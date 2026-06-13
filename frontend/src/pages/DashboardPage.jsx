/**
 * Screen 2 — Admin Dashboard & Analytics (Jun Qi).
 * Structural placeholder. To build:
 *  - KPI tiles: Missing right now / Present / Unassigned / Open exceptions
 *  - Coach status bars + live activity feed (GET /api/trips/:id/dashboard)
 *  - Reverse-headcount missing list with photos (GET /api/trips/:id/missing)
 *  - Excel export (GET /api/trips/:id/export?format=xlsx)
 */
export default function DashboardPage() {
  return (
    <div className="page">
      <div className="page-eyebrow">Active trip</div>
      <h1 className="page-title">Dashboard</h1>
      <p className="page-sub">Live present / missing / unassigned visibility for the active trip.</p>
      <div className="scaffold" style={{ marginTop: 20 }}>
        <h2>Admin Dashboard &amp; Analytics</h2>
        <p>KPI tiles, coach status, live activity feed, missing list, and Excel export.</p>
        <span className="owner">Owner · Jun Qi</span>
      </div>
    </div>
  );
}
