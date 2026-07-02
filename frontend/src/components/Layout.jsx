import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar.jsx";

/**
 * Admin shell layout. The sidebar persists; routed pages render in <Outlet/>.
 * `onLogout` is passed through to the sidebar's Log out button.
 * `exceptionCount` is hard-coded here as demo state; in production it comes
 * from GET /api/trips/:id/dashboard.
 */
export default function Layout({ onLogout }) {
  const openExceptions = 3; // demo: matches Screen 2

  return (
    <div className="app-shell">
      <Sidebar exceptionCount={openExceptions} onLogout={onLogout} />
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
