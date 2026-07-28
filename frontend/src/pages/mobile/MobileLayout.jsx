import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Home, ClipboardList, User, Languages, Moon, Sun, Bus, ScanFace, QrCode } from "lucide-react";
import { getPermissions, apiGet } from "../../lib/api.js";
import { useLang } from "../../lib/i18n.jsx";
import { useTheme } from "../../lib/theme.jsx";
import { useSessionGuard } from "../../lib/useSessionGuard.js";
import MobileChatBubble from "./MobileChatBubble.jsx";
import "../../styles/mobile.css";

const TRIP_ID = "t-1";
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
  const { lang, toggleLang, t } = useLang();
  const { theme, toggleTheme } = useTheme();

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
        const dash = await apiGet(`/trips/${TRIP_ID}/dashboard`);
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
    ...(perms.viewMobileScanner
      ? [
          { to: "/mobile/scan/face", label: "Face", icon: ScanFace },
          { to: "/mobile/scan/qr", label: "QR", icon: QrCode },
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
          <div className="row" style={{ gap: 10 }}>
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
            <button
              onClick={() => { buzz(); toggleTheme(); }}
              aria-label={theme === "dark" ? t("Switch to light mode") : t("Switch to dark mode")}
              style={{ background: "none", border: "none", color: "var(--scc-red)", display: "flex", alignItems: "center", padding: 0 }}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button onClick={() => { buzz(); toggleLang(); }} style={{ background: "none", border: "none", color: "var(--scc-red)", display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700, padding: 0 }}>
              <Languages size={14} /> {lang === "en" ? "中文" : "EN"}
            </button>
          </div>
        </div>
        {tripContext && (
          <div className="mobile-trip-chip">
            <Bus size={13} style={{ color: "var(--scc-red)", flexShrink: 0 }} />
            <span>{tripContext}</span>
          </div>
        )}
      </div>
      <div className="mobile-page">
        <Outlet context={{ onLogout }} />
      </div>
      <nav className="mobile-tabbar" aria-label={t("Mobile navigation")}>
        {tabs.map(({ to, label, icon: Icon, end, badge }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => buzz()}
            className={({ isActive }) => "mobile-tab" + (isActive ? " active" : "")}
          >
            <span className="mobile-tab-icon">
              <Icon size={20} />
              {badge > 0 && <span className="mobile-tab-badge">{badge > 99 ? "99+" : badge}</span>}
            </span>
            {t(label)}
          </NavLink>
        ))}
      </nav>
      {perms.viewMobileChatbot && <MobileChatBubble />}
    </div>
  );
}
