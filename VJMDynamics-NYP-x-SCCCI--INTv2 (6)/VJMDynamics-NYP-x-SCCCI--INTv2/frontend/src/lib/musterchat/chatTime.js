/* =============================================================================
 *  OWNED BY:  Vance — MusterChat shared time formatting
 * ============================================================================= */
// Was five near-identical `const hhmm = (iso) => ...toLocaleTimeString("en-GB",
// { hour: "2-digit", minute: "2-digit" })...` copies across HumanThread,
// GroupThread, QuickChat, MusterChatInbox and AssistantConversation — all
// 24-hour. Centralised here (2026-07-31, "put the time in 12hr format ...
// set like date like ytd etc") so every surface switches together.

/** "9:33 PM" — 12-hour clock with AM/PM, no leading zero. */
export function formatClock(iso) {
  try { return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }); }
  catch { return ""; }
}

function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

/** Relative day label for a date-separator pill inside a message thread:
 *  "Today" / "Yesterday" / "Mon, 28 Jul" (this year) / "28 Jul 2025" (older). */
export function dayLabel(iso) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const today = startOfDay(now);
    const yesterday = new Date(today.getTime() - 86400000);
    const day = startOfDay(d);
    if (day.getTime() === today.getTime()) return "Today";
    if (day.getTime() === yesterday.getTime()) return "Yesterday";
    const opts = d.getFullYear() === now.getFullYear()
      ? { weekday: "short", day: "2-digit", month: "short" }
      : { day: "2-digit", month: "short", year: "numeric" };
    return d.toLocaleDateString("en-GB", opts);
  } catch { return ""; }
}

/** True when two timestamps fall on the same calendar day. */
export function isSameDay(isoA, isoB) {
  try { return startOfDay(new Date(isoA)).getTime() === startOfDay(new Date(isoB)).getTime(); }
  catch { return false; }
}

/** Sidebar/list preview stamp — a clock for today, else the same relative
 *  day label used for thread separators ("Yesterday", "28 Jul"). */
export function formatListStamp(iso) {
  const label = dayLabel(iso);
  return label === "Today" ? formatClock(iso) : label;
}
