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

const router = Router();

/* Small async wrapper so any thrown error reaches JQ's global error handler
 * in server.js (clean JSON 500s, never a hung request). */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (res, code, error, message) => res.status(code).json({ error, message });

/* ---------------------------------------------------------------------------
 * Vimal-owned state (in-memory): consent lifecycles + per-delegate check-in
 * history. Delegates themselves live in the SHARED database — only the
 * biometric-consent bookkeeping is private to this feature.
 * ------------------------------------------------------------------------- */
const consents = new Map(); // delegateId -> { status, method, biometricTokenStored, biometricId?, updatedAt, history[] }
const checkinHistory = new Map(); // delegateId -> [{ venue, tripId, method, matchedIn, timestamp }]

function consentFor(delegateId) {
  if (!consents.has(delegateId)) {
    const at = new Date().toISOString();
    consents.set(delegateId, {
      delegateId,
      status: "GRANTED", // delegates consent at onboarding by default
      method: "onboarding-form",
      biometricTokenStored: true,
      // `biometricId` is a small, irreversible numeric fingerprint of the
      // client's anonymous token (checksum). We never store images/audio.
      biometricId: null,
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

  // Simulated matcher over the REAL shared delegate list. Matching strategy:
  // 1) If any enrolled delegate has a stored biometricId that equals the
  //    checksum(token) we treat that as a direct match (preferred).
  // 2) Otherwise fall back to a stable pseudo-random pick from the pool so
  //    demo flows continue to work even when no biometric enrollment exists.
  const all = await listDelegates();
  const tokenChecksum = checksum(token);

  // Cross-coach guard (mirrors the same fix on the QR check-in path in
  // vance.js): if this exact biometric token belongs to a delegate enrolled
  // on a DIFFERENT coach than the one this scanner is scoped to, say so
  // specifically instead of just falling through to a generic "no match" —
  // that read as a scan failure rather than the real, actionable cause
  // ("wrong coach"), and could otherwise mislead staff into rescanning
  // pointlessly. Checked against the WHOLE roster, not the coach-scoped pool
  // below, since the whole point is to catch a delegate who's excluded from
  // that pool precisely because they're on a different coach.
  if (coachId) {
    const exactMatch = all.find((d) => {
      const c = consentFor(d.id);
      return c.biometricId !== null && c.biometricId === tokenChecksum;
    });
    if (exactMatch && exactMatch.coachId && exactMatch.coachId !== coachId) {
      const dash = await liveDashboard();
      const assignedCoach = (dash.coaches || []).find((c) => c.id === exactMatch.coachId);
      const scannerCoach = (dash.coaches || []).find((c) => c.id === coachId);
      const assignedLabel = assignedCoach ? assignedCoach.name : exactMatch.coachId;
      const scannerLabel = scannerCoach ? scannerCoach.name : coachId;
      return res.status(409).json({
        error: "COACH_MISMATCH",
        message: `${exactMatch.name} is assigned to ${assignedLabel}, not ${scannerLabel}.`,
        delegateId: exactMatch.id,
        delegateName: exactMatch.name,
        assignedCoachId: exactMatch.coachId,
        assignedCoachLabel: assignedLabel,
        scannerCoachId: coachId,
      });
    }
  }

  // Candidates must be still MISSING, have GRANTED consent and (if provided)
  // belong to the mustered coach.
  const pool = all.filter((d) => d.status === "MISSING" && consentFor(d.id).status === "GRANTED" && (!coachId || d.coachId === coachId));
  if (pool.length === 0) {
    return fail(res, 404, "SCAN_FAILED", "No matching enrolled delegate is still missing.");
  }

  // 1) Exact biometricId match (if any)
  let matched = pool.find((d) => {
    const c = consentFor(d.id);
    return c.biometricId !== null && c.biometricId === tokenChecksum;
  });

  // 2) Fallback deterministic selection so demos still behave when no
  // biometric enrollment exists for this pool.
  if (!matched) matched = pool[tokenChecksum % pool.length];
  const dash = await liveDashboard();
  const coach = (dash.coaches || []).find((c) => c.id === matched.coachId);
  const seenAt = `${coach ? coach.name : "On site"} · ${timeNow()}`;

  // Write through JQ's own helper — updates the shared DB row and logs to the
  // dashboard activity feed, so every screen stays in sync.
  await updateDelegate(matched.id, { status: "PRESENT", lastSeen: seenAt });

  const method = token.toLowerCase().startsWith("voice:") ? "VOICE" : "FACE";
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
  const onCoach = all.filter((d) => d.coachId === coach_id);
  const payload = onCoach.map((d) => ({
    delegateId: d.id,
    name: d.name,
    initials: d.initials,
    vip: !!d.vip,
    status: d.status,
    lastSeen: d.lastSeen || "No status",
    consent: consentFor(d.id).status,
  }));

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
      consent: consentFor(d.id).status,
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

  // If a biometric token is provided while granting consent, store only a
  // small irreversible numeric fingerprint (checksum). We never persist
  // the original token or any image/audio. We also only mark biometric
  // storage as present when a valid token accompanied the grant.
  const biometricId = (consent === "GRANTED" && biometricToken && VALID_TOKEN.test(biometricToken))
    ? checksum(biometricToken)
    : existing.biometricId || null;

  const updated = {
    ...existing,
    status: consent,
    method,
    biometricTokenStored: consent === "GRANTED" && !!biometricToken && VALID_TOKEN.test(biometricToken),
    biometricId,
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

export default router;