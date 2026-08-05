/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — the router, shared by every teammate's pages
 *
 *  TEAMMATES: add your own <Route>s here as you build pages — that part is
 *  safe and expected. Don't restructure ViewGate/firstAllowedRoute/the
 *  fallback-order arrays without flagging JQ first, since every route in the
 *  app (yours included) goes through them.
 * ============================================================================= */
import { useState } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import { getToken, clearToken, getPermissions, getUser, apiPost } from "./lib/api.js";

// Vance — fully built
import LoginPage from "./pages/LoginPage.jsx";
import RegisterPage from "./pages/RegisterPage.jsx";
import OnboardingPage from "./pages/desktop/document/OnboardingPage.jsx";

// Scaffolds — owned by teammates
import DashboardPage from "./pages/desktop/dashboard/DashboardPage.jsx";
import AnnouncementsPage from "./pages/desktop/announcements/AnnouncementsPage.jsx";
import TripCoachPage from "./pages/desktop/trip/TripCoachPage.jsx";
import ExceptionInboxPage from "./pages/desktop/ExceptionInboxPage.jsx";
import AccountControlPage from "./pages/desktop/accountcontrol/AccountControlPage.jsx";
import SettingsPage from "./pages/desktop/SettingsPage.jsx";
import HistoryLogPage from "./pages/desktop/dashboard/HistoryLogPage.jsx";
import UserGuidePage from "./pages/desktop/userguide/UserGuidePage.jsx";
import ChatAssistantPage from "./pages/desktop/ChatAssistantPage.jsx";

// Mobile UI — responsive pages, own layout/nav
import MobileLayout from "./pages/mobile/MobileLayout.jsx";
import MobileHomePage from "./pages/mobile/home/MobileHomePage.jsx";
// MobileAttendancePage / MobileTripsPage are intentionally NOT imported — both
// are reached only through MobileOpsPage's Delegates/Trips switch.
import MobileOpsPage from "./pages/mobile/ops/MobileOpsPage.jsx";
import MobileProfilePage from "./pages/mobile/me/MobileProfilePage.jsx";
import MobileIssuesPage from "./pages/mobile/ops/MobileIssuesPage.jsx";
import MobileExceptionsPage from "./pages/mobile/ops/MobileExceptionsPage.jsx";
import MobileUserGuidePage from "./pages/mobile/me/MobileUserGuidePage.jsx";
import MobileAnnouncementsPage from "./pages/mobile/home/MobileAnnouncementsPage.jsx";
import MobileEnrolmentPage from "./pages/mobile/face/MobileEnrolmentPage.jsx";
// Vimal — public delegate self-enrollment app (face/voice capture)
import EnrollPage from "./pages/EnrollPage.jsx";
import BadgePage from "./pages/BadgePage.jsx"; // Vance — public flip-card badge (from emailed pass)

// Which UI to land in — derived from permissions at login (see
// pickModeFromPermissions), never chosen by the user. Persisted so an already-
// authenticated visit to "/" lands where login would have sent them.
const UI_MODE_KEY = "mg_ui_mode";

function getUiMode() {
  try { return localStorage.getItem(UI_MODE_KEY) || "desktop"; } catch { return "desktop"; }
}
function setUiMode(mode) {
  try { localStorage.setItem(UI_MODE_KEY, mode); } catch { /* ignore */ }
}
// Ordered fallbacks for "the route you wanted is gated off — where instead?"
// Walked in priority order. /settings and /mobile/profile are never gated, so
// an account with every view unchecked still lands somewhere.
const DESKTOP_FALLBACK_ORDER = [
  { path: "/dashboard", perm: "viewDashboard" },
  { path: "/announcements", perm: "viewAnnouncements" },
  { path: "/trips", perm: "viewTrips" },
  { path: "/onboarding", perm: "viewDocuments" },
  // No "/scanner": that route unconditionally redirects to /dashboard, and the
  // viewScanner permission no longer exists.
  { path: "/exceptions", perm: "viewExceptions" },
  { path: "/history", perm: "viewHistory" },
];
const MOBILE_FALLBACK_ORDER = [
  { path: "/mobile", perm: "viewMobileHome" },
  { path: "/mobile/operations", perm: "viewMobileAttendance" },
  { path: "/mobile/trips", perm: "viewMobileTrips" },
  { path: "/mobile/issues", perm: "viewMobileIssues" },
];

