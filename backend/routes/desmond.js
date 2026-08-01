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
import { syncTripDayOf, resolveTripUuid } from "../db/dashboard.js";
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

/* "Total days" — and the trip card's "dateRange" display — now follow the
 * itinerary directly rather than being independently-typed values that can
 * drift out of sync. First cut (2026-07-30 — "I added day 6 but it's not
 * reflected") only ever bumped totalDays UP; that turned out to be wrong the
 * moment someone deleted a day ("if I remove day 8 it's still there") — a
 * one-way ratchet isn't "following the itinerary", it's "following it only
 * when it grows". This recomputes totalDays as the itinerary's actual
 * highest day number every time (grows OR shrinks), AND recomputes dateRange
 * (startDate + totalDays - 1, same "25 Jul 2026 – 1 Aug 2026" format
 * TripsListPage.jsx's computeDateRange() renders) in the same statement, so
 * the two can never disagree with each other or with what's actually
 * scheduled. Guarded on `days > 0`: a trip with zero itinerary items keeps
 * whatever totalDays/dateRange it already had rather than collapsing to 1
 * day the moment its last item is deleted — this only takes over once an
 * itinerary actually exists. Called after every itinerary create/update/
 * delete. */
/** Clears a stale "Current day" override and immediately recomputes it
 *  (2026-07-31 — "checkpoint is the problem of why delegate didn't auto
 *  change to assigned/late back"). Editing the itinerary is exactly the
 *  moment a manually-frozen dayOf becomes most misleading — staff just
 *  changed the schedule, so the system's idea of "today's stops" should
 *  reflect it, not stay stuck on a value hand-typed before the edit. Without
 *  this, both checkpoint auto-transition schedulers (routes/checkpoints.js)
 *  keep matching against the WRONG day's itinerary indefinitely, since
 *  syncTripDayOf() itself refuses to touch dayOf while the manual flag is on.
 *  Called after every itinerary create/update/delete, same as
 *  syncTotalDaysToItinerary() above. */
async function clearManualDayOfAndResync(tripId) {
  await run(`UPDATE trips SET "dayOfIsManual" = false WHERE uuid_id = $1`, [tripId]);
  await syncTripDayOf(tripId);
}

async function syncTotalDaysToItinerary(tripId) {
  await run(
    `UPDATE trips t
        SET "totalDays" = sub.days,
            "dateRange" = CASE
              WHEN t."startDate" IS NULL THEN t."dateRange"
              WHEN sub.days <= 1 THEN to_char(t."startDate"::date, 'FMDD Mon YYYY')
              ELSE to_char(t."startDate"::date, 'FMDD Mon YYYY') || ' – ' ||
                   to_char(t."startDate"::date + (sub.days - 1), 'FMDD Mon YYYY')
            END
       FROM (SELECT COALESCE(MAX(day_number), 0) AS days FROM itinerary_items WHERE trip_id = $1) sub
      WHERE t.uuid_id = $1 AND sub.days > 0`,
    [tripId]
  );
}

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
    // Multiple captains per coach (2026-07-31, "allow me to select 1-3
    // staff"). coaches.account_id above only ever held ONE login — this is
    // the many-to-many replacement: every route now reads/writes captains
    // through this table instead. The old column is left in place (still
    // populated by the backfill below, and by dev seed scripts) but is no
    // longer the source of truth for any live route.
    await run(`CREATE TABLE IF NOT EXISTS coach_captains (
      coach_id   VARCHAR(64) NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
      account_id VARCHAR(64) NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      PRIMARY KEY (coach_id, account_id)
    )`);
    await run(`CREATE INDEX IF NOT EXISTS idx_coach_captains_account ON coach_captains(account_id)`);
    // One-time backfill: carry over whatever single captain each coach
    // already had into the new table, so this migration doesn't silently
    // un-scope every existing captain-restricted Staff account the moment it
    // ships. ON CONFLICT DO NOTHING makes it safe to run on every boot.
    await run(`
      INSERT INTO coach_captains (coach_id, account_id)
      SELECT id, account_id FROM coaches WHERE account_id IS NOT NULL
      ON CONFLICT DO NOTHING
    `);
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

