/* =============================================================================
 *  OWNED BY:  Desmond — "TransitFlow" — Trip Booking & Dynamic Coach Management
 *
 *  Pure decision core for a delegate reassignment. Extracted out of trip.js
 *  on purpose: trip.js opens a Postgres pool at module load, so importing it
 *  from a test hangs the runner on the open connection. This file has ZERO
 *  imports and no side effects, so tests/desmond/reassign-logic.test.js can
 *  import evaluateReassign() directly and run instantly, with no DB and no
 *  server. trip.js imports it and does the actual row loads + atomic write
 *  around it — see PATCH /api/trips/:tripId/reassign there.
 * ============================================================================= */

/**
 * Decide what a reassignment should do, given already-loaded state. Separated
 * from the DB I/O so every guard lives in one testable place.
 *
 * Returns exactly one of:
 *   { ok:true,  coachId, status, fromCoachId }   — perform the move
 *   { ok:true,  noop:true, coachId, status }      — nothing to do (same coach)
 *   { ok:false, status, code, message, ... }      — reject with that HTTP status
 *
 * @param {object}   a
 * @param {object|null} a.delegate        { tripId, coachId, status } | null (null = not found)
 * @param {string|null} a.toCoachId       target coach id, or null to unassign
 * @param {object|null} a.coach           resolved target { tripId, capacity, label } | null
 * @param {number}   a.occupied           occupants of the target, EXCLUDING this delegate
 * @param {Set|null} a.visibleCoachIds    coach ids a scoped captain may touch, or null = admin
 * @param {string|null} a.expectedCoachId the coach the client last saw them on (the lock)
 * @param {boolean}  a.hasExpected        did the caller send expectedCoachId? (enables the lock)
 * @param {boolean}  a.override           override a full coach?
 * @param {string}   a.tripUuid           the trip the request is scoped to
 */
export function evaluateReassign({
  delegate, toCoachId = null, coach = null, occupied = 0,
  visibleCoachIds = null, expectedCoachId = null, hasExpected = false, override = false, tripUuid,
}) {
  const target = toCoachId || null;

  if (!delegate) return { ok: false, status: 404, code: "NOT_FOUND", message: "Delegate not found." };
  if (delegate.tripId !== tripUuid) return { ok: false, status: 400, code: "WRONG_TRIP", message: "That delegate isn't on this trip." };
  const fromCoachId = delegate.coachId || null;

  // Same-coach drop (including Unassigned → Unassigned) — nothing to do.
  if (fromCoachId === target) return { ok: true, noop: true, coachId: fromCoachId, status: delegate.status };

  // (1) Target coach must exist AND be on this trip (one-coach / no cross-trip).
  if (target) {
    if (!coach) return { ok: false, status: 404, code: "COACH_NOT_FOUND", message: "That coach doesn't exist." };
    if (coach.tripId !== tripUuid) return { ok: false, status: 400, code: "COACH_WRONG_TRIP", message: "That coach isn't on this trip." };
  }

  // Captain scoping — only touch coaches you can see (releasing to Unassigned is ok).
  if (visibleCoachIds) {
    if (fromCoachId && !visibleCoachIds.has(fromCoachId)) return { ok: false, status: 403, code: "FORBIDDEN", message: "You can only move delegates on your own coach." };
    if (target && !visibleCoachIds.has(target)) return { ok: false, status: 403, code: "FORBIDDEN", message: "You can only move delegates to your own coach." };
  }

  // (2) Seat capacity — capacity <= 0 means "unmetered" and is never full.
  if (target && coach) {
    const capacity = Number(coach.capacity) || 0;
    if (capacity > 0 && occupied >= capacity && !override) {
      return { ok: false, status: 409, code: "CAPACITY_FULL", used: occupied, capacity, message: `${coach.label || "Coach"} is full (${occupied}/${capacity} seats).` };
    }
  }

  // (3) Optimistic lock (pre-check; the route ALSO guards the write atomically).
  if (hasExpected && fromCoachId !== (expectedCoachId || null)) {
    return { ok: false, status: 409, code: "CONFLICT", currentCoachId: fromCoachId, message: "Someone else moved this delegate. Refresh and try again." };
  }

  // Status follows the coach: UNASSIGNED → ASSIGNED when put on a coach; a real
  // attendance status (ARRIVED/LATE/MISSING) is kept; releasing to no coach is
  // UNASSIGNED. Mirrors JQ's normalize() in db/delegates.js.
  const status = target ? (delegate.status === "UNASSIGNED" ? "ASSIGNED" : delegate.status) : "UNASSIGNED";
  return { ok: true, coachId: target, fromCoachId, status };
}
