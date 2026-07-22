// frontend/src/lib/faceScan.js
// OWNED BY: FaceCheck-Pro (Vimal)
//
// The client-side biometric engine: a 128-float face embedding, an FFT-based
// voiceprint embedding, and the cosine-similarity helper both are matched with.
// Shared by the desktop scanner (UnifiedScannerPage), the mobile scanner
// (MobileScannerPage), the kiosk (KioskScannerPage) and the delegate
// self-enrollment app (EnrollPage) so there is ONE copy of the maths.
//
// PDPA / "Zero-Image" guarantee: no image and no audio ever leaves the device
// or touches disk. The raw camera pixel buffer is zeroed in place the instant
// the face vector is derived, and the microphone stream is only ever read as
// frequency magnitudes (never recorded to a Blob/WAV) before being torn down.
// Only the anonymous numeric vector is transmitted.

/* ===========================================================================
 * FACE — 128-float embedding
 * ---------------------------------------------------------------------------
 * Two complementary 64-value descriptors over an 8x8 grid of the grayscale
 * frame, concatenated into a single 128-float vector:
 *   [0..63]   block mean luminance  — coarse facial geometry / shading layout
 *             (brow ridge, eye sockets, nose bridge, jawline all show up as a
 *             stable light/dark arrangement)
 *   [64..127] block gradient energy — local edge strength, i.e. where the
 *             contours actually are, which is what separates two people whose
 *             overall brightness happens to match.
 * Both halves are normalised to 0..1 so neither dominates the cosine score.
 * ========================================================================= */
const GRID = 8;            // 8x8 -> 64 cells per descriptor -> 128 floats total
export const FACE_CROP = 0.9; // fraction of the short edge used as the face box

/* Shared framing rule. THIS IS WHY THE CIRCLE GUIDE EXISTS: the descriptor is
 * position-sensitive, so a face sitting in a different part of the frame at
 * scan time than at enrollment produces a different vector and fails to match.
 * Every capture — enrollment, mobile scanner, desktop scanner, kiosk — is
 * cropped to the SAME centred square, so as long as the delegate puts their
 * face in the on-screen circle both times, the two vectors are comparable.
 * Returns the crop box in pixels for a given frame size. */
export function faceCropBox(width, height) {
  const side = Math.floor(Math.min(width, height) * FACE_CROP);
  return {
    x0: Math.floor((width - side) / 2),
    y0: Math.floor((height - side) / 2),
    side,
  };
}

/** Grayscale + gradient buffers for the centred crop only. Internal helper
 *  shared by the vectorizer and the alignment probe. */
