/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Admin Dashboard, Auth, Accounts & Permissions
 * ============================================================================= */
/**
 * Extracted 2026-08-02 (audit pass) — DashboardPage.jsx and
 * MobileAttendancePage.jsx each defined this exact one-liner independently.
 *
 * Legacy rows may still hold "PRESENT" (check-in routes that haven't
 * migrated to writing "ARRIVED" yet — see normalize() in backend/data.js) —
 * alias it for filtering/sorting so those rows show up under "Arrived"
 * instead of silently vanishing from that filter.
 */
export function effectiveStatus(d) {
  return d.status === "PRESENT" ? "ARRIVED" : d.status;
}
