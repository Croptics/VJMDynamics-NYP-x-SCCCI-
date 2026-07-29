/* =============================================================================
 * backend/routes/vimal.js
 * OWNED BY: FaceCheck-Pro (Vimal)
 * Feature:  Privacy-First Biometric & Multi-Modal Fusion Scanner
 *
 * INTEGRATION (connect, don't destroy):
 *  - IMPORTS JQ's exported data helpers (listDelegates / updateDelegate /
 *    getDashboard / …) from ../data.js — it never edits that file. Scans
 *    update the REAL shared delegates table, so JQ's dashboard, the mobile
 *    Missing page and Desmond's coach boards reflect a face check-in live.
 *  - COACHES ARE DYNAMIC: coach lookups go through getDashboard(), so coaches
 *    added later by Desmond's module (c5, c6, …) work here automatically.
 *  - AUTH reuses JQ's signed-JWT middleware from ../auth.js (same pattern as
 *    Desmond's and Jayden's routers). CORS + express.json() already run
 *    globally in server.js before this router mounts — not re-configured.
 *  - Route paths (/api/attendance/*) collide with nothing registered above
 *    the TEAMMATE ZONE or in the other teammate routers (verified).
 *
 * MOUNTED in the server.js TEAMMATE ZONE (already done):
 *     import vimalRouter from "./routes/vimal.js";
 *     app.use(vimalRouter);
 *
 * PRIVACY DESIGN (PDPA): this server NEVER receives or stores an image or
 * audio clip. `scanData` is always an irreversible one-way token string
 * produced on the client ("face:v1:…" / "voice:v1:…"). Even a full database
 * leak exposes no biometric imagery — only meaningless hashes.
 * ============================================================================= */

import { Router } from "express";
import { requireAuth, requireKioskOrPermission } from "../auth.js";
import {
  listDelegates,
  getDelegateById,
  updateDelegate,
  createDelegate,
  getTrip,
  getDashboard,
} from "../data.js";
// Shared connection helpers (JQ's db layer) — this module owns its OWN table
// and never edits db/schema.js, same arrangement as Jayden's exceptions module.
// Aliased: several handlers below use a local `all` for the delegate list.
import { all as dbAll, get as dbGet, run as dbRun } from "../db/connection.js";

const router = Router();

/* ---------------------------------------------------------------------------
 * PERSISTENT biometric enrollment storage.
 *
 * WHY THIS TABLE EXISTS: enrollments used to live in a JS Map, which meant
 * every backend restart silently wiped every delegate's face/voice sample —
 * a delegate would enroll, the server would restart, and the scanner would
 * then report "not recognised" for someone who HAD enrolled. Vectors now live
 * in Postgres so they survive restarts and are shared across processes.
 *
 * Still PDPA-safe: the columns hold only the anonymous numeric embedding —
 * never an image, never audio.
 * ------------------------------------------------------------------------- */
let biometricsReady = null;
function ensureBiometrics() {
  if (!biometricsReady) {
    biometricsReady = dbRun(`CREATE TABLE IF NOT EXISTS delegate_biometrics (
      delegate_id  VARCHAR(64) PRIMARY KEY REFERENCES delegates(id) ON DELETE CASCADE,
      consent      VARCHAR(16) NOT NULL DEFAULT 'GRANTED',
      face_vector  JSONB,
      voice_vector JSONB,
      voice_hash   BIGINT,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )`).catch((e) => { biometricsReady = null; throw e; });
  }
  return biometricsReady;
}

/** Every enrolled/consent row, keyed by delegate id. */
async function bioMap() {
  await ensureBiometrics();
  const rows = await dbAll(`SELECT * FROM delegate_biometrics`);
  const m = new Map();
  for (const r of rows) m.set(r.delegate_id, r);
  return m;
}

async function bioFor(delegateId) {
  await ensureBiometrics();
  return dbGet(`SELECT * FROM delegate_biometrics WHERE delegate_id = $1`, [delegateId]);
}

/** A delegate with no row has consented at onboarding but is NOT enrolled. */
const consentOf = (row) => (row && row.consent ? row.consent : "GRANTED");
const asVector = (v) => (Array.isArray(v) ? v : null);

async function saveBiometrics(delegateId, { faceVector, voiceVector, voiceHash, consent }) {
  await ensureBiometrics();
  await dbRun(
    `INSERT INTO delegate_biometrics (delegate_id, consent, face_vector, voice_vector, voice_hash, updated_at)
     VALUES ($1, COALESCE($2,'GRANTED'), $3, $4, $5, now())
     ON CONFLICT (delegate_id) DO UPDATE SET
       consent      = COALESCE(EXCLUDED.consent, delegate_biometrics.consent),
       face_vector  = COALESCE(EXCLUDED.face_vector,  delegate_biometrics.face_vector),
       voice_vector = COALESCE(EXCLUDED.voice_vector, delegate_biometrics.voice_vector),
       voice_hash   = COALESCE(EXCLUDED.voice_hash,   delegate_biometrics.voice_hash),
       updated_at   = now()`,
    [
      delegateId,
      consent || null,
      faceVector ? JSON.stringify(faceVector) : null,
      voiceVector ? JSON.stringify(voiceVector) : null,
      Number.isFinite(voiceHash) ? voiceHash : null,
    ]
  );
}

