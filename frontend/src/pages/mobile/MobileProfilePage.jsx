import { useOutletContext } from "react-router-dom";
import { LogOut, ShieldCheck } from "lucide-react";
import { getUser, getPermissions, clearToken } from "../../lib/api.js";
import { useLang } from "../../lib/i18n.jsx";

/**
 * Mobile Profile — signed-in user info + logout, mirroring the account
 * block in the desktop Sidebar but as its own page.
 */
export default function MobileProfilePage() {
  const { t } = useLang();
  const { onLogout } = useOutletContext() || {};
  const user = getUser() || {};
  const perms = getPermissions();
  const displayName = user.name || user.staffId || t("Signed in");
  const initials = displayName.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  function handleLogout() {
    if (onLogout) onLogout();
    else {
      clearToken();
      window.location.assign("/login");
    }
  }

  const activePerms = Object.entries(perms).filter(([, v]) => v);

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 4 }}>
        {t("Profile")}
      </div>
      <h1 style={{ fontSize: 22, margin: "4px 0 16px" }}>{displayName}</h1>

      <div className="mobile-card row" style={{ gap: 12 }}>
        <span className="avatar" style={{ width: 44, height: 44, background: "var(--scc-red-tint)", color: "var(--scc-red)", fontSize: 15 }}>
          {initials}
        </span>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{displayName}</div>
          <div className="muted" style={{ fontSize: 12 }}>{user.username || "—"}</div>
        </div>
      </div>

      <div className="mobile-card">
        <div className="row" style={{ gap: 8, marginBottom: 10 }}>
          <ShieldCheck size={16} color="var(--ink-3)" />
          <span style={{ fontWeight: 600, fontSize: 14 }}>{t("Permissions")}</span>
        </div>
        {activePerms.length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>{t("No special permissions on this account.")}</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {activePerms.map(([key]) => (
              <span key={key} className="badge badge-neutral">{key}</span>
            ))}
          </div>
        )}
      </div>

      <button className="btn btn-ghost btn-block" onClick={handleLogout} style={{ marginTop: 8 }}>
        <LogOut size={16} /> {t("Log out")}
      </button>
    </div>
  );
}
