/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — desktop "current trip" scope
 * ============================================================================= */
// Shared "which trip is the desktop app currently looking at" signal
// (2026-07-31). Reuses DashboardPage's own trip-switcher storage key — that's
// already the de-facto "current trip" the whole desktop shell orients around
// (Layout.jsx's announcement badge reads it too) — so the floating ChatBubble
// assistant can automatically follow whichever trip is on-screen instead of
// needing its own separate manual picker (see AssistantConversation.jsx's
// `compact` mode). Mirrors the same pattern lib/mobileTrip.js already
// established for the mobile app's shared trip scope.
const ACTIVE_TRIP_KEY = "mg_dashboard_trip";
const DEFAULT_TRIP_ID = "t-1";
export const ACTIVE_TRIP_EVENT = "mg:active-trip-changed";

export function getActiveTripId() {
  try { return localStorage.getItem(ACTIVE_TRIP_KEY) || DEFAULT_TRIP_ID; } catch { return DEFAULT_TRIP_ID; }
}

// Not currently called from here directly — DashboardPage.jsx still owns the
// write (via its own saveSelectedTripId) since it also needs to happen inside
// its existing effects/handlers. It dispatches ACTIVE_TRIP_EVENT after every
// write so same-tab listeners (the ChatBubble, mounted the whole time) notice
// immediately — a bare localStorage write alone only fires the browser's
// `storage` event in OTHER tabs, never the tab that made the write.
export function setActiveTripId(id) {
  try { localStorage.setItem(ACTIVE_TRIP_KEY, id); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(ACTIVE_TRIP_EVENT, { detail: id }));
}
