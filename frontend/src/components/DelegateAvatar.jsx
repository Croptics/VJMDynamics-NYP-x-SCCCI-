/**
 * Renders a delegate's profile photo if they have one, otherwise falls back
 * to the existing initials-in-a-circle ".avatar" look everywhere avatars are
 * already used. Same box size/shape either way, so it drops in anywhere a
 * plain <span className="avatar">{initials}</span> was used before.
 */
export default function DelegateAvatar({ delegate, size = 28, style }) {
  if (delegate?.photoUrl) {
    return (
      <img
        src={delegate.photoUrl}
        alt=""
        className="avatar"
        style={{ width: size, height: size, objectFit: "cover", ...style }}
      />
    );
  }
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4, ...style }}>
      {delegate?.initials}
    </span>
  );
}
