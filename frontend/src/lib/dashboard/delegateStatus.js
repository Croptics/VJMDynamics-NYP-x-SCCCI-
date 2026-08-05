/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Admin Dashboard, Auth, Accounts & Permissions
 * ============================================================================= */
/**
 * Legacy rows may still hold "PRESENT" (check-in routes that haven't migrated
 * to writing "ARRIVED" — see normalize() in backend/data.js). Alias PRESENT ->
 * ARRIVED for filtering/sorting so those rows don't vanish from the "Arrived"
 * filter. Shared by DashboardPage.jsx and MobileAttendancePage.jsx.
 */
export function effectiveStatus(d) {
  return d.status === "PRESENT" ? "ARRIVED" : d.status;
}
