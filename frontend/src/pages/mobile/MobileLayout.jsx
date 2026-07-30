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

// trip.departsIn ("04:53") is a COUNTDOWN duration, not a clock time —
// reformatted as "4h 53m" rather than a 12h clock ("4:53 AM" would be a lie
// about what it means). 2026-07-30 — "do the same for these".
function fmtDepartsIn(hhmm) {
  if (!hhmm) return hhmm;
  const [h, m] = String(hhmm).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}
// Genuine live countdown (2026-07-30 — "i see this one nvr change, is it
// static?"). trip.departureAt is a real absolute instant computed
// server-side (getTrip(), db/dashboard.js). No separate ticker needed here —
// this component already re-fetches/re-renders every 5s (see the dashboard
// poll below), which is plenty for a countdown with no seconds shown. Returns
// null once departure has passed, so the chip disappears rather than
// counting into negative numbers.
function liveDepartsIn(departureAtIso) {
  if (!departureAtIso) return null;
  const diffMs = new Date(departureAtIso).getTime() - Date.now();
  if (!(diffMs > 0)) return null;
  const totalMin = Math.round(diffMs / 60000);
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

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
  // Home used to also require the admin capability, on the theory that
  // on-ground staff's job starts at Operations, not the overview dashboard.
  // Reverted (2026-07-30 — "i assigned staff_3 to coach 1... but on mobile
  // ui i can't see home page? i should still be able to see"): a captain
  // assigned to a real coach needs their own Home just as much as an admin
  // does — trip context, quick actions, their coach's status — none of that
  // is admin-only information. Gated purely on `viewMobileHome`, the same as
  // every other tab.
  const tabs = [
    ...(perms.viewMobileHome
      ? [{ to: "/mobile", label: "Home", icon: Home, end: true }] : []),
    // Trips + Attendance are ONE destination now (MobileOpsPage composes both).
    ...(perms.viewMobileAttendance || perms.viewMobileTrips
      ? [{ to: "/mobile/operations", label: "Ops", icon: ClipboardList, badge: missing }] : []),
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

  const departsInDisplay = trip
    ? liveDepartsIn(trip.departureAt) ?? (trip.departsIn ? fmtDepartsIn(trip.departsIn) : null)
    : null;
  const tripContext = trip
    ? [
        trip.name,
        trip.dayOf ? `${t("Day")} ${trip.dayOf}${trip.totalDays ? `/${trip.totalDays}` : ""}` : null,
        departsInDisplay ? `${t("dep")} ${departsInDisplay}` : null,
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
            {/* Inner wrapper added (2026-07-29 — "align the navigation") so the
                active highlight can hug just the icon+label instead of the
                whole flex:1 tab cell — see .mobile-tab-pill in mobile.css for
                the reasoning. */}
            <span className="mobile-tab-pill">
              <span className="mobile-tab-icon">
                <Icon size={primary ? 22 : 20} />
                {badge > 0 && <span className="mobile-tab-badge">{badge > 99 ? "99+" : badge}</span>}
              </span>
              {t(label)}
            </span>
          </NavLink>
        ))}
      </nav>
      {perms.viewMobileChatbot && <MobileChatBubble />}
      <SyncStatus />
    </div>
  );
}
