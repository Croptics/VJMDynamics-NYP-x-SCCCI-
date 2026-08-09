/* =============================================================================
 *  OWNED BY:  Vance — MusterChat contact avatar. Staff accounts can have a
 *  real profile photo (set in Settings, same "photoUrl" the sidebar/topbar
 *  already show) — this renders it when present, falling back to the
 *  initials-in-a-circle every contact used to show unconditionally
 *  (2026-07-31, "can the message staff profile have the profile image").
 *  Delegates never have a photoUrl (only accounts do), so they always fall
 *  through to initials — same as before.
 * ============================================================================= */
const initialsOf = (n) => (n || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

export default function ContactAvatar({ name, kind, photoUrl, style }) {
  if (photoUrl) {
    return <img src={photoUrl} alt={name || ""} className="avatar" style={{ objectFit: "cover", ...style }} />;
  }
  return (
    <span className="avatar" style={{ background: kind === "delegate" ? "var(--ink-2)" : "var(--scc-red)", color: "#fff", ...style }}>
      {initialsOf(name)}
    </span>
  );
}
