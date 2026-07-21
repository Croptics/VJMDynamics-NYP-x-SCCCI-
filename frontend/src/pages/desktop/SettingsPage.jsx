/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Admin Dashboard, Auth, Accounts & Permissions
 * ============================================================================= */
import { ShieldCheck, Sun, Moon, Languages } from "lucide-react";
import { getUser, getPermissions } from "../../lib/api.js";
import { useLang } from "../../lib/i18n.jsx";
import { useTheme } from "../../lib/theme.jsx";
import MediaManager from "../../components/MediaManager.jsx";

/**
 * Screen — Settings. Signed-in account info + app-wide preferences (theme,
 * language). Reached via the sidebar's account block.
 */
export default function SettingsPage() {
  const { t, lang, toggleLang } = useLang();
  const { theme, toggleTheme } = useTheme();
  const user = getUser() || {};
  const perms = getPermissions();

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

  const activePerms = Object.entries(perms).filter(([, v]) => v);

  return (
    <div className="page">
      <div className="page-eyebrow">{t("Administration")}</div>
      <h1 className="page-title">{t("Settings")}</h1>
      <p className="page-sub">{t("Your account details and app preferences.")}</p>

      {/* ---- Account card ---------------------------------------------- */}
      <div className="card" style={{ marginTop: 20, padding: 22 }}>
        <div className="row" style={{ gap: 14 }}>
          <span className="avatar" style={{ width: 52, height: 52, fontSize: 17, background: "var(--scc-red-tint)", color: "var(--scc-red)" }}>
            {initials}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{displayName}</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
              {user.username || "—"} · {roleLabel}
            </div>
          </div>
        </div>
      </div>

      {/* ---- Permissions card -------------------------------------------- */}
      <div className="card" style={{ marginTop: 16, padding: 22 }}>
        <div className="row" style={{ gap: 8, marginBottom: 14 }}>
          <ShieldCheck size={18} color="var(--ink-3)" />
          <h2 style={{ fontSize: 16 }}>{t("Permissions")}</h2>
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

      {/* ---- Preferences card ---------------------------------------------- */}
      <div className="card" style={{ marginTop: 16, padding: 22 }}>
        <h2 style={{ fontSize: 16, marginBottom: 14 }}>{t("Preferences")}</h2>

        <div className="row between" style={{ padding: "12px 0", borderBottom: "1px solid var(--line-2)" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{t("Theme")}</div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
              {t(theme === "dark" ? "Dark mode is on for every page." : "Light mode is on for every page.")}
            </div>
          </div>
          <button className="btn btn-ghost" onClick={toggleTheme}>
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            {t(theme === "dark" ? "Light mode" : "Dark mode")}
          </button>
        </div>

        <div className="row between" style={{ padding: "12px 0" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{t("Language")}</div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
              {t("Switch the interface between English and Chinese.")}
            </div>
          </div>
          <button className="btn btn-ghost" onClick={toggleLang}>
            <Languages size={16} /> {lang === "en" ? "中文" : "English"}
          </button>
        </div>
      </div>

      {/* ---- Image storage (manageAccounts-gated) ------------------------ */}
      {perms.manageAccounts && <MediaManager />}
    </div>
  );
}
