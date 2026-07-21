import { NavLink, Outlet } from "react-router-dom";
import { Home, ClipboardList, MapPin, User, Languages, Moon, Sun } from "lucide-react";
import { getPermissions } from "../../lib/api.js";
import { useLang } from "../../lib/i18n.jsx";
import { useTheme } from "../../lib/theme.jsx";
import { useSessionGuard } from "../../lib/useSessionGuard.js";
import MobileChatBubble from "./MobileChatBubble.jsx";
import "../../styles/mobile.css";

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
  // Same "mobileView" permission group as the /mobile/* route gates in
  // App.jsx — an account with a view unchecked doesn't see the tab either.
  // Profile stays ungated (account settings, not a feature view).
  const tabs = [
    ...(perms.viewMobileHome ? [{ to: "/mobile", label: "Home", icon: Home, end: true }] : []),
    ...(perms.viewMobileAttendance ? [{ to: "/mobile/attendance", label: "Attendance", icon: ClipboardList }] : []),
    ...(perms.viewMobileTrips ? [{ to: "/mobile/trips", label: "Trips", icon: MapPin }] : []),
    { to: "/mobile/profile", label: "Profile", icon: User },
  ];

  return (
    <div className="mobile-shell">
      <div className="mobile-topbar row between">
        <span>MusterGo</span>
        <div className="row" style={{ gap: 12 }}>
          <button
            onClick={toggleTheme}
            aria-label={theme === "dark" ? t("Switch to light mode") : t("Switch to dark mode")}
            style={{ background: "none", border: "none", color: "var(--scc-red)", display: "flex", alignItems: "center", padding: 0 }}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button onClick={toggleLang} style={{ background: "none", border: "none", color: "var(--scc-red)", display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700, padding: 0 }}>
            <Languages size={14} /> {lang === "en" ? "中文" : "EN"}
          </button>
        </div>
      </div>
      <div className="mobile-page">
        <Outlet context={{ onLogout }} />
      </div>
      <nav className="mobile-tabbar" aria-label={t("Mobile navigation")}>
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => "mobile-tab" + (isActive ? " active" : "")}
          >
            <Icon size={20} />
            {t(label)}
          </NavLink>
        ))}
      </nav>
      {perms.viewMobileChatbot && <MobileChatBubble />}
    </div>
  );
}
