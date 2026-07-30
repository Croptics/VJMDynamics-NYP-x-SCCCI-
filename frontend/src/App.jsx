import { useState } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import { getToken, clearToken, getPermissions, getUser, apiPost } from "./lib/api.js";

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
// MobileAttendancePage / MobileTripsPage are NOT imported here any more — both
// are reached only through MobileOpsPage, which composes them behind its
// Delegates/Trips switch. They were left as unused imports when the Ops screen
// took over both routes (2026-07-29 cleanup).
import MobileOpsPage from "./pages/mobile/MobileOpsPage.jsx";
import MobileProfilePage from "./pages/mobile/MobileProfilePage.jsx";
import MobileIssuesPage from "./pages/mobile/MobileIssuesPage.jsx";
import MobileExceptionsPage from "./pages/mobile/MobileExceptionsPage.jsx";
import MobileScannerPage from "./pages/mobile/MobileScannerPage.jsx";
import MobileUserGuidePage from "./pages/mobile/MobileUserGuidePage.jsx";
import MobileAnnouncementsPage from "./pages/mobile/MobileAnnouncementsPage.jsx";
import MobileEnrolmentPage from "./pages/mobile/MobileEnrolmentPage.jsx";
import KioskScannerPage from "./pages/KioskScannerPage.jsx";
// Vimal — public delegate self-enrollment app (face/voice capture)
import EnrollPage from "./pages/EnrollPage.jsx";
import BadgePage from "./pages/BadgePage.jsx"; // Vance — public flip-card badge (from emailed pass)

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
  { path: "/mobile/operations", perm: "viewMobileAttendance" },
  { path: "/mobile/trips", perm: "viewMobileTrips" },
  // Was "/mobile/scanner" until 2026-07-29; that route no longer exists, so the
  // fallback points at the QR scanner (the primary/centre tab) instead — an
  // account whose only permission is viewMobileScanner still lands somewhere real.
  { path: "/mobile/scan/qr", perm: "viewMobileScanner" },
  { path: "/mobile/issues", perm: "viewMobileIssues" },
];

/** Mobile Home is an admin-only overview. For anyone else this returns the
 *  first mobile route they CAN see, deliberately excluding "/mobile" itself —
 *  returning it would bounce straight back here and spin forever. Returns null
 *  for admins, meaning "render Home normally". */
// Only redirects away from "/mobile" when the account genuinely lacks
// viewMobileHome (same permission the tab bar gates on) — it used to also
// redirect every non-admin regardless of that permission (2026-07-30 — "i
// assigned staff_3 to coach 1... but on mobile ui i can't see home page? i
// should still be able to see"), on the theory that Home was an admin-only
// overview. A captain assigned to a real coach needs their own Home too.
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
 * Legacy-URL redirect that keeps the query string (2026-07-30, the
 * /mobile/attendance -> /mobile/operations rename) — a plain `<Navigate>`
 * drops `?status=MISSING` entirely, which would silently break any old
 * bookmark/link that relied on it.
 */
function RedirectPreservingQuery({ to }) {
  const { search } = useLocation();
  return <Navigate to={`${to}${search}`} replace />;
}