function cropBuffers(imageData) {
  const px = imageData.data;
  const width = imageData.width;
  const height = imageData.height;
  const { x0, y0, side } = faceCropBox(width, height);

  const gray = new Float32Array(side * side);
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const src = ((y0 + y) * width + (x0 + x)) * 4;
      gray[y * side + x] = 0.299 * px[src] + 0.587 * px[src + 1] + 0.114 * px[src + 2];
    }
  }
  const grad = new Float32Array(side * side);
  for (let y = 1; y < side - 1; y += 1) {
    for (let x = 1; x < side - 1; x += 1) {
      const i = y * side + x;
      const gx = gray[i + 1] - gray[i - 1];
      const gy = gray[i + side] - gray[i - side];
      grad[i] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return { gray, grad, side };
}

export function vectorizeFaceLandmarks(imageData) {
  const px = imageData.data;
  const { gray, grad, side } = cropBuffers(imageData);

  // Accumulate both descriptors over an 8x8 grid of the CROP
  const cell = Math.max(1, Math.floor(side / GRID));
  const lumaCells = new Array(GRID * GRID).fill(0);
  const edgeCells = new Array(GRID * GRID).fill(0);

  for (let row = 0; row < GRID; row += 1) {
    for (let col = 0; col < GRID; col += 1) {
      const startY = row * cell;
      const endY = row === GRID - 1 ? side : Math.min(side, startY + cell);
      const startX = col * cell;
      const endX = col === GRID - 1 ? side : Math.min(side, startX + cell);
      let lSum = 0, gSum = 0, n = 0;
      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          lSum += gray[y * side + x];
          gSum += grad[y * side + x];
          n += 1;
        }
      }
      const k = row * GRID + col;
      lumaCells[k] = n ? lSum / n : 0;
      edgeCells[k] = n ? gSum / n : 0;
    }
  }

  // LIGHTING NORMALISATION: z-score the luma cells (subtract the mean, divide
  // by the standard deviation) so the descriptor encodes the *pattern* of
  // light and shade across the face rather than how bright the room was. A
  // delegate enrolling by a window and scanning inside a dim coach still
  // produces comparable vectors. Edge cells are scaled by their own max for
  // the same reason.
  const lMean = lumaCells.reduce((a, b) => a + b, 0) / lumaCells.length;
  const lStd = Math.sqrt(lumaCells.reduce((a, b) => a + (b - lMean) ** 2, 0) / lumaCells.length) || 1;
  const maxEdge = Math.max(1e-6, ...edgeCells);
  const vector = [
    ...lumaCells.map((v) => +((v - lMean) / lStd).toFixed(4)),
    ...edgeCells.map((v) => +(v / maxEdge).toFixed(4)),
  ];

  // 5) Short stable hash of the vector (token identity / debugging only —
  // matching uses the vector itself, never this hash).
  let h = 2166136261;
  const featureString = vector.join(",");
  for (let i = 0; i < featureString.length; i += 1) {
    h = ((h ^ featureString.charCodeAt(i)) * 16777619) >>> 0;
  }

  // v3 = 128 floats, comma-separated (v2 was 32 dot-separated integers).
  const token = `face:v3:${h.toString(16)}:${vector.join(",")}`;

  // ---- Zero-Image purge: wipe every buffer that held the frame ------------
  gray.fill(0);
  grad.fill(0);
  px.fill(0);
  return token;
}

/* ===========================================================================
 * FACE ALIGNMENT GATE (Singpass-style)
 * ---------------------------------------------------------------------------
 * Decides whether a real face is properly filling the circle BEFORE anything
 * is captured. Four independent conditions must all hold:
 *
 *   1. PRESENCE + SIZE — the fraction of the circle covered by skin-tone
 *      pixels. Too little = no face / too far away; too much = too close.
 *   2. CENTRING       — the centroid of that skin region must sit near the
 *      middle of the circle, not off to one edge.
 *   3. FEATURES       — enough edge energy INSIDE the skin region to be an
 *      actual face (eyes/nose/mouth), not a blank palm or a bare arm.
 *   4. EXPOSURE       — not too dark, not blown out.
 *
 * SKIN DETECTION FAIRNESS: this uses YCbCr *chrominance* bounds rather than
 * the common RGB rules (R>95 && R>G && R>B …), which systematically fail on
 * darker skin because they encode brightness assumptions. Melanin changes
 * luma (Y) far more than it changes hue (Cb/Cr), so gating on chrominance with
 * a permissive luma floor detects the full range of skin tones. Getting this
 * wrong would mean the scanner simply refusing to see some delegates.
 *
 * Returns { ready, status, hint, coverage, offset, detail, brightness }.
 * The sampled pixels are zeroed afterwards — same Zero-Image rule as capture.
 * ========================================================================= */
