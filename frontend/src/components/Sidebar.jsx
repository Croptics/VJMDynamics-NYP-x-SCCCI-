/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — App shell & navigation
 * ============================================================================= */
import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutGrid,
  MapPin,
  FileText,
  AlertTriangle,
  ClipboardCheck,
  LogOut,
  ShieldCheck,
  Languages,
  Sun,
  Moon,
  HelpCircle,
  Megaphone,
  Settings,
  MessageSquare,
} from "lucide-react";
import { getUser, getPermissions, clearToken } from "../lib/api.js";
import { useLang } from "../lib/i18n.jsx";
import { useTheme } from "../lib/theme.jsx";

/**
 * Left navigation rail. Mirrors the MusterGo admin shell (Screens 2–6).
 * `exceptionCount` drives the red pill on the Exceptions item.
 * The account block + Log out button sit pinned to the bottom.
 */
export default function Sidebar({ exceptionCount = 0, announcementCount = 0, onLogout, open = false }) {
  // Re-render when Settings updates the session (name/photo/etc.) — plain
  // storage writes (updateSession) don't trigger React on their own.
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const onSessionUpdated = () => forceUpdate((n) => n + 1);
    window.addEventListener("mg-session-updated", onSessionUpdated);
    return () => window.removeEventListener("mg-session-updated", onSessionUpdated);
  }, []);

  const perms = getPermissions();
  // A read-only Admin has manageAccounts=false (see accountPermissions() in
  // backend/db/accounts.js) but should still see the Account control link —
  // they can view everything there, just can't create/edit/delete/approve.
  const isAdmin = !!perms.manageAccounts || (getUser()?.role === "admin" && getUser()?.readOnly);
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
    // Temporarily hidden from the sidebar (2026-07-27, "hide this page for
    // now, don't show it on frontend") — the route/page itself is untouched,
    // just not linked from nav. The viewScanner permission that used to gate
    // this nav item was removed entirely 2026-08-02 ("remove face + qr
    // scanner on desktop, include the permission") since it had no visible
    // effect with nothing linking here — if this page is ever restored, add
    // a fresh permission for it rather than reaching for the old key.
    // Biometric enrolment — feeds the scanner above (a delegate can only be
    // face/voice matched once they're enrolled), so it sits next to it.
    // Biometric enrolment is deliberately NOT here (2026-07-29, "this page can
    // be removed from desktop" — matches Vimal's own "enrolment is its own app"
    // decision). It's a standalone delegate-facing app at /enroll, which is
    // still routed and still reachable by the emailed invite links; staff track
    // coverage and send those invites from the mobile Enrolment view instead.
    ...(perms.viewExceptions ? [{ to: "/exceptions", label: "Exceptions", icon: AlertTriangle, badge: exceptionCount }] : []),
    // MusterChat — Vance's inbox (AI assistant + team messaging + calls),
    // promoted to a real nav destination (2026-07-28 — "can you put the chat
    // in the sidebar"). The floating bubble stays as the quick-access AI chat;
    // this is the full messaging workspace.
    ...(perms.viewChatbot ? [{ to: "/assistant", label: "MusterChat", icon: MessageSquare }] : []),
    // Announcements is NOT in this nav list — it's its own box in the footer,
    // beside the language toggle (2026-07-27 — "add another box beside the
    // translation button for announcement"). See the footer JSX below.
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
  // 2026-07-30 — "change the jq part to either admin or staff": this read
  // the raw Staff ID as a fallback whenever the cached session had no `role`
  // field yet (an older session from before login started storing one) —
  // which looks exactly like a role but isn't one, so it read as a bug
  // rather than an intentional fallback. "Staff" is the safe default (every
  // account without an explicit admin role IS staff), and useSessionGuard
  // now also syncs `role` on its periodic check so a stale cached session
  // corrects itself without a fresh login being required.
  const roleLabel = t(user.role === "admin" ? "Admin" : "Staff");
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
        {/* All 4 utility icons together in their OWN row (2026-07-27 —
            "should you move the translation, dark theme to beside
            announcement?") — previously split across two rows (User
            guide/Announcements alone on top, Language/Theme crammed beside
            the avatar below), which read as lopsided. Giving this row its
            own space — instead of squeezing icons in NEXT TO the avatar,
            which is what caused the original cramped/broken look — means
            the avatar block below gets its full width back too. Stretched
            to fill the row evenly (2026-07-27 — "adjust so there no gap for
            dark theme button and the end... or enlarge the button") — was
            fixed-size + left-aligned, leaving a lopsided empty gap after the
            last (Theme) icon; each button now grows equally (flex:1) so all
            4 fill the full width with no leftover space, instead of
            clustering as a smaller group with padding on either side. */}
        <div className="row" style={{ gap: 6 }}>
          <NavLink
            to="/guide"
            className={({ isActive }) => "btn btn-ghost" + (isActive ? " active" : "")}
            style={{ ...S.themeBtn, flex: 1 }}
            title={t("User guide")}
            aria-label={t("User guide")}
          >
            <HelpCircle size={16} />
          </NavLink>
          {perms.viewAnnouncements && (
            <NavLink
              to="/announcements"
              className={({ isActive }) => "btn btn-ghost" + (isActive ? " active" : "")}
              style={{ ...S.themeBtn, flex: 1, position: "relative" }}
              title={t("Announcements")}
              aria-label={t("Announcements")}
            >
              <Megaphone size={16} />
              {announcementCount > 0 && <span style={S.footerBadge}>{announcementCount}</span>}
            </NavLink>
          )}
          <button
            className="btn btn-ghost"
            style={{ ...S.themeBtn, flex: 1 }}
            onClick={toggleLang}
            title={t("Switch language")}
            aria-label={t("Switch language")}
          >
            <Languages size={16} />
          </button>
          <button
            className="btn btn-ghost"
            style={{ ...S.themeBtn, flex: 1 }}
            onClick={toggleTheme}
            title={t(theme === "dark" ? "Light mode" : "Dark mode")}
            aria-label={t(theme === "dark" ? "Light mode" : "Dark mode")}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
        <div style={{ ...S.account, marginTop: 8 }}>
          <NavLink
            to="/settings"
            className={({ isActive }) => "sidebar-account" + (isActive ? " active" : "")}
            style={{ ...S.accountLink, flex: 1 }}
            title={t("Settings")}
          >
            {user.photoUrl ? (
              <img className="avatar" src={user.photoUrl} alt="" style={{ ...S.avatar, objectFit: "cover" }} />
            ) : (
              <span className="avatar" style={S.avatar}>{initials}</span>
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={S.name}>{displayName}</div>
              <div className="muted" style={{ fontSize: 11 }}>{roleLabel}</div>
            </div>
            {/* Settings gear (2026-07-27 — "add like a setting icon beside
                staff 194, cause right now maybe user don't know that for
                setting") — the whole block already linked to /settings, but
                nothing visually signalled that; a gear icon is the
                conventional cue. */}
            {/* Nudged 9px left (2026-07-29 — "move the setting icon to the left
                abit so it look same as the dark theme icon") so its centre
                lines up with the Theme icon directly above it. The arithmetic,
                since it's otherwise a magic number: sidebar is a fixed 232px
                (--sidebar-w) with 14px side padding → 204px of content. The
                utility row is 4 flex:1 buttons with 6px gaps, so each is
                (204-18)/4 = 46.5 wide and the last icon's centre falls at
                157.5 + 23.25 = 180.75. This gear sat at 190 (account padding
                12 minus the link's -6 margin, less half the 16px icon), i.e.
                9.25px too far right. If --sidebar-w changes, redo this. */}
            <Settings size={16} color="var(--ink-3)" style={{ flexShrink: 0, marginRight: 9 }} />
          </NavLink>
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
  footerBadge: {
    position: "absolute", top: -4, right: -4, minWidth: 16, height: 16, padding: "0 3px",
    borderRadius: 999, background: "var(--scc-red)", color: "#fff", fontSize: 10, fontWeight: 700,
    display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
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
