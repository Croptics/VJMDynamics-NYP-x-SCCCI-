/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Admin Dashboard, Auth, Accounts & Permissions
 * ============================================================================= */
/**
 * Tiny fixed-window in-memory rate limiter for the auth routes, to blunt
 * password brute-forcing. Keyed by client IP. WARNING: no shared store, so
 * behind a load balancer each instance counts separately — a real deployment
 * needs Redis or express-rate-limit.
 */
export function rateLimit({ windowMs, max, message }) {
  const hits = new Map(); // ip -> { count, resetAt }
  // Opportunistic cleanup so the Map can't grow unbounded over a long uptime.
  setInterval(() => {
    const now = Date.now();
    for (const [ip, rec] of hits) if (rec.resetAt <= now) hits.delete(ip);
  }, windowMs).unref?.();

  const mw = (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    const now = Date.now();
    const rec = hits.get(ip);
    if (!rec || rec.resetAt <= now) {
      hits.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (rec.count >= max) {
      const retryAfter = Math.ceil((rec.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ error: "RATE_LIMITED", message });
    }
    rec.count += 1;
    next();
  };
  // Let a route clear an IP's counter on success, so a legit user isn't
  // penalised for their earlier typos.
  mw.clear = (req) => hits.delete(req.ip || req.socket?.remoteAddress || "unknown");
  return mw;
}
