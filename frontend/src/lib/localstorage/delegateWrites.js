/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — offline write queue (delegate status half)
 * ============================================================================= */
/**
 * Offline-capable delegate updates (2026-07-28).
 *
 * The mobile Attendance sheet writes attendance decisions straight to
 * `PATCH /api/delegates/:id` — "this person is missing, last seen at Gate 3",
 * "this person cancelled". Those are exactly the calls that must survive a dead
 * signal on-site, so they route through the same outbox as manual check-in.
 *
 * WHY REPLAY IS SAFE HERE. Unlike a check-in (which APPENDS a
 * `check_in_logs` row and therefore needs an idempotency key), a delegate PATCH
 * ASSIGNS state: `status = "MISSING"` applied twice leaves exactly the same row.
 * So a replayed patch can't double-count anything. Ordering still matters —
 * MISSING then CANCELLED must not land the other way round — and the outbox is
 * FIFO and stops at the first entry it can't send, which preserves it.
 *
 * KNOWN, ACCEPTED IMPERFECTION: `updateDelegate()` also writes a history entry
 * (`logActivity`). If a request actually reaches the server but the response is
 * lost (a connection dropping mid-flight), the retry re-applies the same status
 * — harmless for the delegate — but adds a second history line for the same
 * change. That's cosmetic duplication in the audit trail, not wrong data, and
 * it's rarer than the plain-offline case this exists for. Fixing it properly
 * would mean giving `PATCH /api/delegates/:id` its own idempotency key, which is
 * worth doing if the history noise ever becomes a real complaint.
 */
import { apiPatch } from "../api.js";
import { enqueue, registerSender, isOfflineError, pending } from "./outbox.js";

const KIND = "delegates/patch";

/* Replay handler. Registered here rather than in outbox.js so the queue stays
 * free of feature imports. */
registerSender(KIND, ({ delegateId, patch }) => apiPatch(`/delegates/${delegateId}`, patch));

/**
 * PATCH a delegate, queueing it if the server can't be reached.
 * Resolves either way, so a caller's optimistic UI stands — same contract as
 * manualOverride() in exceptionsApi.js.
 *
 * @param delegateId the delegate to update
 * @param patch      the partial delegate body (status / lastLocation / cancelled…)
 * @param meta       optional UI context, e.g. { label: "Chen Hao Ming" }
 */
export async function patchDelegate(delegateId, patch, meta = {}) {
  try {
    return await apiPatch(`/delegates/${delegateId}`, patch);
  } catch (err) {
    if (!isOfflineError(err)) throw err; // a real refusal (403/404) must still surface
    enqueue({
      kind: KIND,
      payload: {
        delegateId,
        patch,
        clientEventId: crypto.randomUUID(),
        clientTs: new Date().toISOString(),
      },
      meta: { delegateId, label: meta.label || delegateId },
    });
    return { ...patch, id: delegateId, queued: true };
  }
}

/** Queued patches for one delegate, oldest first. */
export function queuedPatchesFor(delegateId) {
  return pending()
    .filter((e) => e.kind === KIND && e.payload?.delegateId === delegateId)
    .map((e) => e.payload.patch);
}

/** True when this delegate has an unsynced change. Covered directly by
 *  tests/jq/delegateWrites.test.js — a 2026-08-02 audit pass initially
 *  removed this as "no external callers" without checking tests/, which
 *  isn't under frontend/src or backend/; restored once the resulting test
 *  failure caught the mistake. */
export function hasQueuedPatch(delegateId) {
  return queuedPatchesFor(delegateId).length > 0;
}

/**
 * Overlay queued patches onto a freshly-fetched roster.
 *
 * Without this, a page reload while offline shows the SERVER's stale status and
 * the staff member's own change appears to have vanished — so they'd redo it.
 * Applied in queue order, so the newest decision wins.
 */
export function applyQueuedPatches(delegates) {
  const queued = pending().filter((e) => e.kind === KIND);
  if (queued.length === 0) return delegates;
  const byId = new Map();
  for (const e of queued) {
    const id = e.payload?.delegateId;
    if (!id) continue;
    byId.set(id, { ...(byId.get(id) || {}), ...e.payload.patch });
  }
  return delegates.map((d) => (byId.has(d.id) ? { ...d, ...byId.get(d.id), pendingSync: true } : d));
}
