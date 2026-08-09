// frontend/src/lib/scanner/faceScan.js
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
 * FACE — 392-float embedding
 * ---------------------------------------------------------------------------
 * The frame is first cropped to the DETECTED FACE (see detectFaceBox) and
 * resampled to a fixed NORM x NORM square, so distance from the camera and
 * position in frame are normalised away before anything is measured. That
 * square is then divided into a GRID x GRID mesh giving two descriptors:
 *   [0 .. 195]   cell mean luminance, z-scored — the pattern of light and
 *                shade across the face (brow ridge, eye sockets, nose bridge,
 *                jawline), independent of how bright the room was.
 *   [196 .. 391] cell gradient energy — where the contours actually are, which
 *                separates two people whose shading happens to be similar.
 * A finer mesh than the original 8x8 is what restores discrimination once the
 * face has been size-normalised: at 8x8 every face looked alike (~0.94 to each
 * other), at 14x14 impostors drop to ~0.89 while genuine re-scans stay ~0.99.
 * ========================================================================= */
const GRID = 14;           // 14x14 -> 196 cells per descriptor -> 392 floats total
const NORM = 84;           // every face is resampled to NORM x NORM before measuring
export const FACE_CROP = 0.9; // circle guide diameter, as a fraction of the short edge

/* Fallback framing (used only when no face can be located): the centred
 * square. Real captures use detectFaceBox() below instead. */
export function faceCropBox(width, height) {
  const side = Math.floor(Math.min(width, height) * FACE_CROP);
  return {
    x0: Math.floor((width - side) / 2),
    y0: Math.floor((height - side) / 2),
    side,
  };
}

/* ---------------------------------------------------------------------------
 * ONE CAPTURE PATH FOR EVERY SURFACE.
 *
 * Pages used to do `drawImage(video, 0, 0, 160, 120)`, which squashes a 16:9
 * webcam into 4:3 — the face comes out horizontally compressed, and by a
 * different amount on a device whose camera has a different aspect ratio. Two
 * captures of the same person could therefore never line up.
 *
 * This takes the largest CENTRED SQUARE of the camera frame and resamples it
 * to a fixed square canvas: no distortion, identical geometry on every device,
 * and it matches what the (square) on-screen preview shows.
 * ------------------------------------------------------------------------- */
export function captureFrame(video, size = 180) {
  if (!video || !video.videoWidth) return null;
  const w = video.videoWidth, h = video.videoHeight;
  const side = Math.min(w, h);
  const sx = Math.floor((w - side) / 2);
  const sy = Math.floor((h - side) / 2);
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(video, sx, sy, side, side, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size);
  canvas.width = 0; canvas.height = 0;
  return data;
}

/* Is this pixel skin? YCbCr chrominance with a permissive luma floor — see the
 * fairness note on faceAlignment() for why this is not an RGB rule. */
function isSkinPx(R, G, B) {
  const Y = 0.299 * R + 0.587 * G + 0.114 * B;
  if (Y <= 25) return false;
  const Cb = 128 - 0.168736 * R - 0.331264 * G + 0.5 * B;
  const Cr = 128 + 0.5 * R - 0.418688 * G - 0.081312 * B;
  return Cb >= 74 && Cb <= 138 && Cr >= 128 && Cr <= 182;
}

/* ---------------------------------------------------------------------------
 * FACE LOCALISATION — the fix that makes enrolment actually match a later scan.
 *
 * The descriptor used to be measured over a FIXED centred window, which meant
 * the numbers changed whenever the person stood nearer/further or a little off
 * to one side. Enrol at arm's length, scan from slightly further back, and the
 * two vectors simply weren't comparable — the match failed even though it was
 * the same face.
 *
 * Now we find the face first (skin centroid + area -> a square box around it)
 * and measure INSIDE that box, resampled to a fixed NORM x NORM grid. Distance
 * and position are normalised away: the descriptor describes the face itself,
 * not where it happened to sit in the frame.
 * ------------------------------------------------------------------------- */
export function detectFaceBox(imageData) {
  const px = imageData.data;
  const w = imageData.width, h = imageData.height;
  let n = 0, sx = 0, sy = 0;
  // Step 2px — plenty accurate for a centroid, 4x cheaper.
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      if (!isSkinPx(px[i], px[i + 1], px[i + 2])) continue;
      n += 1; sx += x; sy += y;
    }
  }
  const sampled = Math.ceil(w / 2) * Math.ceil(h / 2);
  if (n < sampled * 0.02) return null; // essentially no skin -> no face

  const cx = sx / n, cy = sy / n;
  // Area of the sampled skin -> equivalent radius, scaled up to cover forehead
  // and chin (the skin mask misses hair/brows, so the raw blob is smaller than
  // the head). 1.45 was tuned so the box lands on the whole face.
  const r = Math.sqrt((n * 4) / Math.PI) * 1.45;
  const side = Math.max(24, Math.round(r * 2));
  return {
    cx, cy, side,
    x0: Math.round(cx - side / 2),
    y0: Math.round(cy - side / 2),
  };
}

/** Resample a square region of the frame to NORM x NORM greyscale + gradients.
 *  Sampling at a fixed output size is what makes the descriptor scale-free:
 *  a big near face and a small far face both become a 64x64 image of a face. */
