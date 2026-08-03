/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Account control's shared permission-checkbox UI
 *
 *  Extracted from AccountControlPage.jsx (2026-08-02 modularization pass) —
 *  used by both the account modal and the "Manage roles" template editor
 *  (RoleTemplatesModal.jsx), so the two checkbox UIs can never drift apart.
 * ============================================================================= */
import { ChevronDown, ChevronRight } from "lucide-react";
import { PERMISSIONS } from "../../../lib/permissions.js";
import { S } from "../../../lib/accountcontrol/accountControlStyles.js";

// The three labelled, collapsible sections the modal's checkboxes are
// grouped into — order matches how an admin thinks about it: what can this
// account DO, then what can it SEE on desktop, then what can it SEE on
// mobile. `selectAll: true` adds a "Select all / Deselect all" toggle to
// that section's header — only the two view groups get one (the request
// that added this was specifically "select all for desktop and mobile");
// Feature actions is short enough, and typically NOT all-or-nothing per
// account, to not need one.
const PERM_GROUPS = [
  { key: "action", title: "Feature actions", desc: "What this account can create, edit or delete" },
  { key: "desktopView", title: "Desktop web views", desc: "Which pages this account can see on the desktop dashboard", selectAll: true },
  { key: "mobileView", title: "Mobile views", desc: "Which tabs this account can see in the mobile app", selectAll: true },
];

// Renders one permission checkbox, then recurses into its children indented
// underneath — supports any nesting depth (currently 2 levels are used:
// dashboard -> Delegate -> History logs), not just direct parent/child.
export function PermRow({ perm, perms, onToggle, childrenOf, t }) {
  const kids = childrenOf(perm.key);
  return (
    <div>
      <label style={S.permRow}>
        <input
          type="checkbox"
          checked={!!perms[perm.key]}
          onChange={() => onToggle(perm.key)}
          style={{ marginTop: 3 }}
        />
        <span>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{t(perm.label)}</span>
          <span className="muted" style={{ display: "block", fontSize: 12 }}>{t(perm.desc)}</span>
        </span>
      </label>
      {kids.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8, marginLeft: 26, borderLeft: "2px solid var(--line)", paddingLeft: 12 }}>
          {kids.map((cp) => (
            <PermRow key={cp.key} perm={cp} perms={perms} onToggle={onToggle} childrenOf={childrenOf} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Shared permission-checkbox groups renderer — used by both the account
 *  modal and the "Manage roles" template editor, so the two don't drift
 *  into two slightly-different checkbox UIs (2026-07-24 extraction). */
export function PermissionCheckboxGroups({ perms, onToggle, collapsedGroups, onToggleCollapsed, onSelectAllInGroup, t }) {
  return (
    <>
      {PERM_GROUPS.map((g) => {
        // adminOnly permissions (e.g. manageAccounts) never render as a
        // toggle here — only a real Admin should ever grant/revoke
        // everyone else's access (see permissions.js's adminOnly doc).
        const allPerms = PERMISSIONS.filter((p) => p.group === g.key && !p.adminOnly);
        if (allPerms.length === 0) return null;
        const topLevel = allPerms.filter((p) => !p.parent || !allPerms.some((pp) => pp.key === p.parent));
        const childrenOf = (key) => allPerms.filter((p) => p.parent === key);
        const collapsed = collapsedGroups.has(g.key);
        const allChecked = allPerms.every((p) => !!perms[p.key]);
        return (
          <div key={g.key} style={{ marginTop: 18 }}>
            <div className="row between" style={{ alignItems: "flex-start", gap: 8 }}>
              <button
                type="button"
                onClick={() => onToggleCollapsed(g.key)}
                aria-expanded={!collapsed}
                style={{
                  background: "none", border: "none", padding: 0, cursor: "pointer",
                  display: "flex", alignItems: "flex-start", gap: 6, textAlign: "left", flex: 1,
                }}
              >
                {collapsed ? <ChevronRight size={16} style={{ marginTop: 2, flexShrink: 0, color: "var(--ink-3)" }} />
                           : <ChevronDown size={16} style={{ marginTop: 2, flexShrink: 0, color: "var(--ink-3)" }} />}
                <span>
                  <span className="field-label" style={{ display: "block" }}>{t(g.title)}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{t(g.desc)}</span>
                </span>
              </button>
              {g.selectAll && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: "5px 10px", flexShrink: 0 }}
                  onClick={() => onSelectAllInGroup(g.key, !allChecked)}
                >
                  {allChecked ? t("Deselect all") : t("Select all")}
                </button>
              )}
            </div>
            {!collapsed && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                {topLevel.map((p) => (
                  <PermRow key={p.key} perm={p} perms={perms} onToggle={onToggle} childrenOf={childrenOf} t={t} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