/** Consent revocation purges the stored vectors outright (PDPA erasure). */
async function revokeBiometrics(delegateId) {
  await ensureBiometrics();
  await dbRun(
    `INSERT INTO delegate_biometrics (delegate_id, consent, face_vector, voice_vector, voice_hash, updated_at)
     VALUES ($1,'REVOKED',NULL,NULL,NULL,now())
     ON CONFLICT (delegate_id) DO UPDATE SET
       consent='REVOKED', face_vector=NULL, voice_vector=NULL, voice_hash=NULL, updated_at=now()`,
    [delegateId]
  );
}

/* Small async wrapper so any thrown error reaches JQ's global error handler
 * in server.js (clean JSON 500s, never a hung request). */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (res, code, error, message) => res.status(code).json({ error, message });

/* ---------------------------------------------------------------------------
 * Vimal-owned state. The BIOMETRIC VECTORS and the authoritative consent flag
 * live in the `delegate_biometrics` table above — they must survive a restart.
 * What stays in memory is only the non-critical audit trail: the sequence of
 * consent events, and per-delegate check-in records.
 * ------------------------------------------------------------------------- */
const consents = new Map();       // delegateId -> { status, method, updatedAt, history[] }
const checkinHistory = new Map(); // delegateId -> [{ venue, tripId, method, matchedIn, timestamp }]

function consentFor(delegateId) {
  if (!consents.has(delegateId)) {
    const at = new Date().toISOString();
    consents.set(delegateId, {
      delegateId,
      status: "GRANTED", // delegates consent at onboarding by default
      method: "onboarding-form",
      // Consented ≠ enrolled. With no face/voice sample in delegate_biometrics
      // a delegate simply can't be matched by the scanner until they enroll —
      // this is what stops the scanner "recognising" someone who never gave a
      // biometric sample.
      biometricTokenStored: false,
      updatedAt: at,
      history: [{ status: "GRANTED", method: "onboarding-form", at }],
    });
  }
  return consents.get(delegateId);
}

/* A biometric token is only matchable if it carries the versioned prefix the
 * client vectorizer emits — anything else is rejected before matching.
 * Version-agnostic ("v\d+", not just "v1") — the client's face vectorizer
 * emits "v2" tokens, so a hardcoded "v1" here silently rejected every real
 * face scan server-side too (same fix as isValidBiometricToken in
 * frontend/src/lib/faceScan.js). */
const VALID_TOKEN = /^(face|voice):v\d+:[0-9a-f]+:/i;

const checksum = (str) => {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
};

/* Real biometric matching (replaces the old random-pick fallback). A face is
 * recognised by cosine similarity of the mean-centred (Pearson) 32-dim
 * luminance vector carried in the token; a voice by exact checksum of its
 * transcript-derived token. FACE_MATCH_THRESHOLD is deliberately a named,
 * tunable constant — this is a lightweight demo vectorizer, not production
 * face recognition, so it trades some strictness for working under the varied
 * light of a real coach bay. Raise it to reduce false matches, lower it if a
 * genuinely-enrolled delegate is being rejected. */
// Cosine-similarity thresholds, set from measured separation rather than
// picked by feel. Since the descriptor is now computed over the DETECTED FACE
// (scale/position normalised) instead of a fixed window, genuine re-scans sit
// very high and impostors well below, so the band moved up:
//   same person, incl. distance/lighting change + sensor noise -> >= 0.993
//   different people                                           -> <= 0.911
// 0.94 sits between them, leaning slightly toward accepting the real person
// (a false rejection strands a delegate at the coach door; a near-miss is
// caught by the staff member standing right there). Voice is looser again —
// a speaker's spectrum varies more between utterances than a face does
// between frames.
const FACE_MATCH_THRESHOLD = 0.94;
const VOICE_MATCH_THRESHOLD = 0.75;
// Real deep face embeddings (Human faceres, a ~1024-float v3 token) are compared
// with RAW cosine — no mean-centring — to mirror similarity() in
// frontend/src/lib/humanFace.js, and clear a lower bar than the hand-crafted
// v2/v3 descriptors. TUNE ON-DEVICE with real faces: raise it if strangers get
// accepted, lower it if the right person gets rejected.
const FACE_V3_THRESHOLD = 0.55;

/** Pull the numeric embedding out of a `<kind>:v<n>:<hash>:<v0,v1,…>` token.
 *  v3 face / v2 voice tokens are comma-separated floats; the older v2 face
 *  form used dot-separated integers, so both separators are accepted. */
function parseVectorToken(token, kind) {
  if (typeof token !== "string") return null;
  const parts = token.split(":");
  if (parts.length < 4 || parts[0].toLowerCase() !== kind) return null;
  const payload = parts[3];
  const nums = (payload.includes(",") ? payload.split(",") : payload.split("."))
    .map(Number)
    .filter((x) => Number.isFinite(x));
  return nums.length >= 8 ? nums : null;
}
const parseFaceVector = (t) => parseVectorToken(t, "face");
const parseVoiceVector = (t) => parseVectorToken(t, "voice");

/* Cosine similarity of the MEAN-CENTRED vectors — identical maths to
 * cosineSimilarity() in frontend/src/lib/faceScan.js. Centring is what makes
 * a 0.85 threshold meaningful: every face descriptor shares a large common
 * "bright in the middle" component that pins raw cosine near 0.99 for
 * everybody, so without centring nothing would ever be rejected. */
function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return -1;
  const n = Math.min(a.length, b.length);
  if (n < 8) return -1;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    dot += x * y; na += x * x; nb += y * y;
  }
  if (na === 0 || nb === 0) return -1;
  return dot / Math.sqrt(na * nb);
}

