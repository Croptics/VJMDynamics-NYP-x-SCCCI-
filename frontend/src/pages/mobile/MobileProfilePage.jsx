import { useRef, useState } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { LogOut, ShieldCheck, HelpCircle, ChevronRight, Settings, Moon, Sun, Languages, Zap, Monitor, Smartphone, ChevronDown, Pencil, Mail, X, Camera, Trash2 } from "lucide-react";
import { getUser, getPermissions, clearToken, apiPatch, apiPost, apiDelete, updateSession } from "../../lib/api.js";
import { useLang } from "../../lib/i18n.jsx";
import { useTheme } from "../../lib/theme.jsx";
import PasskeyManager from "../../components/PasskeyManager.jsx";
// Profile photo (2026-07-31 — "mobile add profile add image") — reuses the
// EXACT same crop/upload flow SettingsPage.jsx's desktop self-service profile
// already has (POST/DELETE /api/auth/me/photo), just via mobile's native file
// picker instead of desktop's "take a photo (webcam) / upload a file" menu —
// a phone's own file picker already offers "Camera" as one of its options,
// so there's no separate getUserMedia capture step needed here.
import PhotoCropModal from "../../components/PhotoCropModal.jsx";
// Same source Account control's Edit-role modal reads (2026-07-30 — "organise
// this permission part, improve the uiux") — this page was dumping raw
// camelCase keys (`viewMobileAllTrips`, `manageAnnouncements`...) as a flat,
// unlabelled, ungrouped wall of badges, which meant reading your own account
// meant knowing the codebase's internal permission names. Reusing PERMISSIONS
// means the label/grouping here can never drift from what an admin sees when
// actually editing this account's role — one source of truth, not a second
// copy that quietly goes stale.
import { PERMISSIONS } from "../../lib/permissions.js";

/**
 * Mobile Profile — signed-in user info + logout, mirroring the account
 * block in the desktop Sidebar but as its own page.
 */
