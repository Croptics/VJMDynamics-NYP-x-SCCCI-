// frontend/src/lib/humanFace.js
// OWNED BY: FaceCheck-Pro (Vimal)
//
// REAL face-recognition engine — replaces the hand-crafted descriptor that used
// to live in faceScan.js. Wraps @vladmandic/human to do, fully on-device:
//   • face detection (blazeface) + 68-point mesh (facemesh)
//   • a real DEEP face embedding (faceres) — the "signature" we match on, the
//     same class of tech phones use for face unlock
//   • anti-spoof (printed photo / screen) + liveness (a live person) so a
//     picture of someone can't enrol or check them in
//
// PRIVACY / PDPA (unchanged guarantee): this is still ZERO-IMAGE. Only the
// numeric embedding ever leaves the device — raw camera pixels stay inside the
// <video>/<canvas> and are never uploaded or stored. The embedding is not
// invertible back into a face image.
//
// Weights are self-hosted under /models/human/ (copied from the npm package by
// scripts/copy-human-models.mjs), so the model set loads offline with no CDN.
//
// Human is heavy (~2MB js + ~10MB weights), so it is loaded lazily via a
// dynamic import the first time the face feature is actually used — it never
// bloats the initial app bundle or the pages that don't scan faces.

let _human = null;     // singleton Human instance once loaded
let _loading = null;   // in-flight load promise (dedupes concurrent callers)

const MODEL_BASE = "/models/human/";

// Gates — tuned conservatively; expect to adjust MATCH_THRESHOLD on-device with
// real faces. All are 0..1.
export const MIN_FACE_SCORE = 0.6;  // detector confidence
export const MIN_LIVE = 0.6;        // liveness (is this a live person?)
export const MIN_REAL = 0.5;        // anti-spoof (1 = real, 0 = photo/screen)
export const MATCH_THRESHOLD = 0.55; // cosine similarity to accept a 1:N match
export const MATCH_MARGIN = 0.03;   // best must beat runner-up by this much

function humanConfig() {
  // ONLY the face pipeline is enabled — body/hand/object/gesture/emotion/iris
  // are off to keep load + inference light.
  return {
    modelBasePath: MODEL_BASE,
    backend: "humangl",
    async: true,
    warmup: "none",
    cacheModels: true,
    filter: { enabled: true, equalization: false },
    face: {
      enabled: true,
      detector: { modelPath: "blazeface.json", rotation: true, maxDetected: 1, minConfidence: 0.4, return: false },
      mesh: { enabled: true, modelPath: "facemesh.json" },
      iris: { enabled: false },
      description: { enabled: true, modelPath: "faceres.json" },
      emotion: { enabled: false },
      antispoof: { enabled: true, modelPath: "antispoof.json" },
      liveness: { enabled: true, modelPath: "liveness.json" },
    },
    body: { enabled: false },
    hand: { enabled: false },
    object: { enabled: false },
    gesture: { enabled: false },
  };
}

/** Load + warm the model the first time it's needed. Safe to call repeatedly. */
export async function loadHuman(onProgress) {
  if (_human) return _human;
  if (_loading) return _loading;
  _loading = (async () => {
    const mod = await import("@vladmandic/human");
    const Human = mod.Human || mod.default;
    const human = new Human(humanConfig());
    if (onProgress) human.events?.addEventListener?.("load", () => onProgress("loading"));
    await human.load();
    try { await human.warmup(); } catch { /* warmup is best-effort */ }
    _human = human;
    return human;
  })();
  return _loading;
}

/** True once models are loaded and ready (for a "warming up…" UI). */
export function isReady() { return !!_human; }

/**
 * Detect the single best face in a <video>/<canvas> element and return the
 * embedding + quality/liveness signals. Never throws — returns { ok:false }.
 */
export async function detectFace(el) {
  if (!el) return { ok: false, hint: "Camera not ready." };
  let human;
  try { human = await loadHuman(); } catch { return { ok: false, hint: "Face model failed to load — check your connection." }; }
  try {
    const res = await human.detect(el);
    const face = res.face && res.face[0];
    if (!face) return { ok: false, hint: "No face detected — center your face in the circle." };
    const embedding = face.embedding && face.embedding.length ? Array.from(face.embedding) : null;
    return {
      ok: true,
      embedding,
      faceScore: face.faceScore ?? face.boxScore ?? face.score ?? 0,
      live: typeof face.live === "number" ? face.live : null,
      real: typeof face.real === "number" ? face.real : null,
      rotation: face.rotation?.angle || null,
    };
  } catch {
    return { ok: false, hint: "Face read failed — hold steady and try again." };
  }
}

/** Quality + anti-spoof + liveness gate. Returns { ready, hint }. */
export function gate(det) {
  if (!det || !det.ok) return { ready: false, hint: det?.hint || "No face detected." };
  if (det.faceScore < MIN_FACE_SCORE) return { ready: false, hint: "Get a clearer, closer view of your face." };
  if (det.real != null && det.real < MIN_REAL) return { ready: false, hint: "Use a live face — a photo or screen won't pass." };
  if (det.live != null && det.live < MIN_LIVE) return { ready: false, hint: "Look at the camera and blink." };
  if (!det.embedding) return { ready: false, hint: "Couldn't read a face signature — try again." };
  return { ready: true, hint: "Aligned — ready to capture" };
}

/** Cosine similarity of two embeddings (0..1). Mirrored on the backend. */
export function similarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/** Average several embeddings into one stable enrolment template. */
export function averageEmbeddings(list) {
  const vecs = (list || []).filter((v) => v && v.length);
  if (!vecs.length) return null;
  const n = vecs[0].length;
  const out = new Array(n).fill(0);
  for (const v of vecs) for (let i = 0; i < n; i += 1) out[i] += v[i];
  for (let i = 0; i < n; i += 1) out[i] /= vecs.length;
  return out;
}

/** Mean pairwise similarity of a sample set — how consistent the capture was. */
export function sampleConsistency(list) {
  const vecs = (list || []).filter((v) => v && v.length);
  if (vecs.length < 2) return 1;
  let sum = 0, count = 0;
  for (let i = 0; i < vecs.length; i += 1)
    for (let j = i + 1; j < vecs.length; j += 1) { sum += similarity(vecs[i], vecs[j]); count += 1; }
  return count ? sum / count : 1;
}

// ---- Face token. Uses the SAME shape as faceScan.js and the backend's
// VALID_TOKEN regex — face:v3:<hex integrity hash>:<comma-separated floats> —
// so it validates and parses identically. The ONLY thing that distinguishes a
// real deep embedding from the legacy hand-crafted descriptor is the vector's
// length (~1024 vs 40), which the backend uses to pick the right matcher +
// threshold. Not an image and not invertible into one.
export function buildEmbeddingToken(embedding) {
  if (!embedding || !embedding.length) return null;
  const s = Array.from(embedding).map((x) => Number(x).toFixed(5)).join(",");
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `face:v3:${h.toString(16)}:${s}`;
}
export function parseEmbeddingToken(token) {
  if (typeof token !== "string" || !token.startsWith("face:v3:")) return null;
  const parts = token.split(":");
  const arr = (parts[3] || "").split(",").map(Number).filter((x) => Number.isFinite(x));
  return arr.length >= 8 ? arr : null;
}
export function isEmbeddingToken(token) {
  const v = parseEmbeddingToken(token);
  return !!v && v.length >= 128; // a real deep embedding, not the legacy descriptor
}
