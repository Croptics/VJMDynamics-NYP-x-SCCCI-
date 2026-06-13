import { useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout.jsx";

// Vance — fully built
import LoginPage from "./pages/LoginPage.jsx";
import OnboardingPage from "./pages/OnboardingPage.jsx";
import ChatAssistantPage from "./pages/ChatAssistantPage.jsx";

// Scaffolds — owned by teammates
import DashboardPage from "./pages/DashboardPage.jsx";
import TripCoachPage from "./pages/TripCoachPage.jsx";
import QRCheckInPage from "./pages/QRCheckInPage.jsx";
import ExceptionInboxPage from "./pages/ExceptionInboxPage.jsx";

/**
 * Top-level router for MusterGo.
 *
 * Auth state is held here as a simple boolean for the demo build; in production
 * this is replaced by a JWT from POST /api/auth/login stored in an auth context.
 * Unauthenticated users are redirected to /login. Authenticated users get the
 * persistent admin shell (Layout) with the feature pages nested inside.
 */
export default function App() {
  const [authed, setAuthed] = useState(false);

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
      <Route element={<Layout />}>
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

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
