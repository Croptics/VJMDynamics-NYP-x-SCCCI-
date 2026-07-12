import { NavLink } from "react-router-dom";
import {
  LayoutGrid,
  MapPin,
  FileText,
  AlertTriangle,
  MessageSquare,
  ClipboardCheck,
  LogOut,
  ShieldCheck,
  Languages,
} from "lucide-react";
import { getUser, getPermissions, clearToken } from "../lib/api.js";
import { useLang } from "../lib/i18n.jsx";

/**
 * Left navigation rail. Mirrors the MusterGo admin shell (Screens 2–6).
 * `exceptionCount` drives the red pill on the Exceptions item.
 * The account block + Log out button sit pinned to the bottom.
 */
export default function Sidebar({ exceptionCount = 0, onLogout }) {
  const perms = getPermissions();
  const isMain = !!perms.manageAccounts;
  const { lang, toggleLang, t } = useLang();
  const items = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutGrid },
    { to: "/trips", label: "Trips", icon: MapPin },
    // Onboarding (document parsing) bulk-creates delegates → manageDelegates.
    ...(perms.manageDelegates ? [{ to: "/onboarding", label: "Documents", icon: FileText }] : []),
    { to: "/exceptions", label: "Exceptions", icon: AlertTriangle, badge: exceptionCount },
    { to: "/assistant", label: "Chat assistant", icon: MessageSquare },
    ...(isMain ? [{ to: "/accounts", label: "Account control", icon: ShieldCheck }] : []),
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
    <nav className="sidebar" aria-label="Primary">
      <div className="sidebar-brand wordmark">
        <ClipboardCheck size={22} strokeWidth={2.4} /> MusterGo
      </div>

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

      {/* Account + logout, pinned to the bottom */}
      <div style={S.footer}>
        <button className="btn btn-ghost btn-block" onClick={toggleLang} title={t("Switch language")}>
          <Languages size={16} /> {lang === "en" ? "中文" : "English"}
        </button>
        <div style={{ ...S.account, marginTop: 8 }}>
          <span className="avatar" style={S.avatar}>{initials}</span>
          <div style={{ minWidth: 0 }}>
            <div style={S.name}>{displayName}</div>
            <div className="muted" style={{ fontSize: 11 }}>{roleLabel}</div>
          </div>
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
    gap: 10,
    padding: "10px 12px",
    borderTop: "1px solid var(--line)",
  },
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
