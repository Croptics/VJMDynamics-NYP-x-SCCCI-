import { useState } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import { getToken, clearToken, getUser, getPermissions, apiPost } from "./lib/api.js";

// Vance — fully built
import LoginPage from "./pages/LoginPage.jsx";
import OnboardingPage from "./pages/OnboardingPage.jsx";

// Scaffolds — owned by teammates
import DashboardPage from "./pages/DashboardPage.jsx";
import TripCoachPage from "./pages/TripCoachPage.jsx";
import QRCheckInPage from "./pages/QRCheckInPage.jsx";
import ExceptionInboxPage from "./pages/ExceptionInboxPage.jsx";
import AccountControlPage from "./pages/AccountControlPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import HistoryLogPage from "./pages/HistoryLogPage.jsx";

// Mobile UI — responsive pages, own layout/nav
import MobileLayout from "./pages/mobile/MobileLayout.jsx";
import MobileHomePage from "./pages/mobile/MobileHomePage.jsx";
import MobileAttendancePage from "./pages/mobile/MobileAttendancePage.jsx";
import MobileTripsPage from "./pages/mobile/MobileTripsPage.jsx";
import MobileProfilePage from "./pages/mobile/MobileProfilePage.jsx";

// Which UI (desktop or mobile) to land in — set explicitly by which button
// the user clicked on the login page ("Sign in" vs "Login for Mobile"), NOT
// guessed from screen width. Persisted so an ALREADY-authenticated visit to
// the bare "/" (token already stored, e.g. "keep me signed in") lands in the
// same place chosen at login, not just a brand-new sign-in.
const UI_MODE_KEY = "mg_ui_mode";

function getUiMode() {
  try { return localStorage.getItem(UI_MODE_KEY) || "desktop"; } catch { return "desktop"; }
}
function setUiMode(mode) {
  try { localStorage.setItem(UI_MODE_KEY, mode); } catch { /* ignore */ }
}
function pickHomeRoute() {
  return getUiMode() === "mobile" ? "/mobile" : "/dashboard";
}

/**
 * Top-level router for MusterGo.
 *
 * Auth is derived from the saved JWT (see lib/api.js). Initialising `authed`
 * from the stored token means a page refresh keeps you signed in and on the
 * same page. Logging out clears the token and returns to /login.
 */
export default function App() {
  const [authed, setAuthed] = useState(() => !!getToken());
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    // Best-effort — clears last_seen_at server-side so Staff Operations'
    // "active now" list drops this account immediately instead of waiting
    // for the 45s window to lapse. Must fire before clearToken() wipes the
    // JWT this call needs to authenticate; the local logout proceeds either
    // way even if this fails (e.g. backend briefly unreachable).
    apiPost("/auth/logout", {}).catch(() => {});
    clearToken();
    setAuthed(false);
  };

  // `mode` is "desktop" or "mobile" — whichever button the user clicked on
  // the login page. Persisted (see setUiMode) so it's remembered next time
  // too, not just for this sign-in.
  const handleSignIn = (mode = "desktop") => {
    setAuthed(true);
    setUiMode(mode);
    // If we got bounced to /login from a specific URL (e.g. someone opened
    // /mobile/profile while logged out, or logged out while on it), go back
    // to exactly that page — but ONLY if it's in the same namespace as the
    // mode just chosen. Otherwise this would silently override an explicit
    // "Login for Mobile" click: visiting the bare "/" while logged out bounces
    // here with from="/", which isn't a mobile path, so it must not win over
    // the button the user just clicked.
    const from = location.state?.from;
    const fromMatchesMode = from && from !== "/login" && from.startsWith("/mobile") === (mode === "mobile");
    if (fromMatchesMode) {
      navigate(from, { replace: true });
      return;
    }
    navigate(mode === "mobile" ? "/mobile" : "/dashboard", { replace: true });
  };

  if (!authed) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage onSignIn={handleSignIn} />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: location.pathname }} />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout onLogout={handleLogout} />}>
        <Route index element={<Navigate to={pickHomeRoute()} replace />} />

        {/* Jun Qi — Admin Dashboard & Analytics (Screen 2) */}
        <Route path="/dashboard" element={<DashboardPage />} />

        {/* Desmond — Trip Booking & Dynamic Coach Management (Screen 3) */}
        <Route path="/trips" element={<TripCoachPage />} />

        {/* Vance — AI Document Parsing & Onboarding (Screen 4) — FULL.
            Bulk-creates delegates, so it needs the same manageDelegates
            permission the backend parse/confirm routes require. */}
        <Route
          path="/onboarding"
          element={
            getPermissions().manageDelegates
              ? <OnboardingPage />
              : <Navigate to="/dashboard" replace />
          }
        />

        {/* Jayden — Exception Logging & QR Fallback (Screen 5) */}
        <Route path="/exceptions" element={<ExceptionInboxPage />} />

        {/* Vance — AI Trip Assistant (Screen 6) — now a floating bubble
            (ChatBubble.jsx, rendered from Layout.jsx on every route)
            instead of a dedicated destination; no route needed. */}

        {/* Vimal — QR Check-in (mobile-web staff view) */}
        <Route path="/checkin" element={<QRCheckInPage />} />

        {/* Account control — needs the manage-accounts permission */}
        <Route
          path="/accounts"
          element={
            getPermissions().manageAccounts
              ? <AccountControlPage />
              : <Navigate to="/dashboard" replace />
          }
        />

        {/* Staff Operations lives INSIDE DashboardPage.jsx as an admin-only
            tab (manageAccounts) — not a separate route, so admins see it
            without leaving the Dashboard. */}

        {/* History log — standalone audit trail (date-grouped activity_log),
            reached from the Dashboard's History tracker card */}
        <Route path="/history" element={<HistoryLogPage />} />

        {/* Settings — signed-in account info + theme/language preferences */}
        <Route path="/settings" element={<SettingsPage />} />

        <Route path="*" element={<Navigate to={pickHomeRoute()} replace />} />
      </Route>

      {/* Mobile UI — responsive pages with their own bottom-tab layout */}
      <Route element={<MobileLayout onLogout={handleLogout} />}>
        <Route path="/mobile" element={<MobileHomePage />} />
        <Route path="/mobile/attendance" element={<MobileAttendancePage />} />
        <Route path="/mobile/trips" element={<MobileTripsPage />} />
        <Route path="/mobile/profile" element={<MobileProfilePage />} />
      </Route>
    </Routes>
  );
}
