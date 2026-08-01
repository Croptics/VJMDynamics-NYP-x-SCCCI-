/* =============================================================================
 *  PART OF:   MusterGo — Missing/Escalated <-> Exceptions auto-sync (2026-07-31)
 *
 *  "Bi-directional exception linking" — a delegate's live status (Missing) and
 *  escalation state (via the existing routes/escalations.js "Escalate to
 *  office" feature — db/delegates.js's rowToDelegate() already derives an
 *  `escalated` flag off the same escalations table) now keep an
 *  auto-generated exception_tickets row in sync, instead of the Exceptions
 *  inbox only ever showing manually-logged tickets.
 *
 *  Deliberately a LEAF module — imports only db/connection.js, nothing from
 *  routes/*. It's called from THREE places that would otherwise form an
 *  import cycle through ../data.js if this lived inside routes/exceptions.js
 *  itself: db/delegates.js (updateDelegate), routes/exceptions.js (the two
 *  raw-SQL check-in routes that intentionally bypass updateDelegate — see
 *  their own comments), and routes/escalations.js (createEscalation). SSE
 *  broadcasting is handled the same way: routes/exceptions.js registers its
 *  own broadcast() closure here once at boot (registerExceptionBroadcast, see
 *  initExceptions()) rather than this module importing that route back.
 *
 *  Only ever touches tickets it created itself (is_auto = true) — a
 *  manually-logged ticket for the same delegate (via Log Exception) is never
 *  read, resolved, or re-prioritised by this module.
 * ============================================================================= */
import { randomUUID } from "crypto";
import { get, run } from "./connection.js";

let notify = () => {};
/** Called once by routes/exceptions.js's initExceptions() so ticket writes
 *  made here still reach live SSE listeners (the Exceptions inbox's
 *  subscribeStream()), exactly like a ticket raised through the normal route. */
export function registerExceptionBroadcast(fn) {
  notify = fn;
}

// Seeded system/kiosk account (db/schema.js) — used as raised_by for tickets
// this module creates, since there's no single "acting account" for every
// call site (e.g. checkpoint auto-transitions run as actor="System", not a
// real account id) and raised_by is a NOT NULL FK to accounts(id).
const SYSTEM_ACCOUNT_ID = "u-kiosk";

async function shapeAndBroadcast(id, event) {
  const row = await get(
    `SELECT x.id, x.type, x.type_other, x.priority, x.status, x.note, x.created_at, x.resolved_at,
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
      WHERE x.id = $1`,
    [id]
  );
  if (!row) return;
  notify(event, {
    id: row.id,
    type: row.type,
    typeOther: row.type_other || null,
    priority: row.priority,
    status: row.status,
    note: row.note,
    delegateId: row.delegate_id || null,
    delegateName: row.delegate_name || null,
    delegateVip: !!row.delegate_vip,
    delegateStatus: row.delegate_status || null,
    coach: row.coach_name || null,
    raisedBy: row.raised_by_name || null,
    resolvedBy: row.resolved_by_name || null,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  });
}

/**
 * Keep the delegate's auto-generated MISSING_PERSON ticket in sync with their
 * live status. status === "MISSING" opens one (if none is already open);
 * any other status resolves whichever auto ticket is currently open for them
 * — covers "marking Arrived from Attendance/Scanner clears their Exceptions
 * entry" for free, since every status write path ends up here.
 */
export async function syncDelegateStatus(delegateId, status) {
  try {
    const d = await get('SELECT "coachId", trip_id FROM delegates WHERE id = $1', [delegateId]);
    if (!d || !d.trip_id) return; // no trip scope to file the ticket under

    if (status === "MISSING") {
      const existing = await get(
        `SELECT id FROM exception_tickets WHERE delegate_id = $1 AND is_auto = true AND status = 'OPEN'`,
        [delegateId]
      );
      if (existing) return; // already tracked — never spawn a duplicate
      const id = randomUUID();
      await run(
        `INSERT INTO exception_tickets
           (id, trip_id, delegate_id, coach_id, type, priority, status, note, raised_by, client_event_id, is_auto)
         VALUES ($1,$2,$3,$4,'MISSING_PERSON','NORMAL','OPEN',$5,$6,$7,true)`,
        [id, d.trip_id, delegateId, d.coachId || null, "Auto-flagged — delegate marked Missing.", SYSTEM_ACCOUNT_ID, randomUUID()]
      );
      await shapeAndBroadcast(id, "exception:created");
    } else {
      const row = await get(
        `UPDATE exception_tickets SET status='RESOLVED', resolved_at=now()
          WHERE delegate_id = $1 AND is_auto = true AND status = 'OPEN'
          RETURNING id`,
        [delegateId]
      );
      if (row) await shapeAndBroadcast(row.id, "exception:updated");

      // Checked in -> clear the Dashboard Alerts banner's "Emergency" entry
      // too (2026-07-31 — "if this one show in arrived, then auto resolve on
      // alert page"). Raised directly against `escalations` rather than
      // importing db/escalations.js's own resolveEscalation() — that function
      // calls back into updateDelegate() (db/delegates.js), and db/delegates.js
      // is what calls INTO this module, so importing it here would form an
      // import cycle. A plain UPDATE is all resolveEscalation() does beyond
      // that recursive call, which would be a redundant no-op here anyway
      // (the delegate's status is already what we're setting it to).
      if (status === "ARRIVED" || status === "PRESENT") {
        await run(
          `UPDATE escalations SET status='resolved', resolved_by=$1, resolved_at=now()
            WHERE delegate_id = $2 AND status IN ('open','acknowledged')`,
          [SYSTEM_ACCOUNT_ID, delegateId]
        );
      }
    }
  } catch (e) {
    // Never let a soft failure here (e.g. exception_tickets not migrated yet
    // on a fresh boot race) block or break the delegate write that triggered it.
    console.error("syncDelegateStatus failed:", e.message);
  }
}

/**
 * "Escalate to office" (routes/escalations.js) also elevates the delegate's
 * tracked ticket to CRITICAL, so it surfaces in the Exceptions inbox's
 * Critical tab — the other half of the same escalations table db/delegates.js
 * already derives its `escalated` flag from. Creates the ticket if one isn't
 * open yet (a delegate can be escalated without having gone fully Missing
 * first, e.g. "not answering calls" while still Late).
 */
export async function escalateAutoTicket(delegateId, note) {
  try {
    const d = await get('SELECT "coachId", trip_id FROM delegates WHERE id = $1', [delegateId]);
    if (!d || !d.trip_id) return;
    const existing = await get(
      `SELECT id FROM exception_tickets WHERE delegate_id = $1 AND is_auto = true AND status = 'OPEN'`,
      [delegateId]
    );
    if (existing) {
      await run(`UPDATE exception_tickets SET priority='CRITICAL' WHERE id = $1`, [existing.id]);
      await shapeAndBroadcast(existing.id, "exception:critical");
      return;
    }
    const id = randomUUID();
    await run(
      `INSERT INTO exception_tickets
         (id, trip_id, delegate_id, coach_id, type, priority, status, note, raised_by, client_event_id, is_auto)
       VALUES ($1,$2,$3,$4,'MISSING_PERSON','CRITICAL','OPEN',$5,$6,$7,true)`,
      [id, d.trip_id, delegateId, d.coachId || null, note || "Escalated to office.", SYSTEM_ACCOUNT_ID, randomUUID()]
    );
    await shapeAndBroadcast(id, "exception:critical");
  } catch (e) {
    console.error("escalateAutoTicket failed:", e.message);
  }
}