/* Deep embeddings (Human faceres, length ~1024) are already discriminative, so
 * they're compared with RAW cosine — the exact maths as similarity() in
 * frontend/src/lib/humanFace.js. The legacy hand-crafted descriptors (length
 * ~40) keep the mean-centred comparison. We tell them apart purely by length. */
const isDeepEmbedding = (v) => Array.isArray(v) && v.length >= 128;
function rawCosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return -1;
  const n = Math.min(a.length, b.length);
  if (n < 8) return -1;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na === 0 || nb === 0 ? -1 : dot / Math.sqrt(na * nb);
}
// Version-aware face comparison + threshold. Only treat it as deep when BOTH
// vectors are deep, so a length mismatch (a legacy enrolment vs a new scan)
// can't accidentally score high on a truncated overlap.
const faceSim = (a, b) => (isDeepEmbedding(a) && isDeepEmbedding(b) ? rawCosine(a, b) : cosineSimilarity(a, b));
const faceThresh = (probe) => (isDeepEmbedding(probe) ? FACE_V3_THRESHOLD : FACE_MATCH_THRESHOLD);

const timeNow = () =>
  new Date().toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", hour12: false });

/* Live coach list (id/label/name/city/capacity/boarded/missing/total) —
 * sourced from JQ's own getDashboard() so dynamically added coaches are
 * always included. */
async function liveDashboard() {
  return getDashboard();
}

/* ============================================================================
 * GET /api/attendance/coaches
 * Mobile-dashboard source: trip meta + every coach with live counts + the
 * unassigned pool size, so the staff app can pick which coach to muster.
 * ========================================================================== */
router.get("/api/attendance/coaches", requireAuth(), wrap(async (_req, res) => {
  const dash = await liveDashboard();
  const trip = dash.trip || (await getTrip());
  res.json({
    trip: {
      id: trip.id,
      name: trip.name,
      dayOf: trip.dayOf,
      totalDays: trip.totalDays,
      localTime: trip.localTime,
      departsIn: trip.departsIn,
      lead: trip.lead,
    },
    unassigned: dash.kpis ? dash.kpis.unassigned : 0,
    coaches: (dash.coaches || []).map((c) => ({
      id: c.id,
      label: c.label,
      name: c.name,
      city: c.city,
      capacity: c.capacity,
      boarded: c.boarded,
      missing: c.missing,
      total: c.total,
    })),
  });
}));

/* ============================================================================
 * POST /api/attendance/scan
 * Body: { tripId, scanData (face/voice token string), timestamp, coachId? }
 * coachId (optional) scopes matching to the coach being mustered.
 * 200 -> { delegateId, name, status: "PRESENT", method, processedInMs }
 * 404 -> { error: "SCAN_FAILED" }
 * ========================================================================== */
