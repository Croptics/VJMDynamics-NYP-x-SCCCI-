/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — shared "which trip is this account scoped to"
 * ============================================================================= */
/**
 * ONE source of truth for "given this account's coach captaincies, which trip
 * should the app be scoped to?" — shared by BOTH surfaces (2026-08-04):
 *
 *   - mobile  → MobileLayout.jsx  (writes lib/mobileTrip.js's mg_mobile_trip)
 *   - desktop → DashboardPage.jsx (writes lib/activeTrip.js's mg_dashboard_trip)
 *
 * WHY this exists rather than each surface deriving its own: the two had
 * byte-for-byte duplicated copies of this filter/tie-break, and they drifted —
 * the mobile copy silently threw `ReferenceError: setMobileTripId is not
 * defined` inside a swallowing try/catch for hours while desktop worked fine,
 * which read to the user as "desktop can do it, why can't mobile?" (AI Log
 * 247-250). Two surfaces solving the same problem twice is what let that
 * happen; one tested pure function is the fix.
 *
 * Both stores stay separate ON PURPOSE (a staff member can legitimately be
 * looking at different trips on a laptop and a phone) — it's only the DECISION
 * of what a bare account maps to that's shared.
 *
 * Input is `/api/my-captain-coaches`'s `coaches` array:
 *   [{ coachId, coachLabel, tripId, tripName, tripStatus }]
 */

/**
 * Every trip this account is meaningfully scoped to, most-relevant first.
 *
 *  - COMPLETED trips are dropped outright. Completing a trip already
 *    auto-unassigns its coach_captains rows (backend PATCH /trips/:tripId), so
 *    this is a backstop for an unassign that lagged, not the primary path.
 *  - "In progress" WINS when any exists. The backend's own single-active-trip
 *    guardrail (findCaptainTripConflicts) refuses to let one account captain
 *    two DIFFERENT in-progress trips at once, so this can only ever resolve to
 *    one — meaning a stale leftover captaincy on a Planning trip can never
 *    outvote the trip the account is actually working right now.
 *  - Otherwise falls back to whatever's left (e.g. everything still Planning).
 */
export function scopedTripIds(coaches) {
  const live = (coaches || []).filter((c) => c && c.tripId && c.tripStatus !== "Completed");
  const inProgress = live.filter((c) => c.tripStatus === "In progress");
  const pool = inProgress.length ? inProgress : live;
  return [...new Set(pool.map((c) => c.tripId))];
}

/**
 * The single trip to auto-correct a cached scope to, or null when it isn't
 * unambiguous (no captaincies at all, or genuinely more than one candidate).
 *
 * Returning null means "leave whatever the user/device already had alone" —
 * deliberately conservative: silently retargeting someone's whole app on a
 * guess is worse than showing them a trip they can switch away from.
 */
export function pickScopedTripId(coaches) {
  const ids = scopedTripIds(coaches);
  return ids.length === 1 ? ids[0] : null;
}