function faceBuffers(imageData, box) {
  const px = imageData.data;
  const w = imageData.width, h = imageData.height;
  const side = box.side;
  const gray = new Float32Array(NORM * NORM);

  for (let y = 0; y < NORM; y += 1) {
    for (let x = 0; x < NORM; x += 1) {
      // Nearest-neighbour sample, clamped so a box overhanging the frame edge
      // still yields a usable descriptor instead of reading garbage.
      const srcX = Math.min(w - 1, Math.max(0, Math.round(box.x0 + (x + 0.5) * (side / NORM))));
      const srcY = Math.min(h - 1, Math.max(0, Math.round(box.y0 + (y + 0.5) * (side / NORM))));
      const i = (srcY * w + srcX) * 4;
      gray[y * NORM + x] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    }
  }

  const grad = new Float32Array(NORM * NORM);
  for (let y = 1; y < NORM - 1; y += 1) {
    for (let x = 1; x < NORM - 1; x += 1) {
      const i = y * NORM + x;
      const gx = gray[i + 1] - gray[i - 1];
      const gy = gray[i + NORM] - gray[i - NORM];
      grad[i] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return { gray, grad, side: NORM };
}

function cropBuffers(imageData) {
  const box = detectFaceBox(imageData) || (() => {
    const { x0, y0, side } = faceCropBox(imageData.width, imageData.height);
    return { x0, y0, side };
  })();
  return faceBuffers(imageData, box);
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
  const short = Math.min(width, height);

  const box = detectFaceBox(imageData);
  if (!box) {
    px.fill(0);
    return { ready: false, status: "no_face", hint: "No face detected — look at the camera",
             coverage: 0, offset: 1, detail: 0, brightness: 0, box: null };
  }

  // --- measure inside the detected face box -------------------------------
  const half = box.side / 2;
  let skin = 0, tot = 0, lumaSum = 0, skinLumaSum = 0;
  for (let y = box.y0; y < box.y0 + box.side; y += 2) {
    if (y < 0 || y >= height) continue;
    for (let x = box.x0; x < box.x0 + box.side; x += 2) {
      if (x < 0 || x >= width) continue;
      const i = (y * width + x) * 4;
      const R = px[i], G = px[i + 1], B = px[i + 2];
      const Y = 0.299 * R + 0.587 * G + 0.114 * B;
      tot += 1; lumaSum += Y;
      if (isSkinPx(R, G, B)) { skin += 1; skinLumaSum += Y; }
    }
  }
  const brightness = tot ? lumaSum / tot / 255 : 0;
  const meanSkinLuma = skin ? skinLumaSum / skin : 0;

  /* FEATURE TEST — face vs. bare hand/arm. A face has DARK OPENINGS (eyes,
   * nostrils, mouth) inside the skin region; a palm is a smooth skin field.
   * FAIRNESS: the darkness cut is a fraction of THIS subject's own mean skin
   * luminance, never an absolute value — an absolute threshold silently failed
   * deep skin tones (their features produce proportionally smaller absolute
   * contrast) while passing lighter ones with identical framing. */
  const darkCut = meanSkinLuma * 0.72;
  let featurePx = 0, faceArea = 0;
  for (let y = box.y0; y < box.y0 + box.side; y += 2) {
    if (y < 0 || y >= height) continue;
    for (let x = box.x0; x < box.x0 + box.side; x += 2) {
      if (x < 0 || x >= width) continue;
      const dx = x - box.cx, dy = y - box.cy;
      if (dx * dx + dy * dy > half * half) continue;
      faceArea += 1;
      const i = (y * width + x) * 4;
      const Y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      if (Y < darkCut && Y > 3) featurePx += 1;
    }
  }
  const detail = faceArea ? featurePx / faceArea : 0;

  // How much of the frame the face fills, and how far off-centre it sits.
  const coverage = box.side / short;
  const offset = Math.hypot(box.cx - width / 2, box.cy - height / 2) / (short / 2);

  /* FULL FACE VISIBLE (the Singpass rule): the whole face box must sit inside
   * the frame with a small margin. If any edge is cut off we refuse — half a
   * face enrolled now is a face that never matches later. */
  const m = short * 0.02;
  const cut =
    box.x0 < m || box.y0 < m ||
    box.x0 + box.side > width - m || box.y0 + box.side > height - m;

  px.fill(0); // Zero-Image purge of the probe frame

  let status = "ready";
  let hint = "Hold still…";
  if (brightness < 0.10) { status = "too_dark"; hint = "Too dark — find better light"; }
  else if (brightness > 0.97) { status = "too_bright"; hint = "Too bright — move out of the glare"; }
  else if (coverage < 0.42) { status = "too_far"; hint = "Move closer — fill the circle"; }
  else if (coverage > 1.02) { status = "too_close"; hint = "Move back a little"; }
  else if (cut) { status = "cut_off"; hint = "Show your whole face — it's cut off at the edge"; }
  else if (offset > 0.28) { status = "off_center"; hint = "Centre your face in the circle"; }
  // 0.015 sits clear of both ends: featureless skin measures ~0.000 for every
  // tone, the weakest real face ~0.032 (deepest tone, least feature contrast).
  else if (detail < 0.015) { status = "no_features"; hint = "Face the camera directly"; }

  return { ready: status === "ready", status, hint, coverage, offset, detail, brightness, box };
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