/**
 * Whole-platform gates — wrap the entire desktop `<Layout>` / mobile
 * `<MobileLayout>` route trees (2026-07-29 — "when i didn't select either
 * desktop web view, login will lead me to mobile regardless if it in mobile
 * responsive... same for mobile view, if [not] selected [I'm] not able to
 * access desktop or mobile depending on which i didn't select").
 *
 * `pickModeFromPermissions` (above) already derives "desktop or mobile" this
 * same way, but ONLY at the moment of login — it decides where to send you
 * once, then `mg_ui_mode` just persists that choice. Nothing stopped an
 * account with zero mobile permissions from still reaching a mobile URL via a
 * bookmark, a stale open tab, a manually-typed address, or an admin revoking
 * their mobile access mid-session — any of those would land them on
 * `firstAllowedRoute`'s neutral fallback (`/settings` or `/mobile/profile`)
 * rather than being moved to the platform they actually belong on. These make
 * that a STANDING rule, re-checked on every navigation, not just at sign-in —
 * and they never look at `window.innerWidth`, so "regardless of mobile
 * responsive" holds structurally, not just by accident of viewport size.
 *
 * The redirect condition is deliberately `!hasThisMode && hasOtherMode`, NOT
 * just `!hasThisMode`: an account with NO view permission on EITHER platform
 * has nowhere correct to go, and redirecting it anyway would ping-pong it
 * forever between `/settings` (desktop's gate sends it to mobile because it
 * has no desktop perms) and `/mobile/profile` (mobile's gate sends it right
 * back because it has no mobile perms either). Only redirect when there's an
 * ACTUAL destination on the other side; a zero-permission account keeps
 * today's existing behaviour (settles on desktop's neutral /settings).
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
    // deep link like /mobile/operations?status=MISSING while logged out, or a
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
        {/* Public flip-card badge from the emailed boarding pass (Vance) — no auth. */}
        <Route path="/badge/:code" element={<BadgePage />} />
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
      <Route path="/badge/:code" element={<BadgePage />} />

      <Route element={<RequireDesktopMode><Layout onLogout={handleLogout} /></RequireDesktopMode>}>
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
        {/* The desktop /enrolment page was REMOVED 2026-07-29 ("this page can be
            removed from desktop"), matching Vimal's "enrolment is its own app"
            decision. Nothing biometric is lost: the standalone delegate-facing
            app at /enroll is still routed (public + authed), the emailed invite
            links point there, and staff manage coverage/invites from
            /mobile/enrolment. Anyone with the old URL bookmarked now falls
            through to the catch-all redirect below. */}

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
            getPermissions().manageAccounts || (getUser()?.role === "admin" && getUser()?.readOnly)
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
        {/* Trips and Attendance are one combined "Operations" destination.
            Both paths are kept so existing deep links (e.g. Home's KPI tiles
            linking to /mobile/operations?status=MISSING) still work — they
            just open the combined page with the matching view selected.
            2026-07-30 ("change the url from /attendance to /operations") —
            renamed from /mobile/attendance; /mobile/attendance itself is kept
            as a redirect below so any old bookmark/link still lands somewhere
            real instead of 404ing. The underlying permission key stays
            "viewMobileAttendance" — renaming that would mean migrating every
            account's stored permissions JSON for a URL-only cosmetic change. */}
        <Route path="/mobile/operations" element={<ViewGate perm="viewMobileAttendance" mode="mobile"><MobileOpsPage defaultView="delegates" /></ViewGate>} />
        <Route path="/mobile/attendance" element={<RedirectPreservingQuery to="/mobile/operations" />} />
        <Route path="/mobile/trips" element={<ViewGate perm="viewMobileTrips" mode="mobile"><MobileOpsPage defaultView="trips" /></ViewGate>} />
        {/* Dedicated Issues page (2026-07-20) — was an inline accordion on
            Mobile Home. Gated behind viewMobileIssues (2026-07-21) so an
            admin can hide it per-account, same as every other mobile view. */}
        <Route path="/mobile/issues" element={<ViewGate perm="viewMobileIssues" mode="mobile"><MobileIssuesPage /></ViewGate>} />
        {/* Jayden's mobile exception INBOX (2026-07-29 integration) — his new
            page arrived unrouted, so nothing could reach it. Deliberately its
            own route rather than replacing /mobile/issues above: his file
            header is explicit that the two are different screens — /issues is
            the log-a-ticket form plus that coach's open list, this is the full
            trip-wide inbox with resolve/override/priority actions. Shares the
            viewMobileIssues gate since it's the same subject matter, so no new
            permission (and no per-account re-configuring) is needed. */}
        <Route path="/mobile/exceptions" element={<ViewGate perm="viewMobileIssues" mode="mobile"><MobileExceptionsPage /></ViewGate>} />
        {/* Mobile scanner (Face + QR + Manual) — the mobile port of the
            desktop /scanner page, reached from WITHIN the logged-in mobile
            app (e.g. a staff member navigating here manually). Auth-only,
            NOT view-gated — any signed-in staff/admin can scan, matching the
            original ungated check-in philosophy. Distinct from the
            passwordless /kiosk-scan (KioskScannerPage.jsx, outside this
            Route tree entirely) — that one is the Login page's "Quick
            Scanner Access" target and needs no session at all; this one is
            for someone already using the app who just wants the scanner. */}
        {/* /mobile/scanner (the legacy combined Face/QR/Manual toggle) was
            REMOVED 2026-07-29 — "already have it standalone". The three locked
            routes below fully replace it and are what the bottom nav points at.
            The page component is unchanged and still used by all three; only
            the unlocked entry point is gone, so an old bookmark now falls
            through to the mobile catch-all instead of showing a second,
            redundant scanner UI. */}
        <Route path="/mobile/scan/face" element={<ViewGate perm="viewMobileScanner" mode="mobile"><MobileScannerPage lockMode="face" /></ViewGate>} />
        <Route path="/mobile/scan/qr" element={<ViewGate perm="viewMobileScanner" mode="mobile"><MobileScannerPage lockMode="qr" /></ViewGate>} />
        {/* Manual check-in as its own locked mode (Vimal, taken 2026-07-29) —
            reached from inside the scanner screens rather than the tab bar. */}
        <Route path="/mobile/scan/manual" element={<ViewGate perm="viewMobileScanner" mode="mobile"><MobileScannerPage lockMode="manual" /></ViewGate>} />
        {/* Mobile Announcements + biometric-enrolment coverage/invites (Vimal,
            taken 2026-07-29). Gated on the SAME permissions as their desktop
            counterparts — his branch left both ungated, which would have let any
            signed-in account read announcements and send enrolment invites. */}
        <Route path="/mobile/announcements" element={<ViewGate perm="viewAnnouncements" mode="mobile"><MobileAnnouncementsPage /></ViewGate>} />
        <Route path="/mobile/enrolment" element={<ViewGate perm="viewMobileScanner" mode="mobile"><MobileEnrolmentPage /></ViewGate>} />
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
