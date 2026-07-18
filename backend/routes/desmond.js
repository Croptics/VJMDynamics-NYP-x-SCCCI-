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
import { requireAuth, requirePermission } from "../auth.js";

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

router.get("/api/trips/:tripId/activity", readAccess, wrap(async (req, res) => {
  res.json({ activity: ACTIVITY.get(req.params.tripId) || [] });
}));

// The frontend calls this right after a mutation that happened through one of
// JQ's OWN routes (delegate reassign/remove) succeeds — see file header for
// why this router can't observe those requests directly. Cosmetic (an
// activity-feed entry, not a real mutation), so any signed-in user, same as
// the original design.
router.post("/api/trips/:tripId/activity", readAccess, wrap(async (req, res) => {
  const { text, kind } = req.body || {};
  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: "TEXT_REQUIRED", message: "Activity text is required." });
  }
  const entry = logActivity(req.params.tripId, String(text).trim(), kind);
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
  const trips = await all(`
    SELECT
      t.uuid_id AS id, t.name, t."dateRange", t.status, t."lead",
      t."dayOf", t."totalDays",
      COUNT(DISTINCT c.id) AS "coachCount",
      COUNT(DISTINCT d.id) AS "delegateCount"
    FROM trips t
    LEFT JOIN coaches   c ON c.trip_id = t.uuid_id
    LEFT JOIN delegates d ON d.trip_id = t.uuid_id
    WHERE t.uuid_id IS NOT NULL
    GROUP BY t.uuid_id, t.name, t."dateRange", t.status, t."lead", t."dayOf", t."totalDays"
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
    // Per-trip Late-status auto-transition cutoff ("HH:MM", 24h, server-
    // local) — see applyLateCutoff() in data.js. Defaults to "10:00" at the
    // DB column level, so this is never actually null/undefined in practice.
    lateCutoffTime: trip.lateCutoffTime,
  });
}));

// Trip settings: currently just the Late-status cutoff time, edited from
// TripCoachPage.jsx's "Trip settings" modal. Kept as its own narrow route
// (not folded into a general trip-metadata PATCH, which doesn't exist yet)
// since that's the only trip-level setting anything currently needs to edit.
router.patch("/api/trips/:tripId/late-cutoff", writeAccess, wrap(async (req, res) => {
  const { lateCutoffTime } = req.body || {};
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(lateCutoffTime || "")) {
    return res.status(400).json({ error: "INVALID_TIME", message: "Enter a time in HH:MM (24-hour) format." });
  }
  const updated = await get(
    `UPDATE trips SET "lateCutoffTime" = $1 WHERE uuid_id = $2 RETURNING uuid_id AS id, "lateCutoffTime"`,
    [lateCutoffTime, req.params.tripId]
  );
  if (!updated) return res.status(404).json({ error: "NOT_FOUND", message: "Trip not found." });
  logActivity(req.params.tripId, `Late-status cutoff set to ${lateCutoffTime}.`, "system");
  res.json(updated);
}));

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

/* =============================================================================
 *  Coaches
 * ========================================================================== */
router.get("/api/trips/:tripId/coaches", readAccess, wrap(async (req, res) => {
  const coaches = await all(`
    SELECT
      c.id, c.label, c.capacity, c.sort_order AS "sortOrder",
      c.staff_user_id AS "staffUserId", u.name AS "staffName", c.driver_name AS "driverName",
      COUNT(d.id) FILTER (WHERE d.status = 'PRESENT') AS boarded,
      COUNT(d.id) FILTER (WHERE d.status = 'MISSING') AS missing,
      COUNT(d.id) AS total
    FROM coaches c
    LEFT JOIN users u ON u.id = c.staff_user_id
    LEFT JOIN delegates d ON d."coachId" = c.id
    WHERE c.trip_id = $1
    GROUP BY c.id, c.label, c.capacity, c.sort_order, c.staff_user_id, u.name, c.driver_name
    ORDER BY c.sort_order
  `, [req.params.tripId]);

  res.json({
    coaches: coaches.map((c) => ({ ...c, boarded: Number(c.boarded), missing: Number(c.missing), total: Number(c.total) })),
  });
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
  const { tripId, label, capacity, staffUserId, driverName } = req.body || {};
  if (!tripId) return res.status(400).json({ error: "MISSING_TRIP_ID", message: "tripId is required." });
  if (!label || !label.trim()) return res.status(400).json({ error: "LABEL_REQUIRED", message: "A coach label is required." });
  if (!staffUserId) return res.status(400).json({ error: "STAFF_REQUIRED", message: "Every coach needs a staff member assigned." });

  const staffRow = await get(`SELECT id, name FROM users WHERE id = $1`, [staffUserId]);
  if (!staffRow) return res.status(404).json({ error: "STAFF_NOT_FOUND", message: "That staff member doesn't exist." });

  const maxRow = await get(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM coaches WHERE trip_id = $1`, [tripId]);
  const sortOrder = Number(maxRow?.m ?? -1) + 1;

  const created = await get(
    `INSERT INTO coaches (id, trip_id, label, name, capacity, staff_user_id, sort_order, driver_name)
     VALUES (gen_random_uuid()::text, $1, $2, $2, $3, $4, $5, $6)
     RETURNING id, label, capacity, sort_order AS "sortOrder", staff_user_id AS "staffUserId", driver_name AS "driverName"`,
    [tripId, label.trim(), Number(capacity) || 40, staffUserId, sortOrder, (driverName || "").trim() || null]
  );
  logActivity(tripId, `${label.trim()} was added to the fleet, led by ${staffRow.name}.`, "coach");
  res.status(201).json({ ...created, staffName: staffRow.name });
}));

