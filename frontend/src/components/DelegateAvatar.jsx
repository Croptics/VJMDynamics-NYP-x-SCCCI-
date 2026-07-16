/**
 * Renders a delegate's profile photo if they have one, otherwise falls back
 * to the existing initials-in-a-circle ".avatar" look everywhere avatars are
 * already used. Same box size/shape either way, so it drops in anywhere a
 * plain <span className="avatar">{initials}</span> was used before.
 *
 * Status-tinted: a MISSING delegate's avatar is coloured/ringed RED, everyone
 * else keeps the standard GREEN. This makes a placeholder (no-photo) avatar
 * signal attendance at a glance, and once a delegate is marked PRESENT the
 * avatar reverts to green automatically. The ring uses boxShadow (not border)
 * so it never changes the box size — avatars stay pixel-aligned in tables.
 */
export default function DelegateAvatar({ delegate, size = 28, style }) {
  const isMissing = delegate?.status === "MISSING";
  const fg = isMissing ? "var(--st-missing)" : "var(--st-present)";
  const bg = isMissing ? "var(--st-missing-bg)" : "var(--st-present-bg)";

  if (delegate?.photoUrl) {
    return (
      <img
        src={delegate.photoUrl}
        alt=""
        className="avatar"
        style={{ width: size, height: size, objectFit: "cover", boxShadow: `0 0 0 2px ${fg}`, ...style }}
      />
    );
  }
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.4, background: bg, color: fg, boxShadow: `inset 0 0 0 1.5px ${fg}`, ...style }}
    >
      {delegate?.initials}
    </span>
  );
}
