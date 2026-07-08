/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Admin Dashboard, Auth, Accounts & Permissions
 * ============================================================================= */
/**
 * Signed session tokens + auth middleware, shared by server.js and any
 * teammate route files (e.g. routes/insights.js) that need to require a
 * signed-in caller.
 *
 * Tokens are JWTs signed with JWT_SECRET (set it in backend/.env for
 * production — see .env.example). Without it, a random-looking but fixed
 * dev default is used so local dev still works, with a console warning.
 */

import jwt from "jsonwebtoken";
import { getAccountByUsername, accountPermissions } from "./data.js";

const JWT_SECRET = process.env.JWT_SECRET || "mustergo-dev-insecure-default-change-me";
if (!process.env.JWT_SECRET) {
  console.warn(
    "  WARNING: JWT_SECRET is not set in backend/.env — using an insecure default.\n" +
    "  Set JWT_SECRET to a long random string before deploying anywhere public.\n"
  );
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Issue a signed session token for a username. */
export function makeToken(username) {
  return jwt.sign({ username }, JWT_SECRET, { expiresIn: "7d" });
}

/** Resolve the calling account from a valid, signed Authorization: Bearer token. */
export async function accountFromReq(req) {
  const auth = req.headers.authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  let payload;
  try {
    payload = jwt.verify(m[1], JWT_SECRET);
  } catch {
    return null; // missing/expired/tampered token
  }
  return (await getAccountByUsername(payload.username)) || null;
}

/** Gate a route on being signed in (any account), no specific permission required. */
export function requireAuth() {
  return wrap(async (req, res, next) => {
    const acc = await accountFromReq(req);
    if (!acc) return res.status(401).json({ error: "UNAUTHENTICATED", message: "Please sign in again." });
    req.account = acc;
    next();
  });
}

/** Gate a route on a specific permission. */
export function requirePermission(perm) {
  return wrap(async (req, res, next) => {
    const acc = await accountFromReq(req);
    if (!acc) return res.status(401).json({ error: "UNAUTHENTICATED", message: "Please sign in again." });
    if (!accountPermissions(acc)[perm]) {
      return res.status(403).json({ error: "FORBIDDEN", message: "You don't have permission for that action." });
    }
    req.account = acc;
    next();
  });
}
