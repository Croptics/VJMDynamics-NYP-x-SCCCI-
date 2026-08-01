/* =============================================================================
 *  OWNED BY:  Jayden — Exception Logging, Critical Alerts & QR Fallback
 *  PART OF:   MusterGo — Screen 5 (Exception Inbox) + Screen 10 (Log Exception)
 *
 *  This is a self-contained feature module. It does NOT edit any of JQ's base
 *  files (server.js / data.js / permissions.js) — it only imports the helpers
 *  they already export, and is mounted with two lines inside the TEAMMATE ZONE
 *  of server.js.
 *
 *  It owns two tables from HIGH_LEVEL_DESIGN.md §2:
 *    - exception_tickets   (§7)  — support tickets
 *    - check_in_logs       (§6)  — shared with Vimal; this module writes the
 *                                  MANUAL rows (manual attendance override).
 *  Both are created with CREATE TABLE IF NOT EXISTS so Vimal's checkin module
 *  can coexist without a migration clash.
 *
 *  DEVIATIONS FROM THE HLD (deliberate, documented):
 *   1. The HLD DDL types ids as UUID, but the live base schema in data.js types
 *      trips/coaches/delegates/accounts ids as VARCHAR(64) ("t-1", "c1", "d-1").
 *      A foreign key must match its parent's type, so these tables use
 *      VARCHAR(64) too. Ids are generated with randomUUID() in app code.
 *   2. The HLD `users` table does not exist yet; the live base uses `accounts`.
 *      raised_by / resolved_by therefore reference accounts(id).
 *   3. Real-time push (the "alert all staff devices" requirement) is not
 *      specified in the HLD. This module adds Server-Sent Events, which needs
 *      no new dependency and works through restrictive proxies.
 *
 *  AUTH: reuses JQ's own signed-JWT middleware (requireAuth / requirePermission
 *  from ../auth.js) instead of decoding a token format by hand — this is a
 *  merge-time fix; the version this shipped with pre-dated JQ's JWT/bcrypt
 *  security work and decoded the old demo.<base64>.token format directly,
 *  which no longer validates. Permission-gated on "manageExceptions": any
 *  signed-in account can view the inbox and the live stream; raising/
 *  resolving/deleting a ticket or a manual override requires the permission.
 * ============================================================================= */

import { Router } from "express";
import { randomUUID } from "crypto";
import pg from "pg";
import { requireAuth, requirePermission } from "../lib/auth.js";
import { resolveTripUuid, updateDelegate, resolveEscalation } from "../data.js";
import { syncCurrentCheckpointStatus } from "./checkpoints.js";
// Bi-directional exception linking (2026-07-31) — see that module's header
// for why this is a standalone leaf module rather than living in this file.
import { syncDelegateStatus, escalateAutoTicket, registerExceptionBroadcast } from "../db/exceptionSync.js";
// Audit trail (2026-07-30 — "the history log didn't track the qr, face
// scanner and manual update right?" — confirmed: it didn't). Same helper
// desmond.js's own edits already use; exported from there rather than
// duplicated here. This powers the Trip board's OWN small "History" panel
// (trip_event_log) — a SEPARATE system from the real Delegate history log
// page below, which turned out to need a second, different fix entirely
// (2026-07-30, "the qr code scanner didn't log in the history log, pls
// check" — this route writes with raw SQL, bypassing updateDelegate() in
// db/delegates.js entirely, and logActivity() is only ever called FROM
// updateDelegate() — so this route, unlike Face/Voice scans which DO go
// through updateDelegate(), never reached the real activity_log table at
// all, regardless of the recordEvent() fix already in place here).
import { recordEvent } from "./desmond.js";
import { logActivity } from "../db/history.js";
import { actorOf } from "../lib/actor.js";

const router = Router();

/* ---- Connection ---------------------------------------------------------- *
 * Reuses the exact same env vars and SSL auto-detection as data.js so there is
 * only ever one place to configure the database (backend/.env).
 * -------------------------------------------------------------------------- */
const { Pool } = pg;
let pool;

function readConfig() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  const forceSsl = process.env.PGSSL;
  const sslFor = (isLocal) =>
    forceSsl === "true" ? { rejectUnauthorized: false }
    : forceSsl === "false" ? false
    : isLocal ? false
    : { rejectUnauthorized: false };

  if (url) return { connectionString: url, ssl: sslFor(/localhost|127\.0\.0\.1/.test(url)) };
  const host = process.env.DB_HOST || "localhost";
  return {
    host,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "mustergo",
    ssl: sslFor(/localhost|127\.0\.0\.1/.test(host)),
  };
}

const q = (text, params) => pool.query(text, params);