export function faceAlignment(imageData) {
  const px = imageData.data;
  const width = imageData.width;
  const height = imageData.height;
  const { x0, y0, side } = faceCropBox(width, height);
  const r = side / 2;
  const cx = r, cy = r; // circle centre in crop coords

  let skin = 0, inCircle = 0, sumX = 0, sumY = 0, lumaSum = 0;
  let skinLumaSum = 0;

  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy > r * r) continue; // circle only
      inCircle += 1;

      const i = ((y0 + y) * width + (x0 + x)) * 4;
      const R = px[i], G = px[i + 1], B = px[i + 2];
      const Y = 0.299 * R + 0.587 * G + 0.114 * B;
      const Cb = 128 - 0.168736 * R - 0.331264 * G + 0.5 * B;
      const Cr = 128 + 0.5 * R - 0.418688 * G - 0.081312 * B;
      lumaSum += Y;

      // Permissive luma floor (Y > 25) keeps deep skin tones in range.
      const isSkin = Y > 25 && Cb >= 74 && Cb <= 138 && Cr >= 128 && Cr <= 182;
      if (!isSkin) continue;
      skin += 1;
      sumX += x; sumY += y;
      skinLumaSum += Y;

    }
  }

  const coverage = inCircle ? skin / inCircle : 0;
  const brightness = inCircle ? lumaSum / inCircle / 255 : 0;
  const meanSkinLuma = skin ? skinLumaSum / skin : 0;

  /* FEATURE TEST — "is this a face, or just a hand/arm/forehead?"
   *
   * Structural, not textural: a face contains DARK OPENINGS (eye sockets,
   * nostrils, mouth line) sitting inside the skin region; a bare arm or palm
   * is a smooth skin field with none. So count pixels inside the circle that
   * are markedly darker than THIS person's own mean skin brightness.
   *
   * FAIRNESS: the darkness threshold is a fraction of the subject's own
   * meanSkinLuma, never an absolute value. An earlier version measured
   * absolute edge energy, which silently failed deep skin tones (their
   * features produce proportionally smaller absolute gradients) while passing
   * lighter ones with identical framing — it would have refused to see some
   * delegates entirely. Measuring relative to the subject's own skin makes
   * the test behave the same across the full tone range. */
  const darkCut = meanSkinLuma * 0.72;
  let featurePx = 0, faceArea = 0;
  if (skin > 0) {
    // Search ONLY inside the detected face itself — a disc centred on the skin
    // centroid, sized from the skin area and shrunk slightly to stay clear of
    // the edge. Scanning the whole circle instead would count the darker
    // BACKGROUND as "features" for light-skinned subjects (their skin is far
    // brighter than the backdrop, so the relative dark-cut swallows it) while
    // counting almost nothing for dark-skinned ones — the metric would measure
    // the backdrop, not the person.
    const faceCX = sumX / skin, faceCY = sumY / skin;
    const rf = Math.sqrt(skin / Math.PI) * 0.8;
    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        const dx = x - faceCX, dy = y - faceCY;
        if (dx * dx + dy * dy > rf * rf) continue;
        faceArea += 1;
        const i = ((y0 + y) * width + (x0 + x)) * 4;
        const Y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        if (Y < darkCut && Y > 3) featurePx += 1;
      }
    }
  }
  // Fraction of the face interior taken up by dark openings (eyes, nostrils,
  // mouth). A real face has several percent; a bare arm or palm has ~none.
  const detail = faceArea ? featurePx / faceArea : 0;
  // Normalised distance of the face centroid from the circle centre (0 = dead
  // centre, 1 = on the rim).
  const offset = skin
    ? Math.hypot(sumX / skin - cx, sumY / skin - cy) / r
    : 1;

  px.fill(0); // Zero-Image purge of the probe frame

  let status = "ready";
  let hint = "Hold still…";
  if (brightness < 0.10) { status = "too_dark"; hint = "Too dark — find better light"; }
  else if (brightness > 0.97) { status = "too_bright"; hint = "Too bright — move out of the glare"; }
  else if (coverage < 0.10) { status = "no_face"; hint = "No face detected — look at the camera"; }
  else if (coverage < 0.30) { status = "too_far"; hint = "Move closer — fill the circle"; }
  else if (coverage > 0.88) { status = "too_close"; hint = "Move back a little"; }
  else if (offset > 0.30) { status = "off_center"; hint = "Centre your face in the circle"; }
  // 0.015 sits well clear of both ends: featureless skin measures ~0.000 for
  // every tone, while the weakest real face measured ~0.032 (deepest tone,
  // where features have the least contrast against the skin around them).
  else if (detail < 0.015) { status = "no_features"; hint = "Face the camera directly"; }

  return { ready: status === "ready", status, hint, coverage, offset, detail, brightness };
}

