/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Emergency escalations
 *
 *  Staff-clicked "alert the office" for when a delegate isn't answering their
 *  phone. NEVER automatic — only ever created by a human POST via
 *  routes/escalations.js.
 * ============================================================================= */
import { all, get, run } from "./connection.js";
import { updateDelegate } from "./delegates.js";

/** Dedupe guard against staff spamming Escalate: if the delegate already has
 *  an open escalation, returns that row so the route skips re-notifying.
 *  Message-only escalations (no delegateId) can't be keyed, so aren't deduped. */
export async function createEscalation({ tripId, delegateId, message }, actor) {
  if (delegateId) {
    const existing = await get(
      `SELECT id, trip_id AS "tripId", delegate_id AS "delegateId", message, status,
              created_by AS "createdBy", created_at AS "createdAt"
       FROM escalations WHERE delegate_id = $1 AND status = 'open'`,
      [delegateId]
    );
    if (existing) return { ...existing, alreadyOpen: true };
  }
  const row = await get(
    `INSERT INTO escalations (trip_id, delegate_id, message, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, trip_id AS "tripId", delegate_id AS "delegateId", message, status,
               created_by AS "createdBy", created_at AS "createdAt"`,
    [tripId || null, delegateId || null, (message || "").trim() || null, actor]
  );
  return { ...row, alreadyOpen: false };
}

/** Feeds ONLY the top banner. Joins delegate name/trip so the banner needs no
 *  second round-trip. Deliberately 'open' only, not 'acknowledged', so
 *  acknowledging clears it off the banner (it lives on in
 *  listActiveEscalations()).
 *
 *  tripId scopes the banner to the selected trip — without it, an emergency on
 *  an unrelated trip flashes the banner. Optional/null keeps the app-wide view
 *  for other callers. */
export async function listOpenEscalations(tripId = null) {
  return all(
    `SELECT e.id, e.trip_id AS "tripId", t.name AS "tripName", e.delegate_id AS "delegateId",
            d.name AS "delegateName", e.message, e.status, e.created_by AS "createdBy", e.created_at AS "createdAt"
       FROM escalations e
       LEFT JOIN trips t ON t.uuid_id = e.trip_id
       LEFT JOIN delegates d ON d.id = e.delegate_id
      WHERE e.status = 'open' ${tripId ? "AND e.trip_id = $1" : ""}
      ORDER BY e.created_at DESC`,
    tripId ? [tripId] : []
  );
}

/** Open OR acknowledged (i.e. not yet resolved) — the Alerts modal's
 *  "Emergency" section, where acknowledged items stay workable instead of
 *  vanishing. Includes phone/lastLocation so the modal needs no per-row
 *  round-trip.
 *
 *  Pass `tripId` or Trip A's dashboard shows every other trip's escalations
 *  too. Omitting it keeps the app-wide behaviour (currently unused). */
export async function listActiveEscalations(tripId) {
  return all(`
    SELECT e.id, e.trip_id AS "tripId", t.name AS "tripName", e.delegate_id AS "delegateId",
           d.name AS "delegateName", d.phone AS "delegatePhone", d."lastLocation" AS "delegateLocation",
           e.message, e.status, e.created_by AS "createdBy", e.created_at AS "createdAt",
           e.acknowledged_by AS "acknowledgedBy", e.acknowledged_at AS "acknowledgedAt"
    FROM escalations e
    LEFT JOIN trips t ON t.uuid_id = e.trip_id
    LEFT JOIN delegates d ON d.id = e.delegate_id
    WHERE e.status IN ('open', 'acknowledged')
      ${tripId ? "AND e.trip_id = $1" : ""}
    ORDER BY e.created_at DESC
  `, tripId ? [tripId] : []);
}

export async function acknowledgeEscalation(id, actor) {
  const existing = await get(`SELECT id, status FROM escalations WHERE id = $1`, [id]);
  if (!existing) return { error: "NOT_FOUND" };
  if (existing.status !== "open") return { error: "NOT_OPEN" };
  await run(
    `UPDATE escalations SET status = 'acknowledged', acknowledged_by = $1, acknowledged_at = now() WHERE id = $2`,
    [actor, id]
  );
  return { ok: true };
}

/** Bulk-acknowledge, so the banner's Acknowledge button isn't 50 clicks.
 *  Nothing is lost — they stay in the Alerts modal's Emergency section
 *  (listActiveEscalations includes 'acknowledged'). */
export async function acknowledgeAllOpen(actor) {
  const rows = await all(
    `UPDATE escalations SET status = 'acknowledged', acknowledged_by = $1, acknowledged_at = now()
     WHERE status = 'open' RETURNING id`,
    [actor]
  );
  return { count: rows.length };
}

/** Resolve means "delegate was found", so this also flips their global status
 *  to ARRIVED. Must go through updateDelegate() so it's a proper,
 *  rollback-eligible History Log entry rather than a silent side effect.
 *  Best-effort: a sync failure must not block the resolve. */
export async function resolveEscalation(id, actor) {
  const existing = await get(`SELECT id, delegate_id AS "delegateId" FROM escalations WHERE id = $1`, [id]);
  if (!existing) return { error: "NOT_FOUND" };
  await run(
    `UPDATE escalations SET status = 'resolved', resolved_by = $1, resolved_at = now() WHERE id = $2`,
    [actor, id]
  );
  if (existing.delegateId) {
    await updateDelegate(existing.delegateId, { status: "ARRIVED" }, actor).catch((err) =>
      console.error("  Escalation resolve -> ARRIVED sync failed:", err.message || err)
    );
  }
  return { ok: true };
}
