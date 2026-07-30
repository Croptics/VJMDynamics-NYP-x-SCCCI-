/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — auth / session
 * ============================================================================= */
import { useEffect, useRef } from "react";
import { apiGet, getUser, getPermissions, updateSession } from "./api.js";
import { translate } from "./i18n.jsx";

// How often (ms) to re-check whether the session is still valid — e.g. an
// admin edited/deleted this account, or (the reason this now runs on mobile
// too) someone logged into this same account elsewhere, which invalidates
// this token server-side via token_version. Also re-checks immediately
// whenever the tab regains focus, so switching back catches it sooner.
const SESSION_CHECK_INTERVAL_MS = 15000;

/**
 * Polls GET /api/auth/session and force-logs-out on a 401 (token no longer
 * valid — renamed/deleted account, or someone else logged into this account
 * elsewhere) or a permissions/username change. Shared by the desktop Layout
 * and MobileLayout so a session ends everywhere it's actually invalidated,
 * not just wherever happens to notice on its own — previously only the
 * desktop shell ran this check, so a mobile session logged in elsewhere
 * would keep looking "active" (just failing every API call) instead of
 * being cleanly logged out.
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
        // Keep the stored user object's display-only fields (email, photo,
        // name) in sync with the backend (2026-07-24) — previously these
        // only ever got written by the Settings page's own self-edit save,
        // so an account's email could be set on the backend (e.g. via
        // registration) yet never actually show up anywhere in the UI until
        // the user happened to open Settings and hit Save once.
        // role added to this sync (2026-07-30 — "change the jq part to
        // either admin or staff"): a session cached from before login
        // started storing `role` had none at all, so the Sidebar's role
        // label fell back to showing the raw Staff ID, which read as a bug.
        // Syncing it here means that self-corrects on the next 15s poll or
        // tab focus, without needing a fresh login.
        if (fresh.email !== before.email || fresh.photoUrl !== before.photoUrl || fresh.name !== before.name || fresh.role !== before.role || fresh.readOnly !== before.readOnly) {
          updateSession({ user: { email: fresh.email, photoUrl: fresh.photoUrl, name: fresh.name, role: fresh.role, readOnly: fresh.readOnly } });
        }
      } catch (e) {
        // 401 means the token no longer resolves to any account — it was
        // renamed/deleted, or a newer login elsewhere invalidated it. Any
        // other error (e.g. the backend being briefly unreachable) is
        // ignored; we just try again next tick.
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