// Switch which staff member is assigned to this coach, and/or update the
// driver's name / capacity. All fields optional except staffUserId, which
// (per the original design) every coach must always have one of.
router.patch("/api/coaches/:id", writeAccess, wrap(async (req, res) => {
  const { staffUserId, driverName, capacity, label } = req.body || {};
  if (!staffUserId) return res.status(400).json({ error: "STAFF_REQUIRED", message: "Every coach needs a staff member assigned." });

  const staffRow = await get(`SELECT id, name FROM users WHERE id = $1`, [staffUserId]);
  if (!staffRow) return res.status(404).json({ error: "STAFF_NOT_FOUND", message: "That staff member doesn't exist." });

  const existing = await get(`SELECT trip_id, label FROM coaches WHERE id = $1`, [req.params.id]);
  if (!existing) return res.status(404).json({ error: "NOT_FOUND", message: "Coach not found." });

  const updated = await get(
    `UPDATE coaches
        SET staff_user_id = $1,
            driver_name = COALESCE($2, driver_name),
            capacity = COALESCE($3, capacity),
            label = COALESCE($4, label),
            name = COALESCE($4, name)
      WHERE id = $5
      RETURNING id, label, capacity, sort_order AS "sortOrder", staff_user_id AS "staffUserId", driver_name AS "driverName"`,
    [staffUserId, driverName !== undefined ? (String(driverName).trim() || null) : null, Number(capacity) || null, label?.trim() || null, req.params.id]
  );
  logActivity(existing.trip_id, `${updated.label} switched to ${staffRow.name}.`, "coach");
  res.json({ ...updated, staffName: staffRow.name });
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
  const deleted = await get(`DELETE FROM coaches WHERE id = $1 RETURNING id, label, trip_id`, [req.params.id]);
  if (!deleted) return res.status(404).json({ error: "NOT_FOUND", message: "Coach not found." });
  logActivity(deleted.trip_id, `${deleted.label} was removed from the fleet.`, "coach");
  res.json({ deleted: true });
}));

/* =============================================================================
 *  Itinerary
 * ========================================================================== */
router.get("/api/trips/:tripId/itinerary", readAccess, wrap(async (req, res) => {
  const items = await all(
    `SELECT id, day_number AS "dayNumber", TO_CHAR(start_time, 'HH24:MI') AS "startTime",
            title, location, sort_order AS "sortOrder", category
       FROM itinerary_items WHERE trip_id = $1 ORDER BY day_number, sort_order`,
    [req.params.tripId]
  );
  res.json({ items, categories: ITINERARY_CATEGORIES });
}));

router.post("/api/trips/:tripId/itinerary", writeAccess, wrap(async (req, res) => {
  const { dayNumber, startTime, title, location, sortOrder, category } = req.body || {};
  if (!dayNumber || !startTime || !title || !title.trim()) {
    return res.status(400).json({ error: "MISSING_FIELDS", message: "Day, time and title are required." });
  }
  const item = await get(
    `INSERT INTO itinerary_items (trip_id, day_number, start_time, title, location, sort_order, category)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, day_number AS "dayNumber", TO_CHAR(start_time,'HH24:MI') AS "startTime", title, location, sort_order AS "sortOrder", category`,
    [req.params.tripId, Number(dayNumber), startTime, title.trim(), (location || "").trim() || null, Number(sortOrder) || 0, normalizeCategory(category)]
  );
  logActivity(req.params.tripId, `Itinerary: "${item.title}" added to Day ${item.dayNumber}.`, "itinerary");
  res.status(201).json(item);
}));

router.patch("/api/trips/:tripId/itinerary/:itemId", writeAccess, wrap(async (req, res) => {
  const { dayNumber, startTime, title, location, category } = req.body || {};
  if (!dayNumber || !startTime || !title || !title.trim()) {
    return res.status(400).json({ error: "MISSING_FIELDS", message: "Day, time and title are required." });
  }
  const item = await get(
    `UPDATE itinerary_items SET day_number = $1, start_time = $2, title = $3, location = $4, category = $5
      WHERE id = $6 AND trip_id = $7
      RETURNING id, day_number AS "dayNumber", TO_CHAR(start_time,'HH24:MI') AS "startTime", title, location, sort_order AS "sortOrder", category`,
    [Number(dayNumber), startTime, title.trim(), (location || "").trim() || null, normalizeCategory(category), req.params.itemId, req.params.tripId]
  );
  if (!item) return res.status(404).json({ error: "NOT_FOUND", message: "Itinerary item not found." });
  logActivity(req.params.tripId, `Itinerary: "${item.title}" updated.`, "itinerary");
  res.json(item);
}));

router.delete("/api/trips/:tripId/itinerary/:itemId", writeAccess, wrap(async (req, res) => {
  const deleted = await get(
    `DELETE FROM itinerary_items WHERE id = $1 AND trip_id = $2 RETURNING id, title`,
    [req.params.itemId, req.params.tripId]
  );
  if (!deleted) return res.status(404).json({ error: "NOT_FOUND", message: "Itinerary item not found." });
  logActivity(req.params.tripId, `Itinerary: "${deleted.title}" removed.`, "itinerary");
  res.json({ deleted: true });
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
  logActivity(tripId, `${delegate.name} was added${vip ? " (VIP)" : ""}.`, "delegate");
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

  params.push(req.params.id);
  const delegate = await get(
    `UPDATE delegates SET ${sets.join(", ")} WHERE id = $${i}
     RETURNING id, name, initials, "coachId", status, vip, "lastSeen", notes, company, accessibility_notes AS "accessibilityNotes"`,
    params
  );
  if (!delegate) return res.status(404).json({ error: "NOT_FOUND", message: "Delegate not found." });
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
