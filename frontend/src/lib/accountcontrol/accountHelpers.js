/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Account control pure permission helpers
 *
 *  Extracted from AccountControlPage.jsx (2026-08-02 modularization pass).
 * ============================================================================= */
import { PERMISSIONS } from "../permissions.js";

// Simplified New/Edit account form (2026-07-31 — "when I add new account,
// just need 2 dropdown: Desktop web view [CRUD/Read-only], Mobile view
// [CRUD/Read-only]. Keep it simple.") — replaces the "Apply an access role"
// template picker + full per-permission checkbox tree that used to be the
// ONLY way to set a Staff account's access, with two dropdowns. The detailed
// checkbox tree still exists and is unchanged — it's what "Manage roles"
// (the named access-TEMPLATE editor) uses to build a template in the first
// place; this is just no longer how an individual ACCOUNT's access is set.
//
// Every desktopView/mobileView permission is always granted (an account can
// always SEE every page/tab) — the two dropdowns only ever control WRITE
// capability, which is what "CRUD" vs "Read-only" actually means. Action
// permissions split into which surface can exercise them: some pages
// (Trips board, Onboarding, Announcements, delegate CRUD) only exist on
// desktop; Scanner and Exceptions have a real UI on BOTH desktop and mobile,
// so either dropdown alone can grant them, and both must say Read-only to
// revoke them.
const DESKTOP_ONLY_ACTION_KEYS = ["manageDelegates", "exportData", "viewDelegateDetails", "manageTrips", "manageDocuments", "manageAnnouncements"];
const SHARED_ACTION_KEYS = ["manageScanner", "manageExceptions"];

/** "crud" if this surface's own action keys are currently granted, else
 *  "readonly" — used both to render the dropdown's current value (when
 *  editing an existing account, however its permissions actually got set)
 *  and to know what the OTHER dropdown currently implies before recomputing
 *  a shared key. Not a stored value — just a read of `perms`. */
export function accessLevelFor(perms, surface) {
  const keys = surface === "desktop" ? DESKTOP_ONLY_ACTION_KEYS : SHARED_ACTION_KEYS;
  return keys.some((k) => perms?.[k]) ? "crud" : "readonly";
}

/** Recomputes a full perms object from the two dropdown states. Desktop/
 *  mobile VIEW permissions are always true; DESKTOP_ONLY_ACTION_KEYS follow
 *  the desktop dropdown alone; SHARED_ACTION_KEYS follow whichever dropdown
 *  says "crud" (an account with mobile Scanner access shouldn't lose it just
 *  because Desktop is set to Read-only, and vice versa). manageAccounts is
 *  never granted here — adminOnly, a Staff account can never have it
 *  regardless of dropdown state. */
export function applyAccessLevels(perms, desktopLevel, mobileLevel) {
  const next = { ...perms };
  for (const p of PERMISSIONS) {
    if (p.key === "manageAccounts") { next[p.key] = false; continue; }
    if (p.group === "desktopView" || p.group === "mobileView") next[p.key] = true;
  }
  for (const k of DESKTOP_ONLY_ACTION_KEYS) next[k] = desktopLevel === "crud";
  for (const k of SHARED_ACTION_KEYS) next[k] = desktopLevel === "crud" || mobileLevel === "crud";
  return next;
}

// Named STAFF access templates (2026-07-24) — a real SCCCI deployment has
// many staff with only a couple of real job shapes, not 50 individually
// hand-ticked permission sets. Persisted server-side now (GET/POST/PATCH/
// DELETE /api/role-templates — see "Manage roles" below), so admins can
// rename/edit/delete the 2 defaults or add their own, not just the 2
// hardcoded ones this started as. "Apply" quick-fills the checkboxes below
// (the permission set is still what's actually enforced/stored — a template
// is just a starting point, fully editable after applying); the Accounts
// list's "Access role" filter shows which template each staff account's
// CURRENT permissions exactly match, so you can see who's in charge of what
// at a glance. An account whose permissions don't exactly match any template
// (including a template account someone has since hand-edited, or a
// template that's since been deleted) shows as "Custom" — this is
// intentionally a DERIVED label (computed fresh from the permission set),
// not a stored tag, so it can never drift out of sync with what's actually
// enforced, and deleting/editing a template can never retroactively change
// what an existing account can do.
export function matchRoleTemplate(permissions, templates) {
  for (const tpl of templates) {
    if (Object.entries(tpl.permissions).every(([k, v]) => !!permissions?.[k] === v)) return tpl.id;
  }
  return null;
}

// Password rule (mirrors the backend check in data.js). Returns a message, or
// null if the password is acceptable.
export const PW_HINT = "At least 8 characters, including a letter and a number.";
export function passwordProblem(pw) {
  const s = String(pw || "");
  if (s.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Za-z]/.test(s)) return "Password must include at least one letter.";
  if (!/[0-9]/.test(s)) return "Password must include at least one number.";
  return null;
}
