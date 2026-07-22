// frontend/src/lib/faceScan.js
// Shared face-scan helpers — the PDPA zero-image vectorizer, the biometric
// token validator, and the "SLA missed" error tone. Extracted from
// UnifiedScannerPage.jsx (originally lifted from Vimal's QRCheckInPage.jsx)
// so the desktop scanner (UnifiedScannerPage) and the mobile scanner
// (MobileScannerPage) share ONE copy instead of each keeping their own.
//
// PDPA guarantee: the raw camera pixel buffer is zeroed in place the instant
// the anonymous one-way token is derived — no image is ever stored or sent.

export function vectorizeFaceLandmarks(imageData) {
  const px = imageData.data;
  const width = imageData.width;
  const height = imageData.height;

  const gray = new Uint8ClampedArray(width * height);
  for (let y = 0, idx = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1, idx += 4) {
      const luma = 0.299 * px[idx] + 0.587 * px[idx + 1] + 0.114 * px[idx + 2];
      gray[y * width + x] = Math.round(luma);
    }
  }

  const vector = [];
  const rows = 4;
  const cols = 8;
  const cellW = Math.max(1, Math.floor(width / cols));
  const cellH = Math.max(1, Math.floor(height / rows));

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      let sum = 0;
      let count = 0;
      const startY = row * cellH;
      const endY = Math.min(height, startY + cellH);
      const startX = col * cellW;
      const endX = Math.min(width, startX + cellW);
      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          sum += gray[y * width + x];
          count += 1;
        }
      }
      vector.push(count > 0 ? Math.round(sum / count) : 0);
    }
  }

  let horEdge = 0, verEdge = 0, symmetry = 0, contrast = 0;
  for (let y = 2; y < height - 2; y += 4) {
    for (let x = 2; x < width - 2; x += 4) {
      const center = gray[y * width + x];
      const right = gray[y * width + x + 2];
      const left = gray[y * width + x - 2];
      const down = gray[(y + 2) * width + x];
      const up = gray[(y - 2) * width + x];
      horEdge += Math.abs(center - right);
      verEdge += Math.abs(center - down);
      contrast += Math.abs(right - left) + Math.abs(up - down);
      symmetry += Math.abs(left - right);
    }
  }
  vector.push(
    Math.round(horEdge / 32),
    Math.round(verEdge / 32),
    Math.round(contrast / 32),
    Math.round(symmetry / 32),
  );

  const featureString = vector.map((v) => v.toString(16).padStart(2, "0")).join("");
  let h = 2166136261;
  for (let i = 0; i < featureString.length; i += 1) {
    h = ((h ^ featureString.charCodeAt(i)) * 16777619) >>> 0;
  }
  // Embed the full 32-dim block-luminance vector (not just the first 8) so the
  // server can do a real cosine/correlation match between an enrolled face and
  // a live scan, instead of exact-hash equality (which never survives a second
  // capture under different light). The 4 edge features are left out of the
  // similarity vector on purpose — they're on a different scale from the 0–255
  // block averages and would dominate the correlation. See parseFaceVector()
  // + faceSimilarity() in routes/vimal.js for the matching side.
  const token = `face:v2:${h.toString(16)}:${vector.slice(0, 32).join(".")}`;

  gray.fill(0);
  px.fill(0);
  return token;
}

// Cosine similarity on the mean-centred vectors (a.k.a. Pearson correlation):
// mean-centring removes the overall-brightness component that otherwise makes
// any two face crops look ~0.99 similar, so different people actually separate.
// Shared so the enrollment page and any client-side preview score the same way
// the server does. Returns a value in [-1, 1]; ~1 is the same face.
export function faceSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return -1;
  const n = Math.min(a.length, b.length);
  if (n < 4) return -1;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i += 1) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  if (da === 0 || db === 0) return -1;
  return num / Math.sqrt(da * db);
}

// Parse the numeric similarity vector back out of a `face:v2:<hash>:<v0.v1…>`
// token. Returns null for a non-face token or one with no vector payload.
export function parseFaceVector(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(":");
  if (parts.length < 4 || !/^face$/i.test(parts[0])) return null;
  const nums = parts[3].split(".").map(Number).filter((x) => Number.isFinite(x));
  return nums.length ? nums : null;
}

// Version-agnostic on purpose: vectorizeFaceLandmarks() above emits "v2"
// tokens, but this used to hardcode "v1" only (copied as-is from Vimal's
// original QRCheckInPage.jsx, which has the same mismatch) — that silently
// rejected every real face scan client-side before it ever reached the
// server. Matches the same fix applied to VALID_TOKEN in routes/vimal.js.
export function isValidBiometricToken(token) {
  if (!token || typeof token !== "string") return false;
  return /^(face|voice):v\d+:[0-9a-f]+:/i.test(token) && token.length > 20 && !/deadbeef/i.test(token);
}

// Low-light multi-modal fallback: an audio passphrase, hashed one-way exactly
// like the face path (never the actual audio), so a delegate can still check
// in when the camera can't reliably see them (see the low-light effect in
// each scanner page for why that matters for fairness, not just convenience).
export function vectorizeVoiceprint(passphrase) {
  let h = 5381;
  for (let i = 0; i < passphrase.length; i++) h = ((h * 33) ^ passphrase.charCodeAt(i)) >>> 0;
  return `voice:v1:${h.toString(16)}:${passphrase.length}`;
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
