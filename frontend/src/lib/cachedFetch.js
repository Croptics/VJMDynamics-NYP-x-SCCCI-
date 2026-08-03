/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — offline read cache
 * ============================================================================= */
/**
 * Cached reads (2026-07-31, "add local storage... everything ... but important
 * one is the manual, attendance, exception, trip"). Pairs with outbox.js's
 * offline WRITE queue to close the other half of "the app must still work
 * with no signal": outbox.js already lets a write survive going offline —
 * this is for READS, so opening a page with no signal shows the last-known
 * data instead of a blank error screen.
 *
 * Deliberately NOT a cache-first "always trust localStorage" scheme — every
 * call still tries the real network request FIRST. The cache only kicks in
 * as a fallback when that request never reached the server at all (the same
 * `isOfflineError` definition outbox.js uses: fetch() itself failed — no
 * `.status` — not a real server response). A genuine server error (403, 500,
 * a revoked session) always surfaces as an error, even with a cache sitting
 * right there — silently showing stale data on top of a real failure would
 * hide the actual problem instead of explaining it.
 *
 * Callers MUST show the `stale` flag somewhere visible (see
 * CachedDataBadge.jsx) — this is a live headcount/attendance app; showing
 * cached data with no indicator risks someone acting on a snapshot that's
 * since changed (a delegate marked missing 10 minutes ago may already be
 * found). The badge is the whole point, not an optional nicety.
 */

const PREFIX = "mg_cache_v1:";

function store() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null; // Safari private mode etc.
  }
}

/** Read whatever's cached for this key, or null if nothing/corrupted.
 *  Internal only (2026-08-02 audit — nothing outside this file ever imports
 *  it, same as its setCached sibling below). */
function getCached(key) {
  const s = store();
  if (!s) return null;
  try {
    const raw = JSON.parse(s.getItem(PREFIX + key) || "null");
    if (!raw || typeof raw !== "object" || !("data" in raw)) return null;
    return raw; // { data, at }
  } catch {
    return null; // corrupted — behave as if nothing were cached
  }
}

function setCached(key, data) {
  const s = store();
  if (!s) return;
  try {
    s.setItem(PREFIX + key, JSON.stringify({ data, at: new Date().toISOString() }));
  } catch {
    /* quota exceeded, or storage unavailable — the fetch result still renders
     * this time, it just won't be there to fall back on next time offline. */
  }
}

/** Same definition outbox.js's isOfflineError() uses: a request that never
 *  reached the server (fetch() rejected — no `.status`), as opposed to a
 *  real HTTP error response the server actually sent back. */
function isOfflineError(err) {
  return !err || err.status === undefined || err.status === 0;
}

/**
 * Wrap a single apiGet(...)-style call with a read cache.
 *   cachedFetch("delegates:t-1", () => apiGet(`/trips/t-1/delegates`))
 *
 * Resolves to { data, stale, at }:
 *  - Real request succeeded → { data: <fresh>, stale: false, at: now }, and
 *    the cache is updated for next time.
 *  - Real request failed to reach the server AND a cache exists →
 *    { data: <cached>, stale: true, at: <when it was cached> } — never
 *    throws, so the caller can render something instead of an error state.
 *  - Real request failed to reach the server, nothing cached → rethrows
 *    (there's genuinely nothing to show).
 *  - Real request reached the server but the server said no (4xx/5xx) →
 *    always rethrows, even with a cache — see the file header on why.
 */
export async function cachedFetch(key, fetchFn) {
  try {
    const data = await fetchFn();
    setCached(key, data);
    return { data, stale: false, at: new Date().toISOString() };
  } catch (err) {
    if (isOfflineError(err)) {
      const cached = getCached(key);
      if (cached) return { data: cached.data, stale: true, at: cached.at };
    }
    throw err;
  }
}
