/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Admin Dashboard, Auth, Accounts & Permissions
 * ============================================================================= */
/** Display name of the account performing a write, recorded on each
 * activity_log entry so the History tracker shows WHO made the change (not a
 * generic "you"). requirePermission()/requireAuth() set req.account. */
export const actorOf = (req) => req.account?.name || req.account?.username || null;