/* ---- Trip-id resolution (FIX 2026-07-30, JQ) --------------------------------
 * Every trip-scoped column in this file's queries is UUID-typed (trips.uuid_id,
 * coaches.trip_id, delegates.trip_id, itinerary_items.trip_id,
 * trip_event_log.trip_id, attendance_log.trip_id). The caller-supplied trip id,
 * though, may legitimately be the base app's LEGACY short id "t-1" (JQ's
 * seeded primary Beijing trip, which the Dashboard/mobile surfaces still use)
 * rather than a real uuid.
 *
 * This file used to pass that id STRAIGHT into those queries. Postgres
 * validates a parameter's shape against the column type before it ever
 * compares values, so "t-1" didn't simply fail to match — it threw
 * `invalid input syntax for type uuid: "t-1"` (SQLSTATE 22P02) and the route
 * 500'd. Not display-only: it blocked real usage (an empty "Move to coach"
 * dropdown because GET /coaches 500'd, and POST /api/delegates failing
 * outright on the primary trip).
 *
 * Every other route file in the backend (announcements/checkpoints/dashboard/
 * delegates/exceptions/export/history/insights/roomAssign) already funnels the
 * caller's id through resolveTripUuid() for exactly this reason — this file was
 * the only one that never did. resolveTripUuid() maps "t-1" to its real uuid,
 * passes a real uuid through unchanged, and returns null for anything else
 * (including garbage, which is why no separate "is it t-1" branch is needed).
 *
 * Used as route middleware on every `:tripId` path so the handler can just read
 * req.tripUuid. A 404 here (rather than the previous 500) is also the correct
 * answer for an id that resolves to no trip at all. Routes taking the id from
 * the BODY or QUERY STRING instead resolve it inline — same call, same reason.
 * -------------------------------------------------------------------------- */