/* ---- Shared vocabulary ---------------------------------------------------- *
 * Kept as constants so the enum definition, the request validation and the
 * column width can never drift apart. The frontend mirrors these in
 * lib/exceptionsApi.js.
 * -------------------------------------------------------------------------- */
export const TYPE_OTHER_MAX = 20;                       // max chars for a custom label
const VALID_TYPES = [
  "MISSING_PERSON", "LOST_BADGE", "FACE_MATCH_FAILED",
  "DEAD_PHONE", "VIP_REQUEST", "OTHER",
];
const VALID_PRIORITIES = ["CRITICAL", "NORMAL", "LOW"];

/** Create this feature's tables. Safe to run on every boot. */
export async function initExceptions() {
  pool = new Pool(readConfig());

  // Enum types from HLD §2. CREATE TYPE has no IF NOT EXISTS, so guard it.
  const enums = [
    ["checkin_method", "'QR','MANUAL'"],
    ["exception_type", VALID_TYPES.map((t) => `'${t}'`).join(",")],
    ["exception_priority", VALID_PRIORITIES.map((p) => `'${p}'`).join(",")],
    ["exception_status", "'OPEN','RESOLVED'"],
  ];
  for (const [name, vals] of enums) {
    await q(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${name}') THEN
        CREATE TYPE ${name} AS ENUM (${vals});
      END IF;
    END $$;`);
  }

  // HLD §6 — shared with Vimal (this module writes the MANUAL rows).
  await q(`CREATE TABLE IF NOT EXISTS check_in_logs (
    id                VARCHAR(64) PRIMARY KEY,
    delegate_id       VARCHAR(64) NOT NULL REFERENCES delegates(id) ON DELETE CASCADE,
    trip_id           VARCHAR(64) NOT NULL REFERENCES trips(id)     ON DELETE CASCADE,
    coach_id          VARCHAR(64) REFERENCES coaches(id) ON DELETE SET NULL,
    method            checkin_method NOT NULL,
    checked_in_by     VARCHAR(64) NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    client_event_id   VARCHAR(64) NOT NULL UNIQUE,
    is_offline_origin BOOLEAN     NOT NULL DEFAULT FALSE,
    client_ts         TIMESTAMPTZ NOT NULL,
    synced_at         TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_checkins_delegate ON check_in_logs(delegate_id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_checkins_trip     ON check_in_logs(trip_id)`);
  // Captures the delegate's status right before a MANUAL override flips it to
  // ARRIVED (2026-07-23), so Undo can restore what they actually were (e.g.
  // LATE) instead of unconditionally resetting to ASSIGNED — a delegate who
  // was Late before an accidental "Mark present" click should go back to
  // Late on Undo, not lose that. NULL for older rows/other methods (QR/face) —
  // undo falls back to ASSIGNED for those, same as before.
  await q(`ALTER TABLE check_in_logs ADD COLUMN IF NOT EXISTS prev_status VARCHAR(16)`);

  // HLD §7 — owned by Jayden.
  await q(`CREATE TABLE IF NOT EXISTS exception_tickets (
    id                VARCHAR(64) PRIMARY KEY,
    trip_id           VARCHAR(64) NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    delegate_id       VARCHAR(64) REFERENCES delegates(id) ON DELETE SET NULL,
    coach_id          VARCHAR(64) REFERENCES coaches(id)   ON DELETE SET NULL,
    type              exception_type     NOT NULL,
    priority          exception_priority NOT NULL DEFAULT 'NORMAL',
    status            exception_status   NOT NULL DEFAULT 'OPEN',
    note              TEXT,
    raised_by         VARCHAR(64) NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    resolved_by       VARCHAR(64) REFERENCES accounts(id) ON DELETE SET NULL,
    client_event_id   VARCHAR(64) NOT NULL UNIQUE,
    is_offline_origin BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at       TIMESTAMPTZ,
    CONSTRAINT chk_resolved CHECK (
      (status = 'RESOLVED' AND resolved_at IS NOT NULL)
      OR (status = 'OPEN'  AND resolved_at IS NULL)
    )
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_exceptions_trip ON exception_tickets(trip_id, status)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_exceptions_pri  ON exception_tickets(trip_id, priority) WHERE status = 'OPEN'`);

  // Free-text label for type='OTHER' ("Others" tile in the log form). Additive,
  // so an already-deployed database picks it up on the next boot without a
  // migration. Capped in the column as well as the UI — never trust the client.
  await q(`ALTER TABLE exception_tickets ADD COLUMN IF NOT EXISTS type_other VARCHAR(${TYPE_OTHER_MAX})`);

  // Bi-directional exception linking (2026-07-31) — distinguishes a ticket
  // db/exceptionSync.js auto-generated from a delegate's live status from one
  // staff raised by hand via Log Exception, so the auto-sync only ever
  // touches its own tickets. See that file's header for the full picture.
  await q(`ALTER TABLE exception_tickets ADD COLUMN IF NOT EXISTS is_auto BOOLEAN NOT NULL DEFAULT false`);

  // Re-scope trip_id to trips.uuid_id (2026-07-31 — "add the trip change to
  // exception"). This table was built (deviation #1 above) before the rest of
  // the app settled on trips.uuid_id as the one real trip identifier, resolved
  // everywhere else via resolveTripUuid() (dashboard, delegates, checkpoints,
  // escalations, history, announcements, room assignment, exports — every one
  // of them). exception_tickets was the sole holdout still FK'd to trips(id),
  // the legacy varchar column ("t-1") — so no matter which trip was selected
  // on the trip switcher, Exceptions could only ever show/write Beijing's
  // tickets. Guarded on the column's current type so this only ever runs once
  // per database: every row here pre-migration is trip_id='t-1' (the base
  // only ever seeded exceptions for the one demo trip), so the backfill is a
  // single unconditional join, not a per-row lookup.
  const { rows: [tripIdCol] } = await q(
    `SELECT data_type FROM information_schema.columns
      WHERE table_name = 'exception_tickets' AND column_name = 'trip_id'`
  );
  if (tripIdCol?.data_type !== "uuid") {
    await q(`ALTER TABLE exception_tickets ADD COLUMN trip_uuid UUID REFERENCES trips(uuid_id)`);
    await q(`UPDATE exception_tickets x SET trip_uuid = t.uuid_id FROM trips t WHERE x.trip_id = t.id`);
    await q(`ALTER TABLE exception_tickets ALTER COLUMN trip_uuid SET NOT NULL`);
    await q(`ALTER TABLE exception_tickets DROP COLUMN trip_id`);
    await q(`ALTER TABLE exception_tickets RENAME COLUMN trip_uuid TO trip_id`);
    // The two indexes above were created on the old varchar column and dropped
    // along with it — recreate them now that trip_id is the uuid column.
    await q(`CREATE INDEX IF NOT EXISTS idx_exceptions_trip ON exception_tickets(trip_id, status)`);
    await q(`CREATE INDEX IF NOT EXISTS idx_exceptions_pri  ON exception_tickets(trip_id, priority) WHERE status = 'OPEN'`);
    console.log("  Migrated exception_tickets.trip_id -> trips.uuid_id");
  }

  // Hands db/exceptionSync.js our SSE broadcast() closure (declared below,
  // but hoisted — see that module's own header for why this is a callback
  // registration rather than exceptionSync.js importing this file directly).
  registerExceptionBroadcast(broadcast);

  console.log("  Exception module ready -> exception_tickets, check_in_logs");
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ---- Real-time channel (SSE) --------------------------------------------- */
const clients = new Set();

function broadcast(event, payload) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try { res.write(frame); } catch { clients.delete(res); }
  }
}

/** Number of staff devices currently listening (used for "pushed to N devices"). */
const deviceCount = () => clients.size;

router.get("/api/exceptions/stream", requireAuth(), (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();
  res.write(`event: ready\ndata: {"ok":true}\n\n`);
  clients.add(res);
  const keepAlive = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => { clearInterval(keepAlive); clients.delete(res); });
});

/* ---- Shaping ------------------------------------------------------------- */
const SELECT_TICKETS = `
  SELECT x.id, x.type, x.type_other, x.priority, x.status, x.note, x.created_at, x.resolved_at,
         x.delegate_id,
         d.name  AS delegate_name, d.vip AS delegate_vip, d.status AS delegate_status,
         c.name  AS coach_name,
         a.name  AS raised_by_name,
         ar.name AS resolved_by_name
    FROM exception_tickets x
    LEFT JOIN delegates d  ON d.id  = x.delegate_id
    LEFT JOIN coaches   c  ON c.id  = x.coach_id
    LEFT JOIN accounts  a  ON a.id  = x.raised_by
    LEFT JOIN accounts  ar ON ar.id = x.resolved_by
`;

const shape = (r) => ({
  id: r.id,
  type: r.type,
  typeOther: r.type_other || null,   // custom label when type === 'OTHER'
  priority: r.priority,
  status: r.status,
  note: r.note,
  delegateId: r.delegate_id || null,
  delegateName: r.delegate_name || null,
  delegateVip: !!r.delegate_vip,
  // Live attendance state of the linked delegate. Drives the Override action:
  // once they are checked in (ARRIVED, or the legacy PRESENT alias) there is
  // nothing left to override, so the button is replaced by a "Present" marker
  // instead of letting a second click write a duplicate check_in_logs row.
  delegateStatus: r.delegate_status || null,
  coach: r.coach_name || null,
  raisedBy: r.raised_by_name || null,
  resolvedBy: r.resolved_by_name || null,
  createdAt: r.created_at,
  resolvedAt: r.resolved_at,
});

/* =============================================================================
 *  ROUTES — paths follow HIGH_LEVEL_DESIGN.md §3.6
 * ============================================================================= */

/** GET /api/trips/:id/exceptions — list tickets (+ counts). Any signed-in user.
 *  :id follows every other trip-scoped route (dashboard/delegates/checkpoints/
 *  …) in accepting either the legacy "t-1" alias or a real trip uuid_id,
 *  resolved through the shared resolveTripUuid() — see the migration note in
 *  initExceptions() above for why exception_tickets used to be the exception. */
router.get("/api/trips/:id/exceptions", requireAuth(), wrap(async (req, res) => {
  const tripUuid = await resolveTripUuid(req.params.id);
  if (!tripUuid) return res.status(404).json({ error: "TRIP_NOT_FOUND", message: "Trip not found." });
  const { status, priority } = req.query;
  const params = [tripUuid];
  let where = "WHERE x.trip_id = $1";
  if (status)   { params.push(status);   where += ` AND x.status = $${params.length}`; }
  if (priority) { params.push(priority); where += ` AND x.priority = $${params.length}`; }

  const { rows } = await q(
    `${SELECT_TICKETS} ${where}
     ORDER BY CASE x.priority WHEN 'CRITICAL' THEN 0 WHEN 'NORMAL' THEN 1 ELSE 2 END,
              x.created_at DESC`,
    params
  );

  const { rows: [c] } = await q(
    `SELECT COUNT(*)::int AS all,
            COUNT(*) FILTER (WHERE priority = 'CRITICAL')::int AS critical,
            COUNT(*) FILTER (WHERE status   = 'OPEN')::int     AS open,
            COUNT(*) FILTER (WHERE status   = 'RESOLVED')::int AS resolved,
            COUNT(*) FILTER (WHERE priority = 'CRITICAL' AND status = 'OPEN')::int AS "criticalOpen"
       FROM exception_tickets WHERE trip_id = $1`,
    [tripUuid]
  );

  res.json({ tickets: rows.map(shape), counts: c });
}));

/**
 * GET /api/trips/:id/exceptions/critical-count — cheap count for the sidebar badge.
 * Returns only the number of UNRESOLVED CRITICAL tickets, so the badge can stay
 * accurate without the sidebar pulling the whole ticket list on every page.
 * Any signed-in user. Same :id contract as the list route above.
 */
router.get("/api/trips/:id/exceptions/critical-count", requireAuth(), wrap(async (req, res) => {
  const tripUuid = await resolveTripUuid(req.params.id);
  if (!tripUuid) return res.status(404).json({ error: "TRIP_NOT_FOUND", message: "Trip not found." });
  const { rows: [r] } = await q(
    `SELECT COUNT(*)::int AS n
       FROM exception_tickets
      WHERE trip_id = $1 AND priority = 'CRITICAL' AND status = 'OPEN'`,
    [tripUuid]
  );
  res.json({ criticalOpen: r.n });
}));

/** GET /api/exceptions/:id — single ticket. Any signed-in user. */
router.get("/api/exceptions/:id", requireAuth(), wrap(async (req, res) => {
  const { rows } = await q(`${SELECT_TICKETS} WHERE x.id = $1`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: "NOT_FOUND", message: "Ticket not found." });
  res.json(shape(rows[0]));
}));

/** POST /api/trips/:id/exceptions — raise a ticket; CRITICAL pushes to devices. Needs manageExceptions. */
router.post("/api/trips/:id/exceptions", requirePermission("manageExceptions"), wrap(async (req, res) => {
  const tripUuid = await resolveTripUuid(req.params.id);
  if (!tripUuid) return res.status(404).json({ error: "TRIP_NOT_FOUND", message: "Trip not found." });
  const { delegateId, coachId, type, typeOther, priority, note, clientEventId } = req.body || {};
  if (!type) return res.status(400).json({ error: "TYPE_REQUIRED", message: "An issue type is required." });

  // Validate against the enum ourselves: an unknown value would otherwise reach
  // Postgres and surface as an opaque 500 instead of a useful 400.
  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: "INVALID_TYPE", message: `Unknown issue type "${type}".` });
  }

  // "Others" carries a free-text label. Required when chosen, trimmed, and
  // hard-capped here as well as in the UI — the client is never trusted.
  let otherLabel = null;
  if (type === "OTHER") {
    otherLabel = typeof typeOther === "string" ? typeOther.trim() : "";
    if (!otherLabel) {
      return res.status(400).json({ error: "TYPE_OTHER_REQUIRED", message: "Describe the issue type." });
    }
    if (otherLabel.length > TYPE_OTHER_MAX) {
      return res.status(400).json({
        error: "TYPE_OTHER_TOO_LONG",
        message: `Keep the issue type to ${TYPE_OTHER_MAX} characters or fewer.`,
      });
    }
  }

  // Idempotency (offline outbox may retry the same event).
  const eventId = clientEventId || randomUUID();
  const dup = await q("SELECT id FROM exception_tickets WHERE client_event_id = $1", [eventId]);
  if (dup.rows.length) {
    const { rows } = await q(`${SELECT_TICKETS} WHERE x.id = $1`, [dup.rows[0].id]);
    return res.status(200).json({ ...shape(rows[0]), duplicate: true });
  }

  // One open ticket per delegate at a time (2026-07-31 — "when you create new
  // exception log, it should only allow one delegate at a time to log. if it
  // same delegate, should not allow"). Staff logging a second ticket for a
  // delegate who already has one open just fragments the same real-world
  // issue across multiple rows instead of adding a note/escalating the
  // existing one — this rejects it up front with a pointer to the ticket
  // that's already open, rather than silently piling up duplicates.
  if (delegateId) {
    const existing = await q(
      `SELECT id FROM exception_tickets WHERE trip_id = $1 AND delegate_id = $2 AND status = 'OPEN' LIMIT 1`,
      [tripUuid, delegateId]
    );
    if (existing.rows.length) {
      return res.status(409).json({
        error: "DELEGATE_ALREADY_HAS_OPEN_TICKET",
        message: "This delegate already has an open exception ticket. Resolve or escalate it instead of logging a new one.",
        ticketId: existing.rows[0].id,
      });
    }
  }

  // Derive the coach from the delegate when not supplied.
  let coach = coachId || null;
  if (!coach && delegateId) {
    const d = await q('SELECT "coachId" FROM delegates WHERE id = $1', [delegateId]);
    coach = d.rows[0]?.coachId || null;
  }

  const id = randomUUID();
  const pri = VALID_PRIORITIES.includes(priority) ? priority : "NORMAL";
  await q(
    `INSERT INTO exception_tickets
       (id, trip_id, delegate_id, coach_id, type, type_other, priority, status, note, raised_by, client_event_id, is_offline_origin)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'OPEN',$8,$9,$10,$11)`,
    [id, tripUuid, delegateId || null, coach, type, otherLabel, pri, note || null,
     req.account.id, eventId, !!req.body?.isOfflineOrigin]
  );

  const { rows } = await q(`${SELECT_TICKETS} WHERE x.id = $1`, [id]);
  const ticket = shape(rows[0]);
  const pushedToDevices = pri === "CRITICAL" ? deviceCount() : 0;

  broadcast(pri === "CRITICAL" ? "exception:critical" : "exception:created", ticket);
  res.status(201).json({ ...ticket, pushedToDevices });
}));

/** PATCH /api/exceptions/:id — resolve, or update priority/note. Needs manageExceptions. */
router.patch("/api/exceptions/:id", requirePermission("manageExceptions"), wrap(async (req, res) => {
  const { status, priority, note } = req.body || {};

  if (status === "RESOLVED") {
    // Concurrency guard: only an OPEN ticket can be resolved (409 otherwise).
    const upd = await q(
      `UPDATE exception_tickets
          SET status='RESOLVED', resolved_at=now(), resolved_by=$1
        WHERE id=$2 AND status='OPEN'
        RETURNING type, delegate_id`,
      [req.account.id, req.params.id]
    );
    if (!upd.rowCount) {
      return res.status(409).json({ error: "ALREADY_RESOLVED", message: "That ticket is already resolved." });
    }
    // Bi-directional exception linking (2026-07-31) — resolving a missing-
    // person ticket from the Exceptions page checks the delegate back in,
    // the reverse of syncDelegateStatus() opening/closing this same ticket
    // off the delegate's OWN status. Resolve the ticket FIRST (above), so the
    // updateDelegate() call below finds no open ticket left to re-resolve —
    // avoids a duplicate no-op broadcast.
    const { type: ticketType, delegate_id: ticketDelegateId } = upd.rows[0];
    if (ticketType === "MISSING_PERSON" && ticketDelegateId) {
      // If this delegate also has an open/acknowledged escalation (the
      // Dashboard's "Alerts" Emergency banner — 2026-07-31, "if i resolve
      // this [ticket] then on the dashboard alert should also resolve"),
      // resolve THAT — db/escalations.js's own resolveEscalation() already
      // flips the delegate to ARRIVED itself, so this covers both at once
      // and keeps a single source of truth for the "how do I un-escalate a
      // delegate" logic. Only falls back to flipping status directly when
      // there's no escalation to resolve (a plain Missing ticket that was
      // never escalated).
      const esc = await q(
        `SELECT id FROM escalations WHERE delegate_id = $1 AND status IN ('open','acknowledged')`,
        [ticketDelegateId]
      );
      if (esc.rows.length) {
        await resolveEscalation(esc.rows[0].id, actorOf(req));
      } else {
        // Only flip if they're STILL Missing — a ticket resolved long after
        // the delegate was already checked in some other way shouldn't
        // clobber whatever their current (correct) status is.
        const d = await q('SELECT status FROM delegates WHERE id = $1', [ticketDelegateId]);
        if (d.rows[0]?.status === "MISSING") {
          await updateDelegate(ticketDelegateId, { status: "ARRIVED" }, actorOf(req));
        }
      }
    }
  } else {
    const sets = [];
    const params = [];
    if (priority !== undefined) {
      if (!VALID_PRIORITIES.includes(priority)) {
        return res.status(400).json({ error: "INVALID_PRIORITY", message: `Unknown priority "${priority}".` });
      }
      params.push(priority); sets.push(`priority = $${params.length}`);
    }
    if (note !== undefined)     { params.push(note);     sets.push(`note = $${params.length}`); }
    if (!sets.length) return res.status(400).json({ error: "NO_FIELDS", message: "Nothing to update." });
    params.push(req.params.id);
    const upd = await q(
      `UPDATE exception_tickets SET ${sets.join(", ")} WHERE id = $${params.length} AND status='OPEN'`,
      params
    );
    if (!upd.rowCount) return res.status(409).json({ error: "CONFLICT", message: "Ticket is not open, or not found." });
  }

  const { rows } = await q(`${SELECT_TICKETS} WHERE x.id = $1`, [req.params.id]);
  const ticket = shape(rows[0]);
  broadcast("exception:updated", ticket);
  res.json(ticket);
}));

/** DELETE /api/exceptions/:id — remove a ticket raised in error. Needs manageExceptions. */
router.delete("/api/exceptions/:id", requirePermission("manageExceptions"), wrap(async (req, res) => {
  const del = await q("DELETE FROM exception_tickets WHERE id = $1", [req.params.id]);
  if (!del.rowCount) return res.status(404).json({ error: "NOT_FOUND", message: "Ticket not found." });
  broadcast("exception:deleted", { id: req.params.id });
  res.json({ deleted: true, id: req.params.id });
}));

/* ---- Manual attendance override ------------------------------------------ *
 * The MANUAL half of HLD §3.5 (check_in_logs). Vimal owns the QR scanner and
 * POST /api/checkins; this path is namespaced to /checkins/manual so the two
 * modules never collide when his router is mounted alongside this one.
 * Needs manageExceptions.
 * -------------------------------------------------------------------------- */
router.post("/api/checkins/manual", requirePermission("manageExceptions"), wrap(async (req, res) => {
  // NOTE (2026-07-23): tripId here is written into check_in_logs.trip_id,
  // which REFERENCES trips(id) — the LEGACY VARCHAR id ("t-1"), not
  // trips.uuid_id. Only the original Beijing trip has that legacy column
  // populated; every trip created since (Desmond's newer flow) has it NULL,
  // so passing a real trip's uuid here violates the FK and 500s. tripId is
  // therefore left as its historical "t-1" default from callers — the
  // checkpoint-sync below uses checkpointTripId instead, resolved through
  // uuid_id, which every trip actually has.
  const { tripId, checkpointTripId, delegateId, clientEventId, clientTs } = req.body || {};
  if (!tripId || !delegateId) {
    return res.status(400).json({ error: "MISSING_FIELDS", message: "tripId and delegateId are required." });
  }
  const d = await q('SELECT id, name, status, "coachId" FROM delegates WHERE id = $1', [delegateId]);
  if (!d.rows.length) return res.status(404).json({ error: "NOT_FOUND", message: "Delegate not found." });

  const eventId = clientEventId || randomUUID();
  const dup = await q("SELECT id FROM check_in_logs WHERE client_event_id = $1", [eventId]);
  if (dup.rows.length) return res.json({ id: dup.rows[0].id, delegateId, status: "ARRIVED", duplicate: true });

  const id = randomUUID();
  await q(
    `INSERT INTO check_in_logs
       (id, delegate_id, trip_id, coach_id, method, checked_in_by, client_event_id, is_offline_origin, client_ts, prev_status)
     VALUES ($1,$2,$3,$4,'MANUAL',$5,$6,$7,$8,$9)`,
    [id, delegateId, tripId, d.rows[0].coachId, req.account.id, eventId,
     !!req.body?.isOfflineOrigin, clientTs || new Date().toISOString(), d.rows[0].status]
  );

  // ARRIVED — the 5-status value (was the legacy PRESENT literal). Reflect
  // the override on the delegate so the dashboard head-count agrees.
  await q(`UPDATE delegates SET status='ARRIVED', "lastSeen"=$1 WHERE id=$2`,
    [`Manual override · ${new Date().toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", hour12: false })}`, delegateId]);
  // Bi-directional exception linking (2026-07-31) — this route bypasses
  // updateDelegate() (see the file-header note further down), so it can't
  // pick up db/delegates.js's own syncDelegateStatus() call for free; done
  // explicitly here instead. Clears any auto-generated Missing ticket the
  // instant staff manually check this delegate in.
  await syncDelegateStatus(delegateId, "ARRIVED");

  // Keep the checkpoint-scoped view (the scanner page's Boarded/Late/Missing
  // KPIs) in sync — a manual mark-present used to only flip the GLOBAL
  // status, so a checkpoint's earlier stale MISSING/LATE record kept
  // showing even after staff manually checked someone in by hand. Mirrors
  // the same sync added to JQ's own PATCH /api/delegates/:id.
  const tripUuid = await resolveTripUuid(checkpointTripId || tripId);
  syncCurrentCheckpointStatus(delegateId, tripUuid, "ARRIVED", req.account?.username || "Manual");
  // Persisted audit row (2026-07-30 — manual overrides never showed up on the
  // History log at all before this; only Room Management/status-sheet edits
  // did). Best-effort by design — a logging failure must never undo or block
  // a check-in that already succeeded.
  if (tripUuid) {
    await recordEvent(tripUuid, req, {
      action: "checkin.manual", entity: "delegate", entityId: delegateId, kind: "checkin",
      summary: `${d.rows[0].name} manually checked in.`,
      before: { status: d.rows[0].status }, after: { status: "ARRIVED" },
    });
  }
  // The REAL Delegate history log (activity_log — see the import comment
  // above) is a separate table this route never wrote to at all, since it
  // updates `delegates` with raw SQL instead of going through
  // updateDelegate() (db/delegates.js), which is the ONLY place logActivity()
  // used to be called from.
  await logActivity(`${d.rows[0].name} checked in (manual)`, "checkin", actorOf(req), { delegateId, tripUuid });

  broadcast("attendance:override", { delegateId, name: d.rows[0].name, method: "MANUAL" });
  res.status(201).json({ id, delegateId, status: "ARRIVED", duplicate: false, method: "MANUAL" });
}));

/* ---- Undo a manual attendance override ------------------------------------
 * The revert half of the Manual panel's "Mark present" — for the accidental-
 * click case ("Undo" shown right next to a just-marked delegate). Same
 * manageExceptions gate as the mark-present action itself, so whoever can do
 * one can do the other. Restores whatever status the delegate ACTUALLY had
 * right before the override (check_in_logs.prev_status, captured above) —
 * e.g. a delegate who was Late before an accidental "Mark present" goes back
 * to Late, not a blanket ASSIGNED (2026-07-23 — was unconditionally ASSIGNED
 * before, which lost a real Late/Missing status on undo). Falls back to
 * ASSIGNED only when there's no prev_status to restore (an older row from
 * before this column existed). Removes the MANUAL check-in log row this
 * override created, so the audit trail doesn't keep a phantom check-in for a
 * status that was immediately undone. Best-effort on the log delete (only
 * ever removes the single most recent MANUAL row for this delegate, so it
 * can't accidentally wipe an earlier, real check-in). */
router.post("/api/checkins/manual/undo", requirePermission("manageExceptions"), wrap(async (req, res) => {
  const { delegateId, checkpointTripId } = req.body || {};
  if (!delegateId) return res.status(400).json({ error: "MISSING_FIELDS", message: "delegateId is required." });

  const d = await q('SELECT id, name FROM delegates WHERE id = $1', [delegateId]);
  if (!d.rows.length) return res.status(404).json({ error: "NOT_FOUND", message: "Delegate not found." });

  const lastLog = await q(
    `SELECT id, prev_status FROM check_in_logs
      WHERE delegate_id = $1 AND method = 'MANUAL'
      ORDER BY client_ts DESC NULLS LAST LIMIT 1`,
    [delegateId]
  );
  const restoredStatus = lastLog.rows[0]?.prev_status || "ASSIGNED";
  if (lastLog.rows.length) await q(`DELETE FROM check_in_logs WHERE id = $1`, [lastLog.rows[0].id]);

  await q(`UPDATE delegates SET status=$1, "lastSeen"=NULL WHERE id=$2`, [restoredStatus, delegateId]);
  // Bi-directional exception linking (2026-07-31) — same reasoning as the
  // mark-present route above: undo can restore MISSING (the delegate was
  // missing before an accidental "Mark present"), which should re-open their
  // ticket exactly as if they'd just gone missing normally.
  await syncDelegateStatus(delegateId, restoredStatus);

  if (checkpointTripId) {
    const tripUuid = await resolveTripUuid(checkpointTripId);
    syncCurrentCheckpointStatus(delegateId, tripUuid, restoredStatus, req.account?.username || "Manual");
  }

  broadcast("attendance:override", { delegateId, name: d.rows[0].name, method: "MANUAL_UNDO" });
  res.json({ delegateId, status: restoredStatus });
}));

/* ---------------------------------------------------------------------------
 * POST /api/checkins/qr
 * The QR half of HLD §3.5 (check_in_logs). A delegate badge scanned in the
 * /checkin screen posts here; we write a method='QR' row and flip the delegate
 * to PRESENT so JQ's dashboard head-count and the reverse-headcount agree.
 *
 * Gated on requireAuth() (any signed-in staff), NOT on manageExceptions — a QR
 * scan is a primary field check-in, exactly like Vimal's face scan, so it uses
 * the same auth level rather than the elevated manual-override permission.
 * Idempotent on client_event_id so an offline retry can't double-insert.
 * Body: { tripId, delegateId, coachId?, clientEventId?, clientTs? }
 * ------------------------------------------------------------------------- */
router.post("/api/checkins/qr", requireAuth(), wrap(async (req, res) => {
  const { tripId, delegateId, clientEventId, clientTs } = req.body || {};
  if (!tripId || !delegateId) {
    return res.status(400).json({ error: "MISSING_FIELDS", message: "tripId and delegateId are required." });
  }
  const d = await q('SELECT id, name, "coachId", status FROM delegates WHERE id = $1', [delegateId]);
  if (!d.rows.length) return res.status(404).json({ error: "NOT_FOUND", message: "Delegate not found." });

  const eventId = clientEventId || randomUUID();
  const dup = await q("SELECT id FROM check_in_logs WHERE client_event_id = $1", [eventId]);
  if (dup.rows.length) {
    return res.json({ id: dup.rows[0].id, delegateId, name: d.rows[0].name, status: "ARRIVED", method: "QR", duplicate: true });
  }

  // Log against the badge's own coach (fall back to the scoped coach hint).
  const coachId = d.rows[0].coachId || (req.body && req.body.coachId) || null;
  const id = randomUUID();
  await q(
    `INSERT INTO check_in_logs
       (id, delegate_id, trip_id, coach_id, method, checked_in_by, client_event_id, is_offline_origin, client_ts)
     VALUES ($1,$2,$3,$4,'QR',$5,$6,$7,$8)`,
    [id, delegateId, tripId, coachId, req.account.id, eventId,
     !!req.body?.isOfflineOrigin, clientTs || new Date().toISOString()]
  );

  // ARRIVED — the 5-status value (was the legacy PRESENT literal).
  await q(`UPDATE delegates SET status='ARRIVED', "lastSeen"=$1 WHERE id=$2`,
    [`QR check-in · ${new Date().toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", hour12: false })}`, delegateId]);
  // Persisted audit row (2026-07-30 — QR check-ins never showed up on the
  // History log at all before this).
  const qrTripUuid = await resolveTripUuid(tripId);
  if (qrTripUuid) {
    await recordEvent(qrTripUuid, req, {
      action: "checkin.qr", entity: "delegate", entityId: delegateId, kind: "checkin",
      summary: `${d.rows[0].name} checked in via QR scan.`,
      before: { status: d.rows[0].status }, after: { status: "ARRIVED" },
    });
  }
  // The REAL Delegate history log (activity_log — see the import comment
  // near the top of this file) — this route also updates `delegates` with
  // raw SQL, so it needs its own explicit logActivity() call too.
  await logActivity(`${d.rows[0].name} checked in (QR)`, "checkin", actorOf(req), { delegateId, tripUuid: qrTripUuid });

  broadcast("attendance:override", { delegateId, name: d.rows[0].name, method: "QR" });
  res.status(201).json({ id, delegateId, name: d.rows[0].name, status: "ARRIVED", duplicate: false, method: "QR" });
}));

export default router;
