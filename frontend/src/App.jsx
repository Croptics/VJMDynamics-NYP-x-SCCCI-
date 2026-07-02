import { useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
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

/**
 * Top-level router for MusterGo.
 *
 * Auth is derived from the saved JWT (see lib/api.js). Initialising `authed`
 * from the stored token means a page refresh keeps you signed in and on the
 * same page. Logging out clears the token and returns to /login.
 */
export default function App() {
  const [authed, setAuthed] = useState(() => !!getToken());

  const handleLogout = () => {
    clearToken();
    setAuthed(false);
  };

  if (!authed) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage onSignIn={() => setAuthed(true)} />} />
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
    </Routes>
  );
}
