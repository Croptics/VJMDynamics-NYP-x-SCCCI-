import { NavLink } from "react-router-dom";
import {
  LayoutGrid,
  MapPin,
  FileText,
  AlertTriangle,
  ClipboardCheck,
  LogOut,
  ShieldCheck,
  UserPlus,
  Languages,
  Sun,
  Moon,
  ScanFace,
  HelpCircle,
} from "lucide-react";
import { getUser, getPermissions, clearToken } from "../lib/api.js";
import { useLang } from "../lib/i18n.jsx";
import { useTheme } from "../lib/theme.jsx";

/**
 * Left navigation rail. Mirrors the MusterGo admin shell (Screens 2–6).
 * `exceptionCount` drives the red pill on the Exceptions item.
 * The account block + Log out button sit pinned to the bottom.
 */
export default function Sidebar({ exceptionCount = 0, onLogout, open = false }) {
  const perms = getPermissions();
  const isAdmin = !!perms.manageAccounts;
  const { lang, toggleLang, t } = useLang();
  const { theme, toggleTheme } = useTheme();
  // Every item (except Account control, still its own manageAccounts check)
  // is now gated by a "desktopView" permission from permissions.js — an
  // account with a view unchecked simply never sees that nav item, matching
  // the matching ViewGate on the route itself in App.jsx. Missing/legacy
  // accounts default every view permission to true (see cleanPermissions in
  // permissions.js), so this is a no-op for every account that existed
  // before per-page view permissions did.
  const items = [
    ...(perms.viewDashboard ? [{ to: "/dashboard", label: "Dashboard", icon: LayoutGrid }] : []),
    ...(perms.viewTrips ? [{ to: "/trips", label: "Trips", icon: MapPin }] : []),
    ...(perms.viewDocuments ? [{ to: "/onboarding", label: "Documents", icon: FileText }] : []),
    // Desktop entrance-kiosk scanner (Face + QR + Manual).
    ...(perms.viewScanner ? [{ to: "/scanner", label: "Face + QR scan", icon: ScanFace }] : []),
    // Biometric enrolment — feeds the scanner above (a delegate can only be
    // face/voice matched once they're enrolled), so it sits next to it.
    ...(perms.viewScanner ? [{ to: "/enrolment", label: "Enrolment", icon: UserPlus }] : []),
    ...(perms.viewExceptions ? [{ to: "/exceptions", label: "Exceptions", icon: AlertTriangle, badge: exceptionCount }] : []),
    // Chat assistant is now a floating bubble (ChatBubble.jsx, rendered from
    // Layout.jsx on every route) instead of a dedicated destination.
    // NOTE: "User guide" is intentionally NOT here — it's a help/reference
    // resource, not a workflow destination, so it lives with the utility
    // controls in the footer (a "?" icon next to the theme toggle) instead.
    // Account control stays on the manageAccounts ACTION permission, not a
    // view toggle — only a real admin should ever grant/revoke everyone
    // else's access (see permissions.js's group doc for why).
    ...(isAdmin ? [{ to: "/accounts", label: "Account control", icon: ShieldCheck }] : []),
  ];

  const user = getUser() || {};
  const displayName = user.name || user.staffId || t("Signed in");
  const roleLabel = user.role
    ? t(user.role.charAt(0).toUpperCase() + user.role.slice(1))
    : user.staffId || t("Staff");
  const initials = displayName
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  function handleLogout() {
    if (onLogout) onLogout();
    else {
      // Fallback if the handler wasn't wired: clear and hard-redirect.
      clearToken();
      window.location.assign("/login");
    }
  }

  return (
    <nav className={"sidebar" + (open ? " open" : "")} aria-label={t("Primary")}>
      <div className="sidebar-brand wordmark">
        <ClipboardCheck size={22} strokeWidth={2.4} /> MusterGo
      </div>

      {/* Only THIS list scrolls when it doesn't fit — the footer below (theme/
          language, account, Log out) stays pinned and always visible instead
          of being pushed off the bottom of a short viewport (e.g. a tablet in
          landscape) with no visible way to reach it. */}
      <div className="sidebar-nav-scroll">
        {items.map(({ to, label, icon: Icon, badge }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}
          >
            <Icon size={18} strokeWidth={2} />
            {t(label)}
            {badge ? <span className="nav-badge">{badge}</span> : null}
          </NavLink>
        ))}
      </div>

      {/* Account + logout, pinned to the bottom */}
      <div style={S.footer}>
        <button className="btn btn-ghost btn-block" onClick={toggleLang} title={t("Switch language")}>
          <Languages size={16} /> {lang === "en" ? "中文" : "English"}
        </button>
        <div style={{ ...S.account, marginTop: 8 }}>
          <NavLink
            to="/settings"
            className={({ isActive }) => "sidebar-account" + (isActive ? " active" : "")}
            style={S.accountLink}
            title={t("Settings")}
          >
            <span className="avatar" style={S.avatar}>{initials}</span>
            <div style={{ minWidth: 0 }}>
              <div style={S.name}>{displayName}</div>
              <div className="muted" style={{ fontSize: 11 }}>{roleLabel}</div>
            </div>
          </NavLink>
          {/* Help / User guide — a utility affordance next to the theme
              toggle, not a primary nav destination (see the items array). */}
          <NavLink
            to="/guide"
            className={({ isActive }) => "btn btn-ghost" + (isActive ? " active" : "")}
            style={S.themeBtn}
            title={t("User guide")}
            aria-label={t("User guide")}
          >
            <HelpCircle size={16} />
          </NavLink>
          <button
            className="btn btn-ghost"
            style={S.themeBtn}
            onClick={toggleTheme}
            title={t(theme === "dark" ? "Light mode" : "Dark mode")}
            aria-label={t(theme === "dark" ? "Light mode" : "Dark mode")}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
        <button className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={handleLogout}>
          <LogOut size={16} /> {t("Log out")}
        </button>
      </div>
    </nav>
  );
}

const S = {
  footer: { marginTop: "auto", paddingTop: 12 },
  account: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 12px",
    borderTop: "1px solid var(--line)",
  },
  accountLink: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flex: 1,
    minWidth: 0,
    padding: "4px 6px",
    margin: "-4px -6px",
    textDecoration: "none",
  },
  themeBtn: { padding: 8, flexShrink: 0 },
  avatar: { width: 34, height: 34, background: "var(--scc-red-tint)", color: "var(--scc-red)" },
  name: {
    fontSize: 13,
    fontWeight: 600,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    color: "var(--ink)",
  },
};
