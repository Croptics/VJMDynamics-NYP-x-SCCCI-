/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — offline read cache
 * ============================================================================= */
/**
 * Cached READS — the read half of "must work with no signal"; outbox.js is the
 * write half.
 *
 * Deliberately NOT cache-first: the network request always runs first, and the
 * cache is only a fallback when the request never reached the server (same
 * isOfflineError definition outbox.js uses). A real server error (403, 500,
 * revoked session) must still surface, cache or not — masking it with stale
 * data hides the actual problem.
 *
 * Callers MUST surface the `stale` flag (see CachedDataBadge.jsx). This is a
 * live headcount app; unlabelled cached data means someone acts on a snapshot
 * that has since changed. The badge is the point, not a nicety.
 */

const PREFIX = "mg_cache_v1:";

function store() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null; // Safari private mode etc.
  }
}

/** Cached value for this key, or null if missing/corrupted. Internal only. */
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
    /* quota exceeded / storage unavailable — this render is fine, there just
     * won't be a fallback next time offline. */
  }
}

/** Never reached the server (fetch() rejected, no `.status`) vs. a real HTTP
 *  error response. Must match outbox.js's isOfflineError(). */
function isOfflineError(err) {
  return !err || err.status === undefined || err.status === 0;
}

/**
 * Wrap one apiGet(...)-style call with a read cache.
 *   cachedFetch("delegates:t-1", () => apiGet(`/trips/t-1/delegates`))
 *
 * Resolves to { data, stale, at }. Offline with a cache resolves stale instead
 * of throwing; offline with no cache, or any real 4xx/5xx, rethrows.
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
