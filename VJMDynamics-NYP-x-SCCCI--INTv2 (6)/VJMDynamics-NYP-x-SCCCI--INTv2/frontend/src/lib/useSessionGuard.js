/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — auth / session
 * ============================================================================= */
import { useEffect, useRef } from "react";
import { apiGet, getUser, getPermissions, updateSession } from "./api.js";
import { translate } from "./i18n.jsx";

// How often (ms) to re-check session validity: an admin edited/deleted this
// account, or someone logged into it elsewhere (which bumps token_version
// server-side). Also re-checks on tab focus so switching back catches it sooner.
const SESSION_CHECK_INTERVAL_MS = 15000;

/**
 * Polls GET /api/auth/session and force-logs-out on a 401 or on a
 * permissions/username change. Shared by the desktop Layout AND MobileLayout —
 * mobile must run it too, or a mobile session invalidated elsewhere keeps
 * looking "active" while every API call silently fails.
 */
export function useSessionGuard(onLogout) {
  const checkingRef = useRef(false);

  useEffect(() => {
    async function checkSession() {
      if (checkingRef.current) return; // avoid overlapping checks
      checkingRef.current = true;
      try {
        const fresh = await apiGet("/auth/session");
        const before = getUser() || {};
        const beforePerms = getPermissions();
        const changed =
          fresh.username !== before.username ||
          JSON.stringify(fresh.permissions) !== JSON.stringify(beforePerms);
        if (changed) {
          forceLogout("Your account access was updated. Please sign in again.");
          return;
        }
        // Sync display-only fields from the backend. Without this they'd only
        // ever be written by the Settings page's self-edit save, so a value set
        // server-side (e.g. email at registration) would never surface.
        // `role` and `id` are here for the same reason: a session cached from
        // before login started returning them has none, which broke the
        // Sidebar's role label and every delegate "did I create this?" check.
        // Syncing self-corrects on the next poll or focus, no re-login needed.
        if (fresh.email !== before.email || fresh.photoUrl !== before.photoUrl || fresh.name !== before.name || fresh.role !== before.role || fresh.readOnly !== before.readOnly || fresh.id !== before.id) {
          updateSession({ user: { email: fresh.email, photoUrl: fresh.photoUrl, name: fresh.name, role: fresh.role, readOnly: fresh.readOnly, id: fresh.id } });
        }
      } catch (e) {
        // 401 = token resolves to no account (renamed/deleted, or a newer login
        // elsewhere). Any other error (backend briefly unreachable) is ignored
        // deliberately — retry next tick rather than log the user out.
        if (e.status === 401) {
          forceLogout("Your account is no longer valid. Please sign in again.");
        }
      } finally {
        checkingRef.current = false;
      }
    }

    function forceLogout(message) {
      window.alert(translate(message));
      onLogout?.(); // clears the token and returns to /login (see App.jsx)
    }

    const interval = setInterval(checkSession, SESSION_CHECK_INTERVAL_MS);
    const onFocus = () => checkSession();
    window.addEventListener("focus", onFocus);
    checkSession(); // also check once on mount

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