/* ===========================================================================
 * MULTI-SAMPLE CAPTURE
 * ---------------------------------------------------------------------------
 * A single frame is a poor biometric sample: one blink, one motion-blurred
 * frame or one flicker of auto-exposure and the stored vector is wrong for
 * good. Enrollment and scanning therefore take SEVERAL vectorized frames and
 * combine them:
 *
 *   - averageFaceVectors() returns the element-wise mean, which cancels
 *     per-frame sensor noise and gives a more stable template.
 *   - sampleConsistency() returns the WORST pairwise cosine between the
 *     samples. If the subject moved or someone else stepped in mid-capture
 *     the samples disagree, and the caller discards the whole attempt rather
 *     than storing a smeared average of two different faces.
 * ========================================================================= */
export function averageFaceVectors(vectors) {
  const valid = (vectors || []).filter((v) => Array.isArray(v) && v.length);
  if (!valid.length) return null;
  const n = Math.min(...valid.map((v) => v.length));
  const out = new Array(n).fill(0);
  for (const v of valid) for (let i = 0; i < n; i += 1) out[i] += v[i];
  return out.map((s) => +(s / valid.length).toFixed(4));
}

export function sampleConsistency(vectors) {
  const valid = (vectors || []).filter((v) => Array.isArray(v) && v.length);
  if (valid.length < 2) return 1;
  let worst = 1;
  for (let i = 0; i < valid.length; i += 1) {
    for (let k = i + 1; k < valid.length; k += 1) {
      worst = Math.min(worst, cosineSimilarity(valid[i], valid[k]));
    }
  }
  return worst;
}

/** Re-emit an averaged vector as a normal `face:v3:<hash>:<…>` token. */
export function buildFaceToken(vector) {
  if (!Array.isArray(vector) || !vector.length) return null;
  let h = 2166136261;
  const s = vector.join(",");
  for (let i = 0; i < s.length; i += 1) h = ((h ^ s.charCodeAt(i)) * 16777619) >>> 0;
  return `face:v3:${h.toString(16)}:${s}`;
}

/* ===========================================================================
 * VOICE — FFT frequency-spectrum embedding (Web Audio API)
 * ---------------------------------------------------------------------------
 * Reads the live mic stream through an AnalyserNode (which performs the Fast
 * Fourier Transform for us), samples the magnitude spectrum ~20x/second for
 * `durationMs`, and averages it into a 64-band voiceprint. Captures the
 * speaker's formant/resonance distribution rather than the words themselves.
 *
 * Zero raw audio retention: the samples are frequency magnitudes only — audio
 * is never written to a MediaRecorder, Blob, or file — and the stream + audio
 * graph are torn down before this resolves.
 *
 * Resolves to a `voice:v2:<hash>:<64 floats>` token, or null if the mic was
 * silent (so the caller can ask the delegate to speak up rather than enrolling
 * a meaningless all-zero vector).
 * ========================================================================= */
