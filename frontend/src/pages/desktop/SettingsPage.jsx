/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Admin Dashboard, Auth, Accounts & Permissions
 * ============================================================================= */
import { useEffect, useRef, useState } from "react";
import { ShieldCheck, Sun, Moon, Languages, Timer, Camera, X, Pencil, Bell, BellOff, Mail, Trash2 } from "lucide-react";
import { getUser, getPermissions, apiGet, apiPatch, apiPost, apiDelete, updateSession } from "../../lib/api.js";
import { useLang } from "../../lib/i18n.jsx";
import { useTheme } from "../../lib/theme.jsx";
import { isAlertSoundMuted, setAlertSoundMuted } from "../../lib/alertSound.js";
import MediaManager from "../../components/MediaManager.jsx";
import PhotoCropModal from "../../components/PhotoCropModal.jsx";
import { PERMISSIONS } from "../../../../permissions.js";

// Read-only summary of an account's own access, grouped the same way
// Account Control's editor groups them — so "what I can do" here always
// matches what an admin sees when editing this same account, just without
// the checkboxes (2026-07-24 — "rename text to make it clearer").
const PERM_SECTIONS = [
  { key: "action", title: "What you can do" },
  { key: "desktopView", title: "Pages you can see (desktop)" },
  { key: "mobileView", title: "Pages you can see (mobile)" },
];

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
  // Bumped after a self-profile save so getUser()/getPermissions() below
  // re-read the just-updated localStorage/sessionStorage record — those
  // helpers aren't reactive on their own (2026-07-24, profile-edit feature).
  const [sessionVersion, setSessionVersion] = useState(0);
  const user = getUser() || {};
  const perms = getPermissions();

  // "Mute alert sound" (2026-07-25) — device-local, silences only the
  // escalation chime (EscalationBanner.jsx); the banner/tab-flash/email
  // still fire regardless. See lib/alertSound.js.
  const [alertMuted, setAlertMutedState] = useState(isAlertSoundMuted());
  function toggleAlertMuted() {
    const next = !alertMuted;
    setAlertSoundMuted(next);
    setAlertMutedState(next);
  }

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

  const isAdmin = user.role === "admin";

  /* ---- Self-service profile editing (2026-07-24) ----------------------
   * "under setting page. pls give option to add profile pic, change name,
   * username, password etc." Wired to PATCH /api/auth/me and
   * POST/DELETE /api/auth/me/photo (routes/auth.js) — any signed-in
   * account can edit its OWN row, but can never touch role/permissions
   * (updateOwnAccount() in db/accounts.js doesn't even accept those
   * fields). Password change requires the current password to verify
   * first — a real check neither admin-side edits nor "forgot password"
   * enforce. */
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileErr, setProfileErr] = useState(null);
  const [profileSaved, setProfileSaved] = useState(false);
  const [cropFile, setCropFile] = useState(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [enlargePhoto, setEnlargePhoto] = useState(false);
  const fileInputRef = useRef(null);

  const PROFILE_ERR_TEXT = {
    USERNAME_REQUIRED: t("Username is required."),
    USERNAME_TAKEN: t("That username is already taken."),
    EMAIL_REQUIRED: t("A valid email address is required."),
    EMAIL_TAKEN: t("That email is already registered to another account."),
    CURRENT_PASSWORD_INCORRECT: t("Your current password is incorrect."),
    WEAK_PASSWORD: t("Choose a stronger password."),
  };

  function openEditProfile() {
    setProfileForm({
      name: user.name || "",
      username: user.username || "",
      email: user.email || "",
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    });
    setProfileErr(null);
    setEditingProfile(true);
  }

  async function saveProfile() {
    if (!profileForm.username.trim()) return setProfileErr(PROFILE_ERR_TEXT.USERNAME_REQUIRED);
    if (profileForm.newPassword && profileForm.newPassword !== profileForm.confirmPassword) {
      return setProfileErr(t("New password and confirmation don't match."));
    }
    if (profileForm.newPassword && !profileForm.currentPassword) {
      return setProfileErr(t("Enter your current password to set a new one."));
    }
    setProfileSaving(true);
    setProfileErr(null);
    try {
      const patch = {
        name: profileForm.name.trim(),
        username: profileForm.username.trim(),
        email: profileForm.email.trim(),
      };
      if (profileForm.newPassword) {
        patch.currentPassword = profileForm.currentPassword;
        patch.newPassword = profileForm.newPassword;
      }
      const result = await apiPatch("/auth/me", patch);
      updateSession({ token: result.token, user: result.account });
      setSessionVersion((v) => v + 1);
      setEditingProfile(false);
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 1800);
    } catch (e) {
      setProfileErr(PROFILE_ERR_TEXT[e.code] || e.message);
    } finally {
      setProfileSaving(false);
    }
  }

  function pickPhoto() {
    fileInputRef.current?.click();
  }
  function onPhotoChosen(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file later
    if (file) setCropFile(file);
  }
  async function handleCropSave(blob) {
    setCropFile(null);
    setPhotoBusy(true);
    setProfileErr(null);
    try {
      const form = new FormData();
      form.append("photo", blob, "avatar.jpg");
      const result = await apiPost("/auth/me/photo", form, true);
      updateSession({ user: { photoUrl: result.photoUrl } });
      setSessionVersion((v) => v + 1);
    } catch (e) {
      setProfileErr(e.message);
    } finally {
      setPhotoBusy(false);
    }
  }
  async function removePhoto() {
    setPhotoBusy(true);
    setProfileErr(null);
    try {
      await apiDelete("/auth/me/photo");
      updateSession({ user: { photoUrl: null } });
      setSessionVersion((v) => v + 1);
    } catch (e) {
      setProfileErr(e.message);
    } finally {
      setPhotoBusy(false);
    }
  }

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
    if (!perms.manageTrips) return;
    apiGet("/all-trips").then((r) => setTrips(r.trips || [])).catch(() => {});
  }, [perms.manageTrips]);

  useEffect(() => {
    if (!perms.manageTrips || !resetTripId) return;
    setResetWindowMinutes(null);
    setBufferMinutes(null);
    apiGet(`/trips/${resetTripId}/checkpoints`)
      .then((r) => {
        setResetWindowMinutes(r.resetWindowMinutes ?? 5);
        setBufferMinutes(r.itineraryBufferMinutes ?? 30);
      })
      .catch(() => { setResetWindowMinutes(5); setBufferMinutes(30); });
  }, [perms.manageTrips, resetTripId]);

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

      {/* ---- Account card ----------------------------------------------
          Self-service profile editing (2026-07-24) — photo, name, username,
          email, password, all editable here without needing an admin. */}
      <div className="card" style={{ marginTop: 20, padding: 24 }}>
        <div className="row between" style={{ gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div className="row" style={{ gap: 16, alignItems: "center" }}>
            <div style={{ position: "relative", flexShrink: 0 }}>
              {user.photoUrl ? (
                <img
                  src={user.photoUrl}
                  alt=""
                  onClick={() => setEnlargePhoto(true)}
                  style={{ width: 64, height: 64, borderRadius: "50%", objectFit: "cover", cursor: "pointer", border: "1px solid var(--line)" }}
                />
              ) : (
                <span
                  className="avatar"
                  style={{ width: 64, height: 64, fontSize: 20, background: "var(--scc-red-tint)", color: "var(--scc-red)" }}
                >
                  {initials}
                </span>
              )}
              <button
                onClick={pickPhoto}
                disabled={photoBusy}
                aria-label={t("Change photo")}
                title={t("Change photo")}
                style={{
                  position: "absolute", right: -2, bottom: -2, width: 24, height: 24, borderRadius: "50%",
                  background: "var(--surface)", border: "1px solid var(--line)", display: "grid", placeItems: "center",
                  cursor: photoBusy ? "default" : "pointer", boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                }}
              >
                <Camera size={13} />
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={onPhotoChosen} style={{ display: "none" }} />
            </div>
            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
              <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.2 }}>{displayName}</div>
              <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span className="mono muted" style={{ fontSize: 12.5 }}>{user.username || "—"}</span>
                <span className="badge badge-neutral" style={{ padding: "1px 8px", fontSize: 11 }}>{roleLabel}</span>
              </div>
              {user.email && (
                <div className="row muted" style={{ fontSize: 12.5, gap: 6, alignItems: "center" }}>
                  <Mail size={12} style={{ flexShrink: 0 }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</span>
                </div>
              )}
              {user.photoUrl && (
                <button
                  className="btn btn-ghost"
                  onClick={removePhoto}
                  disabled={photoBusy}
                  style={{ fontSize: 12, padding: "3px 10px", height: "auto", alignSelf: "flex-start", marginTop: 2 }}
                >
                  <Trash2 size={12} /> {t("Remove photo")}
                </button>
              )}
            </div>
          </div>
          <div className="row" style={{ gap: 10, alignItems: "center", flexShrink: 0 }}>
            {profileSaved && <span style={{ fontSize: 12.5, color: "var(--scc-green, #1a9c5e)" }}>{t("Saved")}</span>}
            <button className="btn btn-ghost" onClick={openEditProfile}>
              <Pencil size={14} /> {t("Edit profile")}
            </button>
          </div>
        </div>
        {!editingProfile && profileErr && (
          <div style={{ color: "var(--scc-red)", fontSize: 12.5, marginTop: 12 }}>{profileErr}</div>
        )}
      </div>

      {enlargePhoto && user.photoUrl && (
        <div
          onClick={() => setEnlargePhoto(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "grid", placeItems: "center", zIndex: 60, cursor: "zoom-out" }}
        >
          <img src={user.photoUrl} alt="" style={{ maxWidth: "min(80vw, 480px)", maxHeight: "80vh", borderRadius: 12 }} />
        </div>
      )}

      {cropFile && (
        <PhotoCropModal file={cropFile} onCancel={() => setCropFile(null)} onSave={handleCropSave} t={t} />
      )}

      {editingProfile && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,0.45)", display: "grid", placeItems: "center", padding: 20, zIndex: 55 }}>
          <div className="card" style={{ width: "min(440px, 100%)", maxHeight: "calc(100vh - 48px)", overflowY: "auto", padding: 24 }}>
            <div className="row between" style={{ marginBottom: 16 }}>
              <h2 style={{ fontSize: 16 }}>{t("Edit profile")}</h2>
              <button onClick={() => setEditingProfile(false)} style={{ background: "none", border: "none", color: "var(--ink-3)", display: "flex" }} aria-label={t("Close")}>
                <X size={18} />
              </button>
            </div>

            <label className="muted" style={{ fontSize: 12.5 }}>{t("Name")}</label>
            <input
              className="input" style={{ marginTop: 4, marginBottom: 12 }}
              value={profileForm.name}
              onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
            />

            <label className="muted" style={{ fontSize: 12.5 }}>{t("Username")}</label>
            <input
              className="input" style={{ marginTop: 4, marginBottom: 12 }}
              value={profileForm.username}
              onChange={(e) => setProfileForm({ ...profileForm, username: e.target.value })}
            />

            <label className="muted" style={{ fontSize: 12.5 }}>{t("Email")}</label>
            <input
              className="input" type="email" style={{ marginTop: 4, marginBottom: 16 }}
              value={profileForm.email}
              onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
            />

            <div className="muted" style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 8, borderTop: "1px solid var(--line-2)", paddingTop: 14 }}>
              {t("Change password (optional)")}
            </div>
            <label className="muted" style={{ fontSize: 12.5 }}>{t("Current password")}</label>
            <input
              className="input" type="password" style={{ marginTop: 4, marginBottom: 12 }}
              value={profileForm.currentPassword}
              onChange={(e) => setProfileForm({ ...profileForm, currentPassword: e.target.value })}
            />
            <label className="muted" style={{ fontSize: 12.5 }}>{t("New password")}</label>
            <input
              className="input" type="password" style={{ marginTop: 4, marginBottom: 12 }}
              value={profileForm.newPassword}
              onChange={(e) => setProfileForm({ ...profileForm, newPassword: e.target.value })}
            />
            <label className="muted" style={{ fontSize: 12.5 }}>{t("Confirm new password")}</label>
            <input
              className="input" type="password" style={{ marginTop: 4, marginBottom: 16 }}
              value={profileForm.confirmPassword}
              onChange={(e) => setProfileForm({ ...profileForm, confirmPassword: e.target.value })}
            />

            {profileErr && <div style={{ color: "var(--scc-red)", fontSize: 12.5, marginBottom: 12 }}>{profileErr}</div>}

            <div className="row" style={{ gap: 10, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => setEditingProfile(false)} disabled={profileSaving}>{t("Cancel")}</button>
              <button className="btn btn-primary" onClick={saveProfile} disabled={profileSaving}>
                {profileSaving ? t("Saving…") : t("Save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Your access card ---------------------------------------------
          Renamed from "Permissions" (was also just a flat dump of raw
          camelCase keys like "manageDelegates" — internal implementation
          detail, not something a non-technical staff member should have to
          parse) to a grouped, human-labelled summary using the same
          label/chip text Account Control's own editor shows for these same
          permissions (2026-07-24). */}
      <div className="card" style={{ marginTop: 16, padding: 22 }}>
        <div className="row" style={{ gap: 8, marginBottom: 14 }}>
          <ShieldCheck size={18} color="var(--ink-3)" />
          <h2 style={{ fontSize: 16 }}>{t("Your access")}</h2>
        </div>
        {isAdmin ? (
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <span className="badge badge-missing">{t("Full access")}</span>
            <span className="muted" style={{ fontSize: 13 }}>{t("Admins can see and do everything in MusterGo.")}</span>
          </div>
        ) : PERM_SECTIONS.every((section) => !PERMISSIONS.some((p) => p.group === section.key && perms[p.key])) ? (
          <div className="muted" style={{ fontSize: 13 }}>{t("No special permissions on this account.")}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {PERM_SECTIONS.map((section) => {
              const items = PERMISSIONS.filter((p) => p.group === section.key && perms[p.key]);
              if (items.length === 0) return null;
              return (
                <div key={section.key}>
                  <div className="muted" style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 8 }}>
                    {t(section.title)}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {items.map((p) => (
                      <span key={p.key} className="badge badge-neutral">{t(p.chip)}</span>
                    ))}
                  </div>
                </div>
              );
            })}
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

        <div className="row between" style={{ padding: "12px 0 0" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{t("Alert sound")}</div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
              {t(alertMuted
                ? "Muted on this device — the escalation banner and email still work as normal."
                : "Plays a chime when a new escalation comes in on this device.")}
            </div>
          </div>
          <button className="btn btn-ghost" onClick={toggleAlertMuted}>
            {alertMuted ? <BellOff size={16} /> : <Bell size={16} />}
            {t(alertMuted ? "Unmute" : "Mute")}
          </button>
        </div>
      </div>

      {/* ---- Checkpoint reset window (manageTrips-gated) -----------------
          Was gated on manageDelegates, which most onsite staff already have
          by default — meaning ordinary staff could see and CHANGE a
          trip-wide scanning/itinerary config from Settings. This is really a
          trip-management setting, so it now requires manageTrips instead
          (false by default for Onsite Headcount Staff, true for Admin Staff
          (Web)) — matches the same permission Desmond's Trips board itself
          requires to edit anything (2026-07-24, "some part are not suppose
          to let staff see"). */}
      {perms.manageTrips && (
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
