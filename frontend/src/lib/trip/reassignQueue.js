/* =============================================================================
 *  OWNED BY:  Desmond — "TransitFlow" — Trip Booking & Dynamic Coach Management
 *
 *  Offline-capable delegate reassignment. The Trips board (desktop + mobile)
 *  reassigns through desmond.js's validated PATCH /api/trips/:tripId/reassign
 *  (server-side capacity + optimistic locking + cross-trip guard). This wraps
 *  that call in the team's shared offline outbox (JQ's lib/outbox.js), exactly
 *  the way lib/delegateWrites.js wraps the attendance PATCH: if the request
 *  never reaches the server, the INTENT is queued and replayed on reconnect.
 *
 *  Extracted out of TripCoachPage.jsx / MobileTripsPage.jsx so both pages share
 *  ONE copy and so tests/desmond can exercise it without React (see
 *  tests/desmond/reassign-queue.test.js).
 *
 *  WHY REPLAY IS SAFE: the endpoint ASSIGNS state (coach + status), it doesn't
 *  append, so applying a queued move twice leaves the same row. Ordering is
 *  preserved by the outbox (FIFO, stops at the first send it can't make).
 * ============================================================================= */
import { apiPatch } from "../api.js";
import { enqueue, registerSender, isOfflineError, pending } from "../localstorage/outbox.js";

export const REASSIGN_KIND = "delegates/reassign";

/* Replay handler. Registered here (not in outbox.js) so the queue stays free of
 * feature imports — it just calls back into this module's endpoint. */
registerSender(REASSIGN_KIND, (p) => apiPatch(`/trips/${p.tripId}/reassign`, p));

/**
 * Reassign a delegate, queueing the move if the server can't be reached.
 * Resolves either way so the caller's optimistic UI stands — same contract as
 * patchDelegate() in delegateWrites.js.
 *
 * @param tripId  the trip whose board this is
 * @param move    { delegateId, toCoachId, expectedCoachId, override }
 *                expectedCoachId drives the server's optimistic lock (the coach
 *                the client last saw them on); override forces a full coach.
 * @param meta    optional UI context, e.g. { label: "Chen Hao Ming" }
 * @returns the updated delegate, or { queued:true, delegateId, coachId } offline
 */
export async function reassignRequest(tripId, { delegateId, toCoachId, expectedCoachId, override }, meta = {}) {
  try {
    return await apiPatch(`/trips/${tripId}/reassign`, { delegateId, toCoachId, expectedCoachId, override: !!override });
  } catch (err) {
    if (!isOfflineError(err)) throw err; // capacity/conflict/permission refusals must still surface
    enqueue({
      kind: REASSIGN_KIND,
      // expectedCoachId is intentionally DROPPED from the queued payload: a
      // deferred move should apply last-write-wins on reconnect, not 409 on a
      // lock that no longer reflects reality.
      payload: { tripId, delegateId, toCoachId, override: !!override, clientEventId: crypto.randomUUID(), clientTs: new Date().toISOString() },
      meta: { delegateId, label: meta.label || delegateId },
    });
    return { queued: true, delegateId, coachId: toCoachId };
  }
}

/**
 * Overlay queued (offline) reassigns onto a freshly-fetched roster so a move
 * made offline doesn't visually snap back on the next poll. Mirrors JQ's
 * applyQueuedPatches(); newest queued target wins, flagged pendingSync so the
 * card can show it as unsynced. Returns the list untouched when nothing's queued.
 */
export function applyQueuedReassigns(delegates) {
  const q = pending().filter((e) => e.kind === REASSIGN_KIND);
  if (!q.length) return delegates;
  const byId = new Map();
  for (const e of q) {
    const id = e.payload?.delegateId;
    if (id) byId.set(id, e.payload.toCoachId ?? null);
  }
  return delegates.map((d) => (byId.has(d.id) ? { ...d, coachId: byId.get(d.id), pendingSync: true } : d));
}
