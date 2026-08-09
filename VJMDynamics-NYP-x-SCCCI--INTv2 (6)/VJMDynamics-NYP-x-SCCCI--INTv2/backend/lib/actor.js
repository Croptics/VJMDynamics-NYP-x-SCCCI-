/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Admin Dashboard, Auth, Accounts & Permissions
 * ============================================================================= */
/** Display name of the account performing a write, recorded on each activity_log
 * entry so History shows WHO changed it. req.account is set by
 * requirePermission()/requireAuth(). */
export const actorOf = (req) => req.account?.name || req.account?.username || null;