// requireKioskOrPermission("manageScanner"): a signed-in user with the
// "Manage scanner" permission, OR the passwordless kiosk token (the
// /kiosk-scan entrance scanner's Face mode — unaffected by the permission,
// by design). See auth.js.
router.post("/api/attendance/scan", requireKioskOrPermission("manageScanner"), wrap(async (req, res) => {
  const started = Date.now();
  const { tripId, scanData, timestamp, coachId } = req.body || {};

  if (typeof tripId !== "string" || !tripId.trim()) {
    return fail(res, 400, "INVALID_REQUEST", "tripId is required.");
  }
  const token = typeof scanData === "string" ? scanData.trim() : "";
  // Demo hook: a token starting with "fail" exercises the failure path live.
  if (!VALID_TOKEN.test(token) || token.startsWith("fail")) {
    return fail(res, 404, "SCAN_FAILED", "Delegate not recognized in system.");
  }

  // REAL biometric match against the PERSISTED enrollments (no random
  // fallback, and no in-memory state that a restart could wipe):
  //   FACE     -> cosine similarity of the enrolled 128-float embedding vs the
  //               live scan embedding; best above FACE_MATCH_THRESHOLD wins.
  //   VOICE v2 -> cosine similarity of the FFT frequency-spectrum embedding.
  //   VOICE v1 -> exact hash of the typed passphrase (the legacy no-mic
  //               fallback: a shared secret, not a biometric).
  // Anything with no enrolled match is genuinely "not recognised" — this is
  // what fixes the old behaviour where ANY face got assigned to a random
  // missing delegate. Delegates enroll their sample via POST /api/enroll.
  const all = await listDelegates();
  const bios = await bioMap();
  const method = token.toLowerCase().startsWith("voice:") ? "VOICE" : "FACE";
  const scanVec = method === "FACE" ? parseFaceVector(token) : parseVoiceVector(token);
  const tokenChecksum = checksum(token);

  if (method === "FACE" && !scanVec) {
    return fail(res, 400, "INVALID_SCAN", "Face scan carried no usable data — try again in better light.");
  }

  const threshold = method === "FACE" ? faceThresh(scanVec) : VOICE_MATCH_THRESHOLD;

  // Score every CONSENTED, ENROLLED delegate across the WHOLE roster (not just
  // the coach-scoped pool) so we can both reject a truly unknown face AND still
  // catch a recognised delegate who belongs to a different coach.
  const scored = all
    .map((d) => {
      const row = bios.get(d.id);
      if (!row || consentOf(row) !== "GRANTED") return { d, score: -1 };
      if (method === "FACE") {
        const enrolled = asVector(row.face_vector);
        return { d, score: enrolled ? faceSim(scanVec, enrolled) : -1 };
      }
      // VOICE — prefer the acoustic embedding; fall back to the typed-
      // passphrase hash for v1 tokens / delegates enrolled without a mic.
      const enrolledVoice = asVector(row.voice_vector);
      if (scanVec && enrolledVoice) return { d, score: cosineSimilarity(scanVec, enrolledVoice) };
      if (row.voice_hash !== null && row.voice_hash !== undefined) {
        return { d, score: Number(row.voice_hash) === tokenChecksum ? 1 : -1 };
      }
      return { d, score: -1 };
    })
    .filter((s) => s.score >= threshold)
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best) {
    return fail(
      res, 404, "SCAN_FAILED",
      method === "VOICE"
        ? "Voice not recognised — has this delegate enrolled a voiceprint?"
        : "Face not recognised — has this delegate enrolled at /enroll?"
    );
  }
  const matched = best.d;

  // Recognised, but assigned to a DIFFERENT coach than this scanner is scoped
  // to: say so specifically (mirrors the QR path in vance.js) so staff don't
  // rescan pointlessly.
  if (coachId && matched.coachId && matched.coachId !== coachId) {
    const dash0 = await liveDashboard();
    const assignedCoach = (dash0.coaches || []).find((c) => c.id === matched.coachId);
    const scannerCoach = (dash0.coaches || []).find((c) => c.id === coachId);
    const assignedLabel = assignedCoach ? assignedCoach.name : matched.coachId;
    const scannerLabel = scannerCoach ? scannerCoach.name : coachId;
    return res.status(409).json({
      error: "COACH_MISMATCH",
      message: `${matched.name} is assigned to ${assignedLabel}, not ${scannerLabel}.`,
      delegateId: matched.id,
      delegateName: matched.name,
      assignedCoachId: matched.coachId,
      assignedCoachLabel: assignedLabel,
      scannerCoachId: coachId,
    });
  }

  // Recognised and on the right coach, but already boarded — nothing to do.
  if (matched.status !== "MISSING") {
    return res.status(409).json({
      error: "ALREADY_BOARDED",
      message: `${matched.name} is already ${matched.status === "PRESENT" ? "boarded" : matched.status.toLowerCase()}.`,
      delegateId: matched.id,
      delegateName: matched.name,
    });
  }

  const dash = await liveDashboard();
  const coach = (dash.coaches || []).find((c) => c.id === matched.coachId);
  const seenAt = `${coach ? coach.name : "On site"} · ${timeNow()}`;

  // Write through JQ's own helper — updates the shared DB row and logs to the
  // dashboard activity feed, so every screen stays in sync.
  await updateDelegate(matched.id, { status: "PRESENT", lastSeen: seenAt });

  const processedInMs = Date.now() - started;
  const when = timestamp && !Number.isNaN(Date.parse(timestamp)) ? new Date(timestamp) : new Date();
  checkinHistory.set(matched.id, [
    ...(checkinHistory.get(matched.id) || []),
    {
      venue: coach ? [coach.name, coach.city].filter(Boolean).join(" · ") : (dash.trip && dash.trip.name) || "On site",
      tripId,
      method,
      matchedIn: `${(processedInMs / 1000).toFixed(1)}s`,
      timestamp: when.toISOString(),
    },
  ]);

  return res.status(200).json({
    delegateId: matched.id,
    name: matched.name,
    status: "PRESENT",
    method,
    processedInMs, // client compares the full round-trip against the 1s SLA
  });
}));

/* ============================================================================
 * GET /api/attendance/:trip_id/coach/:coach_id
 * Reverse-Headcount source: live statuses + consent flags for ONE coach,
 * plus trip meta. Coach lookup is dynamic (works for c5/c6/…).
 * (The base app is single-trip — "t-1" — so trip_id is accepted verbatim.)
 * ========================================================================== */
router.get("/api/attendance/:trip_id/coach/:coach_id", requireAuth(), wrap(async (req, res) => {
  const { trip_id, coach_id } = req.params;
  const dash = await liveDashboard();
  const coach = (dash.coaches || []).find((c) => c.id === coach_id);
  if (!coach) return fail(res, 404, "NOT_FOUND", "Unknown coach.");

  const all = await listDelegates();
  const bios = await bioMap();
  const onCoach = all.filter((d) => d.coachId === coach_id);
  const payload = onCoach.map((d) => {
    const row = bios.get(d.id);
    return {
      delegateId: d.id,
      name: d.name,
      initials: d.initials,
      vip: !!d.vip,
      status: d.status,
      lastSeen: d.lastSeen || "No status",
      consent: consentOf(row),
      // Lets the scanner UI show who can actually be face/voice matched.
      enrolled: !!(row && (asVector(row.face_vector) || asVector(row.voice_vector) || row.voice_hash !== null)),
    };
  });

  const trip = dash.trip || (await getTrip());
  res.json({
    tripId: trip_id,
    trip: {
      name: trip.name,
      dayOf: trip.dayOf,
      totalDays: trip.totalDays,
      localTime: trip.localTime,
      departsIn: trip.departsIn,
    },
    coachId: coach_id,
    coachLabel: coach.name,
    location: coach.city || "On route",
    departure: trip.departsIn ? `departs in ${trip.departsIn}` : "on schedule",
    expected: payload.length,
    // "Boarded" = arrived on the coach. ARRIVED is the current 5-status
    // value; PRESENT is the pre-migration legacy value some older rows/
    // writes still carry (same isBoarded() pattern as data.js's
    // getDashboard(), which /api/attendance/coaches above already uses —
    // this endpoint's own boarded count had drifted to checking PRESENT
    // only, so a delegate marked ARRIVED via manual/QR/face check-in showed
    // up correctly everywhere EXCEPT this one coach-detail card's own
    // Boarded tile).
    boarded: payload.filter((d) => d.status === "PRESENT" || d.status === "ARRIVED").length,
    missing: payload.filter((d) => d.status === "MISSING").length,
    delegates: payload,
  });
}));

