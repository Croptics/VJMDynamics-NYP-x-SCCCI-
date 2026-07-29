import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Home, ClipboardList, User, Bus, ScanFace, QrCode } from "lucide-react";
import { getPermissions, apiGet } from "../../lib/api.js";
import { useLang } from "../../lib/i18n.jsx";
import { useSessionGuard } from "../../lib/useSessionGuard.js";
import MobileChatBubble from "./MobileChatBubble.jsx";
// Re-added after taking Vimal's mobile UI wholesale (2026-07-29). These three
// are FUNCTION, not styling, and his branch predates them:
//   EscalationBanner — the "delegate escalated to office" alert, every route.
//   SyncStatus       — the offline "N changes waiting to sync" pill. Without it
//                      the offline attendance queue still works but becomes
//                      invisible, which is worse than not having it.
//   getMobileTripId  — the mobile trip switcher; his `const TRIP_ID = "t-1"`
//                      silently pins the whole mobile app to the Beijing trip.
import EscalationBanner from "../../components/EscalationBanner.jsx";
import SyncStatus from "../../components/SyncStatus.jsx";
import { getMobileTripId } from "../../lib/mobileTrip.js";
import "../../styles/mobile.css";
// Light haptic tick on tab taps / actions — a native-app touch. No-op on
// desktop and iOS Safari (which don't implement the Vibration API).
const buzz = (ms = 8) => { try { navigator.vibrate && navigator.vibrate(ms); } catch { /* unsupported */ } };

/**
 * Mobile UI shell — bottom tab-bar layout for the responsive /mobile/* pages.
 * Parallel to (and independent of) the desktop Layout/Sidebar; touches no
 * desktop routes or styles.
 *
 * The standalone "Missing" tab was folded into Home (see MobileHomePage) so
 * first-time users have one obvious starting point instead of hunting across
 * tabs; this freed slot now points at the Attendance sheet instead.
 *
 * The former "Assistant" tab is now a floating chat bubble (MobileChatBubble,
 * rendered below on every /mobile/* route) instead of a dedicated
 * destination — that tab slot now points at Trips (currently a blank
 * placeholder, MobileTripsPage.jsx, for a teammate to build out).
 *
 * useSessionGuard() force-logs-out on an invalidated token — same hook the
 * desktop Layout uses. Previously only desktop had this, so logging in on
 * desktop invalidated a mobile session server-side (token_version bump) but
 * the mobile UI never noticed — it just kept failing every API call instead
 * of cleanly logging out.
 */
export default function MobileLayout({ onLogout }) {
  const { t } = useLang();

  useSessionGuard(onLogout);
  const perms = getPermissions();

  // Live tab badges + header context. Best-effort: the dashboard poll powers
  // the "missing" counter pill on the roster tab and the trip-context chip in
  // the header, but a failed fetch never breaks navigation — badges just
  // don't show. Same 5s cadence used across the mobile views.
  const [missing, setMissing] = useState(0);
  const [trip, setTrip] = useState(null);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const dash = await apiGet(`/trips/${getMobileTripId()}/dashboard`);
        if (!alive) return;
        setMissing(dash.kpis ? dash.kpis.missing || 0 : 0);
        setTrip(dash.trip || null);
      } catch { /* best-effort — leave badges as-is */ }
    }
    load();
    const id = setInterval(load, 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  // Same "mobileView" permission group as the /mobile/* route gates in
  // App.jsx — an account with a view unchecked doesn't see the tab either.
  // Profile stays ungated (account settings, not a feature view).
  // Home is the admin overview dashboard. On-ground staff don't need it —
  // their job starts at Operations (who's missing) and the scanners — so it's
  // gated on the admin capability as well as its own view permission.
  const isAdmin = !!perms.manageAccounts;

  const tabs = [
    ...(isAdmin && perms.viewMobileHome
      ? [{ to: "/mobile", label: "Home", icon: Home, end: true }] : []),
    // Trips + Attendance are ONE destination now (MobileOpsPage composes both).
    ...(perms.viewMobileAttendance || perms.viewMobileTrips
      ? [{ to: "/mobile/attendance", label: "Ops", icon: ClipboardList, badge: missing }] : []),
    // Face and QR are separate tabs rather than modes of one scanner screen.
    // QR leads (and sits dead-centre, flagged `primary` so it renders as the
    // raised action tab) because it's the fastest, most reliable check-in —
    // face is the premium path but needs good light and an enrolled delegate.
    // Manual is intentionally NOT a tab: it's the fallback you reach for when
    // a scan won't cooperate, so it lives one tap inside the scanner screens.
    ...(perms.viewMobileScanner
      ? [
          { to: "/mobile/scan/qr", label: "QR", icon: QrCode, primary: true },
          { to: "/mobile/scan/face", label: "Face", icon: ScanFace },
        ]
      : []),
    { to: "/mobile/profile", label: "Me", icon: User },
  ];

  const tripContext = trip
    ? [
        trip.name,
        trip.dayOf ? `${t("Day")} ${trip.dayOf}${trip.totalDays ? `/${trip.totalDays}` : ""}` : null,
        trip.departsIn ? `${t("dep")} ${trip.departsIn}` : null,
      ].filter(Boolean).join(" · ")
    : null;

  return (
    <div className="mobile-shell">
      <div className="mobile-topbar">
        <div className="row between">
          <span>MusterGo</span>
          {/* Theme + language toggles moved to the Profile ("Me") page —
              the topbar stays a clean brand + sync-status header. */}
          <span
            className="mobile-sync-chip"
            style={{
              background: online ? "var(--st-present-bg)" : "var(--st-missing-bg)",
              color: online ? "var(--st-present)" : "var(--st-missing)",
            }}
            title={online ? t("Synced to cloud") : t("Offline — changes saved locally")}
          >
            <span
              className={"mobile-sync-dot" + (online ? " pulse" : "")}
              style={{ background: online ? "var(--st-present)" : "var(--st-missing)" }}
            />
            {online ? t("Synced") : t("Offline")}
          </span>
        </div>
        {tripContext && (
          <div className="mobile-trip-chip">
            <Bus size={13} style={{ color: "var(--scc-red)", flexShrink: 0 }} />
            <span>{tripContext}</span>
          </div>
        )}
      </div>
      <div className="mobile-page">
        <EscalationBanner />
        <Outlet context={{ onLogout }} />
      </div>
      <nav className="mobile-tabbar" aria-label={t("Mobile navigation")}>
        {tabs.map(({ to, label, icon: Icon, end, badge, primary }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => buzz()}
            className={({ isActive }) => "mobile-tab" + (isActive ? " active" : "") + (primary ? " primary" : "")}
          >
            <span className="mobile-tab-icon">
              <Icon size={primary ? 22 : 20} />
              {badge > 0 && <span className="mobile-tab-badge">{badge > 99 ? "99+" : badge}</span>}
            </span>
            {t(label)}
          </NavLink>
        ))}
      </nav>
      {perms.viewMobileChatbot && <MobileChatBubble />}
      <SyncStatus />
    </div>
  );
}
