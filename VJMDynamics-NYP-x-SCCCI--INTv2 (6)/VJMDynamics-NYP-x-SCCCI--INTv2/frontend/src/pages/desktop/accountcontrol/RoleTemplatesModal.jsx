/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Account control's "Manage roles" modal
 *
 *  Extracted from AccountControlPage.jsx (2026-08-02 modularization pass).
 * ============================================================================= */
import { useState, useRef } from "react";
import { X, Pencil, Trash2, AlertTriangle, UserPlus } from "lucide-react";
import { apiPost, apiPatch, apiDelete } from "../../../lib/api.js";
import { PERMISSIONS, DEFAULT_PERMISSIONS } from "../../../lib/permissions.js";
import { S } from "../../../lib/accountcontrol/accountControlStyles.js";
import { PermissionCheckboxGroups } from "./PermissionControls.jsx";

/** "Manage roles" — create/edit/delete the named access templates (2026-07-24).
 *  List view + an inline create/edit form (reuses PermissionCheckboxGroups,
 *  same component the account modal uses, so the two checkbox UIs can never
 *  drift apart). A template is just a server-stored PRESET — deleting or
 *  editing one never changes any existing account's actual permissions
 *  (those live only in accounts.permissions); it only changes what shows up
 *  as a quick-fill option / which "bucket" an account's permissions
 *  currently fall into on the Access-role filter. */
export function RoleTemplatesModal({ templates, onClose, onChanged, t }) {
  const [editing, setEditing] = useState(null); // null | "new" | template object
  const [form, setForm] = useState({ label: "", perms: {} });
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const downOnBackdrop = useRef(false);

  function openNew() {
    setForm({ label: "", perms: { ...DEFAULT_PERMISSIONS } });
    setCollapsedGroups(new Set());
    setError("");
    setEditing("new");
  }
  function openEdit(tpl) {
    setForm({ label: tpl.label, perms: { ...tpl.permissions } });
    setCollapsedGroups(new Set());
    setError("");
    setEditing(tpl);
  }
  function togglePerm(key) {
    setForm((f) => ({ ...f, perms: { ...f.perms, [key]: !f.perms[key] } }));
  }
  function setAllInGroup(groupKey, value) {
    setForm((f) => {
      const perms = { ...f.perms };
      for (const p of PERMISSIONS) if (p.group === groupKey) perms[p.key] = value;
      return { ...f, perms };
    });
  }
  function toggleGroupCollapsed(groupKey) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey); else next.add(groupKey);
      return next;
    });
  }

  async function save() {
    if (!form.label.trim()) { setError(t("A role name is required.")); return; }
    setSaving(true); setError("");
    try {
      if (editing === "new") await apiPost("/role-templates", { label: form.label.trim(), permissions: form.perms });
      else await apiPatch(`/role-templates/${editing.id}`, { label: form.label.trim(), permissions: form.perms });
      await onChanged();
      setEditing(null);
    } catch (e) {
      setError(e.message || t("Could not save this role."));
    } finally {
      setSaving(false);
    }
  }

  async function remove(tpl) {
    const msg = t("Delete the \"") + tpl.label + t("\" role template? Accounts already using these permissions keep them — this only removes the quick-fill option and the filter entry.");
    if (!window.confirm(msg)) return;
    try {
      await apiDelete(`/role-templates/${tpl.id}`);
      await onChanged();
    } catch (e) {
      setError(e.message || t("Could not delete this role."));
    }
  }

  return (
    <div style={S.overlay}
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) onClose(); }}>
      <div className="card" style={{ ...S.modal, width: "min(560px, 100%)" }} onClick={(e) => e.stopPropagation()}>
        <div className="row between" style={{ marginBottom: 14 }}>
          <h2 style={{ fontSize: 17 }}>{editing ? (editing === "new" ? t("New role") : t("Edit role")) : t("Manage roles")}</h2>
          <button onClick={editing ? () => setEditing(null) : onClose} style={S.iconBtn} aria-label={t("Close")}><X size={18} /></button>
        </div>

        {!editing ? (
          <>
            <p className="muted" style={{ fontSize: 13, marginTop: 0, marginBottom: 14 }}>
              {t("Named, fine-grained permission presets for the Accounts list's Access-role filter and badges — the New/Edit account form itself now uses the two simple Desktop/Mobile access dropdowns instead of applying a template directly.")}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {templates.map((tpl) => (
                <div key={tpl.id} className="row between" style={{ padding: "10px 12px", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{tpl.label}</div>
                  <div className="row" style={{ gap: 6 }}>
                    <button onClick={() => openEdit(tpl)} aria-label={`${t("Edit")} ${tpl.label}`} style={S.iconBtn}><Pencil size={16} /></button>
                    <button onClick={() => remove(tpl)} aria-label={`${t("Delete")} ${tpl.label}`} style={{ ...S.iconBtn, color: "var(--st-missing)" }}><Trash2 size={16} /></button>
                  </div>
                </div>
              ))}
              {templates.length === 0 && <div className="muted" style={{ fontSize: 13 }}>{t("No role templates yet.")}</div>}
            </div>
            {error && <div style={S.formErr}><AlertTriangle size={15} /> {t(error)}</div>}
            <div className="row" style={{ gap: 10, marginTop: 18, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={onClose}>{t("Close")}</button>
              <button className="btn btn-primary" onClick={openNew}><UserPlus size={16} /> {t("New role")}</button>
            </div>
          </>
        ) : (
          <>
            <label className="field-label">{t("Role name")}</label>
            <input className="input" autoFocus value={form.label}
              placeholder={t("e.g. Documents Desk")}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />

            <PermissionCheckboxGroups
              perms={form.perms}
              onToggle={togglePerm}
              collapsedGroups={collapsedGroups}
              onToggleCollapsed={toggleGroupCollapsed}
              onSelectAllInGroup={setAllInGroup}
              t={t}
            />

            {error && <div style={S.formErr}><AlertTriangle size={15} /> {t(error)}</div>}
            <div className="row" style={{ gap: 10, marginTop: 18, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => setEditing(null)} disabled={saving}>{t("Cancel")}</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? t("Saving…") : t("Save role")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
