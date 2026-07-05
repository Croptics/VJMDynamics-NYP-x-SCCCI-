import { useRef, useState } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import { getToken, clearToken, getUser, getPermissions } from "./lib/api.js";

// Vance — fully built
import LoginPage from "./pages/LoginPage.jsx";
import OnboardingPage from "./pages/OnboardingPage.jsx";
import ChatAssistantPage from "./pages/ChatAssistantPage.jsx";

// Scaffolds — owned by teammates
import DashboardPage from "./pages/DashboardPage.jsx";
import TripCoachPage from "./pages/TripCoachPage.jsx";
import QRCheckInPage from "./pages/QRCheckInPage.jsx";
import ExceptionInboxPage from "./pages/ExceptionInboxPage.jsx";
import AccountControlPage from "./pages/AccountControlPage.jsx";

// Mobile UI — responsive pages, own layout/nav
import MobileLayout from "./pages/mobile/MobileLayout.jsx";
import MobileHomePage from "./pages/mobile/MobileHomePage.jsx";
import MobileMissingPage from "./pages/mobile/MobileMissingPage.jsx";
import MobileAssistantPage from "./pages/mobile/MobileAssistantPage.jsx";
import MobileProfilePage from "./pages/mobile/MobileProfilePage.jsx";

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
  // Remembers whether you were in the mobile section when you logged out, so
  // signing back in returns you to /mobile instead of always landing on the
  // desktop /dashboard.
  const wasMobileRef = useRef(false);

  const handleLogout = () => {
    wasMobileRef.current = location.pathname.startsWith("/mobile");
    clearToken();
    setAuthed(false);
  };

  const handleSignIn = () => {
    setAuthed(true);
    navigate(wasMobileRef.current ? "/mobile" : "/dashboard", { replace: true });
  };

  if (!authed) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage onSignIn={handleSignIn} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout onLogout={handleLogout} />}>
        <Route index element={<Navigate to="/dashboard" replace />} />

        {/* Jun Qi — Admin Dashboard & Analytics (Screen 2) */}
        <Route path="/dashboard" element={<DashboardPage />} />

        {/* Desmond — Trip Booking & Dynamic Coach Management (Screen 3) */}
        <Route path="/trips" element={<TripCoachPage />} />

        {/* Vance — AI Document Parsing & Onboarding (Screen 4) — FULL */}
        <Route path="/onboarding" element={<OnboardingPage />} />

        {/* Jayden — Exception Logging & QR Fallback (Screen 5) */}
        <Route path="/exceptions" element={<ExceptionInboxPage />} />

        {/* Vance — AI Trip Assistant (Screen 6) */}
        <Route path="/assistant" element={<ChatAssistantPage />} />

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

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>

      {/* Mobile UI — responsive pages with their own bottom-tab layout */}
      <Route element={<MobileLayout onLogout={handleLogout} />}>
        <Route path="/mobile" element={<MobileHomePage />} />
        <Route path="/mobile/missing" element={<MobileMissingPage />} />
        <Route path="/mobile/assistant" element={<MobileAssistantPage />} />
        <Route path="/mobile/profile" element={<MobileProfilePage />} />
      </Route>
    </Routes>
  );
}