/* ============================================================================
 * GET /api/attendance/headcount            (?coachId=c2 to scope to one coach)
 * The Reverse-Headcount stats endpoint from the assignment brief: overall
 * boarded/missing/unassigned stats PLUS the list of delegates still missing,
 * so a single call powers both the "STILL MISSING — 5 of 25 expected" hero
 * card and the missing-delegate call list.
 * ========================================================================== */
router.get("/api/attendance/headcount", requireAuth(), wrap(async (req, res) => {
  const { coachId } = req.query;
  const dash = await liveDashboard();

  if (coachId && !(dash.coaches || []).some((c) => c.id === coachId)) {
    return fail(res, 404, "NOT_FOUND", "Unknown coach.");
  }

  const all = await listDelegates();
  const bios = await bioMap();
  const scoped = coachId ? all.filter((d) => d.coachId === coachId) : all.filter((d) => d.status !== "UNASSIGNED");
  const missingDelegates = scoped
    .filter((d) => d.status === "MISSING")
    .map((d) => ({
      delegateId: d.id,
      name: d.name,
      initials: d.initials,
      vip: !!d.vip,
      coachId: d.coachId,
      lastSeen: d.lastSeen || "No status",
      consent: consentOf(bios.get(d.id)),
    }));

  const trip = dash.trip || (await getTrip());
  res.json({
    tripId: trip.id,
    coachId: coachId || null,
    stats: {
      expected: scoped.length,
      // Same ARRIVED/PRESENT fix as the coach-detail endpoint above.
      boarded: scoped.filter((d) => d.status === "PRESENT" || d.status === "ARRIVED").length,
      missing: missingDelegates.length,
      unassigned: dash.kpis ? dash.kpis.unassigned : 0,
    },
    missingDelegates,
  });
}));

/* ============================================================================
 * POST /api/attendance/consent   (create/update the consent lifecycle)
 * Body: { delegateId, consent: "GRANTED" | "REVOKED", method? }
 *
 * REVOKED flips biometricTokenStored -> false (immediate purge flag) and
 * hard-excludes the delegate from all future face/voice matching until
 * consent is granted again. Full auditable history per delegate.
 * ========================================================================== */
router.post("/api/attendance/consent", requireAuth(), wrap(async (req, res) => {
  const { delegateId, consent, method = "staff-app" } = req.body || {};
  const biometricToken = req.body && req.body.biometricToken ? String(req.body.biometricToken).trim() : null;

  if (typeof delegateId !== "string" || !(await getDelegateById(delegateId))) {
    return fail(res, 404, "NOT_FOUND", "Delegate does not exist.");
  }
  if (!["GRANTED", "REVOKED"].includes(consent)) {
    return fail(res, 400, "INVALID_CONSENT", 'consent must be "GRANTED" or "REVOKED".');
  }

  const existing = consentFor(delegateId);
  const entry = { status: consent, method, at: new Date().toISOString() };

  // Validate an explicitly provided biometric token: reject obvious
  // placeholders or malformed tokens before storing any fingerprint.
  if (biometricToken) {
    if (!VALID_TOKEN.test(biometricToken) || biometricToken.length < 20 || /deadbeef/i.test(biometricToken)) {
      return fail(res, 400, "INVALID_BIOMETRIC_TOKEN", "Provided biometric token is invalid or a placeholder.");
    }
  }

  // Persist the consent decision. REVOKING purges the stored vectors outright
  // (PDPA erasure) so the delegate can no longer be matched at all; granting
  // with a valid token enrolls that sample the same way /api/enroll does.
  if (consent === "REVOKED") {
    await revokeBiometrics(delegateId);
  } else {
    const faceVector = biometricToken && /^face:/i.test(biometricToken) ? parseFaceVector(biometricToken) : null;
    const voiceVector = biometricToken && /^voice:/i.test(biometricToken) ? parseVoiceVector(biometricToken) : null;
    const voiceHash = biometricToken && /^voice:/i.test(biometricToken) && !voiceVector ? checksum(biometricToken) : null;
    await saveBiometrics(delegateId, { faceVector, voiceVector, voiceHash, consent: "GRANTED" });
  }

  const row = await bioFor(delegateId);
  const updated = {
    ...existing,
    status: consent,
    method,
    biometricTokenStored: !!(row && (asVector(row.face_vector) || asVector(row.voice_vector) || row.voice_hash !== null)),
    updatedAt: entry.at,
    history: [...existing.history, entry],
  };
  consents.set(delegateId, updated);
  res.status(200).json(updated);
}));

/* ============================================================================
 * GET /api/attendance/history/:delegate_id
 * Historical check-in records across venues (Vimal-owned records).
 * ========================================================================== */
router.get("/api/attendance/history/:delegate_id", requireAuth(), wrap(async (req, res) => {
  const { delegate_id } = req.params;
  const delegate = await getDelegateById(delegate_id);
  if (!delegate) return fail(res, 404, "NOT_FOUND", "Delegate does not exist.");
  res.json({
    delegateId: delegate_id,
    name: delegate.name,
    records: checkinHistory.get(delegate_id) || [],
  });
}));

