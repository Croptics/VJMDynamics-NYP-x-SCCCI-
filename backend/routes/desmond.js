/* =============================================================================
 * backend/routes/desmond.js
 * Owner: Desmond — "TransitFlow" — Trip Booking & Dynamic Coach Management
 *
 * v2 — adds the fields/endpoints behind the "operations dashboard" redesign
 * (itinerary category, coach driver name, delegate company/accessibility,
 * and a shared activity feed) on top of the v1 trip/coach/delegate/itinerary
 * CRUD. See database/004_desmond_dashboard_extras.sql for the schema side.
 *
 * v3 — the frontend redesign moved from a KPI-dashboard style board to an
 * "operational workspace" one; the only backend change that required is
 * GET /api/all-trips now also returning dayOf/totalDays so the trip list
 * page can show a real per-trip progress indicator (previously only the
 * per-trip summary endpoint returned those two columns).
 *
 * Self-contained: opens its own pg Pool (server.js/data.js don't export
 * theirs). Auth reuses this branch's existing auth.js (requireAuth()) — same
 * signed JWTs server.js and routes/insights.js already use.
 *
 * CORS — NOT configured again here; backend/server.js already runs cors()
 * before any router (including this one) is mounted.
 *
 * Route paths avoid colliding with JQ's routes already registered above the
 * TEAMMATE ZONE in server.js (Express runs the FIRST matching route and
 * stops, so a same-shaped route registered here would simply never run):
 *   - GET /api/trips            already exists (hardcoded Beijing trip only)
 *                               → trip listing is GET /api/all-trips instead.
 *   - GET /api/trips/:id        already exists (ignores :id)
 *                               → trip detail is GET /api/trips/:tripId/summary.
 *   - GET /api/trips/:id/delegates  already exists (ignores :id, returns ALL
 *                               delegates) → GET /api/delegates?tripId=...
 *   - POST /api/trips/:id/delegates already exists, doesn't know trip_id/notes
 *                               → POST /api/delegates instead.
 *   - /api/trips/:tripId/coaches, /api/coaches*, /api/trips/:tripId/itinerary*,
 *     /api/trips/:tripId/activity*, /api/users/staff are new ground JQ's
 *     router never touches.
 *
 * ACTIVITY FEED — a design note: JQ's own delegate reassignment (PATCH
 * /api/delegates/:id) and removal (DELETE /api/delegates/:id) are handled
 * entirely inside server.js, ABOVE this router's mount point. Once JQ's
 * handler responds, Express never gives this router a chance to see that
 * request — so this file cannot log those two actions server-side by
 * hooking the request itself. Instead, the frontend reports them explicitly
 * right after they succeed, via POST /api/trips/:tripId/activity (the same
 * endpoint a human could call from anywhere). Every OTHER mutation below
 * (coaches, itinerary, delegate creation/details — all routes that DO run
 * inside this file) logs itself directly, which is both simpler and more
 * accurate than round-tripping through the client for those.
 *
 * The log itself is a plain in-memory array per trip (resets on backend
 * restart) — deliberately mirroring data.js's own ACTIVITY pattern for the
 * Dashboard's live feed, rather than adding yet another persisted table for
 * what's explicitly a "recent, ephemeral activity" UI, not an audit log.
 * ========================================================================== */

import "dotenv/config";
import { Router } from "express";
import pg from "pg";
import { requireAuth, requirePermission } from "../lib/auth.js";
import { actorOf } from "../lib/actor.js";
import { syncTripDayOf } from "../db/dashboard.js";
// Read-only import of JQ's own write helper (2026-07-25 fix, JQ) — see the
// attendance POST route below for why: marking someone's attendance here
// used to only touch checkpoint_checkins, leaving the Dashboard/All-
// delegates table showing a stale status. Going through updateDelegate()
// (not a raw UPDATE) also means this shows up in the History Log like every
// other status change, not just a silent side effect.
import { updateDelegate } from "../db/delegates.js";

const { Pool } = pg;

/* ---- Connection ------------------------------------------------------------
 * Mirrors data.js's own auto-SSL logic, self-contained (data.js doesn't
 * export its pool). Works against Neon (or Supabase, or local Postgres) the
 * same way data.js does — same DATABASE_URL, same SSL auto-detection.
 * -------------------------------------------------------------------------- */
function readConfig() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  const forceSsl = process.env.PGSSL; // "true" | "false" | undefined (auto)

  if (url) {
    const isLocal = /localhost|127\.0\.0\.1/.test(url);
    const ssl = forceSsl === "true" ? { rejectUnauthorized: false }
              : forceSsl === "false" ? false
              : isLocal ? false
              : { rejectUnauthorized: false }; // Neon/Supabase need SSL
    return { connectionString: url, ssl };
  }

  const host = process.env.DB_HOST || "localhost";
  const isLocal = /localhost|127\.0\.0\.1/.test(host);
  const ssl = forceSsl === "true" ? { rejectUnauthorized: false }
            : forceSsl === "false" ? false
            : isLocal ? false
            : { rejectUnauthorized: false };

  return {
    host,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "mustergo",
    ssl,
  };
}

const pool = new Pool(readConfig());
// Without this listener an idle client error would crash the whole Node
// process — node-postgres treats an unhandled pool "error" as fatal.
pool.on("error", (err) => console.error("desmond.js pg pool error:", err));

async function all(sql, params = []) { return (await pool.query(sql, params)).rows; }
async function get(sql, params = []) { return (await all(sql, params))[0] || null; }
async function run(sql, params = []) { await pool.query(sql, params); }

/* ---- Additive schema: live operational-status fields -----------------------
 * Columns this feature added AFTER the base schema was frozen in data.js
 * (JQ's, off-limits). Added idempotently at startup — the same additive
 * `ADD COLUMN IF NOT EXISTS` pattern vance.js uses — so data.js is untouched.
 * Best-effort: a failure here (DB briefly unreachable) is logged, not fatal;
 * the SELECTs below use COALESCE so they still work if a column isn't there
 * yet on the very first boot.
 *   itinerary_items.status         scheduled | delayed | moved | cancelled
 *   itinerary_items.delay_minutes  minutes behind schedule (for "delayed")
 *   itinerary_items.completed      staff manually ticked this stop as done
 *   coaches.arrival_status         not_arrived | en_route | arrived
 * -------------------------------------------------------------------------- */
