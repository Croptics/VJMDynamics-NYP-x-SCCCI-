/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Account control pure permission helpers
 *
 *  Extracted from AccountControlPage.jsx.
 * ============================================================================= */
import { PERMISSIONS } from "../permissions.js";

// An individual ACCOUNT's access is set by two dropdowns (Desktop / Mobile ×
// CRUD|Read-only), not the checkbox tree — that tree now only builds named
// TEMPLATES in "Manage roles".
//
// View permissions are always granted (everyone can SEE every page); the
// dropdowns only control WRITE capability. Action keys split by surface:
// desktop-only pages follow the desktop dropdown, while Scanner/Exceptions
// exist on both, so either dropdown grants them and BOTH must be Read-only
// to revoke.
const DESKTOP_ONLY_ACTION_KEYS = ["manageDelegates", "exportData", "viewDelegateDetails", "manageTrips", "manageDocuments", "manageAnnouncements"];
const SHARED_ACTION_KEYS = ["manageScanner", "manageExceptions"];

/** Derived, not stored: "crud" if this surface's action keys are granted.
 *  Also used to see what the other dropdown implies before recomputing a
 *  shared key. */
export function accessLevelFor(perms, surface) {
  const keys = surface === "desktop" ? DESKTOP_ONLY_ACTION_KEYS : SHARED_ACTION_KEYS;
  return keys.some((k) => perms?.[k]) ? "crud" : "readonly";
}

/** Recomputes a full perms object from the two dropdown states. Shared keys
 *  follow whichever dropdown says "crud", so mobile Scanner access survives
 *  Desktop being Read-only. manageAccounts is adminOnly and never granted
 *  here regardless of dropdown state. */
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

// Named staff access templates live server-side (/api/role-templates). A
// template is only a starting point — the permission SET is what's enforced.
// The "Access role" label is therefore DERIVED by exact-matching current
// permissions, never a stored tag: that way editing or deleting a template
// can't retroactively change what an existing account can do, and a
// hand-edited account correctly falls back to "Custom".
export function matchRoleTemplate(permissions, templates) {
  for (const tpl of templates) {
    if (Object.entries(tpl.permissions).every(([k, v]) => !!permissions?.[k] === v)) return tpl.id;
  }
  return null;
}

// Must mirror the backend check in data.js. Returns a message, or null if ok.
export const PW_HINT = "At least 8 characters, including a letter and a number.";
export function passwordProblem(pw) {
  const s = String(pw || "");
  if (s.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Za-z]/.test(s)) return "Password must include at least one letter.";
  if (!/[0-9]/.test(s)) return "Password must include at least one number.";
  return null;
}
