import { useState } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import { getToken, clearToken, getPermissions, apiPost } from "./lib/api.js";

// Vance — fully built
import LoginPage from "./pages/LoginPage.jsx";
import RegisterPage from "./pages/RegisterPage.jsx";
import OnboardingPage from "./pages/desktop/OnboardingPage.jsx";

// Scaffolds — owned by teammates
import DashboardPage from "./pages/desktop/DashboardPage.jsx";
import AnnouncementsPage from "./pages/desktop/AnnouncementsPage.jsx";
import TripCoachPage from "./pages/desktop/TripCoachPage.jsx";
import UnifiedScannerPage from "./pages/desktop/UnifiedScannerPage.jsx";
import ExceptionInboxPage from "./pages/desktop/ExceptionInboxPage.jsx";
import AccountControlPage from "./pages/desktop/AccountControlPage.jsx";
import SettingsPage from "./pages/desktop/SettingsPage.jsx";
import HistoryLogPage from "./pages/desktop/HistoryLogPage.jsx";
import UserGuidePage from "./pages/desktop/UserGuidePage.jsx";
import ChatAssistantPage from "./pages/desktop/ChatAssistantPage.jsx";

// Mobile UI — responsive pages, own layout/nav
import MobileLayout from "./pages/mobile/MobileLayout.jsx";
import MobileHomePage from "./pages/mobile/MobileHomePage.jsx";
import MobileAttendancePage from "./pages/mobile/MobileAttendancePage.jsx";
import MobileTripsPage from "./pages/mobile/MobileTripsPage.jsx";
// Combined Trips + Attendance destination — composes the two pages above.
import MobileOpsPage from "./pages/mobile/MobileOpsPage.jsx";
import MobileProfilePage from "./pages/mobile/MobileProfilePage.jsx";
import MobileIssuesPage from "./pages/mobile/MobileIssuesPage.jsx";
import MobileScannerPage from "./pages/mobile/MobileScannerPage.jsx";
import MobileUserGuidePage from "./pages/mobile/MobileUserGuidePage.jsx";
import KioskScannerPage from "./pages/KioskScannerPage.jsx";
// Vimal — public delegate self-enrollment app (face/voice capture)
import EnrollPage from "./pages/EnrollPage.jsx";

// Which UI (desktop or mobile) to land in — derived automatically at login
// time from the account's own permissions (see pickModeFromPermissions
// below), not chosen by the user. Persisted so an ALREADY-authenticated visit
// to the bare "/" (token already stored, e.g. "keep me signed in") lands in
// the same place derived at login, not just a brand-new sign-in.
const UI_MODE_KEY = "mg_ui_mode";

function getUiMode() {
  try { return localStorage.getItem(UI_MODE_KEY) || "desktop"; } catch { return "desktop"; }
}
function setUiMode(mode) {
  try { localStorage.setItem(UI_MODE_KEY, mode); } catch { /* ignore */ }
}
// Ordered fallbacks for "the route you wanted is view-gated off — where do
// we send you instead?" Walks each list in priority order and lands on the
// first one this account's permissions actually allow; /settings and
// /mobile/profile are never gated, so they're always a safe last resort
// (an account with literally every view unchecked still lands somewhere).
const DESKTOP_FALLBACK_ORDER = [
  { path: "/dashboard", perm: "viewDashboard" },
  { path: "/announcements", perm: "viewAnnouncements" },
  { path: "/trips", perm: "viewTrips" },
  { path: "/onboarding", perm: "viewDocuments" },
  { path: "/scanner", perm: "viewScanner" },
  { path: "/exceptions", perm: "viewExceptions" },
  { path: "/history", perm: "viewHistory" },
];
const MOBILE_FALLBACK_ORDER = [
  { path: "/mobile", perm: "viewMobileHome" },
  { path: "/mobile/attendance", perm: "viewMobileAttendance" },
  { path: "/mobile/trips", perm: "viewMobileTrips" },
  { path: "/mobile/scanner", perm: "viewMobileScanner" },
  { path: "/mobile/issues", perm: "viewMobileIssues" },
];

/** Mobile Home is an admin-only overview. For anyone else this returns the
 *  first mobile route they CAN see, deliberately excluding "/mobile" itself —
 *  returning it would bounce straight back here and spin forever. Returns null
 *  for admins, meaning "render Home normally". */
function mobileHomeRedirect() {
  const perms = getPermissions();
  if (perms.manageAccounts) return null; // admin — Home is theirs
  const hit = MOBILE_FALLBACK_ORDER.filter((r) => r.path !== "/mobile").find((r) => perms[r.perm]);
  return hit ? hit.path : "/mobile/profile"; // profile is never gated
}