export default function MobileProfilePage() {
  const { t, lang, toggleLang } = useLang();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const { onLogout } = useOutletContext() || {};
  const user = getUser() || {};
  const perms = getPermissions();
  const displayName = user.name || user.staffId || t("Signed in");
  const initials = displayName.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  // Same badge desktop's Account card shows (2026-07-30 — "for mobile part,
  // follow like desktop one", after "remove jq" there) — role, not the raw
  // Staff ID, which read as a bug rather than useful information here.
  const roleLabel = t(user.role === "admin" ? "Admin" : "Staff");

  // Edit profile (2026-07-30 — "i want the exact stuff/feature on desktop to
  // mobile"): mirrors SettingsPage.jsx's own edit flow field-for-field
  // (same PATCH /auth/me endpoint, same response shape), just in a mobile
  // bottom sheet instead of a centered modal — this page never had ANY
  // profile-editing capability before, only a read-only name+username block.
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileErr, setProfileErr] = useState(null);
  // Profile photo — same PATCH-adjacent flow as SettingsPage.jsx (see the
  // import comment above).
  const [cropFile, setCropFile] = useState(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [enlargePhoto, setEnlargePhoto] = useState(false);
  const fileInputRef = useRef(null);
  function pickPhoto() { fileInputRef.current?.click(); }
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
    } catch (e) {
      setProfileErr(e.message);
    } finally {
      setPhotoBusy(false);
    }
  }
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
      name: user.name || "", username: user.username || "", email: user.email || "",
      phone: user.phone || "", currentPassword: "", newPassword: "", confirmPassword: "",
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
    setProfileSaving(true); setProfileErr(null);
    try {
      const patch = {
        name: profileForm.name.trim(), username: profileForm.username.trim(),
        email: profileForm.email.trim(), phone: profileForm.phone.trim(),
      };
      if (profileForm.newPassword) {
        patch.currentPassword = profileForm.currentPassword;
        patch.newPassword = profileForm.newPassword;
      }
      const result = await apiPatch("/auth/me", patch);
      updateSession({ token: result.token, user: result.account });
      setEditingProfile(false);
    } catch (e) {
      setProfileErr(PROFILE_ERR_TEXT[e.code] || e.message);
    } finally {
      setProfileSaving(false);
    }
  }

  function handleLogout() {
    if (onLogout) onLogout();
    else {
      clearToken();
      window.location.assign("/login");
    }
  }

  // Group + label using the SAME metadata Account control's role editor uses
  // (see the import comment above), rather than the raw `Object.entries(perms)`
  // key dump this page used to render. `GROUPS` controls section order/icon/
  // heading; a group with zero active permissions is omitted entirely rather
  // than shown empty. `activeCount` drives which groups start expanded (see
  // below) and lets an admin-heavy account collapse the long lists by default.
  const GROUPS = [
    { key: "action", label: t("What you can do"), icon: Zap },
    { key: "desktopView", label: t("Desktop pages you can see"), icon: Monitor },
    { key: "mobileView", label: t("Mobile tabs you can see"), icon: Smartphone },
  ];
  const grouped = GROUPS.map((g) => ({
    ...g,
    items: PERMISSIONS.filter((p) => p.group === g.key && perms[p.key]),
  })).filter((g) => g.items.length > 0);
  const totalActive = grouped.reduce((n, g) => n + g.items.length, 0);
  // Collapsed by default ONLY when there's enough to actually be worth
  // collapsing (an admin can easily have 20+ across all three groups) — a
  // short list just stays open, since collapsing 3 items saves no one
  // anything and only adds a click.
  const [expandedGroups, setExpandedGroups] = useState(() =>
    new Set(totalActive > 8 ? [] : grouped.map((g) => g.key))
  );
  const toggleGroup = (key) => setExpandedGroups((prev) => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  return (
    <div className="m-fade-in">
      <div className="m-eyebrow">{t("Profile")}</div>
      <h1 className="m-page-title" style={{ marginBottom: 16 }}>{displayName}</h1>

      <div className="mobile-card row between" style={{ gap: 12, alignItems: "flex-start" }}>
        <div className="row" style={{ gap: 12, minWidth: 0 }}>
          <div style={{ position: "relative", flexShrink: 0 }}>
            {user.photoUrl ? (
              <img
                src={user.photoUrl}
                alt=""
                onClick={() => setEnlargePhoto(true)}
                style={{ width: 44, height: 44, borderRadius: "50%", objectFit: "cover", cursor: "pointer", border: "1px solid var(--line)" }}
              />
            ) : (
              <span className="avatar" style={{ width: 44, height: 44, background: "var(--scc-red-tint)", color: "var(--scc-red)", fontSize: 15 }}>
                {initials}
              </span>
            )}
            <button
              onClick={pickPhoto}
              disabled={photoBusy}
              aria-label={t("Change photo")}
              title={t("Change photo")}
              style={{
                position: "absolute", right: -2, bottom: -2, width: 18, height: 18, borderRadius: "50%",
                background: "var(--surface)", border: "1px solid var(--line)", display: "grid", placeItems: "center",
                cursor: photoBusy ? "default" : "pointer", boxShadow: "0 1px 3px rgba(0,0,0,0.25)", padding: 0,
              }}
            >
              <Camera size={10} />
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={onPhotoChosen} style={{ display: "none" }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{displayName}</div>
            <span className="badge badge-neutral" style={{ padding: "1px 8px", fontSize: 11, marginTop: 3, display: "inline-block" }}>{roleLabel}</span>
            {user.email && (
              <div className="row muted" style={{ fontSize: 12, gap: 5, alignItems: "center", marginTop: 6, overflow: "hidden" }}>
                <Mail size={12} style={{ flexShrink: 0 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</span>
              </div>
            )}
            {user.photoUrl && (
              <button
                className="btn btn-ghost"
                onClick={removePhoto}
                disabled={photoBusy}
                style={{ fontSize: 11.5, padding: "2px 8px", height: "auto", marginTop: 5 }}
              >
                <Trash2 size={11} /> {t("Remove photo")}
              </button>
            )}
          </div>
        </div>
        <button className="btn btn-ghost" style={{ flexShrink: 0, padding: "6px 10px", fontSize: 12.5 }} onClick={openEditProfile}>
          <Pencil size={13} /> {t("Edit profile")}
        </button>
      </div>

      {cropFile && (
        <PhotoCropModal file={cropFile} onCancel={() => setCropFile(null)} onSave={handleCropSave} t={t} />
      )}
      {enlargePhoto && user.photoUrl && (
        <div
          onClick={() => setEnlargePhoto(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "grid", placeItems: "center", zIndex: 60, cursor: "zoom-out" }}
        >
          <img src={user.photoUrl} alt="" style={{ maxWidth: "min(80vw, 480px)", maxHeight: "80vh", borderRadius: 12 }} />
        </div>
      )}
      {profileErr && !editingProfile && (
        <div style={{ color: "var(--scc-red)", fontSize: 12.5, marginTop: -8, marginBottom: 12 }}>{profileErr}</div>
      )}

      {editingProfile && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,0.45)", display: "flex", alignItems: "flex-end", zIndex: 60 }}
          onClick={() => !profileSaving && setEditingProfile(false)}
        >
          <div className="card" style={{ width: "100%", borderRadius: "16px 16px 0 0", padding: 18, paddingBottom: 26, maxHeight: "86vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div className="row between" style={{ marginBottom: 14 }}>
              <h2 style={{ fontSize: 16 }}>{t("Edit profile")}</h2>
              <button onClick={() => setEditingProfile(false)} style={{ background: "none", border: "none", color: "var(--ink-3)", display: "flex" }} aria-label={t("Close")}>
                <X size={18} />
              </button>
            </div>

            <label className="muted" style={{ fontSize: 12.5 }}>{t("Name")}</label>
            <input className="input" style={{ marginTop: 4, marginBottom: 12 }}
              value={profileForm.name} onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })} />

            <label className="muted" style={{ fontSize: 12.5 }}>{t("Username")}</label>
            <input className="input" style={{ marginTop: 4, marginBottom: 12 }}
              value={profileForm.username} onChange={(e) => setProfileForm({ ...profileForm, username: e.target.value })} />

            <label className="muted" style={{ fontSize: 12.5 }}>{t("Email")}</label>
            <input className="input" type="email" style={{ marginTop: 4, marginBottom: 12 }}
              value={profileForm.email} onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })} />

            <label className="muted" style={{ fontSize: 12.5 }}>{t("Contact number")}</label>
            <input className="input" type="tel" style={{ marginTop: 4, marginBottom: 16 }}
              placeholder={t("Optional — e.g. +65 9123 4567")}
              value={profileForm.phone} onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })} />

            <div className="muted" style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 8, borderTop: "1px solid var(--line-2)", paddingTop: 14 }}>
              {t("Change password (optional)")}
            </div>
            <label className="muted" style={{ fontSize: 12.5 }}>{t("Current password")}</label>
            <input className="input" type="password" style={{ marginTop: 4, marginBottom: 12 }}
              value={profileForm.currentPassword} onChange={(e) => setProfileForm({ ...profileForm, currentPassword: e.target.value })} />
            <label className="muted" style={{ fontSize: 12.5 }}>{t("New password")}</label>
            <input className="input" type="password" style={{ marginTop: 4, marginBottom: 12 }}
              value={profileForm.newPassword} onChange={(e) => setProfileForm({ ...profileForm, newPassword: e.target.value })} />
            <label className="muted" style={{ fontSize: 12.5 }}>{t("Confirm new password")}</label>
            <input className="input" type="password" style={{ marginTop: 4, marginBottom: 16 }}
              value={profileForm.confirmPassword} onChange={(e) => setProfileForm({ ...profileForm, confirmPassword: e.target.value })} />

            {profileErr && <div style={{ color: "var(--scc-red)", fontSize: 12.5, marginBottom: 12 }}>{profileErr}</div>}

            <div className="row" style={{ gap: 10 }}>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setEditingProfile(false)} disabled={profileSaving}>{t("Cancel")}</button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={saveProfile} disabled={profileSaving}>
                {profileSaving ? t("Saving…") : t("Save")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mobile-card">
        {/* marginBottom 4 -> 12 (2026-07-30 — "add some gap for permission and
            what you can do"): at 4px the header's own bottom margin plus the
            first group's zero top-margin/border left almost no visible gap
            before "What you can do", reading like the heading and the first
            group ran together. */}
        <div className="row between" style={{ marginBottom: grouped.length ? 12 : 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <ShieldCheck size={16} color="var(--ink-3)" />
            <span style={{ fontWeight: 600, fontSize: 14 }}>{t("Permissions")}</span>
          </div>
          {totalActive > 0 && (
            <span className="muted" style={{ fontSize: 12 }}>{totalActive} {t("granted")}</span>
          )}
        </div>
        {grouped.length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>{t("No special permissions on this account.")}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {grouped.map((g, i) => {
              const isOpen = expandedGroups.has(g.key);
              const Icon = g.icon;
              return (
                <div key={g.key} style={{ borderTop: i > 0 ? "1px solid var(--line)" : "none", paddingTop: i > 0 ? 10 : 0, marginTop: i > 0 ? 10 : 0 }}>
                  <button
                    onClick={() => toggleGroup(g.key)}
                    className="row between"
                    style={{ width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", color: "inherit" }}
                    aria-expanded={isOpen}
                  >
                    <span className="row" style={{ gap: 7, fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}>
                      <Icon size={14} style={{ flexShrink: 0 }} /> {g.label}
                      <span className="muted" style={{ fontWeight: 400 }}>({g.items.length})</span>
                    </span>
                    <ChevronDown size={15} color="var(--ink-3)" style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s ease", flexShrink: 0 }} />
                  </button>
                  {isOpen && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 9 }}>
                      {/* Real label + description, not the raw `key` — a
                          teammate/staff member reading their own account
                          shouldn't need to know the codebase's internal
                          permission names to understand what they can do. */}
                      {g.items.map((p) => (
                        <span
                          key={p.key}
                          className="badge badge-neutral"
                          title={p.desc}
                        >
                          {t(p.label)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Preferences — appearance + language (moved here from the topbar). */}
      <div className="mobile-card">
        <div className="row" style={{ gap: 8, marginBottom: 10 }}>
          <Settings size={16} color="var(--ink-3)" />
          <span style={{ fontWeight: 600, fontSize: 14 }}>{t("Preferences")}</span>
        </div>
        <button className="m-row" onClick={toggleTheme} aria-label={t("Toggle appearance")}>
          <span className="avatar" style={{ background: "var(--scc-red-tint)", color: "var(--scc-red)" }}>
            {theme === "dark" ? <Moon size={15} /> : <Sun size={15} />}
          </span>
          <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{t("Appearance")}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--scc-red)" }}>
            {theme === "dark" ? t("Dark") : t("Light")}
          </span>
        </button>
        <button className="m-row" onClick={toggleLang} aria-label={t("Toggle language")}>
          <span className="avatar" style={{ background: "var(--scc-red-tint)", color: "var(--scc-red)" }}>
            <Languages size={15} />
          </span>
          <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{t("Language")}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--scc-red)" }}>
            {lang === "en" ? "English" : "中文"}
          </span>
        </button>
      </div>

      {/* Biometric sign-in — register this device's Face ID / fingerprint so
          the login page can offer it instead of a typed password. */}
      <PasskeyManager t={t} />

      <button
        className="mobile-card row between"
        style={{ width: "100%", cursor: "pointer", border: "1px solid var(--line)" }}
        onClick={() => navigate("/mobile-user-guide")}
      >
        <span className="row" style={{ gap: 10 }}>
          <HelpCircle size={18} color="var(--ink-3)" />
          <span style={{ fontWeight: 600, fontSize: 14 }}>{t("User guide")}</span>
        </span>
        <ChevronRight size={16} color="var(--ink-3)" />
      </button>

      <button className="btn btn-ghost btn-block" onClick={handleLogout} style={{ marginTop: 8 }}>
        <LogOut size={16} /> {t("Log out")}
      </button>
    </div>
  );
}