const ITINERARY_STATUSES = ["scheduled", "delayed", "moved", "cancelled"];
const COACH_ARRIVALS = ["not_arrived", "en_route", "arrived"];
(async function ensureOpsSchema() {
  try {
    await run(`ALTER TABLE itinerary_items ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'scheduled'`);
    await run(`ALTER TABLE itinerary_items ADD COLUMN IF NOT EXISTS delay_minutes INTEGER NOT NULL DEFAULT 0`);
    await run(`ALTER TABLE itinerary_items ADD COLUMN IF NOT EXISTS completed BOOLEAN NOT NULL DEFAULT false`);
    await run(`ALTER TABLE coaches ADD COLUMN IF NOT EXISTS arrival_status TEXT NOT NULL DEFAULT 'not_arrived'`);
    // Auto-generated planning coaches start without a staff member (assigned
    // later), so the column must allow NULL. No-op if it already does.
    await run(`ALTER TABLE coaches ALTER COLUMN staff_user_id DROP NOT NULL`).catch(() => {});
    // Per-coach scoping (2026-07-24): the login ACCOUNT that captains this
    // coach. Logins live in JQ's `accounts` table (id like "u-5"); the older
    // staff_user_id → `users` is a display-only guide directory, NOT a login,
    // so it can't be used to scope who sees what. account_id is the real link
    // between a signed-in person and the one coach they manage. Soft reference
    // (no FK) to avoid coupling this feature's migrations to accounts'.
    await run(`ALTER TABLE coaches ADD COLUMN IF NOT EXISTS account_id VARCHAR(64)`);
    // Persisted before/after audit for trip-management events (coach /
    // itinerary / trip edits). Delegate changes are already audited in JQ's
    // activity_log (History Log, with rollback); this is the equivalent trail
    // for THIS feature's own mutations, which never went through updateDelegate.
    // before_data / after_data are JSON snapshots of the changed entity.
    await run(`CREATE TABLE IF NOT EXISTS trip_event_log (
      id          VARCHAR(64) PRIMARY KEY,
      trip_id     UUID,
      actor       TEXT,
      action      TEXT,
      entity      TEXT,
      entity_id   VARCHAR(64),
      summary     TEXT,
      before_data JSONB,
      after_data  JSONB,
      at          TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await run(`CREATE INDEX IF NOT EXISTS trip_event_log_trip_at ON trip_event_log (trip_id, at DESC)`);
    // Per-event ATTENDANCE history (point-to-point): one row per change to a
    // delegate's status AT a specific itinerary stop, so staff can see the full
    // before/after trail of who was marked present/missing at each event, per
    // coach. The live per-stop status itself lives in JQ's checkpoint_checkins
    // (which we also upsert, so the Dashboard/Timeline stay in sync); this table
    // is the change LOG on top of it that checkpoint_checkins doesn't keep.
    await run(`CREATE TABLE IF NOT EXISTS attendance_log (
      id                VARCHAR(64) PRIMARY KEY,
      trip_id           UUID,
      itinerary_item_id UUID,
      delegate_id       VARCHAR(64),
      coach_id          VARCHAR(64),
      actor             TEXT,
      from_status       TEXT,
      to_status         TEXT,
      at                TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await run(`CREATE INDEX IF NOT EXISTS attendance_log_item_at ON attendance_log (itinerary_item_id, at DESC)`);
  } catch (e) {
    console.error("desmond.js ensureOpsSchema (non-fatal):", e.message);
  }
})();

/* ---- Error handling --------------------------------------------------- */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const router = Router();

// "View for all, edit gated": any signed-in user can READ (GET) the board and
// log activity, but creating / editing / deleting trips, coaches, itinerary
// items or delegates requires the "manageTrips" permission. Applied per-route
// below (not as a blanket router.use()) — this router is mounted at the app
// root alongside every other teammate's router, and an unscoped router.use()
// would intercept requests meant for THEIR routes too (any POST/PATCH/DELETE
// reaching this layer gets checked against "manageTrips" before Express ever
// gets to decide none of this router's own paths match).
const readAccess = requireAuth();
const writeAccess = requirePermission("manageTrips");

/* ---- Helpers -------------------------------------------------------------- */

/** Mirrors data.js's own nextId() exactly so new delegate ids stay in the
 *  SAME "d-N" sequence JQ's own delegate creation uses. */
async function nextDelegateId() {
  const row = await get(`SELECT COALESCE(MAX(CAST(SUBSTRING(id FROM 3) AS INTEGER)), 0) AS m FROM delegates`);
  return `d-${Number(row?.m || 0) + 1}`;
}

function initialsOf(name) {
  return (name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

const ITINERARY_CATEGORIES = ["hotel", "attraction", "meal", "factory", "airport", "transport", "other"];
function normalizeCategory(c) {
  return ITINERARY_CATEGORIES.includes(c) ? c : "other";
}

/* ---- Activity feed (in-memory, per trip — see file header) ----------------- */
const ACTIVITY = new Map(); // tripId -> [{ id, text, kind, at }]
const MAX_ACTIVITY = 40;
const ACTIVITY_KINDS = ["checkin", "coach", "delegate", "itinerary", "system"];

function logActivity(tripId, text, kind = "system") {
  if (!tripId || !text) return null;
  const entry = {
    id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text: String(text).slice(0, 300),
    kind: ACTIVITY_KINDS.includes(kind) ? kind : "system",
    at: new Date().toISOString(),
  };
  const list = ACTIVITY.get(tripId) || [];
  list.unshift(entry);
  ACTIVITY.set(tripId, list.slice(0, MAX_ACTIVITY));
  return entry;
}

/* ---- Persisted audit (before/after) — see trip_event_log in ensureOpsSchema.
 * recordEvent() does double duty: it keeps the lightweight in-memory activity
 * feed working (via logActivity, unchanged) AND writes a durable audit row
 * with JSON before/after snapshots so a coordinator can see exactly what a
 * value changed FROM and TO, surviving a backend restart. Best-effort on the
 * persisted side: an audit failure must never block or fail the real mutation
 * it's describing, so the INSERT is wrapped and its error swallowed. */
async function recordEvent(tripId, req, { action, entity, entityId = null, summary, before = null, after = null, kind = "system" }) {
  if (!tripId || !summary) return;
  logActivity(tripId, summary, kind); // live feed (ephemeral) — unchanged behaviour
  try {
    await run(
      `INSERT INTO trip_event_log (id, trip_id, actor, action, entity, entity_id, summary, before_data, after_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        tripId, actorOf(req) || "System", action, entity, entityId, String(summary).slice(0, 300),
        before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null,
      ]
    );
  } catch (e) {
    console.error("desmond.js recordEvent (non-fatal):", e.message);
  }
}

router.get("/api/trips/:tripId/activity", readAccess, wrap(async (req, res) => {
  res.json({ activity: ACTIVITY.get(req.params.tripId) || [] });
}));

// Persisted before/after audit for one trip, newest first. Powers the board's
// History panel. Separate from the ephemeral /activity feed above (which is
// in-memory and resets on restart); this reads the durable trip_event_log.
router.get("/api/trips/:tripId/audit", readAccess, wrap(async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 60));
  const events = await all(
    `SELECT id, actor, action, entity, entity_id AS "entityId", summary,
            before_data AS "before", after_data AS "after", at
       FROM trip_event_log WHERE trip_id = $1 ORDER BY at DESC LIMIT $2`,
    [req.params.tripId, limit]
  );
  res.json({ events });
}));

// Login accounts a coordinator can assign as a coach captain. GET /api/accounts
// is manageAccounts-only (admin), which would stop a plain trip manager from
// assigning; this exposes just id/username/name/role (NO secrets) to anyone who
// can already read the board, so captain assignment isn't admin-gated.
router.get("/api/assignable-accounts", readAccess, wrap(async (_req, res) => {
  const accounts = await all(
    `SELECT id, username, name, role FROM accounts
      WHERE username <> '__kiosk__' AND role IN ('staff','admin') ORDER BY name, username`
  );
  res.json({ accounts });
}));

// The coaches (and their trips) the SIGNED-IN account captains — used by the
// Trips list to scope a captain to only their own trip(s), and to hide trip
// create/seed from them. Keyed off the caller's own account id (req.account.id),
// so it can't be used to snoop another user's assignments.
router.get("/api/my-captain-coaches", readAccess, wrap(async (req, res) => {
  const accountId = req.account?.id;
  if (!accountId) return res.json({ coaches: [] });
  const coaches = await all(
    `SELECT c.id AS "coachId", c.label AS "coachLabel", c.trip_id AS "tripId", t.name AS "tripName"
       FROM coaches c JOIN trips t ON t.uuid_id = c.trip_id
      WHERE c.account_id = $1 ORDER BY t.name, c.sort_order`,
    [accountId]
  );
  res.json({ coaches });
}));

// The frontend calls this right after a mutation that happened through one of
// JQ's OWN routes (delegate reassign/remove) succeeds — see file header for
// why this router can't observe those requests directly. Cosmetic (an
// activity-feed entry, not a real mutation), so any signed-in user, same as
// the original design.
router.post("/api/trips/:tripId/activity", readAccess, wrap(async (req, res) => {
  const { text, kind, before, after } = req.body || {};
  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: "TEXT_REQUIRED", message: "Activity text is required." });
  }
  const entry = logActivity(req.params.tripId, String(text).trim(), kind);
  // Also persist to the durable audit so client-reported actions (delegate
  // reassign / remove, which happen through JQ's routes and so can't be logged
  // server-side here — see file header) show up in the History panel too, with
  // optional before/after the client may include.
  try {
    await run(
      `INSERT INTO trip_event_log (id, trip_id, actor, action, entity, entity_id, summary, before_data, after_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [`evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, req.params.tripId, actorOf(req) || "System",
       `reported.${kind || "system"}`, "delegate", null, String(text).trim().slice(0, 300),
       before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null]
    );
  } catch (e) { console.error("desmond.js activity persist (non-fatal):", e.message); }
  res.status(201).json(entry);
}));

/* =============================================================================
 *  Staff directory
 * ========================================================================== */
router.get("/api/users/staff", readAccess, wrap(async (_req, res) => {
  const staff = await all(
    `SELECT id, name, email, role FROM users WHERE role IN ('staff','admin') ORDER BY name`
  );
  res.json({ staff });
}));

/* =============================================================================
 *  Trips
 * ========================================================================== */
router.get("/api/all-trips", readAccess, wrap(async (_req, res) => {
  // v3: also selects dayOf/totalDays so the trip list cards can show a real
  // per-trip progress indicator instead of just name/status/counts.
  // startDate/dayOfIsManual added later (2026-07-24, JQ's auto-day feature) —
  // without them here, the Edit trip modal (which reuses these same trip
  // objects) always saw startDate as undefined and showed the date picker
  // blank even for a trip that already had one saved.
  const trips = await all(`
    SELECT
      t.uuid_id AS id, t.name, t."dateRange", t.status, t."lead",
      t."dayOf", t."totalDays", t."startDate", t."dayOfIsManual",
      COUNT(DISTINCT c.id) AS "coachCount",
      COUNT(DISTINCT d.id) AS "delegateCount"
    FROM trips t
    LEFT JOIN coaches   c ON c.trip_id = t.uuid_id
    LEFT JOIN delegates d ON d.trip_id = t.uuid_id
    WHERE t.uuid_id IS NOT NULL
    GROUP BY t.uuid_id, t.name, t."dateRange", t.status, t."lead", t."dayOf", t."totalDays", t."startDate", t."dayOfIsManual"
    ORDER BY t.name
  `);
  res.json({
    trips: trips.map((t) => ({ ...t, coachCount: Number(t.coachCount), delegateCount: Number(t.delegateCount) })),
  });
}));

router.get("/api/trips/:tripId/summary", readAccess, wrap(async (req, res) => {
  const trip = await get(`SELECT * FROM trips WHERE uuid_id = $1`, [req.params.tripId]);
  if (!trip) return res.status(404).json({ error: "NOT_FOUND", message: "Trip not found." });

  const coachRow = await get(`SELECT COUNT(*) AS c FROM coaches WHERE trip_id = $1`, [trip.uuid_id]);
  const delegateRow = await get(`SELECT COUNT(*) AS c FROM delegates WHERE trip_id = $1`, [trip.uuid_id]);

  res.json({
    id: trip.uuid_id,
    name: trip.name,
    dateRange: trip.dateRange,
    status: trip.status,
    lead: trip.lead,
    dayOf: trip.dayOf,
    totalDays: trip.totalDays,
    coachCount: Number(coachRow?.c || 0),
    delegateCount: Number(delegateRow?.c || 0),
  });
}));

// NOTE (2026-07-24): the old single trip-wide "Late-status cutoff" — a static
// HH:MM stored on trips.lateCutoffTime, edited via a "Trip settings" modal on
// this board and enforced by applyLateCutoff() in db/delegates.js — has been
// RETIRED in favour of JQ's itinerary-driven model. Every scheduled itinerary
// stop is now its own cutoff: applyCheckpointLateCutoff() (routes/checkpoints.js,
// run every 60s from server.js) auto-flips un-scanned delegates to LATE per
// stop, reading THIS feature's itinerary_items directly. That fully answers the
// client's "derive the late-flip from the itinerary, not a fixed time" ask —
// and does it per-stop rather than one time per trip. server.js has already
// unscheduled the old applyLateCutoff(), so the PATCH /late-cutoff route and the
// summary's lateCutoffTime field it fed were dead code and were removed here.

// Demo trip catalogue. Idempotent: only inserts whichever names don't already
// exist, so running it twice (or against a DB that already has some) never
// duplicates. Each entry may optionally set status/dayOf/totalDays; when
// omitted the insert falls back to Planning / day 1 of 5, so the original 10
// keep behaving exactly as before. (v5 — added 5 destinations beyond mainland
// China and a couple of non-Planning statuses so the seeded list reads as a
// realistic mix rather than ten identical "Planning" placeholders.)
const DEMO_TRIPS = [
  { name: "Shanghai Innovation Mission",        dateRange: "3–7 Sep 2026" },
  { name: "Guangzhou Trade Delegation",         dateRange: "14–18 Sep 2026" },
  { name: "Shenzhen Tech Immersion",            dateRange: "5–9 Oct 2026" },
  { name: "Hangzhou Digital Economy Study Trip", dateRange: "19–23 Oct 2026" },
  { name: "Chengdu Business Exchange",          dateRange: "2–6 Nov 2026" },
  { name: "Xiamen Cross-Strait Forum",          dateRange: "16–20 Nov 2026" },
  { name: "Suzhou Industrial Park Visit",       dateRange: "30 Nov–4 Dec 2026" },
  { name: "Tianjin Port & Logistics Mission",   dateRange: "7–11 Dec 2026" },
  { name: "Nanjing Heritage & Trade Tour",      dateRange: "11–15 Jan 2027" },
  { name: "Qingdao Manufacturing Study Mission", dateRange: "25–29 Jan 2027" },
  // — v5 additions —
  { name: "Vientiane Cultural & Trade Mission", dateRange: "10–14 Feb 2027" }, // Laos
  { name: "Manila Innovation Summit",           dateRange: "3–8 Mar 2027", status: "In progress", dayOf: 3, totalDays: 6 }, // Philippines
  { name: "Jakarta & Bali Trade Mission",       dateRange: "17–22 Mar 2027" }, // Indonesia
  { name: "Bangkok Business Exchange",          dateRange: "7–12 Apr 2027", status: "Completed", dayOf: 6, totalDays: 6 }, // Thailand
  { name: "Yunnan Cross-Border Trade Mission",  dateRange: "21–25 Apr 2027" }, // Yunnan
];

router.post("/api/trips/seed", writeAccess, wrap(async (_req, res) => {
  const existing = await all(`SELECT name FROM trips WHERE name = ANY($1::text[])`, [DEMO_TRIPS.map((t) => t.name)]);
  const existingNames = new Set(existing.map((r) => r.name));
  const toInsert = DEMO_TRIPS.filter((t) => !existingNames.has(t.name));

  for (const t of toInsert) {
    await run(
      `INSERT INTO trips (id, uuid_id, name, "dateRange", "dayOf", "totalDays", status)
       VALUES (gen_random_uuid()::text, gen_random_uuid(), $1, $2, $3, $4, $5)`,
      [t.name, t.dateRange, t.dayOf || 1, t.totalDays || 5, t.status || "Planning"]
    );
  }

  res.status(201).json({ created: toInsert.length, skipped: DEMO_TRIPS.length - toInsert.length, total: DEMO_TRIPS.length });
}));

/* ---- Trip CRUD ---------------------------------------------------------------
 * Create / edit / delete a single real trip (not demo seeding). The base app
 * owns GET /api/trips (its one hardcoded Beijing trip) but has no create/edit/
 * delete for the trip catalogue, so these are new ground. All gated on
 * manageTrips (writeAccess). id/uuid_id are generated the same way the seed
 * route does: a random text id + a real UUID that the rest of this feature
 * keys off.
 * ---------------------------------------------------------------------------- */
const TRIP_STATUSES = ["Planning", "In progress", "Completed", "Cancelled"];

router.post("/api/trips", writeAccess, wrap(async (req, res) => {
  const { name, dateRange, status, lead, dayOf, totalDays, startDate } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "NAME_REQUIRED", message: "A trip name is required." });
  const st = TRIP_STATUSES.includes(status) ? status : "Planning";
  const total = Math.max(1, Number(totalDays) || 5);
  const day = Math.min(total, Math.max(1, Number(dayOf) || 1));
  const sd = startDate ? String(startDate).trim() || null : null;
  let trip = await get(
    `INSERT INTO trips (id, uuid_id, name, "dateRange", "dayOf", "totalDays", status, "lead", "startDate")
     VALUES (gen_random_uuid()::text, gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)
     RETURNING uuid_id AS id, name, "dateRange", status, "lead", "dayOf", "totalDays", "startDate", "dayOfIsManual"`,
    [name.trim(), (dateRange || "").trim() || null, day, total, st, (lead || "").trim() || null, sd]
  );
  // A startDate was given — compute the real "Day X of Y" immediately instead
  // of leaving whatever was typed (or the "1" default) until the next 60s
  // scheduler tick (see syncTripDayOf(), db/dashboard.js, JQ's).
  if (sd) {
    await syncTripDayOf(trip.id);
    trip = await get(
      `SELECT uuid_id AS id, name, "dateRange", status, "lead", "dayOf", "totalDays", "startDate", "dayOfIsManual" FROM trips WHERE uuid_id = $1`,
      [trip.id]
    );
  }
  await recordEvent(trip.id, req, {
    action: "trip.create", entity: "trip", entityId: trip.id, kind: "system",
    summary: `Trip "${trip.name}" was created.`,
    after: { name: trip.name, status: trip.status, dateRange: trip.dateRange },
  });
  res.status(201).json(trip);
}));

router.patch("/api/trips/:tripId", writeAccess, wrap(async (req, res) => {
  const b = req.body || {};
  const sets = [];
  const params = [];
  let i = 1;
  if (b.name !== undefined) {
    if (!String(b.name).trim()) return res.status(400).json({ error: "NAME_REQUIRED", message: "Name can't be empty." });
    sets.push(`name = $${i++}`); params.push(String(b.name).trim());
  }
  if (b.dateRange !== undefined) { sets.push(`"dateRange" = $${i++}`); params.push(String(b.dateRange).trim() || null); }
  if (b.lead !== undefined) { sets.push(`"lead" = $${i++}`); params.push(String(b.lead).trim() || null); }
  if (b.status !== undefined) {
    if (!TRIP_STATUSES.includes(b.status)) return res.status(400).json({ error: "BAD_STATUS", message: "Invalid trip status." });
    sets.push(`status = $${i++}`); params.push(b.status);
  }
  if (b.totalDays !== undefined) { sets.push(`"totalDays" = $${i++}`); params.push(Math.max(1, Number(b.totalDays) || 1)); }
  if (b.startDate !== undefined) { sets.push(`"startDate" = $${i++}`); params.push(String(b.startDate).trim() || null); }
  // Hand-typing a specific "Current day" is a deliberate override — flip
  // dayOfIsManual on so the next auto-sync tick doesn't immediately stomp it.
  // "resetDayOfAuto: true" is the opposite action ("Use automatic day" in
  // Edit trip) — clears the override so auto-sync resumes.
  if (b.dayOf !== undefined) {
    sets.push(`"dayOf" = $${i++}`); params.push(Math.max(1, Number(b.dayOf) || 1));
    sets.push(`"dayOfIsManual" = true`);
  }
  if (b.resetDayOfAuto === true) { sets.push(`"dayOfIsManual" = false`); }
  if (sets.length === 0) return res.status(400).json({ error: "NO_FIELDS", message: "Nothing to update." });
  const tripBefore = await get(
    `SELECT name, status, "dateRange", "lead", "dayOf", "totalDays", "startDate" FROM trips WHERE uuid_id = $1`,
    [req.params.tripId]
  );
  params.push(req.params.tripId);
  let trip = await get(
    `UPDATE trips SET ${sets.join(", ")} WHERE uuid_id = $${i}
     RETURNING uuid_id AS id, name, "dateRange", status, "lead", "dayOf", "totalDays", "startDate", "dayOfIsManual"`,
    params
  );
  if (!trip) return res.status(404).json({ error: "NOT_FOUND", message: "Trip not found." });
  // A new startDate, or clearing the manual override, means "dayOf" may now
  // be stale — recompute immediately rather than waiting for the next tick.
  if (b.startDate !== undefined || b.resetDayOfAuto === true) {
    await syncTripDayOf(req.params.tripId);
    trip = await get(
      `SELECT uuid_id AS id, name, "dateRange", status, "lead", "dayOf", "totalDays", "startDate", "dayOfIsManual" FROM trips WHERE uuid_id = $1`,
      [req.params.tripId]
    );
  }
  await recordEvent(req.params.tripId, req, {
    action: "trip.update", entity: "trip", entityId: req.params.tripId, kind: "system",
    summary: `Trip details for "${trip.name}" were updated.`,
    before: tripBefore && { name: tripBefore.name, status: tripBefore.status, dateRange: tripBefore.dateRange, lead: tripBefore.lead, dayOf: tripBefore.dayOf, totalDays: tripBefore.totalDays, startDate: tripBefore.startDate },
    after: { name: trip.name, status: trip.status, dateRange: trip.dateRange, lead: trip.lead, dayOf: trip.dayOf, totalDays: trip.totalDays, startDate: trip.startDate },
  });
  res.json(trip);
}));

router.delete("/api/trips/:tripId", writeAccess, wrap(async (req, res) => {
  const trip = await get(`SELECT id, uuid_id, name FROM trips WHERE uuid_id = $1`, [req.params.tripId]);
  if (!trip) return res.status(404).json({ error: "NOT_FOUND", message: "Trip not found." });
  // Guard the base app's primary trip (id "t-1"): JQ's Dashboard hard-depends
  // on it, so it must never be deletable from here.
  if (trip.id === "t-1") return res.status(400).json({ error: "PROTECTED", message: "The primary trip can't be deleted." });
  // Refuse to delete a non-empty trip rather than cascade-deleting delegates/
  // coaches — those rows are referenced by other features (check-in logs,
  // exceptions), so removing them here could orphan or break their data. The
  // coordinator clears the board first, then deletes the empty trip.
  const dCount = await get(`SELECT COUNT(*) AS c FROM delegates WHERE trip_id = $1`, [trip.uuid_id]);
  const cCount = await get(`SELECT COUNT(*) AS c FROM coaches WHERE trip_id = $1`, [trip.uuid_id]);
  if (Number(dCount.c) > 0 || Number(cCount.c) > 0) {
    return res.status(409).json({ error: "NOT_EMPTY", message: "Remove this trip's coaches and delegates before deleting it." });
  }
  await run(`DELETE FROM itinerary_items WHERE trip_id = $1`, [trip.uuid_id]);
  // The trip is going away, so its audit trail goes with it (nothing can view a
  // deleted trip's history anyway) — keeps trip_event_log from accumulating
  // orphan rows.
  await run(`DELETE FROM trip_event_log WHERE trip_id = $1`, [trip.uuid_id]).catch(() => {});
  await run(`DELETE FROM trips WHERE uuid_id = $1`, [trip.uuid_id]);
  res.json({ ok: true, id: trip.uuid_id, name: trip.name });
}));

/* =============================================================================
 *  Coaches
 * ========================================================================== */
router.get("/api/trips/:tripId/coaches", readAccess, wrap(async (req, res) => {
  const coaches = await all(`
    SELECT
      c.id, c.label, c.capacity, c.sort_order AS "sortOrder",
      c.staff_user_id AS "staffUserId", u.name AS "staffName", c.driver_name AS "driverName",
      c.account_id AS "accountId", a.name AS "captainName", a.username AS "captainUsername",
      COALESCE(c.arrival_status, 'not_arrived') AS "arrivalStatus",
      COUNT(d.id) FILTER (WHERE d.status IN ('PRESENT', 'ARRIVED')) AS boarded,
      COUNT(d.id) FILTER (WHERE d.status = 'MISSING') AS missing,
      COUNT(d.id) AS total
    FROM coaches c
    LEFT JOIN users u    ON u.id = c.staff_user_id
    LEFT JOIN accounts a ON a.id = c.account_id
    LEFT JOIN delegates d ON d."coachId" = c.id
    WHERE c.trip_id = $1
    GROUP BY c.id, c.label, c.capacity, c.sort_order, c.staff_user_id, u.name, c.driver_name, c.account_id, a.name, a.username, c.arrival_status
    ORDER BY c.sort_order
  `, [req.params.tripId]);

  res.json({
    coaches: coaches.map((c) => ({ ...c, boarded: Number(c.boarded), missing: Number(c.missing), total: Number(c.total) })),
  });
}));

// Bulk capacity — sets EVERY existing coach on a trip to the same seat count
// in one shot (2026-07-24, Edit trip's "Max delegates per coach" field).
// Deliberately separate from the per-coach PATCH /api/coaches/:id below —
// that one already exists for adjusting a single coach; this is for "make
// them all X" instead of editing each one individually.
router.patch("/api/trips/:tripId/coaches/capacity", writeAccess, wrap(async (req, res) => {
  const capacity = Math.min(200, Math.max(1, Math.floor(Number(req.body?.capacity) || 0)));
  if (!capacity) return res.status(400).json({ error: "BAD_CAPACITY", message: "capacity must be a positive number." });
  const updated = await all(
    `UPDATE coaches SET capacity = $1 WHERE trip_id = $2 RETURNING id`,
    [capacity, req.params.tripId]
  );
  if (updated.length) {
    await recordEvent(req.params.tripId, req, {
      action: "coach.capacity", entity: "trip", entityId: req.params.tripId, kind: "coach",
      summary: `All coaches set to ${capacity} seats.`, after: { capacityEach: capacity, coachesAffected: updated.length },
    });
  }
  res.json({ updated: updated.length, capacity });
}));

// Live bus-arrival status for one coach: not_arrived → en_route → arrived.
// Toggled straight from the coach card so staff can see at a glance which
// buses have actually turned up.
router.patch("/api/coaches/:id/arrival", writeAccess, wrap(async (req, res) => {
  const { arrivalStatus } = req.body || {};
  if (!COACH_ARRIVALS.includes(arrivalStatus)) {
    return res.status(400).json({ error: "BAD_STATUS", message: "Unknown arrival status." });
  }
  const before = await get(`SELECT arrival_status AS "arrivalStatus" FROM coaches WHERE id = $1`, [req.params.id]);
  const updated = await get(
    `UPDATE coaches SET arrival_status = $1 WHERE id = $2
     RETURNING id, label, trip_id, arrival_status AS "arrivalStatus"`,
    [arrivalStatus, req.params.id]
  );
  if (!updated) return res.status(404).json({ error: "NOT_FOUND", message: "Coach not found." });
  const nice = { not_arrived: "not arrived", en_route: "en route", arrived: "arrived" };
  await recordEvent(updated.trip_id, req, {
    action: "coach.arrival", entity: "coach", entityId: updated.id, kind: "coach",
    summary: `${updated.label} bus is ${nice[arrivalStatus]}.`,
    before: { arrival: nice[before?.arrivalStatus] || "not arrived" }, after: { arrival: nice[arrivalStatus] },
  });
  res.json(updated);
}));

// Capacity planning: given how many delegates are coming, generate the right
// number of coaches to seat them (called from the Planning board). Coaches are
// created without a staff member (assigned later) and auto-named "Coach N",
// continuing from the highest existing number so numbering stays consistent.
router.post("/api/coaches/generate", writeAccess, wrap(async (req, res) => {
  const { tripId, count, capacity } = req.body || {};
  if (!tripId) return res.status(400).json({ error: "MISSING_TRIP_ID", message: "tripId is required." });
  const n = Math.min(50, Math.max(1, Math.floor(Number(count) || 0)));
  const cap = Math.min(200, Math.max(1, Math.floor(Number(capacity) || 40)));
  const rows = await all(`SELECT label, sort_order AS "sortOrder" FROM coaches WHERE trip_id = $1`, [tripId]);
  let maxNum = 0, maxSort = -1;
  for (const r of rows) {
    const m = /coach\s*(\d+)/i.exec(r.label || "");
    if (m) maxNum = Math.max(maxNum, Number(m[1]));
    maxSort = Math.max(maxSort, Number(r.sortOrder ?? -1));
  }
  const created = [];
  for (let i = 1; i <= n; i++) {
    const label = `Coach ${maxNum + i}`;
    const c = await get(
      `INSERT INTO coaches (id, trip_id, label, name, capacity, staff_user_id, sort_order, driver_name)
       VALUES (gen_random_uuid()::text, $1, $2, $2, $3, NULL, $4, NULL)
       RETURNING id, label, capacity, sort_order AS "sortOrder"`,
      [tripId, label, cap, maxSort + i]
    );
    created.push(c);
  }
  await recordEvent(tripId, req, {
    action: "coach.generate", entity: "trip", entityId: tripId, kind: "coach",
    summary: `${n} coach${n !== 1 ? "es" : ""} generated (${cap} seats each).`, after: { generated: n, capacityEach: cap },
  });
  res.status(201).json({ created });
}));

// Every staff member currently holding a coach, across ALL trips — powers the
// "already assigned elsewhere" hint in the Add/Edit Coach modal.
router.get("/api/coaches/staff-assignments", readAccess, wrap(async (_req, res) => {
  const rows = await all(`
    SELECT c.staff_user_id AS "staffUserId", c.id AS "coachId", c.label AS "coachLabel", c.trip_id AS "tripId"
      FROM coaches c WHERE c.staff_user_id IS NOT NULL
  `);
  res.json({ assignments: rows });
}));

router.post("/api/coaches", writeAccess, wrap(async (req, res) => {
  const { tripId, label, capacity, staffUserId, driverName, accountId } = req.body || {};
  if (!tripId) return res.status(400).json({ error: "MISSING_TRIP_ID", message: "tripId is required." });
  if (!label || !label.trim()) return res.status(400).json({ error: "LABEL_REQUIRED", message: "A coach label is required." });
  if (!staffUserId) return res.status(400).json({ error: "STAFF_REQUIRED", message: "Every coach needs a staff member assigned." });

  const staffRow = await get(`SELECT id, name FROM users WHERE id = $1`, [staffUserId]);
  if (!staffRow) return res.status(404).json({ error: "STAFF_NOT_FOUND", message: "That staff member doesn't exist." });

  // Optional captain: the login account that manages (and is scoped to) this
  // coach — see account_id in ensureOpsSchema. Validated so a coach can't be
  // pinned to a non-existent login.
  let captain = null;
  if (accountId) {
    captain = await get(`SELECT id, name, username FROM accounts WHERE id = $1`, [accountId]);
    if (!captain) return res.status(404).json({ error: "ACCOUNT_NOT_FOUND", message: "That login account doesn't exist." });
  }

  const maxRow = await get(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM coaches WHERE trip_id = $1`, [tripId]);
  const sortOrder = Number(maxRow?.m ?? -1) + 1;

  const created = await get(
    `INSERT INTO coaches (id, trip_id, label, name, capacity, staff_user_id, sort_order, driver_name, account_id)
     VALUES (gen_random_uuid()::text, $1, $2, $2, $3, $4, $5, $6, $7)
     RETURNING id, label, capacity, sort_order AS "sortOrder", staff_user_id AS "staffUserId", driver_name AS "driverName", account_id AS "accountId"`,
    [tripId, label.trim(), Number(capacity) || 40, staffUserId, sortOrder, (driverName || "").trim() || null, captain?.id || null]
  );
  await recordEvent(tripId, req, {
    action: "coach.create", entity: "coach", entityId: created.id, kind: "coach",
    summary: `${label.trim()} was added to the fleet, led by ${staffRow.name}${captain ? `, captained by ${captain.name || captain.username}` : ""}.`,
    after: { label: created.label, capacity: created.capacity, staffName: staffRow.name, captain: captain?.username || null },
  });
  res.status(201).json({ ...created, staffName: staffRow.name, captainName: captain?.name || null, captainUsername: captain?.username || null });
}));

// Switch which staff member is assigned to this coach, and/or update the
// driver's name / capacity. All fields optional except staffUserId, which
// (per the original design) every coach must always have one of.
router.patch("/api/coaches/:id", writeAccess, wrap(async (req, res) => {
  const { staffUserId, driverName, capacity, label, accountId } = req.body || {};
  if (!staffUserId) return res.status(400).json({ error: "STAFF_REQUIRED", message: "Every coach needs a staff member assigned." });

  const staffRow = await get(`SELECT id, name FROM users WHERE id = $1`, [staffUserId]);
  if (!staffRow) return res.status(404).json({ error: "STAFF_NOT_FOUND", message: "That staff member doesn't exist." });

  // Full BEFORE snapshot so the audit can show exactly what changed. Joins in
  // the old staff/captain display names, not just their ids.
  const existing = await get(
    `SELECT c.trip_id, c.label, c.capacity, c.staff_user_id AS "staffUserId", u.name AS "staffName",
            c.account_id AS "accountId", a.username AS "captainUsername", a.name AS "captainName"
       FROM coaches c LEFT JOIN users u ON u.id = c.staff_user_id LEFT JOIN accounts a ON a.id = c.account_id
      WHERE c.id = $1`,
    [req.params.id]
  );
  if (!existing) return res.status(404).json({ error: "NOT_FOUND", message: "Coach not found." });

  // accountId semantics: omitted (undefined) = leave the captain unchanged;
  // explicit null/"" = clear the captain; a value = set/validate it.
  const changeCaptain = accountId !== undefined;
  let captain = null;
  if (changeCaptain && accountId) {
    captain = await get(`SELECT id, name, username FROM accounts WHERE id = $1`, [accountId]);
    if (!captain) return res.status(404).json({ error: "ACCOUNT_NOT_FOUND", message: "That login account doesn't exist." });
  }

  const updated = await get(
    `UPDATE coaches
        SET staff_user_id = $1,
            driver_name = COALESCE($2, driver_name),
            capacity = COALESCE($3, capacity),
            label = COALESCE($4, label),
            name = COALESCE($4, name),
            account_id = CASE WHEN $6 THEN $7 ELSE account_id END
      WHERE id = $5
      RETURNING id, label, capacity, sort_order AS "sortOrder", staff_user_id AS "staffUserId", driver_name AS "driverName", account_id AS "accountId"`,
    [staffUserId, driverName !== undefined ? (String(driverName).trim() || null) : null, Number(capacity) || null, label?.trim() || null, req.params.id, changeCaptain, changeCaptain ? (captain?.id || null) : null]
  );

  const parts = [];
  if (existing.staffUserId !== staffUserId) parts.push(`led by ${staffRow.name}`);
  if (changeCaptain && (existing.captainUsername || null) !== (captain?.username || null)) {
    parts.push(captain ? `captained by ${captain.name || captain.username}` : "captain cleared");
  }
  await recordEvent(existing.trip_id, req, {
    action: "coach.update", entity: "coach", entityId: req.params.id, kind: "coach",
    summary: `${updated.label} updated${parts.length ? ` — ${parts.join(", ")}` : ""}.`,
    before: { label: existing.label, capacity: existing.capacity, staffName: existing.staffName, captain: existing.captainUsername },
    after: { label: updated.label, capacity: updated.capacity, staffName: staffRow.name, captain: changeCaptain ? (captain?.username || null) : existing.captainUsername },
  });
  res.json({ ...updated, staffName: staffRow.name, captainName: captain?.name || (changeCaptain ? null : existing.captainName), captainUsername: captain?.username || (changeCaptain ? null : existing.captainUsername) });
}));

router.delete("/api/coaches/:id", writeAccess, wrap(async (req, res) => {
  const countRow = await get(`SELECT COUNT(*) AS c FROM delegates WHERE "coachId" = $1`, [req.params.id]);
  const n = Number(countRow?.c || 0);
  if (n > 0) {
    return res.status(409).json({
      error: "DELEGATES_ASSIGNED",
      message: `Cannot remove this coach: ${n} delegate${n !== 1 ? "s" : ""} still assigned. Move them first.`,
    });
  }
  const deleted = await get(`DELETE FROM coaches WHERE id = $1 RETURNING id, label, trip_id, capacity`, [req.params.id]);
  if (!deleted) return res.status(404).json({ error: "NOT_FOUND", message: "Coach not found." });
  await recordEvent(deleted.trip_id, req, {
    action: "coach.delete", entity: "coach", entityId: deleted.id, kind: "coach",
    summary: `${deleted.label} was removed from the fleet.`,
    before: { label: deleted.label, capacity: deleted.capacity },
  });
  res.json({ deleted: true });
}));

/* =============================================================================
 *  Itinerary
 * ========================================================================== */
router.get("/api/trips/:tripId/itinerary", readAccess, wrap(async (req, res) => {
  const items = await all(
    `SELECT id, day_number AS "dayNumber", TO_CHAR(start_time, 'HH24:MI') AS "startTime",
            title, location, sort_order AS "sortOrder", category,
            COALESCE(status, 'scheduled') AS status,
            COALESCE(delay_minutes, 0) AS "delayMinutes",
            COALESCE(completed, false) AS completed
       FROM itinerary_items WHERE trip_id = $1 ORDER BY day_number, sort_order`,
    [req.params.tripId]
  );
  res.json({ items, categories: ITINERARY_CATEGORIES });
}));

router.post("/api/trips/:tripId/itinerary", writeAccess, wrap(async (req, res) => {
  const { dayNumber, startTime, title, location, sortOrder, category, status, delayMinutes } = req.body || {};
  if (!dayNumber || !startTime || !title || !title.trim()) {
    return res.status(400).json({ error: "MISSING_FIELDS", message: "Day, time and title are required." });
  }
  const st = ITINERARY_STATUSES.includes(status) ? status : "scheduled";
  const delay = st === "delayed" ? Math.max(0, Number(delayMinutes) || 0) : 0;
  const item = await get(
    `INSERT INTO itinerary_items (trip_id, day_number, start_time, title, location, sort_order, category, status, delay_minutes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id, day_number AS "dayNumber", TO_CHAR(start_time,'HH24:MI') AS "startTime", title, location, sort_order AS "sortOrder", category, status, delay_minutes AS "delayMinutes", completed`,
    [req.params.tripId, Number(dayNumber), startTime, title.trim(), (location || "").trim() || null, Number(sortOrder) || 0, normalizeCategory(category), st, delay]
  );
  await recordEvent(req.params.tripId, req, {
    action: "itinerary.create", entity: "itinerary", entityId: item.id, kind: "itinerary",
    summary: `Itinerary: "${item.title}" added to Day ${item.dayNumber}.`,
    after: { day: item.dayNumber, time: item.startTime, title: item.title, status: item.status },
  });
  res.status(201).json(item);
}));

router.patch("/api/trips/:tripId/itinerary/:itemId", writeAccess, wrap(async (req, res) => {
  const { dayNumber, startTime, title, location, category, status, delayMinutes } = req.body || {};
  if (!dayNumber || !startTime || !title || !title.trim()) {
    return res.status(400).json({ error: "MISSING_FIELDS", message: "Day, time and title are required." });
  }
  const st = ITINERARY_STATUSES.includes(status) ? status : "scheduled";
  const delay = st === "delayed" ? Math.max(0, Number(delayMinutes) || 0) : 0;
  const before = await get(
    `SELECT day_number AS "dayNumber", TO_CHAR(start_time,'HH24:MI') AS "startTime", title, location, category, status, delay_minutes AS "delayMinutes"
       FROM itinerary_items WHERE id = $1 AND trip_id = $2`,
    [req.params.itemId, req.params.tripId]
  );
  const item = await get(
    `UPDATE itinerary_items SET day_number = $1, start_time = $2, title = $3, location = $4, category = $5, status = $6, delay_minutes = $7
      WHERE id = $8 AND trip_id = $9
      RETURNING id, day_number AS "dayNumber", TO_CHAR(start_time,'HH24:MI') AS "startTime", title, location, sort_order AS "sortOrder", category, status, delay_minutes AS "delayMinutes", completed`,
    [Number(dayNumber), startTime, title.trim(), (location || "").trim() || null, normalizeCategory(category), st, delay, req.params.itemId, req.params.tripId]
  );
  if (!item) return res.status(404).json({ error: "NOT_FOUND", message: "Itinerary item not found." });
  await recordEvent(req.params.tripId, req, {
    action: "itinerary.update", entity: "itinerary", entityId: item.id, kind: "itinerary",
    summary: `Itinerary: "${item.title}" updated.`,
    before: before && { day: before.dayNumber, time: before.startTime, title: before.title, status: before.status, delayMinutes: before.delayMinutes },
    after: { day: item.dayNumber, time: item.startTime, title: item.title, status: item.status, delayMinutes: item.delayMinutes },
  });
  res.json(item);
}));

// Lightweight live-status update for one stop — lets a coordinator flag a stop
// as delayed / moved / cancelled (or back to on-time) from the board itself,
// without re-entering its whole form. delayMinutes only applies to "delayed".
router.patch("/api/trips/:tripId/itinerary/:itemId/status", writeAccess, wrap(async (req, res) => {
  const { status, delayMinutes } = req.body || {};
  if (!ITINERARY_STATUSES.includes(status)) {
    return res.status(400).json({ error: "BAD_STATUS", message: "Unknown itinerary status." });
  }
  const delay = status === "delayed" ? Math.max(0, Number(delayMinutes) || 0) : 0;
  const before = await get(
    `SELECT status, delay_minutes AS "delayMinutes" FROM itinerary_items WHERE id = $1 AND trip_id = $2`,
    [req.params.itemId, req.params.tripId]
  );
  const item = await get(
    `UPDATE itinerary_items SET status = $1, delay_minutes = $2
      WHERE id = $3 AND trip_id = $4
      RETURNING id, day_number AS "dayNumber", TO_CHAR(start_time,'HH24:MI') AS "startTime", title, location, sort_order AS "sortOrder", category, status, delay_minutes AS "delayMinutes", completed`,
    [status, delay, req.params.itemId, req.params.tripId]
  );
  if (!item) return res.status(404).json({ error: "NOT_FOUND", message: "Itinerary item not found." });
  const label = status === "delayed" ? `delayed ${delay} min` : status;
  await recordEvent(req.params.tripId, req, {
    action: "itinerary.status", entity: "itinerary", entityId: item.id, kind: "itinerary",
    summary: `Itinerary: "${item.title}" marked ${label}.`,
    before: before && { status: before.status, delayMinutes: before.delayMinutes },
    after: { status: item.status, delayMinutes: item.delayMinutes },
  });
  res.json(item);
}));

// Tick / untick a stop as completed (crossed out on the board). Orthogonal to
// status — a stop can be, say, "delayed" and then completed.
router.patch("/api/trips/:tripId/itinerary/:itemId/complete", writeAccess, wrap(async (req, res) => {
  const completed = !!(req.body && req.body.completed);
  const item = await get(
    `UPDATE itinerary_items SET completed = $1
      WHERE id = $2 AND trip_id = $3
      RETURNING id, day_number AS "dayNumber", TO_CHAR(start_time,'HH24:MI') AS "startTime", title, location, sort_order AS "sortOrder", category, status, delay_minutes AS "delayMinutes", completed`,
    [completed, req.params.itemId, req.params.tripId]
  );
  if (!item) return res.status(404).json({ error: "NOT_FOUND", message: "Itinerary item not found." });
  await recordEvent(req.params.tripId, req, {
    action: "itinerary.complete", entity: "itinerary", entityId: item.id, kind: "itinerary",
    summary: `Itinerary: "${item.title}" ${completed ? "completed" : "reopened"}.`,
    before: { completed: !completed }, after: { completed },
  });
  res.json(item);
}));

router.delete("/api/trips/:tripId/itinerary/:itemId", writeAccess, wrap(async (req, res) => {
  const deleted = await get(
    `DELETE FROM itinerary_items WHERE id = $1 AND trip_id = $2 RETURNING id, title, day_number AS "dayNumber", TO_CHAR(start_time,'HH24:MI') AS "startTime"`,
    [req.params.itemId, req.params.tripId]
  );
  if (!deleted) return res.status(404).json({ error: "NOT_FOUND", message: "Itinerary item not found." });
  await recordEvent(req.params.tripId, req, {
    action: "itinerary.delete", entity: "itinerary", entityId: deleted.id, kind: "itinerary",
    summary: `Itinerary: "${deleted.title}" removed.`,
    before: { day: deleted.dayNumber, time: deleted.startTime, title: deleted.title },
  });
  res.json({ deleted: true });
}));

/* =============================================================================
 *  Per-event attendance (point-to-point) + its before/after history
 *  ---------------------------------------------------------------------------
 *  Every itinerary stop is a "checkpoint": a delegate has an independent
 *  present/missing/late status AT each stop, so full headcount can be confirmed
 *  at every venue, not just initial boarding. The live per-stop status is kept
 *  in JQ's checkpoint_checkins (also read by the Dashboard/Timeline); on top of
 *  that, every change is logged to attendance_log so staff get a full "who was
 *  marked what, by whom, when — and what it was before" trail per event, per
 *  coach.
 * ========================================================================== */
const ATTENDANCE_STATUSES = ["ARRIVED", "MISSING", "LATE"];

// Read: every delegate's status at one stop (grouped client-side by coach) plus
// the change history for that stop. View-for-all.
router.get("/api/trips/:tripId/itinerary/:itemId/attendance", readAccess, wrap(async (req, res) => {
  const { tripId, itemId } = req.params;
  const item = await get(
    `SELECT id, title, day_number AS "dayNumber", TO_CHAR(start_time,'HH24:MI') AS "startTime", COALESCE(completed,false) AS completed
       FROM itinerary_items WHERE id = $1 AND trip_id = $2`,
    [itemId, tripId]
  );
  if (!item) return res.status(404).json({ error: "NOT_FOUND", message: "Itinerary item not found." });

  const delegates = await all(
    `SELECT d.id AS "delegateId", d.name, d."coachId", c.label AS "coachLabel", c.sort_order AS "coachSort",
            cc.status, cc.scanned_by AS "scannedBy", cc.updated_at AS "updatedAt"
       FROM delegates d
       LEFT JOIN coaches c ON c.id = d."coachId"
       LEFT JOIN checkpoint_checkins cc ON cc.itinerary_item_id = $1 AND cc.delegate_id = d.id
      WHERE d.trip_id = $2
      ORDER BY c.sort_order NULLS LAST, d.name`,
    [itemId, tripId]
  );

  const history = await all(
    `SELECT a.id, a.delegate_id AS "delegateId", d.name AS "delegateName",
            a.coach_id AS "coachId", c.label AS "coachLabel",
            a.actor, a.from_status AS "fromStatus", a.to_status AS "toStatus", a.at
       FROM attendance_log a
       LEFT JOIN delegates d ON d.id = a.delegate_id
       LEFT JOIN coaches c ON c.id = a.coach_id
      WHERE a.itinerary_item_id = $1
      ORDER BY a.at DESC LIMIT 300`,
    [itemId]
  );

  res.json({ item, delegates, history });
}));

// Write: set one delegate's status at one stop. Upserts JQ's checkpoint_checkins
// AND logs the before/after to attendance_log. Gated on manageTrips.
router.post("/api/trips/:tripId/itinerary/:itemId/attendance", writeAccess, wrap(async (req, res) => {
  const { tripId, itemId } = req.params;
  const { delegateId, status } = req.body || {};
  if (!delegateId) return res.status(400).json({ error: "DELEGATE_REQUIRED", message: "delegateId is required." });
  if (!ATTENDANCE_STATUSES.includes(status)) {
    return res.status(400).json({ error: "INVALID_STATUS", message: `status must be one of ${ATTENDANCE_STATUSES.join(", ")}.` });
  }
  const item = await get(`SELECT id, title FROM itinerary_items WHERE id = $1 AND trip_id = $2`, [itemId, tripId]);
  if (!item) return res.status(404).json({ error: "NOT_FOUND", message: "Itinerary item not found." });
  const delegate = await get(`SELECT id, name, "coachId" FROM delegates WHERE id = $1 AND trip_id = $2`, [delegateId, tripId]);
  if (!delegate) return res.status(404).json({ error: "DELEGATE_NOT_FOUND", message: "Delegate not on this trip." });

  const before = await get(`SELECT status FROM checkpoint_checkins WHERE itinerary_item_id = $1 AND delegate_id = $2`, [itemId, delegateId]);
  const fromStatus = before?.status || null;
  if (fromStatus === status) return res.json({ unchanged: true, status });

  const actor = actorOf(req) || "Staff";
  await run(
    `INSERT INTO checkpoint_checkins (itinerary_item_id, delegate_id, status, method, scanned_by, updated_at)
     VALUES ($1,$2,$3,NULL,$4,now())
     ON CONFLICT (itinerary_item_id, delegate_id) DO UPDATE SET status = $3, scanned_by = $4, updated_at = now()`,
    [itemId, delegateId, status, actor]
  );
  await run(
    `INSERT INTO attendance_log (id, trip_id, itinerary_item_id, delegate_id, coach_id, actor, from_status, to_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [`att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, tripId, itemId, delegateId, delegate.coachId || null, actor, fromStatus, status]
  );
  // FIX (2026-07-25, JQ): this used to only write checkpoint_checkins above —
  // the delegate's own GLOBAL status (what the Dashboard/All-delegates table
  // actually reads) was never touched, so marking someone "Arrived" here
  // left them showing their old status everywhere else in the app. This is
  // a deliberate, explicit staff action for THIS delegate (unlike the
  // late-cutoff auto-transition elsewhere, which only ever promotes
  // ASSIGNED -> LATE to avoid clobbering a more specific state) — so it
  // unconditionally syncs the global status to match. Best-effort: a sync
  // failure never blocks the attendance record itself from being saved.
  await updateDelegate(delegateId, { status }, actor).catch((err) =>
    console.error("  Attendance -> global status sync failed:", err.message || err)
  );
  res.status(201).json({ delegateId, status, fromStatus });
}));

/* =============================================================================
 *  Delegates
 *  (Coach reassignment and delete reuse JQ's existing PATCH/DELETE
 *  /api/delegates/:id — see file header for why activity for those two is
 *  reported by the frontend via POST /api/trips/:tripId/activity instead of
 *  logged here.)
 * ========================================================================== */
router.get("/api/delegates", readAccess, wrap(async (req, res) => {
  const { tripId } = req.query;
  if (!tripId) return res.status(400).json({ error: "MISSING_TRIP_ID", message: "tripId query param is required." });
  const delegates = await all(
    `SELECT id, name, initials, "coachId", status, vip, "lastSeen", notes, company, accessibility_notes AS "accessibilityNotes", "photoUrl"
       FROM delegates WHERE trip_id = $1 ORDER BY name`,
    [tripId]
  );
  res.json({ delegates });
}));

router.post("/api/delegates", writeAccess, wrap(async (req, res) => {
  const { tripId, name, vip, notes, company, accessibilityNotes } = req.body || {};
  if (!tripId) return res.status(400).json({ error: "MISSING_TRIP_ID", message: "tripId is required." });
  if (!name || !name.trim()) return res.status(400).json({ error: "NAME_REQUIRED", message: "A name is required." });

  const id = await nextDelegateId();
  const delegate = await get(
    `INSERT INTO delegates (id, trip_id, name, initials, "coachId", status, vip, notes, company, accessibility_notes)
     VALUES ($1,$2,$3,$4,NULL,'UNASSIGNED',$5,$6,$7,$8)
     RETURNING id, name, initials, "coachId", status, vip, "lastSeen", notes, company, accessibility_notes AS "accessibilityNotes", "photoUrl"`,
    [id, tripId, name.trim(), initialsOf(name), !!vip, (notes || "").trim() || null, (company || "").trim() || null, (accessibilityNotes || "").trim() || null]
  );
  await recordEvent(tripId, req, {
    action: "delegate.create", entity: "delegate", entityId: delegate.id, kind: "delegate",
    summary: `${delegate.name} was added${vip ? " (VIP)" : ""}.`,
    after: { name: delegate.name, vip: !!delegate.vip, company: delegate.company },
  });
  res.status(201).json(delegate);
}));

// Superset of the old /notes route: partial update of the fields that live
// only on this feature's side (JQ's own PATCH /api/delegates/:id handles
// coachId/status reassignment and doesn't know about these columns).
// Every field is optional — omit a field to leave it unchanged.
router.patch("/api/delegates/:id/details", writeAccess, wrap(async (req, res) => {
  const body = req.body || {};
  const sets = [];
  const params = [];
  let i = 1;

  if (body.notes !== undefined) { sets.push(`notes = $${i++}`); params.push(String(body.notes).trim() || null); }
  if (body.company !== undefined) { sets.push(`company = $${i++}`); params.push(String(body.company).trim() || null); }
  if (body.accessibilityNotes !== undefined) { sets.push(`accessibility_notes = $${i++}`); params.push(String(body.accessibilityNotes).trim() || null); }
  if (body.vip !== undefined) { sets.push(`vip = $${i++}`); params.push(!!body.vip); }
  if (body.name !== undefined && String(body.name).trim()) {
    sets.push(`name = $${i++}`); params.push(String(body.name).trim());
    sets.push(`initials = $${i++}`); params.push(initialsOf(body.name));
  }

  if (sets.length === 0) {
    return res.status(400).json({ error: "NO_FIELDS", message: "Nothing to update." });
  }

  const detailBefore = await get(
    `SELECT name, vip, notes, company, accessibility_notes AS "accessibilityNotes" FROM delegates WHERE id = $1`,
    [req.params.id]
  );
  params.push(req.params.id);
  const delegate = await get(
    `UPDATE delegates SET ${sets.join(", ")} WHERE id = $${i}
     RETURNING id, name, initials, "coachId", status, vip, "lastSeen", notes, company, accessibility_notes AS "accessibilityNotes", trip_id AS "tripId"`,
    params
  );
  if (!delegate) return res.status(404).json({ error: "NOT_FOUND", message: "Delegate not found." });
  await recordEvent(delegate.tripId, req, {
    action: "delegate.details", entity: "delegate", entityId: delegate.id, kind: "delegate",
    summary: `${delegate.name}'s details were updated.`,
    before: detailBefore && { name: detailBefore.name, vip: detailBefore.vip, company: detailBefore.company, accessibilityNotes: detailBefore.accessibilityNotes, notes: detailBefore.notes },
    after: { name: delegate.name, vip: delegate.vip, company: delegate.company, accessibilityNotes: delegate.accessibilityNotes, notes: delegate.notes },
  });
  res.json(delegate);
}));

// Kept for backwards compatibility with the v1 frontend build.
router.patch("/api/delegates/:id/notes", writeAccess, wrap(async (req, res) => {
  const { notes } = req.body || {};
  const delegate = await get(
    `UPDATE delegates SET notes = $1 WHERE id = $2
     RETURNING id, name, initials, "coachId", status, vip, "lastSeen", notes, company, accessibility_notes AS "accessibilityNotes"`,
    [(notes || "").trim() || null, req.params.id]
  );
  if (!delegate) return res.status(404).json({ error: "NOT_FOUND", message: "Delegate not found." });
  res.json(delegate);
}));

export default router;