function firstAllowedRoute(perms, mode) {
  const order = mode === "mobile" ? MOBILE_FALLBACK_ORDER : DESKTOP_FALLBACK_ORDER;
  const hit = order.find((r) => perms[r.perm]);
  if (hit) return hit.path;
  return mode === "mobile" ? "/mobile/profile" : "/settings";
}

/** Auto-pick desktop vs. mobile straight from the account's own permissions
 *  (no more manual "Sign in" vs. "Login for Mobile" choice on the login
 *  page):
 *   - Only mobileView perms granted  -> mobile.
 *   - Only desktopView perms granted -> desktop.
 *   - Both granted                   -> whichever the CURRENT viewport
 *     suggests (>768px desktop, otherwise mobile) — matches the width
 *     MobileLayout/tokens.css already treat as the mobile breakpoint.
 *   - Neither granted                -> desktop, same safe default as
 *     before (lands on /settings via firstAllowedRoute's own fallback).
 *  "Single-feature restricted" accounts fall out of this for free: if only
 *  one permission in the chosen mode's list is true, firstAllowedRoute's
 *  ordered walk lands directly on that one page. */
function pickModeFromPermissions(perms) {
  const hasDesktop = DESKTOP_FALLBACK_ORDER.some((r) => perms[r.perm]);
  const hasMobile = MOBILE_FALLBACK_ORDER.some((r) => perms[r.perm]);
  if (hasDesktop && hasMobile) return window.innerWidth <= 768 ? "mobile" : "desktop";
  if (hasMobile) return "mobile";
  return "desktop";
}

function pickHomeRoute() {
  const mode = getUiMode();
  return firstAllowedRoute(getPermissions(), mode);
}

/**
 * Route-level view gate. Renders `children` if the current account has
 * `perm`, otherwise bounces to the first route this account IS allowed —
 * never a hardcoded page, since that page could itself be gated off for
 * this same account. `mode` picks which fallback ladder (desktop vs mobile)
 * to walk; see DESKTOP_FALLBACK_ORDER / MOBILE_FALLBACK_ORDER above.
 */