async function withTripUuid(req, res, next) {
  try {
    const tripUuid = await resolveTripUuid(req.params.tripId);
    if (!tripUuid) return res.status(404).json({ error: "NOT_FOUND", message: "Trip not found." });
    req.tripUuid = tripUuid;
    next();
  } catch (err) {
    next(err);
  }
}

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
// Exported (2026-07-30 — "the history log didn't track the qr, face scanner
// and manual update right?" — confirmed true, none of those check-in routes
// ever called this) so vimal.js/exceptions.js/vance.js can log a check-in the
// same way every desktop edit already does, instead of each duplicating this
// non-trivial function. Nothing about its own behaviour changes.
export async function recordEvent(tripId, req, { action, entity, entityId = null, summary, before = null, after = null, kind = "system" }) {
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

// ACTIVITY is keyed by the RESOLVED uuid (recordEvent/logActivity are called
// with the resolved id everywhere below), so this read has to resolve too or
// "t-1" would look up a key nothing ever writes to and always read empty.
router.get("/api/trips/:tripId/activity", readAccess, withTripUuid, wrap(async (req, res) => {
  res.json({ activity: ACTIVITY.get(req.tripUuid) || [] });
}));

// Persisted before/after audit for one trip, newest first. Powers the board's
// History panel. Separate from the ephemeral /activity feed above (which is
// in-memory and resets on restart); this reads the durable trip_event_log.
router.get("/api/trips/:tripId/audit", readAccess, withTripUuid, wrap(async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 60));
  const events = await all(
    `SELECT id, actor, action, entity, entity_id AS "entityId", summary,
            before_data AS "before", after_data AS "after", at
       FROM trip_event_log WHERE trip_id = $1 ORDER BY at DESC LIMIT $2`,
    [req.tripUuid, limit]
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
       FROM coaches c
       JOIN trips t ON t.uuid_id = c.trip_id
       JOIN coach_captains cc ON cc.coach_id = c.id AND cc.account_id = $1
      ORDER BY t.name, c.sort_order`,
    [accountId]
  );
  res.json({ coaches });
}));

// The frontend calls this right after a mutation that happened through one of
// JQ's OWN routes (delegate reassign/remove) succeeds — see file header for
// why this router can't observe those requests directly. Cosmetic (an
// activity-feed entry, not a real mutation), so any signed-in user, same as
// the original design.
router.post("/api/trips/:tripId/activity", readAccess, withTripUuid, wrap(async (req, res) => {
  const { text, kind, before, after } = req.body || {};
  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: "TEXT_REQUIRED", message: "Activity text is required." });
  }
  const entry = logActivity(req.tripUuid, String(text).trim(), kind);
  // Also persist to the durable audit so client-reported actions (delegate
  // reassign / remove, which happen through JQ's routes and so can't be logged
  // server-side here — see file header) show up in the History panel too, with
  // optional before/after the client may include.
  try {
    await run(
      `INSERT INTO trip_event_log (id, trip_id, actor, action, entity, entity_id, summary, before_data, after_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [`evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, req.tripUuid, actorOf(req) || "System",
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
  // blank even for a trip that already had one saved. departureTime/
  // countryFrom/countryTo added the same way (2026-07-30) after hitting the
  // IDENTICAL bug again — "the To (country) never saved" turned out to mean
  // it saved fine, but reopening Edit Trip re-seeds its form from THIS list,
  // which never selected the new columns, so it always looked blank again.
  const trips = await all(`
    SELECT
      t.uuid_id AS id, t.name, t."dateRange", t.status, t."lead",
      t."dayOf", t."totalDays", t."startDate", t."dayOfIsManual",
      t."departureTime", t."countryFrom", t."countryTo",
      COUNT(DISTINCT c.id) AS "coachCount",
      COUNT(DISTINCT d.id) AS "delegateCount"
    FROM trips t
    LEFT JOIN coaches   c ON c.trip_id = t.uuid_id
    LEFT JOIN delegates d ON d.trip_id = t.uuid_id
    WHERE t.uuid_id IS NOT NULL
    GROUP BY t.uuid_id, t.name, t."dateRange", t.status, t."lead", t."dayOf", t."totalDays", t."startDate", t."dayOfIsManual",
             t."departureTime", t."countryFrom", t."countryTo"
    ORDER BY t.name
  `);
  res.json({
    trips: trips.map((t) => ({ ...t, coachCount: Number(t.coachCount), delegateCount: Number(t.delegateCount) })),
  });
}));

router.get("/api/trips/:tripId/summary", readAccess, withTripUuid, wrap(async (req, res) => {
  const trip = await get(`SELECT * FROM trips WHERE uuid_id = $1`, [req.tripUuid]);
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
    startDate: trip.startDate,
    departureTime: trip.departureTime,
    countryFrom: trip.countryFrom,
    countryTo: trip.countryTo,
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

const HHMM_RE = /^\d{2}:\d{2}$/;

router.post("/api/trips", writeAccess, wrap(async (req, res) => {
  const { name, dateRange, status, lead, dayOf, totalDays, startDate, departureTime, countryFrom, countryTo } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "NAME_REQUIRED", message: "A trip name is required." });
  if (departureTime !== undefined && departureTime !== null && departureTime !== "" && !HHMM_RE.test(departureTime)) {
    return res.status(400).json({ error: "BAD_DEPARTURE_TIME", message: "Departure time must be HH:MM." });
  }
  const st = TRIP_STATUSES.includes(status) ? status : "Planning";
  const total = Math.max(1, Number(totalDays) || 5);
  const day = Math.min(total, Math.max(1, Number(dayOf) || 1));
  const sd = startDate ? String(startDate).trim() || null : null;
  const dt = departureTime ? String(departureTime).trim() : null;
  const cf = countryFrom !== undefined ? (String(countryFrom).trim() || null) : null;
  const ct = countryTo !== undefined ? (String(countryTo).trim() || null) : null;
  let trip = await get(
    `INSERT INTO trips (id, uuid_id, name, "dateRange", "dayOf", "totalDays", status, "lead", "startDate", "departureTime", "countryFrom", "countryTo")
     VALUES (gen_random_uuid()::text, gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, COALESCE($8, '10:00'), COALESCE($9, 'Singapore'), $10)
     RETURNING uuid_id AS id, name, "dateRange", status, "lead", "dayOf", "totalDays", "startDate", "dayOfIsManual", "departureTime", "countryFrom", "countryTo"`,
    [name.trim(), (dateRange || "").trim() || null, day, total, st, (lead || "").trim() || null, sd, dt, cf, ct]
  );
  // A startDate was given — compute the real "Day X of Y" immediately instead
  // of leaving whatever was typed (or the "1" default) until the next 60s
  // scheduler tick (see syncTripDayOf(), db/dashboard.js, JQ's).
  if (sd) {
    await syncTripDayOf(trip.id);
    trip = await get(
      `SELECT uuid_id AS id, name, "dateRange", status, "lead", "dayOf", "totalDays", "startDate", "dayOfIsManual", "departureTime", "countryFrom", "countryTo" FROM trips WHERE uuid_id = $1`,
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

router.patch("/api/trips/:tripId", writeAccess, withTripUuid, wrap(async (req, res) => {
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
  if (b.startDate !== undefined) {
    sets.push(`"startDate" = $${i++}`); params.push(String(b.startDate).trim() || null);
    // BUG FIX (2026-07-31 — "checkpoint is the problem of why delegate didn't
    // auto change to assigned/late back"): syncTripDayOf() (below) refuses to
    // touch "dayOf" while dayOfIsManual is true — its own WHERE clause
    // excludes manual-override trips — so a startDate change used to call
    // syncTripDayOf() and get silently ignored if "Current day" had EVER been
    // hand-set once. A stale/frozen dayOf then makes BOTH auto-transition
    // schedulers (applyCheckpointLateCutoff / resetArrivedBeforeNextCheckpoint
    // in routes/checkpoints.js) look at the wrong day's itinerary — today's
    // real stops never match `i.day_number = t."dayOf"`, so delegates stop
    // auto-flipping Assigned<->Late entirely. Changing the actual start date
    // is a strong enough signal that the override is stale — clear it here
    // (unless this SAME request is also hand-setting `dayOf`, or already
    // sending resetDayOfAuto:true — both handled below; pushing here TOO
    // would add a second `"dayOfIsManual" = ...` to the same UPDATE's SET
    // list, which Postgres rejects outright as "multiple assignments to
    // same column" — surfaced to the user as a bare "Something went wrong
    // on the server" with zero indication why. TripsListPage.jsx's Edit
    // trip form always sends BOTH startDate and resetDayOfAuto together on
    // every save, which is exactly the combination that hit this.)
    if (b.dayOf === undefined && b.resetDayOfAuto !== true) sets.push(`"dayOfIsManual" = false`);
  }
  if (b.departureTime !== undefined) {
    const dt = b.departureTime ? String(b.departureTime).trim() : null;
    if (dt && !HHMM_RE.test(dt)) return res.status(400).json({ error: "BAD_DEPARTURE_TIME", message: "Departure time must be HH:MM." });
    sets.push(`"departureTime" = $${i++}`); params.push(dt);
  }
  if (b.countryFrom !== undefined) { sets.push(`"countryFrom" = $${i++}`); params.push(String(b.countryFrom).trim() || null); }
  if (b.countryTo !== undefined) { sets.push(`"countryTo" = $${i++}`); params.push(String(b.countryTo).trim() || null); }
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
    [req.tripUuid]
  );
  params.push(req.tripUuid);
  let trip = await get(
    `UPDATE trips SET ${sets.join(", ")} WHERE uuid_id = $${i}
     RETURNING uuid_id AS id, name, "dateRange", status, "lead", "dayOf", "totalDays", "startDate", "dayOfIsManual", "departureTime", "countryFrom", "countryTo"`,
    params
  );
  if (!trip) return res.status(404).json({ error: "NOT_FOUND", message: "Trip not found." });
  // A new startDate, or clearing the manual override, means "dayOf" may now
  // be stale — recompute immediately rather than waiting for the next tick.
  if (b.startDate !== undefined || b.resetDayOfAuto === true) {
    await syncTripDayOf(req.tripUuid);
    trip = await get(
      `SELECT uuid_id AS id, name, "dateRange", status, "lead", "dayOf", "totalDays", "startDate", "dayOfIsManual", "departureTime", "countryFrom", "countryTo" FROM trips WHERE uuid_id = $1`,
      [req.tripUuid]
    );
  }
  await recordEvent(req.tripUuid, req, {
    action: "trip.update", entity: "trip", entityId: req.tripUuid, kind: "system",
    summary: `Trip details for "${trip.name}" were updated.`,
    before: tripBefore && { name: tripBefore.name, status: tripBefore.status, dateRange: tripBefore.dateRange, lead: tripBefore.lead, dayOf: tripBefore.dayOf, totalDays: tripBefore.totalDays, startDate: tripBefore.startDate },
    after: { name: trip.name, status: trip.status, dateRange: trip.dateRange, lead: trip.lead, dayOf: trip.dayOf, totalDays: trip.totalDays, startDate: trip.startDate },
  });
  res.json(trip);
}));

router.delete("/api/trips/:tripId", writeAccess, withTripUuid, wrap(async (req, res) => {
  const trip = await get(`SELECT id, uuid_id, name FROM trips WHERE uuid_id = $1`, [req.tripUuid]);
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
router.get("/api/trips/:tripId/coaches", readAccess, withTripUuid, wrap(async (req, res) => {
  // FIX (2026-07-30, JQ): c.name/c.city weren't selected, so any consumer of
  // this list (e.g. MobileTripsPage.jsx's DelegateSheet, which shows "Coach
  // 4 · Suzhou" the same way MobileAttendancePage.jsx's own coachName()
  // helper does — [c.name, c.city].filter(Boolean).join(" · ")) could only
  // ever fall back to the bare c.label ("C3"). Coaches created through this
  // board's own forms never set city at all (no field for it) — that's
  // expected, not a bug; the join naturally degrades to name-only for those.
  const coaches = await all(`
    SELECT
      c.id, c.label, c.name, c.city, c.capacity, c.sort_order AS "sortOrder",
      c.staff_user_id AS "staffUserId", u.name AS "staffName", c.driver_name AS "driverName",
      COALESCE(c.arrival_status, 'not_arrived') AS "arrivalStatus",
      -- Captains (2026-07-31, multi-captain support) — a correlated subquery,
      -- not a plain JOIN, so it can't multiply rows against the delegates
      -- JOIN below and corrupt the boarded/missing/total counts.
      (SELECT COALESCE(json_agg(json_build_object('id', a2.id, 'name', a2.name, 'username', a2.username) ORDER BY a2.name NULLS LAST, a2.username), '[]'::json)
         FROM coach_captains cc JOIN accounts a2 ON a2.id = cc.account_id
        WHERE cc.coach_id = c.id) AS captains,
      COUNT(d.id) FILTER (WHERE d.status IN ('PRESENT', 'ARRIVED')) AS boarded,
      COUNT(d.id) FILTER (WHERE d.status = 'MISSING') AS missing,
      COUNT(d.id) AS total
    FROM coaches c
    LEFT JOIN users u    ON u.id = c.staff_user_id
    LEFT JOIN delegates d ON d."coachId" = c.id
    WHERE c.trip_id = $1
    GROUP BY c.id, c.label, c.name, c.city, c.capacity, c.sort_order, c.staff_user_id, u.name, c.driver_name, c.arrival_status
    ORDER BY c.sort_order
  `, [req.tripUuid]);

  res.json({
    coaches: coaches.map((c) => ({ ...c, boarded: Number(c.boarded), missing: Number(c.missing), total: Number(c.total) })),
  });
}));

// Bulk capacity — sets EVERY existing coach on a trip to the same seat count
// in one shot (2026-07-24, Edit trip's "Max delegates per coach" field).
// Deliberately separate from the per-coach PATCH /api/coaches/:id below —
// that one already exists for adjusting a single coach; this is for "make
// them all X" instead of editing each one individually.
router.patch("/api/trips/:tripId/coaches/capacity", writeAccess, withTripUuid, wrap(async (req, res) => {
  const capacity = Math.min(200, Math.max(1, Math.floor(Number(req.body?.capacity) || 0)));
  if (!capacity) return res.status(400).json({ error: "BAD_CAPACITY", message: "capacity must be a positive number." });
  const updated = await all(
    `UPDATE coaches SET capacity = $1 WHERE trip_id = $2 RETURNING id`,
    [capacity, req.tripUuid]
  );
  if (updated.length) {
    await recordEvent(req.tripUuid, req, {
      action: "coach.capacity", entity: "trip", entityId: req.tripUuid, kind: "coach",
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
  // Body-supplied id — resolve it the same way withTripUuid does for :tripId
  // routes (see its comment). 404 rather than 500 on an id that matches no trip.
  const tripUuid = await resolveTripUuid(tripId);
  if (!tripUuid) return res.status(404).json({ error: "NOT_FOUND", message: "Trip not found." });
  const n = Math.min(50, Math.max(1, Math.floor(Number(count) || 0)));
  const cap = Math.min(200, Math.max(1, Math.floor(Number(capacity) || 40)));
  const rows = await all(`SELECT label, sort_order AS "sortOrder" FROM coaches WHERE trip_id = $1`, [tripUuid]);
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
      [tripUuid, label, cap, maxSort + i]
    );
    created.push(c);
  }
  await recordEvent(tripUuid, req, {
    action: "coach.generate", entity: "trip", entityId: tripUuid, kind: "coach",
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

const MAX_CAPTAINS = 3;

router.post("/api/coaches", writeAccess, wrap(async (req, res) => {
  const { tripId, label, capacity, driverName } = req.body || {};
  // accountIds (2026-07-31, "allow me to select 1-3 staff") replaces the old
  // singular accountId — still accepted as a 1-element fallback so nothing
  // calling this with the old shape breaks.
  const rawIds = Array.isArray(req.body?.accountIds) ? req.body.accountIds : (req.body?.accountId ? [req.body.accountId] : []);
  const accountIds = Array.from(new Set(rawIds.filter(Boolean)));
  if (!tripId) return res.status(400).json({ error: "MISSING_TRIP_ID", message: "tripId is required." });
  // Body-supplied id — resolve like withTripUuid does for :tripId routes.
  const tripUuid = await resolveTripUuid(tripId);
  if (!tripUuid) return res.status(404).json({ error: "NOT_FOUND", message: "Trip not found." });
  if (!label || !label.trim()) return res.status(400).json({ error: "LABEL_REQUIRED", message: "A coach label is required." });
  if (accountIds.length > MAX_CAPTAINS) return res.status(400).json({ error: "TOO_MANY_CAPTAINS", message: `A coach can have at most ${MAX_CAPTAINS} captains.` });

  // Captains: the login accounts that manage (and are scoped to) this coach —
  // see coach_captains in ensureOpsSchema. Validated so a coach can't be
  // pinned to a non-existent login. This is now the ONLY "who's assigned"
  // concept a coach has (2026-07-31, "remove the staff member option ...
  // rename coach captains to staff member") — the old staffUserId (a
  // display-only guide-directory name with no login, from the separate
  // `users` table) is no longer collected from the UI at all.
  let captains = [];
  if (accountIds.length) {
    captains = await all(`SELECT id, name, username FROM accounts WHERE id = ANY($1)`, [accountIds]);
    if (captains.length !== accountIds.length) return res.status(404).json({ error: "ACCOUNT_NOT_FOUND", message: "One of those login accounts doesn't exist." });
  }

  const maxRow = await get(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM coaches WHERE trip_id = $1`, [tripUuid]);
  const sortOrder = Number(maxRow?.m ?? -1) + 1;

  const created = await get(
    `INSERT INTO coaches (id, trip_id, label, name, capacity, sort_order, driver_name, account_id)
     VALUES (gen_random_uuid()::text, $1, $2, $2, $3, $4, $5, $6)
     RETURNING id, label, capacity, sort_order AS "sortOrder", driver_name AS "driverName"`,
    [tripUuid, label.trim(), Number(capacity) || 40, sortOrder, (driverName || "").trim() || null, captains[0]?.id || null]
  );
  for (const cap of captains) {
    await run(`INSERT INTO coach_captains (coach_id, account_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [created.id, cap.id]);
  }
  const captainNames = captains.map((c) => c.name || c.username).join(", ");
  await recordEvent(tripUuid, req, {
    action: "coach.create", entity: "coach", entityId: created.id, kind: "coach",
    summary: `${label.trim()} was added to the fleet${captains.length ? `, staffed by ${captainNames}` : ""}.`,
    after: { label: created.label, capacity: created.capacity, captains: captains.map((c) => c.username) },
  });
  res.status(201).json({ ...created, captains: captains.map((c) => ({ id: c.id, name: c.name, username: c.username })) });
}));

// Switch which staff member is assigned to this coach, and/or update the
// driver's name / capacity. Captains (2026-07-31) are now the only "who's
// assigned" concept a coach has — the old staffUserId requirement (a
// display-only guide-directory name from the separate `users` table, with no
// login behind it) is gone; every field here is optional.
router.patch("/api/coaches/:id", writeAccess, wrap(async (req, res) => {
  const { driverName, capacity, label } = req.body || {};

  // Full BEFORE snapshot so the audit can show exactly what changed.
  const existing = await get(
    `SELECT trip_id, label, capacity FROM coaches WHERE id = $1`,
    [req.params.id]
  );
  if (!existing) return res.status(404).json({ error: "NOT_FOUND", message: "Coach not found." });
  const existingCaptains = await all(
    `SELECT a.id, a.name, a.username FROM coach_captains cc JOIN accounts a ON a.id = cc.account_id WHERE cc.coach_id = $1 ORDER BY a.name NULLS LAST, a.username`,
    [req.params.id]
  );

  // accountIds semantics: omitted (undefined) = leave captains unchanged;
  // [] = clear all captains; an array = replace the set (2026-07-31, "allow
  // me to select 1-3 staff" — up to MAX_CAPTAINS).
  const changeCaptains = req.body?.accountIds !== undefined;
  let captains = existingCaptains;
  if (changeCaptains) {
    const accountIds = Array.from(new Set((Array.isArray(req.body.accountIds) ? req.body.accountIds : []).filter(Boolean)));
    if (accountIds.length > MAX_CAPTAINS) return res.status(400).json({ error: "TOO_MANY_CAPTAINS", message: `A coach can have at most ${MAX_CAPTAINS} captains.` });
    captains = accountIds.length ? await all(`SELECT id, name, username FROM accounts WHERE id = ANY($1)`, [accountIds]) : [];
    if (captains.length !== accountIds.length) return res.status(404).json({ error: "ACCOUNT_NOT_FOUND", message: "One of those login accounts doesn't exist." });
  }

  const updated = await get(
    `UPDATE coaches
        SET driver_name = COALESCE($1, driver_name),
            capacity = COALESCE($2, capacity),
            label = COALESCE($3, label),
            name = COALESCE($3, name),
            account_id = CASE WHEN $5 THEN $6 ELSE account_id END
      WHERE id = $4
      RETURNING id, label, capacity, sort_order AS "sortOrder", driver_name AS "driverName"`,
    [driverName !== undefined ? (String(driverName).trim() || null) : null, Number(capacity) || null, label?.trim() || null, req.params.id, changeCaptains, changeCaptains ? (captains[0]?.id || null) : null]
  );
  if (changeCaptains) {
    await run(`DELETE FROM coach_captains WHERE coach_id = $1`, [req.params.id]);
    for (const cap of captains) await run(`INSERT INTO coach_captains (coach_id, account_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.params.id, cap.id]);
  }

  const existingNames = existingCaptains.map((c) => c.name || c.username).sort().join(",");
  const newNames = captains.map((c) => c.name || c.username).sort().join(",");
  const parts = [];
  if (changeCaptains && existingNames !== newNames) {
    parts.push(captains.length ? `staffed by ${captains.map((c) => c.name || c.username).join(", ")}` : "staff cleared");
  }
  await recordEvent(existing.trip_id, req, {
    action: "coach.update", entity: "coach", entityId: req.params.id, kind: "coach",
    summary: `${updated.label} updated${parts.length ? ` — ${parts.join(", ")}` : ""}.`,
    before: { label: existing.label, capacity: existing.capacity, captains: existingCaptains.map((c) => c.username) },
    after: { label: updated.label, capacity: updated.capacity, captains: captains.map((c) => c.username) },
  });
  res.json({ ...updated, captains: captains.map((c) => ({ id: c.id, name: c.name, username: c.username })) });
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
router.get("/api/trips/:tripId/itinerary", readAccess, withTripUuid, wrap(async (req, res) => {
  const items = await all(
    `SELECT id, day_number AS "dayNumber", TO_CHAR(start_time, 'HH24:MI') AS "startTime",
            title, location, sort_order AS "sortOrder", category,
            COALESCE(status, 'scheduled') AS status,
            COALESCE(delay_minutes, 0) AS "delayMinutes",
            COALESCE(completed, false) AS completed
       FROM itinerary_items WHERE trip_id = $1 ORDER BY day_number, sort_order`,
    [req.tripUuid]
  );
  res.json({ items, categories: ITINERARY_CATEGORIES });
}));

router.post("/api/trips/:tripId/itinerary", writeAccess, withTripUuid, wrap(async (req, res) => {
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
    [req.tripUuid, Number(dayNumber), startTime, title.trim(), (location || "").trim() || null, Number(sortOrder) || 0, normalizeCategory(category), st, delay]
  );
  await syncTotalDaysToItinerary(req.tripUuid);
  await clearManualDayOfAndResync(req.tripUuid);
  await recordEvent(req.tripUuid, req, {
    action: "itinerary.create", entity: "itinerary", entityId: item.id, kind: "itinerary",
    summary: `Itinerary: "${item.title}" added to Day ${item.dayNumber}.`,
    after: { day: item.dayNumber, time: item.startTime, title: item.title, status: item.status },
  });
  res.status(201).json(item);
}));

router.patch("/api/trips/:tripId/itinerary/:itemId", writeAccess, withTripUuid, wrap(async (req, res) => {
  const { dayNumber, startTime, title, location, category, status, delayMinutes } = req.body || {};
  if (!dayNumber || !startTime || !title || !title.trim()) {
    return res.status(400).json({ error: "MISSING_FIELDS", message: "Day, time and title are required." });
  }
  const st = ITINERARY_STATUSES.includes(status) ? status : "scheduled";
  const delay = st === "delayed" ? Math.max(0, Number(delayMinutes) || 0) : 0;
  const before = await get(
    `SELECT day_number AS "dayNumber", TO_CHAR(start_time,'HH24:MI') AS "startTime", title, location, category, status, delay_minutes AS "delayMinutes"
       FROM itinerary_items WHERE id = $1 AND trip_id = $2`,
    [req.params.itemId, req.tripUuid]
  );
  const item = await get(
    `UPDATE itinerary_items SET day_number = $1, start_time = $2, title = $3, location = $4, category = $5, status = $6, delay_minutes = $7
      WHERE id = $8 AND trip_id = $9
      RETURNING id, day_number AS "dayNumber", TO_CHAR(start_time,'HH24:MI') AS "startTime", title, location, sort_order AS "sortOrder", category, status, delay_minutes AS "delayMinutes", completed`,
    [Number(dayNumber), startTime, title.trim(), (location || "").trim() || null, normalizeCategory(category), st, delay, req.params.itemId, req.tripUuid]
  );
  if (!item) return res.status(404).json({ error: "NOT_FOUND", message: "Itinerary item not found." });
  await syncTotalDaysToItinerary(req.tripUuid);
  await clearManualDayOfAndResync(req.tripUuid);
  await recordEvent(req.tripUuid, req, {
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
router.patch("/api/trips/:tripId/itinerary/:itemId/status", writeAccess, withTripUuid, wrap(async (req, res) => {
  const { status, delayMinutes } = req.body || {};
  if (!ITINERARY_STATUSES.includes(status)) {
    return res.status(400).json({ error: "BAD_STATUS", message: "Unknown itinerary status." });
  }
  const delay = status === "delayed" ? Math.max(0, Number(delayMinutes) || 0) : 0;
  const before = await get(
    `SELECT status, delay_minutes AS "delayMinutes" FROM itinerary_items WHERE id = $1 AND trip_id = $2`,
    [req.params.itemId, req.tripUuid]
  );
  const item = await get(
    `UPDATE itinerary_items SET status = $1, delay_minutes = $2
      WHERE id = $3 AND trip_id = $4
      RETURNING id, day_number AS "dayNumber", TO_CHAR(start_time,'HH24:MI') AS "startTime", title, location, sort_order AS "sortOrder", category, status, delay_minutes AS "delayMinutes", completed`,
    [status, delay, req.params.itemId, req.tripUuid]
  );
  if (!item) return res.status(404).json({ error: "NOT_FOUND", message: "Itinerary item not found." });
  const label = status === "delayed" ? `delayed ${delay} min` : status;
  await recordEvent(req.tripUuid, req, {
    action: "itinerary.status", entity: "itinerary", entityId: item.id, kind: "itinerary",
    summary: `Itinerary: "${item.title}" marked ${label}.`,
    before: before && { status: before.status, delayMinutes: before.delayMinutes },
    after: { status: item.status, delayMinutes: item.delayMinutes },
  });
  res.json(item);
}));

// Tick / untick a stop as completed (crossed out on the board). Orthogonal to
// status — a stop can be, say, "delayed" and then completed.
router.patch("/api/trips/:tripId/itinerary/:itemId/complete", writeAccess, withTripUuid, wrap(async (req, res) => {
  const completed = !!(req.body && req.body.completed);
  const item = await get(
    `UPDATE itinerary_items SET completed = $1
      WHERE id = $2 AND trip_id = $3
      RETURNING id, day_number AS "dayNumber", TO_CHAR(start_time,'HH24:MI') AS "startTime", title, location, sort_order AS "sortOrder", category, status, delay_minutes AS "delayMinutes", completed`,
    [completed, req.params.itemId, req.tripUuid]
  );
  if (!item) return res.status(404).json({ error: "NOT_FOUND", message: "Itinerary item not found." });
  await recordEvent(req.tripUuid, req, {
    action: "itinerary.complete", entity: "itinerary", entityId: item.id, kind: "itinerary",
    summary: `Itinerary: "${item.title}" ${completed ? "completed" : "reopened"}.`,
    before: { completed: !completed }, after: { completed },
  });
  res.json(item);
}));

router.delete("/api/trips/:tripId/itinerary/:itemId", writeAccess, withTripUuid, wrap(async (req, res) => {
  const deleted = await get(
    `DELETE FROM itinerary_items WHERE id = $1 AND trip_id = $2 RETURNING id, title, day_number AS "dayNumber", TO_CHAR(start_time,'HH24:MI') AS "startTime"`,
    [req.params.itemId, req.tripUuid]
  );
  if (!deleted) return res.status(404).json({ error: "NOT_FOUND", message: "Itinerary item not found." });
  await syncTotalDaysToItinerary(req.tripUuid);
  await clearManualDayOfAndResync(req.tripUuid);
  await recordEvent(req.tripUuid, req, {
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
router.get("/api/trips/:tripId/itinerary/:itemId/attendance", readAccess, withTripUuid, wrap(async (req, res) => {
  const { itemId } = req.params;
  const tripId = req.tripUuid; // resolved (see withTripUuid) — the queries below are UUID-typed
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
router.post("/api/trips/:tripId/itinerary/:itemId/attendance", writeAccess, withTripUuid, wrap(async (req, res) => {
  const { itemId } = req.params;
  const tripId = req.tripUuid; // resolved (see withTripUuid) — the queries below are UUID-typed
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
  // Query-string id — resolve like withTripUuid does for :tripId routes.
  const tripUuid = await resolveTripUuid(tripId);
  if (!tripUuid) return res.status(404).json({ error: "NOT_FOUND", message: "Trip not found." });
  // FIX (2026-07-30, JQ): this SELECT was missing phone/room/last-known-
  // location — MobileTripsPage.jsx's DelegateSheet (built to mirror
  // MobileAttendancePage.jsx's own delegate sheet: status, coach, phone,
  // room, last location, checkpoint timeline) only ever got that sparser
  // subset because THIS route, not the sheet component, never selected the
  // rest. Mirrors JQ's own listDelegates()'s column set (db/delegates.js,
  // SELECT d.*) for the fields this feature's board actually shows.
  const delegates = await all(
    `SELECT id, name, initials, "coachId", status, vip, "lastSeen", "lastLocation", phone, notes, company,
            accessibility_notes AS "accessibilityNotes", hotel_name, room_number, "photoUrl"
       FROM delegates WHERE trip_id = $1 ORDER BY name`,
    [tripUuid]
  );
  res.json({ delegates });
}));

router.post("/api/delegates", writeAccess, wrap(async (req, res) => {
  const { tripId, name, vip, notes, company, accessibilityNotes } = req.body || {};
  if (!tripId) return res.status(400).json({ error: "MISSING_TRIP_ID", message: "tripId is required." });
  // Body-supplied id — resolve like withTripUuid does for :tripId routes.
  // Creating a delegate on the primary trip ("t-1") used to 500 outright here.
  const tripUuid = await resolveTripUuid(tripId);
  if (!tripUuid) return res.status(404).json({ error: "NOT_FOUND", message: "Trip not found." });
  if (!name || !name.trim()) return res.status(400).json({ error: "NAME_REQUIRED", message: "A name is required." });

  const id = await nextDelegateId();
  const delegate = await get(
    `INSERT INTO delegates (id, trip_id, name, initials, "coachId", status, vip, notes, company, accessibility_notes)
     VALUES ($1,$2,$3,$4,NULL,'UNASSIGNED',$5,$6,$7,$8)
     RETURNING id, name, initials, "coachId", status, vip, "lastSeen", notes, company, accessibility_notes AS "accessibilityNotes", "photoUrl"`,
    [id, tripUuid, name.trim(), initialsOf(name), !!vip, (notes || "").trim() || null, (company || "").trim() || null, (accessibilityNotes || "").trim() || null]
  );
  await recordEvent(tripUuid, req, {
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