/** Returns the first mobile route this account CAN see, or null meaning "render
 *  Home normally". MUST exclude "/mobile" itself or it bounces back here and
 *  spins forever.
 *
 *  Gate on viewMobileHome only — the same permission the tab bar uses. Do NOT
 *  redirect every non-admin: a captain assigned to a real coach needs Home. */
function mobileHomeRedirect() {
  const perms = getPermissions();
  if (perms.viewMobileHome) return null;
  const hit = MOBILE_FALLBACK_ORDER.filter((r) => r.path !== "/mobile").find((r) => perms[r.perm]);
  return hit ? hit.path : "/mobile/profile"; // profile is never gated
}

function firstAllowedRoute(perms, mode) {
  const order = mode === "mobile" ? MOBILE_FALLBACK_ORDER : DESKTOP_FALLBACK_ORDER;
  const hit = order.find((r) => perms[r.perm]);
  if (hit) return hit.path;
  return mode === "mobile" ? "/mobile/profile" : "/settings";
}

/** Desktop vs. mobile, from permissions alone (there is no manual choice on
 *  the login page): only-mobile -> mobile, only-desktop -> desktop, both ->
 *  whichever the viewport suggests (768px, matching MobileLayout/tokens.css),
 *  neither -> desktop as the safe default. Single-feature accounts fall out for
 *  free via firstAllowedRoute's ordered walk. */
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
 * Route-level view gate. Bounces to the first route this account IS allowed —
 * never a hardcoded page, which could itself be gated off for this account.
 * `mode` picks which fallback ladder to walk.
 */
function ViewGate({ perm, mode = "desktop", children }) {
  const perms = getPermissions();
  if (perms[perm]) return children;
  return <Navigate to={firstAllowedRoute(perms, mode)} replace />;
}

/**
 * Legacy-URL redirect that KEEPS the query string — a plain <Navigate> drops
 * `?status=MISSING`, silently breaking old bookmarks.
 */
function RedirectPreservingQuery({ to }) {
  const { search } = useLocation();
  return <Navigate to={`${to}${search}`} replace />;
}

/**
 * Whole-platform gates wrapping the entire desktop/mobile route trees.
 * pickModeFromPermissions only runs AT login, so without these an account with
 * zero mobile permissions could still reach a mobile URL via a bookmark, a
 * stale tab, a typed address, or mid-session revocation. These re-check on
 * every navigation and deliberately never read window.innerWidth, so the rule
 * holds structurally rather than by accident of viewport size.
 *
 * The condition MUST be `!hasThisMode && hasOtherMode`, not just
 * `!hasThisMode`: an account with no view permission on either platform would
 * ping-pong forever between /settings and /mobile/profile. Only redirect when
 * there is an actual destination on the other side.
 */
function RequireDesktopMode({ children }) {
  const perms = getPermissions();
  const hasDesktop = DESKTOP_FALLBACK_ORDER.some((r) => perms[r.perm]);
  const hasMobile = MOBILE_FALLBACK_ORDER.some((r) => perms[r.perm]);
  if (!hasDesktop && hasMobile) return <Navigate to={firstAllowedRoute(perms, "mobile")} replace />;
  return children;
}
function RequireMobileMode({ children }) {
  const perms = getPermissions();
  const hasMobile = MOBILE_FALLBACK_ORDER.some((r) => perms[r.perm]);
  const hasDesktop = DESKTOP_FALLBACK_ORDER.some((r) => perms[r.perm]);
  if (!hasMobile && hasDesktop) return <Navigate to={firstAllowedRoute(perms, "desktop")} replace />;
  return children;
}

/**
 * Top-level router. Auth comes from the saved JWT (lib/api.js); initialising
 * `authed` from the stored token is what makes a refresh keep you signed in.
 */
