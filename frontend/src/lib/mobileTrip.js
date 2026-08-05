/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — mobile trip scope
 * ============================================================================= */
// Single source of truth for which trip the mobile app is scoped to; replaces
// per-page hardcoded `TRIP_ID` constants that couldn't be repointed without a
// code edit. MobileHomePage.jsx's switcher writes here; every other mobile page
// (Attendance/Scanner/Issues/Ops/tab-bar shell) must read here, not its own
// constant, or they drift out of sync.
const MOBILE_TRIP_KEY = "mg_mobile_trip";
const DEFAULT_TRIP_ID = "t-1";

export function getMobileTripId() {
  try { return localStorage.getItem(MOBILE_TRIP_KEY) || DEFAULT_TRIP_ID; } catch { return DEFAULT_TRIP_ID; }
}

export function setMobileTripId(id) {
  try { localStorage.setItem(MOBILE_TRIP_KEY, id); } catch { /* ignore */ }
}
