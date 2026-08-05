/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — desktop "current trip" scope
 * ============================================================================= */
// Shared "which trip is the desktop app looking at" signal. Deliberately reuses
// DashboardPage's own trip-switcher storage key — that IS the de-facto current
// trip the desktop shell orients around (Layout.jsx's announcement badge reads
// it too) — so the floating ChatBubble follows the on-screen trip instead of
// needing its own picker (see AssistantConversation.jsx `compact` mode).
// Mirrors lib/mobileTrip.js for the mobile app.
const ACTIVE_TRIP_KEY = "mg_dashboard_trip";
const DEFAULT_TRIP_ID = "t-1";
export const ACTIVE_TRIP_EVENT = "mg:active-trip-changed";

export function getActiveTripId() {
  try { return localStorage.getItem(ACTIVE_TRIP_KEY) || DEFAULT_TRIP_ID; } catch { return DEFAULT_TRIP_ID; }
}

// DashboardPage.jsx imports this directly (aliased to loadSelectedTripId/
// saveSelectedTripId). Must dispatch ACTIVE_TRIP_EVENT on every write so
// same-tab listeners (the always-mounted ChatBubble) notice: a bare
// localStorage write fires `storage` only in OTHER tabs, never the writer.
export function setActiveTripId(id) {
  try { localStorage.setItem(ACTIVE_TRIP_KEY, id); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(ACTIVE_TRIP_EVENT, { detail: id }));
}

/**
 * Map the active trip id onto a real row from an /all-trips list.
 *
 * Needed because the Dashboard persists the legacy `"t-1"` ALIAS for the base
 * trip, while /all-trips only ever returns uuids — so any page that feeds the
 * active id into a <select> built from that list would find no matching option
 * and render blank. Falls back to the id unchanged when the list hasn't loaded
 * yet, so callers can use it unconditionally.
 *
 * Matching the base trip by name is the convention already used elsewhere in
 * this codebase for exactly this alias; it's fragile if the seed trip is ever
 * renamed, in which case the first entry is used instead.
 */
export function resolveActiveTripId(activeId, trips) {
  if (activeId && activeId !== DEFAULT_TRIP_ID) return activeId;
  const list = trips || [];
  if (!list.length) return activeId;
  const seed = list.find((tr) => (tr.name || "").toLowerCase().includes("beijing"));
  return seed?.id || list[0].id;
}