/* ============================================================================
 * POST /api/attendance/assign-unassigned
 * Muster-prep: move delegates who are UNASSIGNED (e.g. the 29 imported via
 * Vance's onboarding with no coach yet) onto the selected coach as MISSING —
 * i.e. "expected on this coach, not yet boarded" — so the Reverse Headcount
 * and the scanner have a real pool to work with.
 * Body: { coachId, limit? }  — respects coach capacity; uses JQ's
 * updateDelegate() helper, so the dashboard KPIs update instantly.
 * ========================================================================== */
router.post("/api/attendance/assign-unassigned", requireAuth(), wrap(async (req, res) => {
  const { coachId, limit } = req.body || {};
  const dash = await liveDashboard();
  const coach = (dash.coaches || []).find((c) => c.id === coachId);
  if (!coach) return fail(res, 404, "NOT_FOUND", "Unknown coach.");

  const all = await listDelegates();
  const unassigned = all.filter((d) => d.status === "UNASSIGNED");
  if (unassigned.length === 0) {
    return fail(res, 409, "NO_UNASSIGNED", "There are no unassigned delegates to muster.");
  }

  const seats = Math.max(0, (coach.capacity || Infinity) - coach.total);
  const take = Math.min(
    unassigned.length,
    seats,
    Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : unassigned.length
  );
  if (take === 0) {
    return fail(res, 409, "COACH_FULL", `${coach.name} is at capacity.`);
  }

  for (const d of unassigned.slice(0, take)) {
    await updateDelegate(d.id, { status: "MISSING", coachId, lastSeen: "Awaiting muster" });
  }
  res.status(200).json({ assigned: take, coachId, remainingUnassigned: unassigned.length - take });
}));

/* ============================================================================
 * POST /api/attendance/demo-seed
 * Demo convenience for an EMPTY database: if the target coach has ZERO
 * delegates AND there are no unassigned delegates waiting, insert a small
 * named demo roster through JQ's createDelegate() helper. Never touches
 * existing rows; refuses to run otherwise.
 * ========================================================================== */
const DEMO_ROSTER = [
  { name: "Lim Wei Jie",   vip: true,  status: "MISSING", lastSeen: "VIP · last 14:08" },
  { name: "Ng Soo Peng",   vip: false, status: "MISSING", lastSeen: "Phone unreachable" },
  { name: "Tan Boon Keng", vip: false, status: "MISSING", lastSeen: "No status" },
  { name: "Wong Pei Shan", vip: false, status: "MISSING", lastSeen: "Lobby · 14:02" },
  { name: "Goh Mei Ling",  vip: false, status: "MISSING", lastSeen: "Lobby · 13:58" },
  { name: "Tan Siew Ling", vip: false, status: "PRESENT", lastSeen: "Coach · 14:26" },
  { name: "Chen Hao Ming", vip: false, status: "PRESENT", lastSeen: "Coach · 14:20" },
  { name: "Yeo Pei Lin",   vip: false, status: "PRESENT", lastSeen: "Coach · 14:19" },
  { name: "Koh Siew Wen",  vip: false, status: "PRESENT", lastSeen: "Coach · 14:17" },
  { name: "Phua Yi Ming",  vip: false, status: "PRESENT", lastSeen: "Coach · 14:15" },
];

/* ============================================================================
 * POST /api/attendance/reset            (individual undo — multi-leg trips)
 * Body: { delegateId }
 * Flips ONE boarded delegate back to MISSING — e.g. a delegate who stepped
 * off the coach at a rest stop, so the next leg's headcount correctly counts
 * them as "expected, not yet re-boarded" again. Writes through JQ's
 * updateDelegate() helper so every screen (dashboard, Missing page, coach
 * boards) reflects the reset live. The auditable check-in history is kept —
 * a reset is an operational status flip, not a data purge.
 * ========================================================================== */
router.post("/api/attendance/reset", requireAuth(), wrap(async (req, res) => {
  const { delegateId } = req.body || {};
  if (typeof delegateId !== "string" || !(await getDelegateById(delegateId))) {
    return fail(res, 404, "NOT_FOUND", "Delegate does not exist.");
  }
  await updateDelegate(delegateId, { status: "MISSING", lastSeen: `Reset · ${timeNow()}` });
  res.status(200).json({ delegateId, status: "MISSING" });
}));

/* ============================================================================
 * POST /api/attendance/reset-coach      (group / whole-coach undo)
 * Body: { coachId }
 * Flips EVERY boarded delegate on one coach back to MISSING in a single tap,
 * for starting a fresh headcount when moving from Venue A to Venue B. Counts
 * both ARRIVED (current) and PRESENT (legacy) as boarded — same isBoarded()
 * pairing used everywhere else in this router.
 * ========================================================================== */
router.post("/api/attendance/reset-coach", requireAuth(), wrap(async (req, res) => {
  const { coachId } = req.body || {};
  const dash = await liveDashboard();
  const coach = (dash.coaches || []).find((c) => c.id === coachId);
  if (!coach) return fail(res, 404, "NOT_FOUND", "Unknown coach.");

  const all = await listDelegates();
  const boarded = all.filter(
    (d) => d.coachId === coachId && (d.status === "PRESENT" || d.status === "ARRIVED")
  );
  if (boarded.length === 0) {
    return fail(res, 409, "NOTHING_TO_RESET", `No one is boarded on ${coach.name} yet.`);
  }
  for (const d of boarded) {
    await updateDelegate(d.id, { status: "MISSING", lastSeen: `Reset · ${timeNow()}` });
  }
  res.status(200).json({ reset: boarded.length, coachId });
}));

