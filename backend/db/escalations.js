/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Emergency escalations
 *
 *  A DELIBERATE, staff-clicked "alert the office" action for the exact
 *  scenario the user described: a delegate isn't answering their phone, and
 *  on-site staff wants to pull in offsite admin/office staff to help. Never
 *  automatic — only ever created by a real POST from a human clicking a real
 *  button (routes/escalations.js).
 * ============================================================================= */
import { all, get, run } from "./connection.js";
import { updateDelegate } from "./delegates.js";

/** Dedupe guard (2026-07-25) — "a lot of missing/late delegates could lead
 *  staff to spam the escalate button." If the SAME delegate already has an
 *  open (not yet acknowledged/resolved) escalation, this returns that
 *  existing row instead of creating a duplicate — the route then skips
 *  re-sending notifications for it, so re-clicking Escalate on someone
 *  already escalated doesn't spam the banner or the inbox. Only delegate-
 *  scoped: a message-only escalation (no delegateId) is never deduped,
 *  since there's nothing to key it on. */
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

/** Every open escalation, newest first, joined with the delegate's name/trip
 *  so the banner doesn't need a second round-trip to show something useful
 *  ("Cliff Chai — not answering calls", not just a bare id). Feeds ONLY the
 *  top banner — deliberately just 'open', not 'acknowledged' too, so
 *  acknowledging something actually clears it off the banner (see
 *  listActiveEscalations() below for where it goes instead). */
export async function listOpenEscalations() {
  return all(`
    SELECT e.id, e.trip_id AS "tripId", t.name AS "tripName", e.delegate_id AS "delegateId",
           d.name AS "delegateName", e.message, e.status, e.created_by AS "createdBy", e.created_at AS "createdAt"
    FROM escalations e
    LEFT JOIN trips t ON t.uuid_id = e.trip_id
    LEFT JOIN delegates d ON d.id = e.delegate_id
    WHERE e.status = 'open'
    ORDER BY e.created_at DESC
  `);
}

/** Every escalation that's open OR acknowledged (i.e. NOT yet resolved) —
 *  feeds the Alerts modal's "Emergency" section (2026-07-25). Acknowledging
 *  an escalation used to make it disappear entirely, which doesn't scale
 *  once there are many (e.g. 50 delegates escalated) — nobody could go back
 *  and actually work through them. This is where they live until someone
 *  explicitly resolves them. Includes phone/lastLocation so the modal can
 *  show full delegate context without a second round-trip per row. */
export async function listActiveEscalations() {
  return all(`
    SELECT e.id, e.trip_id AS "tripId", t.name AS "tripName", e.delegate_id AS "delegateId",
           d.name AS "delegateName", d.phone AS "delegatePhone", d."lastLocation" AS "delegateLocation",
           e.message, e.status, e.created_by AS "createdBy", e.created_at AS "createdAt",
           e.acknowledged_by AS "acknowledgedBy", e.acknowledged_at AS "acknowledgedAt"
    FROM escalations e
    LEFT JOIN trips t ON t.uuid_id = e.trip_id
    LEFT JOIN delegates d ON d.id = e.delegate_id
    WHERE e.status IN ('open', 'acknowledged')
    ORDER BY e.created_at DESC
  `);
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

/** Acknowledge EVERY currently open escalation in one query (2026-07-25) —
 *  "if there are 50 escalations, I have to click 50 times" was the exact
 *  complaint; the banner's Acknowledge button now calls this instead of
 *  one-at-a-time. Nothing is lost — every one of them still shows up in the
 *  Alerts modal's Emergency section (listActiveEscalations includes
 *  'acknowledged'), just cleared off the noisy top banner in a single click. */
export async function acknowledgeAllOpen(actor) {
  const rows = await all(
    `UPDATE escalations SET status = 'acknowledged', acknowledged_by = $1, acknowledged_at = now()
     WHERE status = 'open' RETURNING id`,
    [actor]
  );
  return { count: rows.length };
}

/** Resolving an escalation means the delegate was found (2026-07-25,
 *  explicit user instruction: "if I click resolve, it should change the
 *  status to arrived, because that's when the delegate is found") — flips
 *  the delegate's GLOBAL status to ARRIVED through the real updateDelegate()
 *  path, so it's a proper, rollback-eligible History Log entry, not a
 *  silent side effect. Best-effort: a sync failure never blocks the
 *  escalation itself from being marked resolved. Only touches the delegate
 *  when one is actually linked (message-only escalations have nothing to
 *  update). */
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
