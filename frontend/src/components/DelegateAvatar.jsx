/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Delegate widgets
 * ============================================================================= */
/**
 * Full 5-state status → color mapping for profile-card-style elements (this
 * avatar, and the delegate Edit modal's photo/status header in
 * DashboardPage.jsx) — kept separate from StatusBadge.jsx's STATE_MAP
 * (badge className + label) since these consumers need raw fg/bg CSS
 * variables to theme a container, not a pill class.
 *
 * UNASSIGNED gets a dedicated muted GREY (--st-neutral) rather than the
 * amber --st-unassigned used for badges/KPI tiles elsewhere — those two
 * spellings of "unassigned" are deliberately different: amber there means
 * "needs a coach, pay attention"; grey here means "no live status yet, not
 * urgent." The other four keep the SAME tokens already used everywhere else
 * in the app (StatusBadge, coach cards, etc.) — no new colors invented.
 */
const STATUS_TONE = {
  UNASSIGNED: { fg: "var(--st-neutral)", bg: "var(--st-neutral-bg)" },
  ASSIGNED: { fg: "var(--st-assigned)", bg: "var(--st-assigned-bg)" },
  // PRESENT kept as a legacy alias — some check-in routes still write it
  // directly (see normalize() in backend/data.js), aliased to ARRIVED's tone.
  PRESENT: { fg: "var(--st-present)", bg: "var(--st-present-bg)" },
  ARRIVED: { fg: "var(--st-present)", bg: "var(--st-present-bg)" },
  LATE: { fg: "var(--st-late)", bg: "var(--st-late-bg)" },
  MISSING: { fg: "var(--st-missing)", bg: "var(--st-missing-bg)" },
};

export function statusTone(status) {
  return STATUS_TONE[status] || STATUS_TONE.UNASSIGNED;
}

/**
 * Renders a delegate's profile photo if they have one, otherwise falls back
 * to the existing initials-in-a-circle ".avatar" look everywhere avatars are
 * already used. Same box size/shape either way, so it drops in anywhere a
 * plain <span className="avatar">{initials}</span> was used before.
 *
 * Status-tinted across all 5 states (was MISSING=red / everyone-else=green
 * — an UNASSIGNED delegate's placeholder avatar was incorrectly showing
 * green, as if already accounted for). The ring uses boxShadow (not border)
 * so it never changes the box size — avatars stay pixel-aligned in tables.
 */
export default function DelegateAvatar({ delegate, size = 28, style }) {
  const { fg, bg } = statusTone(delegate?.status);

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