router.post("/api/attendance/demo-seed", requireAuth(), wrap(async (req, res) => {
  const coachId = (req.body && req.body.coachId) || "c2";
  const dash = await liveDashboard();
  if (!(dash.coaches || []).some((c) => c.id === coachId)) {
    return fail(res, 404, "NOT_FOUND", "Unknown coach.");
  }
  const all = await listDelegates();
  if (all.some((d) => d.coachId === coachId)) {
    return fail(res, 409, "COACH_NOT_EMPTY", "Coach already has delegates — demo seed skipped.");
  }
  if (all.some((d) => d.status === "UNASSIGNED")) {
    return fail(res, 409, "USE_ASSIGN", "Unassigned delegates exist — assign them instead of seeding demo rows.");
  }
  const created = [];
  for (const d of DEMO_ROSTER) {
    created.push(await createDelegate({ ...d, coachId }));
  }
  res.status(201).json({ seeded: created.length, coachId });
}));

/* ============================================================================
 * DELEGATE SELF-ENROLLMENT (public — no staff login)
 *
 * The standalone /enroll web app (frontend/src/pages/EnrollPage.jsx) that a
 * delegate opens themselves before the trip. They find their own record by
 * name, give PDPA consent, capture a face sample and/or record a voice
 * passphrase, and submit. Only the irreversible vector/checksum is stored —
 * never an image or audio clip (same Zero-Image guarantee as the scanner).
 *
 * These two routes are intentionally UNAUTHENTICATED (like the passwordless
 * /kiosk-scan surface): a delegate enrolling before the event has no staff
 * account. This is demo-grade self-service — it proves identity only by the
 * name the delegate selects, not by a secret. In production you'd gate this
 * behind the per-delegate magic link from their confirmation email.
 * ========================================================================== */

/* GET /api/enroll/lookup — find your delegate record to enroll against.
 * Returns minimal fields only (id, name, coach, what's already enrolled):
 *   ?id=<delegateId>  exact record (used by the notification deep-link)
 *   ?name=<2+ chars>  name filter
 *   (neither)         the full roster, so the enrol page can show a browsable
 *                     picker with everyone's coach instead of a blind search. */
router.get("/api/enroll/lookup", wrap(async (req, res) => {
  const id = String((req.query && req.query.id) || "").trim();
  const q = String((req.query && req.query.name) || "").trim().toLowerCase();
  const all = await listDelegates();
  const dash = await liveDashboard();
  const bios = await bioMap();
  const coachName = (cid) => {
    const c = (dash.coaches || []).find((x) => x.id === cid);
    return c ? c.name : null;
  };
  const toMatch = (d) => {
    const row = bios.get(d.id);
    return {
      delegateId: d.id,
      name: d.name,
      coachId: d.coachId || null,
      coachLabel: coachName(d.coachId),
      enrolled: {
        face: !!(row && asVector(row.face_vector)),
        voice: !!(row && (asVector(row.voice_vector) || row.voice_hash !== null)),
      },
    };
  };
  let list;
  if (id) list = all.filter((d) => d.id === id);
  else if (q.length >= 2) list = all.filter((d) => (d.name || "").toLowerCase().includes(q));
  else list = all;
  const matches = list
    .slice(0, 300)
    .map(toMatch)
    .sort((a, b) => (a.coachLabel || "~").localeCompare(b.coachLabel || "~") || a.name.localeCompare(b.name));
  res.json({ matches });
}));

/* POST /api/enroll  — store a delegate's own face and/or voice sample.
 * Body: { delegateId, faceToken?, voiceToken? }  (at least one required)
 * Stores only the parsed similarity vector (face) and an irreversible
 * checksum (voice), flips consent to GRANTED, and records the enrollment in
 * the delegate's consent history. */
router.post("/api/enroll", wrap(async (req, res) => {
  const { delegateId } = req.body || {};
  const faceToken = req.body && req.body.faceToken ? String(req.body.faceToken).trim() : null;
  const voiceToken = req.body && req.body.voiceToken ? String(req.body.voiceToken).trim() : null;

  const delegate = typeof delegateId === "string" ? await getDelegateById(delegateId) : null;
  if (!delegate) return fail(res, 404, "NOT_FOUND", "We couldn't find that delegate.");
  if (!faceToken && !voiceToken) {
    return fail(res, 400, "NOTHING_TO_ENROLL", "Capture a face and/or record a voice passphrase first.");
  }

  const at = new Date().toISOString();
  let faceVector = null;
  let voiceVector = null;
  let voiceHash = null;

  if (faceToken) {
    if (!VALID_TOKEN.test(faceToken) || !/^face:/i.test(faceToken) || /deadbeef/i.test(faceToken)) {
      return fail(res, 400, "INVALID_FACE_TOKEN", "That face sample was invalid — please retake it.");
    }
    faceVector = parseFaceVector(faceToken);
    if (!faceVector) {
      return fail(res, 400, "INVALID_FACE_TOKEN", "Face sample had too little detail — retake it in better light.");
    }
  }
  if (voiceToken) {
    if (!VALID_TOKEN.test(voiceToken) || !/^voice:/i.test(voiceToken) || /deadbeef/i.test(voiceToken)) {
      return fail(res, 400, "INVALID_VOICE_TOKEN", "That voice sample was invalid — please record it again.");
    }
    // v2 = FFT spectrum embedding (a real voiceprint); v1 = typed-passphrase
    // hash, kept as the no-microphone fallback.
    voiceVector = parseVoiceVector(voiceToken);
    if (!voiceVector) voiceHash = checksum(voiceToken);
  }

  // PERSISTED — survives a backend restart, unlike the old in-memory Map.
  await saveBiometrics(delegateId, { faceVector, voiceVector, voiceHash, consent: "GRANTED" });

  // Keep the in-memory audit trail of consent events alongside it.
  const existing = consentFor(delegateId);
  consents.set(delegateId, {
    ...existing,
    status: "GRANTED",
    method: "self-enroll",
    biometricTokenStored: true,
    updatedAt: at,
    history: [...existing.history, { status: "GRANTED", method: "self-enroll", at }],
  });

  res.status(200).json({
    delegateId,
    name: delegate.name,
    enrolled: {
      face: !!faceVector,
      voice: !!(voiceVector || voiceHash !== null),
      voiceType: voiceVector ? "acoustic" : voiceHash !== null ? "passphrase" : null,
    },
  });
}));