export default function App() {
  const [authed, setAuthed] = useState(() => !!getToken());
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    // Clears last_seen_at so Staff Operations' "active now" list drops this
    // account immediately rather than after 45s. MUST fire before clearToken()
    // wipes the JWT it authenticates with. Best-effort — logout proceeds
    // regardless.
    apiPost("/auth/logout", {}).catch(() => {});
    clearToken();
    setAuthed(false);
  };

  // `mode` is derived, not clicked — see pickModeFromPermissions.
  const handleSignIn = () => {
    setAuthed(true);
    const perms = getPermissions();
    const mode = pickModeFromPermissions(perms);
    setUiMode(mode);
    // Return to the URL we were bounced from, but ONLY if it's a real deep
    // link: same namespace as the derived mode, and NOT one of the two neutral
    // catch-alls. The wildcard route below dumps every unmatched unauthenticated
    // path onto those two, so honouring them as "from" would defeat
    // auto-routing (a mobile-only account whose session lapsed on a desktop
    // /settings tab would be sent back to /settings, not their mobile home).
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
        {/* Public, like /login. New accounts start "pending" until an admin
            approves them, so this never sets `authed`. */}
        <Route path="/register" element={<RegisterPage />} />
        {/* Public delegate self-enrollment (Vimal) — no login. */}
        <Route path="/enroll" element={<EnrollPage />} />
        {/* Public flip-card badge from the emailed boarding pass (Vance) — no auth. */}
        <Route path="/badge/:code" element={<BadgePage />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: location.pathname }} />} />
      </Routes>
    );
  }

  return (
    <Routes>
      {/* Public delegate self-enrollment — reachable while authed too, no chrome. */}
      <Route path="/enroll" element={<EnrollPage />} />
      <Route path="/badge/:code" element={<BadgePage />} />

      <Route element={<RequireDesktopMode><Layout onLogout={handleLogout} /></RequireDesktopMode>}>
        <Route index element={<Navigate to={pickHomeRoute()} replace />} />

        {/* Jun Qi — Admin Dashboard & Analytics (Screen 2) */}
        <Route path="/dashboard" element={<ViewGate perm="viewDashboard"><DashboardPage /></ViewGate>} />

        {/* Desmond — Trip Booking & Dynamic Coach Management (Screen 3) */}
        <Route path="/announcements" element={<ViewGate perm="viewAnnouncements"><AnnouncementsPage /></ViewGate>} />

        <Route path="/trips" element={<ViewGate perm="viewTrips"><TripCoachPage /></ViewGate>} />

        {/* Vance — AI Document Parsing & Onboarding (Screen 4). viewDocuments
            only controls SEEING the page; the parse/confirm writes are
            separately gated on manageDelegates inside OnboardingPage.jsx and
            the backend routes. */}
        <Route path="/onboarding" element={<ViewGate perm="viewDocuments"><OnboardingPage /></ViewGate>} />

        {/* Jayden — Exception Logging & QR Fallback (Screen 5) */}
        <Route path="/exceptions" element={<ViewGate perm="viewExceptions"><ExceptionInboxPage /></ViewGate>} />

        {/* Vance — AI Trip Assistant (Screen 6) is a floating bubble
            (ChatBubble.jsx, rendered from Layout.jsx), so no route. */}

        {/* The desktop /enrolment page is gone on purpose — enrolment is its
            own app (Vimal). The public /enroll route still exists, invite
            emails point there, and staff manage coverage from
            /mobile/enrolment. Old bookmarks hit the catch-all below. */}

        {/* UnifiedScannerPage.jsx (the desktop Face+QR+Manual kiosk) and the
            viewScanner permission are both deleted; the mobile scanner has its
            own independent imports of the shared face/QR libs. This route only
            keeps old /scanner bookmarks working. A desktop kiosk scanner would
            have to be built fresh. */}
        <Route path="/scanner" element={<Navigate to="/dashboard" replace />} />

        {/* Deliberately gated on manageAccounts (an ACTION permission), not
            folded into the desktopView group — granting/revoking everyone
            else's access must stay a capability check, not a view toggle
            another staff member could be handed. */}
        <Route
          path="/accounts"
          element={
            getPermissions().manageAccounts || (getUser()?.role === "admin" && getUser()?.readOnly)
              ? <AccountControlPage />
              : <Navigate to={pickHomeRoute()} replace />
          }
        />

        {/* Staff Operations is an admin-only tab INSIDE DashboardPage.jsx
            (manageAccounts), not a route. */}

        {/* History log — standalone audit trail (date-grouped activity_log),
            reached from the Dashboard's History tracker card */}
        <Route path="/history" element={<ViewGate perm="viewHistory"><HistoryLogPage /></ViewGate>} />

        {/* MusterChat — Vance's full inbox (AI + messaging + video). Not in the
            sidebar; reached from the floating ChatBubble, and gated on the same
            viewChatbot permission as the bubble. */}
        <Route path="/assistant" element={<ViewGate perm="viewChatbot"><ChatAssistantPage /></ViewGate>} />

        {/* Settings — signed-in account info + theme/language preferences */}
        <Route path="/settings" element={<SettingsPage />} />

        {/* User guide — intentionally ungated: it's for people brand new to
            the app, regardless of what they can edit. */}
        <Route path="/guide" element={<UserGuidePage />} />

        <Route path="*" element={<Navigate to={pickHomeRoute()} replace />} />
      </Route>

      {/* Mobile UI — own bottom-tab layout, view-gated like desktop.
          /mobile/profile stays ungated: account settings, not a feature. */}
      <Route element={<RequireMobileMode><MobileLayout onLogout={handleLogout} /></RequireMobileMode>}>
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
        {/* Trips and Attendance are one combined "Operations" page; both paths
            are kept so deep links like ?status=MISSING still work, and
            /mobile/attendance redirects below rather than 404ing. The
            permission key stays "viewMobileAttendance" — renaming it would mean
            migrating every account's stored permissions JSON for a cosmetic
            URL change. */}
        <Route path="/mobile/operations" element={<ViewGate perm="viewMobileAttendance" mode="mobile"><MobileOpsPage defaultView="delegates" /></ViewGate>} />
        <Route path="/mobile/attendance" element={<RedirectPreservingQuery to="/mobile/operations" />} />
        <Route path="/mobile/trips" element={<ViewGate perm="viewMobileTrips" mode="mobile"><MobileOpsPage defaultView="trips" /></ViewGate>} />
        {/* Issues, gated on viewMobileIssues so admins can hide it
            per-account like every other mobile view. */}
        <Route path="/mobile/issues" element={<ViewGate perm="viewMobileIssues" mode="mobile"><MobileIssuesPage /></ViewGate>} />
        {/* Jayden's mobile exception INBOX — deliberately its own route, NOT a
            replacement for /mobile/issues: that one is the log-a-ticket form
            plus a coach's open list, this is the trip-wide inbox with
            resolve/override/priority. Shares the viewMobileIssues gate so no
            new permission or per-account reconfiguring is needed. */}
        <Route path="/mobile/exceptions" element={<ViewGate perm="viewMobileIssues" mode="mobile"><MobileExceptionsPage /></ViewGate>} />
        {/* The quick QR/Face/Manual scanner and the passwordless /kiosk-scan
            entrance scanner were both removed (2026-08-05, on request — they
            let a scan bypass admin approval). Enrolment below still uses the
            viewMobileScannerFace permission key so existing accounts' stored
            permissions don't need migrating; it just no longer has a sibling
            scanner route to share the name with.

            Announcements MUST stay on the same permission as its desktop
            counterpart — leaving these ungated (as Vimal's branch did) lets any
            signed-in account read announcements and send enrolment invites. */}
        <Route path="/mobile/announcements" element={<ViewGate perm="viewAnnouncements" mode="mobile"><MobileAnnouncementsPage /></ViewGate>} />
        <Route path="/mobile/enrolment" element={<ViewGate perm="viewMobileScannerFace" mode="mobile"><MobileEnrolmentPage /></ViewGate>} />
        <Route path="/mobile/profile" element={<MobileProfilePage />} />
        {/* Must stay in THIS Route group: /guide lives inside the desktop
            Layout, so linking mobile at it rendered the desktop sidebar around
            the content. Ungated, same as /guide. */}
        <Route path="/mobile-user-guide" element={<MobileUserGuidePage />} />
      </Route>
    </Routes>
  );
}
