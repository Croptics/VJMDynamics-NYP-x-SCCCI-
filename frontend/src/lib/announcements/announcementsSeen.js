/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — App shell & navigation
 *
 *  Tiny localStorage helper backing the Announcements sidebar badge
 *  (2026-07-26 — "if i create new post, can you put the number, just like
 *  the exception page show 1"). Per-trip, per-browser "last seen" timestamp:
 *  the badge counts announcements created after this timestamp, and visiting
 *  AnnouncementsPage.jsx clears it back to "now".
 * ============================================================================= */

const SEEN_KEY_PREFIX = "mg_ann_seen_";

/** ISO timestamp of the last time this browser viewed this trip's Announcements page, or null if never. */
export function getAnnouncementsSeenAt(tripId) {
  if (!tripId) return null;
  try {
    return localStorage.getItem(SEEN_KEY_PREFIX + tripId);
  } catch {
    return null;
  }
}

/** Mark this trip's announcements as seen as of right now — clears the badge. */
export function markAnnouncementsSeenNow(tripId) {
  if (!tripId) return;
  try {
    localStorage.setItem(SEEN_KEY_PREFIX + tripId, new Date().toISOString());
  } catch {
    /* storage unavailable (private mode etc.) — badge just won't clear, not fatal */
  }
}

/** How many of the given announcements were created after the last-seen mark. */
export function countUnseenAnnouncements(tripId, announcements) {
  const seenAt = getAnnouncementsSeenAt(tripId);
  const seenMs = seenAt ? Date.parse(seenAt) : 0;
  return (announcements || []).filter((a) => Date.parse(a.createdAt) > seenMs).length;
}