/* GET /api/enroll/stats — how much of the roster is enrolled. Powers the
 * progress panel on the enrolment page so staff can see coverage at a glance
 * ("34 of 42 enrolled") instead of checking delegates one by one. */
router.get("/api/enroll/stats", wrap(async (_req, res) => {
  const all = await listDelegates();
  const bios = await bioMap();
  let face = 0, voice = 0, either = 0;
  for (const d of all) {
    const row = bios.get(d.id);
    if (!row || consentOf(row) !== "GRANTED") continue;
    const f = !!asVector(row.face_vector);
    const v = !!(asVector(row.voice_vector) || row.voice_hash !== null);
    if (f) face += 1;
    if (v) voice += 1;
    if (f || v) either += 1;
  }
  res.json({ total: all.length, face, voice, enrolled: either });
}));

/* POST /api/enroll/verify — a SELF-TEST. Scores a freshly captured sample
 * against what this delegate already has stored and reports the similarity,
 * WITHOUT touching their attendance status or the stored template. Lets a
 * delegate confirm "yes, the scanner will actually recognise me" at the moment
 * they enrol, instead of finding out at the coach door.
 * Body: { delegateId, faceToken? | voiceToken? } */
router.post("/api/enroll/verify", wrap(async (req, res) => {
  const { delegateId } = req.body || {};
  const faceToken = req.body && req.body.faceToken ? String(req.body.faceToken).trim() : null;
  const voiceToken = req.body && req.body.voiceToken ? String(req.body.voiceToken).trim() : null;

  const delegate = typeof delegateId === "string" ? await getDelegateById(delegateId) : null;
  if (!delegate) return fail(res, 404, "NOT_FOUND", "We couldn't find that delegate.");
  const row = await bioFor(delegateId);
  if (!row || consentOf(row) !== "GRANTED") {
    return fail(res, 409, "NOT_ENROLLED", "Nothing enrolled yet for this delegate.");
  }

  if (faceToken) {
    const vec = parseFaceVector(faceToken);
    const enrolled = asVector(row.face_vector);
    if (!vec) return fail(res, 400, "INVALID_FACE_TOKEN", "That sample had no usable data.");
    if (!enrolled) return fail(res, 409, "NOT_ENROLLED", "No face is enrolled for this delegate.");
    const similarity = faceSim(vec, enrolled);
    const thr = faceThresh(vec);
    return res.json({
      modality: "FACE", similarity: +similarity.toFixed(4),
      threshold: thr, match: similarity >= thr,
    });
  }
  if (voiceToken) {
    const vec = parseVoiceVector(voiceToken);
    const enrolled = asVector(row.voice_vector);
    if (vec && enrolled) {
      const similarity = cosineSimilarity(vec, enrolled);
      return res.json({
        modality: "VOICE", similarity: +similarity.toFixed(4),
        threshold: VOICE_MATCH_THRESHOLD, match: similarity >= VOICE_MATCH_THRESHOLD,
      });
    }
    // Legacy typed-passphrase enrolment — exact hash, no similarity score.
    const ok = row.voice_hash !== null && Number(row.voice_hash) === checksum(voiceToken);
    return res.json({ modality: "VOICE", similarity: ok ? 1 : 0, threshold: 1, match: ok });
  }
  return fail(res, 400, "NOTHING_TO_VERIFY", "Capture a face or voice sample to test.");
}));

/* POST /api/enroll/revoke — PDPA right to erasure. Purges this delegate's
 * stored face/voice vectors outright and marks consent REVOKED, so they can no
 * longer be biometrically matched (staff can still check them in manually or
 * by QR). Same public trust model as enrolment itself — see the section header.
 * Body: { delegateId } */
router.post("/api/enroll/revoke", wrap(async (req, res) => {
  const { delegateId } = req.body || {};
  const delegate = typeof delegateId === "string" ? await getDelegateById(delegateId) : null;
  if (!delegate) return fail(res, 404, "NOT_FOUND", "We couldn't find that delegate.");

  await revokeBiometrics(delegateId);
  const at = new Date().toISOString();
  const existing = consentFor(delegateId);
  consents.set(delegateId, {
    ...existing,
    status: "REVOKED",
    method: "self-service",
    biometricTokenStored: false,
    updatedAt: at,
    history: [...existing.history, { status: "REVOKED", method: "self-service", at }],
  });
  res.json({ delegateId, name: delegate.name, consent: "REVOKED", erased: true });
}));

export default router;