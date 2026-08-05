/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Admin Dashboard, Auth, Accounts & Permissions
 * ============================================================================= */
/**
 * Signed session tokens + auth middleware, shared by server.js and teammate
 * route files (e.g. routes/dashboard/insights.js) needing a signed-in caller.
 *
 * Tokens are JWTs signed with JWT_SECRET (set it in backend/.env for
 * production — see .env.example). Without it a FIXED dev default is used so
 * local dev still works; that default is insecure, hence the console warning.
 */

import jwt from "jsonwebtoken";
import { getAccountByUsername, accountPermissions } from "../data.js";
import { wrap } from "./wrap.js";

const JWT_SECRET = process.env.JWT_SECRET || "mustergo-dev-insecure-default-change-me";
if (!process.env.JWT_SECRET) {
  console.warn(
    "  WARNING: JWT_SECRET is not set in backend/.env — using an insecure default.\n" +
    "  Set JWT_SECRET to a long random string before deploying anywhere public.\n"
  );
}

/** Issue a signed session token for a username at a given token version. */
export function makeToken(username, tokenVersion = 0) {
  return jwt.sign({ username, tv: tokenVersion }, JWT_SECRET, { expiresIn: "7d" });
}

/**
 * Issue a scoped, PASSWORDLESS kiosk token for the entrance scanner.
 *
 * It carries `{ kiosk: true }` and NO username on purpose: accountFromReq()
 * resolves callers by username, so a kiosk token returns null there and is
 * therefore REJECTED by requireAuth()/requirePermission() — it grants nothing
 * anywhere EXCEPT endpoints that explicitly opt in via requireKioskOrAuth().
 * Short-lived (8h ≈ one event shift). See KioskScannerPage.jsx and the public
 * POST /api/auth/kiosk mint endpoint (server.js).
 */
export function signKioskToken() {
  return jwt.sign({ kiosk: true }, JWT_SECRET, { expiresIn: "8h" });
}

/** True iff the request carries a valid, unexpired kiosk token. */
function kioskTokenValid(req) {
  const auth = req.headers.authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1] : req.query?.token;
  if (!token) return false;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return payload && payload.kiosk === true;
  } catch {
    return false;
  }
}

/** Resolve the calling account from a valid, signed Authorization: Bearer token. */
export async function accountFromReq(req) {
  const auth = req.headers.authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  // EventSource (SSE) cannot set request headers, so routes that stream (e.g.
  // the live exceptions feed) pass ?token= instead — accept either.
  const token = m ? m[1] : req.query?.token;
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return null; // missing/expired/tampered token
  }
  const account = await getAccountByUsername(payload.username);
  if (!account) return null;
  // Single active session: reject a token whose version is behind the account's
  // current one (i.e. a newer login has since happened on another device).
  if ((account.token_version ?? 0) !== (payload.tv ?? 0)) return null;
  return account;
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

/**
 * Gate for the passwordless kiosk's camera check-in endpoints (POST
 * /attendance/scan, POST /onboarding/checkin) and its checkpoint-list read
 * (GET /trips/:id/checkpoints — labels/times aren't sensitive delegate data).
 * Accepts a signed-in account OR a valid kiosk token; a kiosk token maps to
 * the dedicated `__kiosk__` account (seeded in data.js) so writes that
 * foreign-key onto accounts.id (e.g. check_in_logs.checked_in_by) still work.
 * The kiosk token stays powerless everywhere else — checkpoint stats/admin
 * CRUD stay on requireAuth/requirePermission (see checkpoints.js).
 */
export function requireKioskOrAuth() {
  return wrap(async (req, res, next) => {
    const acc = await accountFromReq(req);
    if (acc) { req.account = acc; return next(); }
    if (kioskTokenValid(req)) {
      const kiosk = await getAccountByUsername("__kiosk__");
      if (kiosk) { req.account = { ...kiosk, isKiosk: true }; return next(); }
    }
    return res.status(401).json({ error: "UNAUTHENTICATED", message: "Please sign in again." });
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

/**
 * Gate for the READ side of Account control (GET routes only). Passes for
 * "manageAccounts" OR a read-only Admin: accountPermissions() in
 * db/accounts.js zeroes "manageAccounts" for read-only admins along with every
 * other action key, so a plain requirePermission() would lock them out of even
 * VIEWING the page they're meant to have full visibility of. Mutating routes
 * stay on requirePermission("manageAccounts"), which they correctly fail.
 */
export function requireAccountsView() {
  return wrap(async (req, res, next) => {
    const acc = await accountFromReq(req);
    if (!acc) return res.status(401).json({ error: "UNAUTHENTICATED", message: "Please sign in again." });
    const isReadOnlyAdmin = acc.role === "admin" && !!acc.readOnly;
    if (!accountPermissions(acc).manageAccounts && !isReadOnlyAdmin) {
      return res.status(403).json({ error: "FORBIDDEN", message: "You don't have permission for that action." });
    }
    req.account = acc;
    next();
  });
}

/**
 * Like requireKioskOrAuth(), but the SIGNED-IN-SESSION path additionally
 * requires `perm`. The kiosk-token path deliberately carries no per-permission
 * check — the kiosk exists so a device with no login can still scan. Used on
 * the camera check-in endpoints, gated on "manageScanner" for a real session.
 */
export function requireKioskOrPermission(perm) {
  return wrap(async (req, res, next) => {
    const acc = await accountFromReq(req);
    if (acc) {
      if (!accountPermissions(acc)[perm]) {
        return res.status(403).json({ error: "FORBIDDEN", message: "You don't have permission for that action." });
      }
      req.account = acc;
      return next();
    }
    if (kioskTokenValid(req)) {
      const kiosk = await getAccountByUsername("__kiosk__");
      if (kiosk) { req.account = { ...kiosk, isKiosk: true }; return next(); }
    }
    return res.status(401).json({ error: "UNAUTHENTICATED", message: "Please sign in again." });
  });
}
