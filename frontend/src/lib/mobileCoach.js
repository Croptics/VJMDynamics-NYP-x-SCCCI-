/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — mobile "which coach am I working" scope
 * ============================================================================= */
/**
 * Shared "which coach is this device mustering" signal, mirroring
 * lib/mobileTrip.js (same per-device localStorage shape, same reasoning).
 *
 * WHY: tapping a coach on mobile Home used to affect only the Attendance
 * roster (via ?coach= in the URL), while the QR / Face / Manual scanners
 * independently auto-picked "first coach with people". So going Home → Coach 2
 * → QR left you scanning INTO Coach 1 — a wrong-coach check-in with no visible
 * warning. Writing the choice here lets every scanner surface open on the coach
 * you actually selected.
 *
 * Stored per DEVICE, not per account, exactly like the trip scope — and like it,
 * a stored id is only ever a PREFERENCE: callers must validate it against the
 * current trip's real coach list before using it (see readers below), because a
 * trip switch leaves a coach id that belongs to a different trip.
 */
const MOBILE_COACH_KEY = "mg_mobile_coach";

export function getMobileCoachId() {
  try { return localStorage.getItem(MOBILE_COACH_KEY) || null; } catch { return null; }
}

export function setMobileCoachId(id) {
  try {
    if (id) localStorage.setItem(MOBILE_COACH_KEY, id);
    else localStorage.removeItem(MOBILE_COACH_KEY);
  } catch { /* ignore — a preference, never load-bearing */ }
}

/**
 * Pick the coach to open on, given the trip's actual coach list.
 * Order: the remembered coach (if it's still in this trip) → the first coach
 * with people to muster → the first coach at all. Returns null for an empty
 * list. Keeps that fallback chain in ONE place so every scanner agrees.
 */
export function preferredCoachId(coaches) {
  const list = coaches || [];
  if (!list.length) return null;
  const remembered = getMobileCoachId();
  if (remembered && list.some((c) => c.id === remembered)) return remembered;
  const withPeople = list.find((c) => (c.total || 0) > 0);
  return (withPeople || list[0]).id || null;
}
