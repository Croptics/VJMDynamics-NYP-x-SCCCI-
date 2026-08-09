/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — server-side per-trip authorisation
 * ============================================================================= */
/**
 * "May this account act on this trip at all?" — enforced SERVER-SIDE.
 *
 * WHY: trip separation was UI-only. Every trip-scoped route was `requireAuth()`
 * (or a permission check) with no check on WHICH trip the caller asked for, so
 * any signed-in staff account could read or write another trip's data just by
 * passing a different tripId — boarding passes, activity log, check-ins. The
 * front end hid those trips; the API happily served them. AI Log 262.
 *
 * DELIBERATELY NOT modelled on db/dashboard.js's getVisibleCoachIds(), whose
 * `null` return means "no restriction" AND is also returned when a staff account
 * has no coaches on the trip — so an unassigned account reads as unrestricted.
 * That's fine for its filtering use, but as an authorisation primitive it fails
 * open, which is the wrong default. These functions return plain booleans/Sets
 * and fail CLOSED.
 *
 * Rule: an admin sees every trip (matching the "Full access" concept the rest of
 * the app already uses). Anyone else may act only on a trip where they captain
 * at least one coach. A staff member with no captaincy has no trip access — the
 * same conclusion the mobile shell reaches when it hides Ops/QR/Face for them.
 */
import { all, get } from "../db/connection.js";

/** Trip uuids this account may touch, or `null` meaning "all trips" (admin). */
export async function accountTripIds(account) {
  if (!account) return new Set();
  if (account.role === "admin") return null;
  const rows = await all(
    `SELECT DISTINCT c.trip_id AS id
       FROM coach_captains cc
       JOIN coaches c ON c.id = cc.coach_id
      WHERE cc.account_id = $1 AND c.trip_id IS NOT NULL`,
    [account.id]
  );
  return new Set(rows.map((r) => r.id));
}

/** True if `account` may act on `tripUuid`. Missing account/trip => false. */
export async function canAccessTrip(account, tripUuid) {
  if (!account || !tripUuid) return false;
  if (account.role === "admin") return true;
  const ids = await accountTripIds(account);
  return ids.has(tripUuid);
}

/**
 * Guard for a route handler. Returns true when the request may proceed;
 * otherwise it has ALREADY sent a 403 and the caller must return immediately:
 *
 *   if (!(await guardTrip(req, res, tripUuid))) return;
 */
export async function guardTrip(req, res, tripUuid) {
  if (await canAccessTrip(req.account, tripUuid)) return true;
  res.status(403).json({
    error: "TRIP_FORBIDDEN",
    message: "You're not assigned to this trip. Ask an admin to assign you to a coach on it.",
  });
  return false;
}

/** The trip a checkpoint (itinerary item) belongs to, or null. */
export async function tripIdForCheckpoint(checkpointId) {
  const row = await get(`SELECT trip_id FROM itinerary_items WHERE id = $1`, [checkpointId]);
  return row?.trip_id || null;
}