export async function captureVoiceEmbedding(durationMs = 2500, onLevel) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx || !navigator.mediaDevices) throw new Error("Web Audio API unavailable in this browser.");

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new Ctx();
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
  };

  try {
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;          // 512 frequency bins
    analyser.smoothingTimeConstant = 0.4;
    source.connect(analyser);

    const bins = analyser.frequencyBinCount;      // 512
    const spectrum = new Uint8Array(bins);
    const BANDS = 64;
    const perBand = Math.floor(bins / BANDS);     // 8 bins per band
    const acc = new Float64Array(BANDS);
    let frames = 0;
    let peak = 0;

    await new Promise((resolve) => {
      const started = performance.now();
      const tick = () => {
        analyser.getByteFrequencyData(spectrum);
        let frameEnergy = 0;
        for (let b = 0; b < BANDS; b += 1) {
          let sum = 0;
          for (let i = 0; i < perBand; i += 1) sum += spectrum[b * perBand + i];
          const v = sum / perBand;
          acc[b] += v;
          frameEnergy += v;
        }
        frames += 1;
        const level = frameEnergy / BANDS / 255;
        if (level > peak) peak = level;
        if (onLevel) onLevel(level);
        if (performance.now() - started >= durationMs) { resolve(); return; }
        setTimeout(tick, 50);
      };
      tick();
    });

    spectrum.fill(0); // purge the last spectrum frame

    // Too quiet to be a real utterance — don't enroll silence.
    if (frames === 0 || peak < 0.04) return null;

    const maxBand = Math.max(1e-6, ...Array.from(acc, (v) => v / frames));
    const vector = Array.from(acc, (v) => +((v / frames) / maxBand).toFixed(4));

    let h = 2166136261;
    const s = vector.join(",");
    for (let i = 0; i < s.length; i += 1) h = ((h ^ s.charCodeAt(i)) * 16777619) >>> 0;
    return `voice:v2:${h.toString(16)}:${vector.join(",")}`;
  } finally {
    cleanup();
  }
}

/* Legacy typed-passphrase voiceprint (v1). Kept as the manual fallback for
 * browsers with no microphone/Web Audio support: it hashes the SPOKEN WORDS
 * rather than the voice, so the server matches it exactly instead of by
 * acoustic similarity. Not a biometric — a shared secret. */
export function vectorizeVoiceprint(passphrase) {
  let h = 5381;
  for (let i = 0; i < passphrase.length; i++) h = ((h * 33) ^ passphrase.charCodeAt(i)) >>> 0;
  return `voice:v1:${h.toString(16)}:${passphrase.length}`;
}

/* ===========================================================================
 * Matching maths (mirrored server-side in routes/vimal.js)
 * ========================================================================= */

// Cosine similarity of the MEAN-CENTRED vectors. Centring matters: raw face
// descriptors all share a large common component (every face crop is broadly
// bright in the middle), which pins plain cosine at ~0.99 for everyone and
// makes a 0.85 threshold meaningless. Centring removes that shared baseline so
// genuine matches (~0.9+) separate cleanly from different people (~0.3-0.6).
export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return -1;
  const n = Math.min(a.length, b.length);
  if (n < 8) return -1;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i += 1) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i] - ma, y = b[i] - mb;
    dot += x * y; na += x * x; nb += y * y;
  }
  if (na === 0 || nb === 0) return -1;
  return dot / Math.sqrt(na * nb);
}

// Back-compat alias — earlier code called this faceSimilarity().
export const faceSimilarity = cosineSimilarity;

// Parse the numeric vector back out of a `face:v3:<hash>:<v0,v1,…>` (or the
// older v2 `<v0.v1.…>` integer form) token. Returns null when there's no
// vector payload.
export function parseFaceVector(token) {
  return parseVectorToken(token, "face");
}

// Same for a `voice:v2:<hash>:<v0,v1,…>` FFT voiceprint. A legacy v1 token
// carries no vector (it's a passphrase hash), so this returns null for it and
// the server falls back to exact-hash matching.
export function parseVoiceVector(token) {
  return parseVectorToken(token, "voice");
}

function parseVectorToken(token, kind) {
  if (typeof token !== "string") return null;
  const parts = token.split(":");
  if (parts.length < 4) return null;
  if (parts[0].toLowerCase() !== kind) return null;
  const payload = parts[3];
  const nums = (payload.includes(",") ? payload.split(",") : payload.split("."))
    .map(Number)
    .filter((x) => Number.isFinite(x));
  return nums.length >= 8 ? nums : null;
}

export function isValidBiometricToken(token) {
  if (!token || typeof token !== "string") return false;
  return /^(face|voice):v\d+:[0-9a-f]+:/i.test(token) && token.length > 20 && !/deadbeef/i.test(token);
}

export function playErrorTone() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 220;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.45);
    osc.onended = () => ctx.close();
  } catch { /* no audio device — the banner alert still shows */ }
}
