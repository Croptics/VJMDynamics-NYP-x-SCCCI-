/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — mobile trip scope
 * ============================================================================= */
// Shared "which trip is the mobile app currently looking at" state
// (2026-07-23). Every mobile page used to hardcode its own local
// `TRIP_ID = "t-1"` constant independently, so there was no way to point the
// whole mobile experience at a different trip (e.g. a real in-progress trip
// other than the default Beijing one) without editing code. Home's own trip
// switcher (MobileHomePage.jsx) writes here; every other mobile page
// (Attendance/Scanner/Issues/Ops/the tab-bar shell) reads from here instead
// of its own separate constant, so they all stay in sync.
const MOBILE_TRIP_KEY = "mg_mobile_trip";
const DEFAULT_TRIP_ID = "t-1";

export function getMobileTripId() {
  try { return localStorage.getItem(MOBILE_TRIP_KEY) || DEFAULT_TRIP_ID; } catch { return DEFAULT_TRIP_ID; }
}

export function setMobileTripId(id) {
  try { localStorage.setItem(MOBILE_TRIP_KEY, id); } catch { /* ignore */ }
}
