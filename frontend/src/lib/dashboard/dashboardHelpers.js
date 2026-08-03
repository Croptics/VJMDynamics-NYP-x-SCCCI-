/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Dashboard pure display/formatting helpers
 *
 *  Extracted from DashboardPage.jsx (2026-08-02 modularization pass). All
 *  pure functions — no state, no hooks — shared by DashboardPage.jsx,
 *  DashboardWidgets.jsx, RoomManagementTab.jsx, and CheckpointHistoryTab.jsx.
 * ============================================================================= */

/* ---- Coach display helpers ----------------------------------------------
 * Coaches added outside the original seed may have no city, or a long label
 * ("Coach 5" instead of "C5") — never render "null" or overflow the avatar.
 * ------------------------------------------------------------------------- */
export function coachDisplayName(c) {
  return [c.name, c.city].filter(Boolean).join(" · ");
}

export function coachShortLabel(c) {
  if (c.label && c.label.length <= 3) return c.label;
  const num = String(c.label || c.name || "").match(/\d+/);
  return num ? `C${num[0]}` : String(c.label || c.name || "?").slice(0, 2).toUpperCase();
}

/** Format a delegate's upload timestamp (createdAt) as e.g. "12 Jul, 14:30".
 *  Older rows created before the column existed still get the migration time,
 *  so this only shows "—" if the value is genuinely missing/unparseable. */
// Display-only 12h formatting for checkpoint scheduledTime (2026-07-30 —
// "do the same for these"). scheduledTime is a raw 24h "HH:MM" string from
// the checkpoints API; nothing here sorts or compares it, so this only
// prettifies what actually gets printed. Same one-line helper as
// TripCoachPage.jsx/MobileTripsPage.jsx — kept local per this codebase's
// existing per-file small-helper pattern rather than a shared import.
export function fmt12h(hhmm) {
  if (!hhmm) return hhmm;
  const [h, m] = String(hhmm).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${period}`;
}
// trip.departsIn ("04:53") is a COUNTDOWN duration, not a clock time — running
// it through fmt12h would print the nonsensical "4:53 AM" for "4 hours 53
// minutes from now". This reformats it as a duration instead ("4h 53m"),
// fixing the same "looks like raw 24h military time" complaint honestly.
// Only reached as a fallback now, for a trip with no departureTime/startDate
// set yet — see liveDepartsIn() below, which is preferred whenever the
// backend can compute a real departureAt.
export function fmtDepartsIn(hhmm) {
  if (!hhmm) return hhmm;
  const [h, m] = String(hhmm).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}
// Genuine live countdown (2026-07-30 — "i see this one nvr change, is it
// static?" — it was: trip.departsIn was a hardcoded seed string that never
// moved). trip.departureAt is a real absolute instant computed server-side
// from startDate + totalDays + the new departureTime field (getTrip(),
// db/dashboard.js) — recomputing the diff against "right now" on every render
// is what makes this actually tick down, unlike the old static string. Called
// from render, not stored in state — it piggybacks on nowClock's existing 15s
// re-render tick rather than running its own second timer for one more field.
// Returns null once departure has passed, so the chip disappears instead of
// showing a stale "0h -3m".
export function liveDepartsIn(departureAtIso) {
  if (!departureAtIso) return null;
  const diffMs = new Date(departureAtIso).getTime() - Date.now();
  if (!(diffMs > 0)) return null;
  const totalMin = Math.round(diffMs / 60000);
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export function fmtUploadDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d)) return "—";
  return d.toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** "Staff operations" active-sessions relative time, e.g. "15s ago" / "2m ago". */
export function staffOpsTimeAgo(iso, t) {
  if (!iso) return "";
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 10) return t("just now");
  if (secs < 60) return `${secs}${t("s ago")}`;
  return `${Math.round(secs / 60)}${t("m ago")}`;
}

// Composition bar (boarded/late/missing against capacity) — a SINGLE div
// painted with a hard-stop CSS gradient, not multiple flex children. One box
// means one height, guaranteed identical every time (no cross-browser flex-
// child-height edge cases), and the track's own border-radius/overflow:hidden
// naturally rounds both ends with no per-segment corner logic needed. Used by
// both the Coach status card (CoachBar, in DashboardWidgets.jsx) and the
// Reverse headcount modal, so both show the same composition the same way
// (2026-07-24 —
// previously a single flat red-or-green fill in both places, so two coaches
// both "in trouble" looked identical whether one was mostly Late or mostly
// Missing).

// Same flat, solid-block flex-bar as RosterCard's "Roster breakdown" bar
// (2026-07-24 — "you can look at roster breakdown, that look much
// cleaner") — plain `<span>` children sized by width%, no gradient/gap/
// minimum-width tricks. Percentages are relative to the coach's total seat
// capacity (not just the sum of these 3 segments), so the un-rendered
// remainder is genuinely "still to board", shown via the container's own
// background rather than an explicit 4th segment.
export function coachBarSegments(coach, { includeBoarded = true } = {}) {
  const cap = coach.capacity || Math.max(coach.total || 0, 1);
  const segs = [
    ...(includeBoarded ? [{ n: coach.boarded || 0, tone: "present" }] : []),
    { n: coach.late || 0, tone: "late" },
    { n: coach.missing || 0, tone: "missing" },
  ]
    .map((s) => ({ ...s, pct: Math.max(0, Math.round((s.n / cap) * 100)) }))
    .filter((s) => s.pct > 0);
  // Rounding each % independently can sum to just over 100 (e.g. 34+33+34) —
  // shave the excess off the last segment so it never overflows the bar.
  const totalPct = segs.reduce((sum, s) => sum + s.pct, 0);
  if (totalPct > 100) segs[segs.length - 1].pct = Math.max(0, segs[segs.length - 1].pct - (totalPct - 100));
  return segs;
}

/** Activity text comes from the backend as plain English ("Lim added",
 *  "All delegates removed (3)"), since it's stored as-is in the log. Rebuild
 *  it with the translated verb rather than adding a whole new API shape. */
export function translateActivityText(text, t) {
  const allMatch = text.match(/^All delegates removed \((\d+)\)$/);
  if (allMatch) return `${t("All delegates removed")} (${allMatch[1]})`;
  const verbMatch = text.match(/^(.*) (added|updated|removed)$/);
  if (verbMatch) return `${verbMatch[1]} ${t(verbMatch[2])}`;
  return text;
}

export function activityColor(kind) {
  if (kind === "exception") return "var(--st-missing)";
  if (kind === "reassign") return "var(--st-unassigned)";
  // 2026-07-27 — escalations now log here too (see routes/escalations.js).
  if (kind === "escalation") return "var(--st-missing)";
  return "var(--st-present)";
}

// Bumps a room number's trailing digits by `delta`, preserving any prefix
// and zero-padding (e.g. "12A" -> "13A", "05" -> "06") — room numbers are
// free text (some trips prefix a block letter), not a plain integer, so a
// naive Number(value)+1 would break on anything non-numeric.
export function bumpRoomNumber(value, delta) {
  const str = String(value ?? "");
  const m = str.match(/^(.*?)(\d+)(\D*)$/);
  if (!m) return delta > 0 ? `${str}1` : str; // nothing to decrement from
  const [, prefix, digits, suffix] = m;
  const next = Math.max(0, parseInt(digits, 10) + delta);
  return prefix + String(next).padStart(digits.length, "0") + suffix;
}
