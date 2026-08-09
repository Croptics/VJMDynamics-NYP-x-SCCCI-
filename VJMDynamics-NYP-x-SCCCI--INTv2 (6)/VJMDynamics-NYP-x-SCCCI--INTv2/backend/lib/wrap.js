/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Admin Dashboard, Auth, Accounts & Permissions
 * ============================================================================= */
/** Wraps an async Express handler so a rejected promise becomes a 500 via
 * the error-handling middleware, instead of crashing the process. Shared by
 * server.js and every backend/routes/*.js file. */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
