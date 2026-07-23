/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Admin Dashboard, Auth, Accounts & Permissions
 * ============================================================================= */
import { useEffect, useState } from "react";
import { ShieldCheck, Sun, Moon, Languages, Timer } from "lucide-react";
import { getUser, getPermissions, apiGet, apiPatch } from "../../lib/api.js";
import { useLang } from "../../lib/i18n.jsx";
import { useTheme } from "../../lib/theme.jsx";
import MediaManager from "../../components/MediaManager.jsx";

// This card's OWN persisted trip choice — separate from the Dashboard's
// switcher (mg_dashboard_trip), since each page can be looking at a
// different trip at once. Only used as a fallback default the very first
// time this card is opened (before the user has picked anything here).
const DASHBOARD_TRIP_KEY = "mg_dashboard_trip";
const SETTINGS_RESET_TRIP_KEY = "mg_settings_reset_trip";
const RESET_WINDOW_OPTIONS = [1, 2, 5, 10, 15, 30, 60];
const BUFFER_OPTIONS = [0, 5, 10, 15, 30, 60];

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

  /* ---- Checkpoint reset window ---------------------------------------
   * Per-trip setting (trips.checkpointResetMinutes, routes/checkpoints.js) —
   * how many minutes before the next itinerary stop an ARRIVED delegate
   * resets to ASSIGNED so they can be re-scanned. Used to live as an inline
   * dropdown on the Dashboard header; moved here since it's a standing
   * config choice, not something you look at every refresh. */
  const [trips, setTrips] = useState([]);
  const [resetTripId, setResetTripId] = useState(() => {
    try {
      return localStorage.getItem(SETTINGS_RESET_TRIP_KEY) || localStorage.getItem(DASHBOARD_TRIP_KEY) || "t-1";
    } catch { return "t-1"; }
  });
  function pickResetTrip(id) {
    setResetTripId(id);
    try { localStorage.setItem(SETTINGS_RESET_TRIP_KEY, id); } catch { /* ignore */ }
  }
  const [resetWindowMinutes, setResetWindowMinutes] = useState(null);
  const [resetSaving, setResetSaving] = useState(false);
  const [resetSaved, setResetSaved] = useState(false);
  const [resetError, setResetError] = useState(null);

  // Buffer time — the minimum minutes required between two itinerary stops
  // on the same day (enforced in TripCoachPage.jsx's EditItineraryModal).
  // Deliberately its OWN setting, not tied to the reset window above — they
  // used to share one value, but tightening the reset window for testing
  // shouldn't also force this gap to shrink.
  const [bufferMinutes, setBufferMinutes] = useState(null);
  const [bufferSaving, setBufferSaving] = useState(false);
  const [bufferSaved, setBufferSaved] = useState(false);
  const [bufferError, setBufferError] = useState(null);

  useEffect(() => {
    if (!perms.manageDelegates) return;
    apiGet("/all-trips").then((r) => setTrips(r.trips || [])).catch(() => {});
  }, [perms.manageDelegates]);

  useEffect(() => {
    if (!perms.manageDelegates || !resetTripId) return;
    setResetWindowMinutes(null);
    setBufferMinutes(null);
    apiGet(`/trips/${resetTripId}/checkpoints`)
      .then((r) => {
        setResetWindowMinutes(r.resetWindowMinutes ?? 5);
        setBufferMinutes(r.itineraryBufferMinutes ?? 30);
      })
      .catch(() => { setResetWindowMinutes(5); setBufferMinutes(30); });
  }, [perms.manageDelegates, resetTripId]);

  async function changeResetWindow(minutes) {
    setResetSaving(true); setResetError(null); setResetSaved(false);
    try {
      await apiPatch(`/trips/${resetTripId}/checkpoint-reset-window`, { minutes });
      setResetWindowMinutes(minutes);
      setResetSaved(true);
      setTimeout(() => setResetSaved(false), 1800);
    } catch (e) { setResetError(e.message); }
    finally { setResetSaving(false); }
  }

  async function changeBufferMinutes(minutes) {
    setBufferSaving(true); setBufferError(null); setBufferSaved(false);
    try {
      await apiPatch(`/trips/${resetTripId}/itinerary-buffer`, { minutes });
      setBufferMinutes(minutes);
      setBufferSaved(true);
      setTimeout(() => setBufferSaved(false), 1800);
    } catch (e) { setBufferError(e.message); }
    finally { setBufferSaving(false); }
  }

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

      {/* ---- Checkpoint reset window (manageDelegates-gated) ------------- */}
      {perms.manageDelegates && (
        <div className="card" style={{ marginTop: 16, padding: 22 }}>
          <div className="row" style={{ gap: 8, marginBottom: 4 }}>
            <Timer size={18} color="var(--ink-3)" />
            <h2 style={{ fontSize: 16 }}>{t("Checkpoint reset window")}</h2>
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 16 }}>
            {t("How long before the next itinerary stop an arrived delegate resets to assigned, so they can be scanned in again.")}
          </div>

          <div className="row between" style={{ padding: "12px 0", borderBottom: "1px solid var(--line-2)", flexWrap: "wrap", gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{t("Trip")}</div>
            <select
              className="input"
              style={{ width: "auto", minWidth: 220 }}
              value={resetTripId}
              onChange={(e) => pickResetTrip(e.target.value)}
            >
              <option value="t-1">{t("Beijing study mission")}</option>
              {trips.filter((tr) => tr.id !== "t-1").map((tr) => (
                <option key={tr.id} value={tr.id}>{tr.name}</option>
              ))}
            </select>
          </div>

          <div className="row between" style={{ padding: "14px 0 4px", borderBottom: "1px solid var(--line-2)", flexWrap: "wrap", gap: 10 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{t("Reset window")}</div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                {t("Shorter for testing, longer (e.g. 30 min) for a real trip.")}
              </div>
            </div>
            <div className="row" style={{ gap: 10, alignItems: "center" }}>
              {resetSaved && <span style={{ fontSize: 12.5, color: "var(--scc-green, #1a9c5e)" }}>{t("Saved")}</span>}
              <select
                className="input"
                style={{ width: "auto", minWidth: 110 }}
                value={resetWindowMinutes ?? ""}
                disabled={resetSaving || resetWindowMinutes === null}
                onChange={(e) => changeResetWindow(Number(e.target.value))}
              >
                {RESET_WINDOW_OPTIONS.map((m) => (
                  <option key={m} value={m}>{m} {t("min")}</option>
                ))}
              </select>
            </div>
          </div>
          {resetError && <div style={{ color: "var(--scc-red)", fontSize: 12.5, marginTop: 8, marginBottom: 4 }}>{resetError}</div>}

          <div className="row between" style={{ padding: "14px 0 4px", flexWrap: "wrap", gap: 10 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{t("Buffer time")}</div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                {t("Minimum gap required between two itinerary stops on the same day (0 = no minimum).")}
              </div>
            </div>
            <div className="row" style={{ gap: 10, alignItems: "center" }}>
              {bufferSaved && <span style={{ fontSize: 12.5, color: "var(--scc-green, #1a9c5e)" }}>{t("Saved")}</span>}
              <select
                className="input"
                style={{ width: "auto", minWidth: 110 }}
                value={bufferMinutes ?? ""}
                disabled={bufferSaving || bufferMinutes === null}
                onChange={(e) => changeBufferMinutes(Number(e.target.value))}
              >
                {BUFFER_OPTIONS.map((m) => (
                  <option key={m} value={m}>{m === 0 ? t("None") : `${m} ${t("min")}`}</option>
                ))}
              </select>
            </div>
          </div>
          {bufferError && <div style={{ color: "var(--scc-red)", fontSize: 12.5, marginTop: 8 }}>{bufferError}</div>}
        </div>
      )}

      {/* ---- Image storage (manageAccounts-gated) ------------------------ */}
      {perms.manageAccounts && <MediaManager />}
    </div>
  );
}