function ViewGate({ perm, mode = "desktop", children }) {
  const perms = getPermissions();
  if (perms[perm]) return children;
  return <Navigate to={firstAllowedRoute(perms, mode)} replace />;
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

  // `mode` ("desktop" or "mobile") is no longer a button the user clicks —
  // pickModeFromPermissions derives it from the account's own permissions
  // (see that function's doc comment). Persisted (see setUiMode) so a later
  // already-authenticated visit to "/" lands in the same place without
  // re-deriving it.
  const handleSignIn = () => {
    setAuthed(true);
    const perms = getPermissions();
    const mode = pickModeFromPermissions(perms);
    setUiMode(mode);
    // If we got bounced to /login from a specific URL (e.g. someone opened a
    // deep link like /mobile/attendance?status=MISSING while logged out, or a
    // stale token silently expired while they were on some page), go back to
    // exactly that page — but ONLY if it's a real deep link: in the same
    // namespace as the mode just derived, AND not one of the two neutral
    // catch-all fallbacks (/settings, /mobile/profile). Those two are where
    // an unauthenticated visit to ANY unmatched path lands via the wildcard
    // route below, so treating them as a meaningful "from" would silently
    // override the whole point of auto-routing — e.g. a mobile-only account
    // whose session lapsed while a desktop tab happened to be sitting on
    // /settings would otherwise get sent right back to /settings instead of
    // their actual mobile home.
    const NEUTRAL_FALLBACKS = ["/settings", "/mobile/profile"];
    const from = location.state?.from;
    const fromMatchesMode =
      from && from !== "/login" && !NEUTRAL_FALLBACKS.includes(from) &&
      from.startsWith("/mobile") === (mode === "mobile");
    if (fromMatchesMode) {
      navigate(from, { replace: true });
      return;
    }
    navigate(firstAllowedRoute(perms, mode), { replace: true });
  };

  if (!authed) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage onSignIn={handleSignIn} />} />
        {/* Self-service registration (2026-07-24) — public, like /login. New
            accounts start "pending" and can't sign in until an admin
            approves them on Account control, so this never sets `authed`. */}
        <Route path="/register" element={<RegisterPage />} />
        {/* Passwordless entrance-kiosk scanner — reachable with NO auth at
            all, in both the logged-out and logged-in route trees (see the
            matching entry below). Deliberately registered OUTSIDE Layout/
            MobileLayout so it renders with zero nav chrome — see
            KioskScannerPage.jsx's own header comment for the full design:
            it mints its own short-lived, narrowly-scoped kiosk token
            in-memory (never touches getToken()/localStorage, so `authed`
            here is completely unaffected by visiting this route). */}
        <Route path="/kiosk-scan" element={<KioskScannerPage />} />
        {/* Public delegate self-enrollment (Vimal) — no login, like the kiosk. */}
        <Route path="/enroll" element={<EnrollPage />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: location.pathname }} />} />
      </Routes>
    );
  }

  return (
    <Routes>
      {/* Same passwordless kiosk route, reachable even while a normal staff
          session is authenticated (e.g. a staff member opens it on a shared
          kiosk device without wanting to log that specific device in) — no
          Layout/MobileLayout wrapper, so no sidebar/tab bar leaks in either
          way. */}
      <Route path="/kiosk-scan" element={<KioskScannerPage />} />
      {/* Public delegate self-enrollment — reachable while authed too, no chrome. */}
      <Route path="/enroll" element={<EnrollPage />} />

      <Route element={<Layout onLogout={handleLogout} />}>
        <Route index element={<Navigate to={pickHomeRoute()} replace />} />

        {/* Jun Qi — Admin Dashboard & Analytics (Screen 2). View-gated —
            an account with viewDashboard unchecked never sees it, same as
            every other route below (see permissions.js's "desktopView"
            group and ViewGate above). */}
        <Route path="/dashboard" element={<ViewGate perm="viewDashboard"><DashboardPage /></ViewGate>} />

        {/* Desmond — Trip Booking & Dynamic Coach Management (Screen 3) */}
        <Route path="/announcements" element={<ViewGate perm="viewAnnouncements"><AnnouncementsPage /></ViewGate>} />

        <Route path="/trips" element={<ViewGate perm="viewTrips"><TripCoachPage /></ViewGate>} />

        {/* Vance — AI Document Parsing & Onboarding (Screen 4) — FULL.
            View access is viewDocuments (can this account even SEE the
            page); the actual parse/confirm writes are separately gated by
            manageDelegates inside OnboardingPage.jsx / the backend routes —
            an account can be able to look at boarding passes without being
            able to bulk-create delegates. */}
        <Route path="/onboarding" element={<ViewGate perm="viewDocuments"><OnboardingPage /></ViewGate>} />

        {/* Jayden — Exception Logging & QR Fallback (Screen 5) */}
        <Route path="/exceptions" element={<ViewGate perm="viewExceptions"><ExceptionInboxPage /></ViewGate>} />

        {/* Vance — AI Trip Assistant (Screen 6) — now a floating bubble
            (ChatBubble.jsx, rendered from Layout.jsx on every route)
            instead of a dedicated destination; no route needed. */}

        {/* Biometric enrolment (Vimal) — the in-app counterpart to the public
            /enroll link. Staff can enrol a delegate's face/voice at the desk;
            delegates can still self-enrol from the public page. Gated on the
            same viewScanner permission as the scanner it feeds. */}
        <Route
          path="/enrolment"
          element={
            <ViewGate perm="viewScanner">
              <div className="page">
                <div className="page-eyebrow">FaceCheck Pro</div>
                <h1 className="page-title">Biometric enrolment</h1>
                <p className="page-sub" style={{ marginBottom: 20 }}>
                  Capture a delegate's face and voiceprint so the scanners can recognise them.
                  Delegates can also self-enrol at <strong>/enroll</strong> before the trip.
                </p>
                <EnrollPage embedded />
              </div>
            </ViewGate>
          }
        />

        {/* Unified desktop scanner (Face + QR + Manual) — an entrance-kiosk
            page hosting all three real check-in paths on one screen.
            Temporarily hidden (2026-07-27, "hide this page for now, don't
            show it on frontend") — redirects to the dashboard instead of
            rendering, so even a direct /scanner visit doesn't show it while
            the sidebar link is also commented out (Sidebar.jsx). Restore by
            swapping this back to <ViewGate perm="viewScanner"><UnifiedScannerPage /></ViewGate>. */}
        <Route path="/scanner" element={<Navigate to="/dashboard" replace />} />

        {/* Account control — needs the manage-accounts permission. Kept on
            manageAccounts (an action permission), NOT folded into the
            desktopView group — only a real admin should ever be able to
            grant/revoke everyone else's access, so this one stays a
            capability check, not a per-account view toggle another staff
            member could be handed. */}
        <Route
          path="/accounts"
          element={
            getPermissions().manageAccounts
              ? <AccountControlPage />
              : <Navigate to={pickHomeRoute()} replace />
          }
        />

        {/* Staff Operations lives INSIDE DashboardPage.jsx as an admin-only
            tab (manageAccounts) — not a separate route, so admins see it
            without leaving the Dashboard. */}

        {/* History log — standalone audit trail (date-grouped activity_log),
            reached from the Dashboard's History tracker card */}
        <Route path="/history" element={<ViewGate perm="viewHistory"><HistoryLogPage /></ViewGate>} />

        {/* MusterChat — Vance's full inbox (AI assistant + team messaging +
            video calls), integrated 2026-07-27. Not in the sidebar: the
            floating ChatBubble's unread badge/"open Messages" bar links here.
            Gated on the same viewChatbot permission that gates the bubble. */}
        <Route path="/assistant" element={<ViewGate perm="viewChatbot"><ChatAssistantPage /></ViewGate>} />

        {/* Settings — signed-in account info + theme/language preferences */}
        <Route path="/settings" element={<SettingsPage />} />

        {/* User guide — onboarding walkthrough + delegate status explainer,
            open to any signed-in user (no permission gate — it's for people
            brand new to the app, regardless of what they're allowed to edit) */}
        <Route path="/guide" element={<UserGuidePage />} />

        <Route path="*" element={<Navigate to={pickHomeRoute()} replace />} />
      </Route>

      {/* Mobile UI — responsive pages with their own bottom-tab layout.
          View-gated the same way as desktop (see permissions.js's
          "mobileView" group) — /mobile/profile stays ungated, it's account
          settings, not a feature view. */}
      <Route element={<MobileLayout onLogout={handleLogout} />}>
        {/* Home = admin overview. Staff are sent straight to Operations (or
            the first view they do have) — see mobileHomeRedirect(). */}
        <Route
          path="/mobile"
          element={
            mobileHomeRedirect()
              ? <Navigate to={mobileHomeRedirect()} replace />
              : <ViewGate perm="viewMobileHome" mode="mobile"><MobileHomePage /></ViewGate>
          }
        />
        {/* Trips and Attendance are one combined "Operations" destination.
            Both paths are kept so existing deep links (e.g. Home's KPI tiles
            linking to /mobile/attendance?status=MISSING) still work — they
            just open the combined page with the matching view selected. */}
        <Route path="/mobile/attendance" element={<ViewGate perm="viewMobileAttendance" mode="mobile"><MobileOpsPage defaultView="delegates" /></ViewGate>} />
        <Route path="/mobile/trips" element={<ViewGate perm="viewMobileTrips" mode="mobile"><MobileOpsPage defaultView="trips" /></ViewGate>} />
        {/* Dedicated Issues page (2026-07-20) — was an inline accordion on
            Mobile Home. Gated behind viewMobileIssues (2026-07-21) so an
            admin can hide it per-account, same as every other mobile view. */}
        <Route path="/mobile/issues" element={<ViewGate perm="viewMobileIssues" mode="mobile"><MobileIssuesPage /></ViewGate>} />
        {/* Mobile scanner (Face + QR + Manual) — the mobile port of the
            desktop /scanner page, reached from WITHIN the logged-in mobile
            app (e.g. a staff member navigating here manually). Auth-only,
            NOT view-gated — any signed-in staff/admin can scan, matching the
            original ungated check-in philosophy. Distinct from the
            passwordless /kiosk-scan (KioskScannerPage.jsx, outside this
            Route tree entirely) — that one is the Login page's "Quick
            Scanner Access" target and needs no session at all; this one is
            for someone already using the app who just wants the scanner. */}
        <Route path="/mobile/scanner" element={<ViewGate perm="viewMobileScanner" mode="mobile"><MobileScannerPage /></ViewGate>} />
        {/* Face and QR are their own bottom-nav tabs. Same page, pinned to one
            scanner via lockMode (which also hides the in-page mode switcher);
            /mobile/scanner above keeps the original combined toggle. */}
        <Route path="/mobile/scan/face" element={<ViewGate perm="viewMobileScanner" mode="mobile"><MobileScannerPage lockMode="face" /></ViewGate>} />
        <Route path="/mobile/scan/qr" element={<ViewGate perm="viewMobileScanner" mode="mobile"><MobileScannerPage lockMode="qr" /></ViewGate>} />
        <Route path="/mobile/profile" element={<MobileProfilePage />} />
        {/* Mobile-dedicated User Guide (2026-07-21) — fixes a routing defect
            where MobileProfilePage's "User guide" button used to send you to
            the shared desktop /guide route, which only lives inside the
            DESKTOP Layout's Route group — opening it on mobile rendered the
            desktop sidebar/chrome around the content. This route lives here
            instead, so it gets the normal mobile topbar + tab bar. Ungated,
            same as /guide — a help resource open to any signed-in account. */}
        <Route path="/mobile-user-guide" element={<MobileUserGuidePage />} />
      </Route>
    </Routes>
  );
}
