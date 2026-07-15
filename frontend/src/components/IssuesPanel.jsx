/* =============================================================================
 *  OWNED BY:  Jayden — Exception Logging, Critical Alerts & QR check-in
 *
 *  Mobile exception logging for the staff app's "Issues" tab (Figma Screen 10).
 *  Self-contained: it builds on Jayden's own data layer (exceptionsApi.js),
 *  which in turn uses the shared lib/api.js — so it inherits token storage and
 *  typed errors. It touches no other teammate's feature.
 *
 *  Logging a ticket and resolving one both require the `manageExceptions`
 *  permission (see permissions.js). The panel gates its controls on that
 *  permission and degrades to a read-only view without it, rather than firing
 *  requests that would 403.
 * ============================================================================= */

import { useEffect, useState, useCallback, useRef } from "react";
import {
  UserX, BadgeX, BatteryLow, Crown, AlertTriangle, CheckCircle2,
  Clock, ShieldAlert, Inbox,
} from "lucide-react";
import { getPermissions } from "../lib/api.js";
import {
  listExceptions, createException, resolveException,
  subscribeStream, fmtTime, ISSUE_LABEL,
} from "../lib/exceptionsApi.js";

/* Issue tiles — the four from Figma Screen 10, in a 2×2 grid. */
const ISSUE_TYPES = [
  { value: "MISSING_PERSON", label: "Missing person", Icon: UserX },
  { value: "LOST_BADGE",     label: "Lost badge",     Icon: BadgeX },
  { value: "DEAD_PHONE",     label: "Dead phone",     Icon: BatteryLow },
  { value: "VIP_REQUEST",    label: "VIP request",    Icon: Crown },
];

export default function IssuesPanel({ tripId, coachId, coach, onLogged }) {
  const canEdit = getPermissions().manageExceptions;

  // form
  const [type, setType] = useState("MISSING_PERSON");
  const [delegateId, setDelegateId] = useState("");
  const [note, setNote] = useState("");
  const [critical, setCritical] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState("");

  // list
  const [tickets, setTickets] = useState([]);
  const [counts, setCounts] = useState({ all: 0, critical: 0, open: 0, resolved: 0 });
  const [loadError, setLoadError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [live, setLive] = useState(false);

  const toastTimer = useRef(null);
  const flash = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  };

  // Delegate picker options come from the active coach's roster (passed down),
  // so it always matches who's actually on this coach.
  const delegates = (coach && coach.delegates) ? coach.delegates : [];

  const load = useCallback(async () => {
    try {
      setLoadError("");
      const data = await listExceptions({ status: "OPEN" });
      setTickets(data.tickets || []);
      setCounts(data.counts || { all: 0, critical: 0, open: 0, resolved: 0 });
    } catch (e) {
      setLoadError(e.message || "Could not load exceptions.");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Live updates so a ticket raised on another device shows up here too.
  useEffect(() => {
    const off = subscribeStream((event) => {
      if (event === "stream:open") setLive(true);
      else if (event === "stream:error") setLive(false);
      else load();
    });
    return off;
  }, [load]);

  async function submit() {
    if (!canEdit) return;
    setSaving(true);
    setFormError("");
    try {
      await createException({ type, delegateId, coachId, note, markCritical: critical });
      flash(critical ? "Critical alert sent to all staff" : "Exception logged");
      setNote("");
      setCritical(false);
      setDelegateId("");
      setType("MISSING_PERSON");
      await load();
      onLogged?.();
    } catch (e) {
      setFormError(
        e.status === 403
          ? "You need the ‘Manage exceptions’ permission to log tickets."
          : e.message || "Could not log the exception. Try again."
      );
    } finally {
      setSaving(false);
    }
  }

  async function resolve(id) {
    if (!canEdit) return;
    setBusyId(id);
    try {
      await resolveException(id);
      await load();
      onLogged?.();
    } catch (e) {
      flash(e.status === 409 ? "Already resolved" : "Could not resolve");
    } finally {
      setBusyId(null);
    }
  }

  const st = {
    eyebrow: { fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 8 },
    grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
    tile: (active) => ({
      display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start",
      padding: "14px 14px", borderRadius: "var(--r-md)", fontSize: 13.5, fontWeight: 600,
      border: `1.5px solid ${active ? "var(--scc-red)" : "var(--line)"}`,
      background: active ? "var(--scc-red-tint)" : "var(--surface)",
      color: active ? "var(--scc-red-700)" : "var(--ink)",
      textAlign: "left",
    }),
    select: {
      width: "100%", padding: "12px 12px", borderRadius: "var(--r-md)",
      border: "1px solid var(--line)", background: "var(--surface)",
      fontSize: 14, color: "var(--ink)", fontFamily: "inherit",
    },
    textarea: {
      width: "100%", minHeight: 72, padding: "12px", borderRadius: "var(--r-md)",
      border: "1px solid var(--line)", fontSize: 14, fontFamily: "inherit", resize: "vertical",
    },
    critical: (on) => ({
      display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
      borderRadius: "var(--r-md)", cursor: canEdit ? "pointer" : "not-allowed",
      border: `1.5px solid ${on ? "var(--scc-red)" : "var(--line)"}`,
      background: on ? "var(--scc-red-tint)" : "var(--surface)",
    }),
    switch: (on) => ({
      width: 42, height: 24, borderRadius: 999, flexShrink: 0, position: "relative",
      background: on ? "var(--scc-red)" : "var(--line)", transition: "background .15s",
    }),
    knob: (on) => ({
      position: "absolute", top: 2, left: on ? 20 : 2, width: 20, height: 20,
      borderRadius: "50%", background: "var(--surface)", transition: "left .15s",
      boxShadow: "var(--shadow-sm)",
    }),
    ticket: (pri) => ({
      border: "1px solid var(--line)",
      borderLeft: `3px solid ${pri === "CRITICAL" ? "var(--st-missing)" : "var(--st-normal)"}`,
      borderRadius: "var(--r-md)", padding: "12px 14px", background: "var(--surface)",
    }),
  };

  return (
    <div>
      <div className="row between" style={{ alignItems: "baseline" }}>
        <h2 style={{ fontSize: 20 }}>Log exception</h2>
        <span className={`badge ${live ? "badge-present" : "badge-neutral"}`} style={{ fontSize: 11 }}>
          {live ? "● Live" : "○ Offline"}
        </span>
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>
        Raise an issue for the team. Critical alerts reach every staff device instantly.
      </p>

      {!canEdit && (
        <div className="card" style={{
          padding: 12, marginTop: 12, fontSize: 12.5,
          background: "var(--st-unassigned-bg)", color: "var(--st-unassigned)",
          border: "1px solid var(--st-unassigned)",
        }}>
          <ShieldAlert size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
          Logging is view-only for this account. Ask an admin to enable “Manage
          exceptions” in Account control (or run <code>npm run reset-login</code>).
        </div>
      )}

      {/* -------------------------------- form -------------------------------- */}
      <div style={{ marginTop: 18 }}>
        <div style={st.eyebrow}>Issue type</div>
        <div style={st.grid}>
          {ISSUE_TYPES.map(({ value, label, Icon }) => (
            <button key={value} type="button" style={st.tile(type === value)}
                    onClick={() => setType(value)} aria-pressed={type === value}>
              <Icon size={20} strokeWidth={2} />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={st.eyebrow}>Delegate</div>
        <select style={st.select} value={delegateId} onChange={(e) => setDelegateId(e.target.value)}>
          <option value="">Unidentified / not listed</option>
          {delegates.map((d) => (
            <option key={d.delegateId} value={d.delegateId}>
              {d.name}{d.vip ? " · VIP" : ""}
            </option>
          ))}
        </select>
        {delegates.length === 0 && (
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Pick a coach on the Trips tab to list its delegates.
          </div>
        )}
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={st.eyebrow}>Quick note</div>
        <textarea style={st.textarea} value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Phone unreachable. Last seen near gift shop at 14:08." />
      </div>

      <div style={{ ...st.critical(critical), marginTop: 18 }}
           role="switch" aria-checked={critical} tabIndex={0}
           onClick={() => canEdit && setCritical((v) => !v)}
           onKeyDown={(e) => { if (canEdit && (e.key === " " || e.key === "Enter")) { e.preventDefault(); setCritical((v) => !v); } }}>
        <span style={st.switch(critical)}><span style={st.knob(critical)} /></span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: critical ? "var(--scc-red-700)" : "var(--ink)" }}>Mark as critical</div>
          <div className="muted" style={{ fontSize: 12.5 }}>Alerts all staff devices instantly</div>
        </div>
      </div>

      {formError && (
        <div style={{ marginTop: 12, fontSize: 13, color: "var(--scc-red-700)" }}>
          <AlertTriangle size={13} style={{ verticalAlign: -2, marginRight: 6 }} />{formError}
        </div>
      )}

      <button
        className={"btn btn-block " + (critical ? "btn-primary" : "btn-dark")}
        style={{ marginTop: 16 }}
        onClick={submit}
        disabled={saving || !canEdit}
      >
        {saving ? "Submitting…" : critical ? "Submit & alert team" : "Submit ticket"}
      </button>

      {toast && (
        <div className="card" style={{
          marginTop: 12, padding: "10px 12px", display: "flex", alignItems: "center", gap: 8,
          background: "var(--st-present-bg)", color: "var(--st-present)", border: "1px solid var(--st-present)",
        }}>
          <CheckCircle2 size={16} /> {toast}
        </div>
      )}

      {/* --------------------------- open tickets ----------------------------- */}
      <div className="row between" style={{ marginTop: 26, alignItems: "baseline" }}>
        <div style={st.eyebrow}>Open exceptions</div>
        <span className="muted" style={{ fontSize: 12 }}>
          {counts.open} open · {counts.critical} critical
        </span>
      </div>

      {loadError && <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>{loadError}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
        {tickets.map((t) => (
          <div key={t.id} style={st.ticket(t.priority)}>
            <div className="row between" style={{ alignItems: "flex-start", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 8, alignItems: "center" }}>
                  <span className={`badge ${t.priority === "CRITICAL" ? "badge-missing" : "badge-neutral"}`} style={{ fontSize: 11 }}>
                    {t.priority === "CRITICAL" ? "Critical" : "Normal"}
                  </span>
                  <span style={{ fontWeight: 700, fontSize: 13.5 }}>{ISSUE_LABEL[t.type] || t.type}</span>
                </div>
                <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                  {t.delegateName || "Unidentified"}{t.coach ? ` · ${t.coach}` : ""}
                </div>
                {t.note && <div style={{ fontSize: 13, marginTop: 6 }}>{t.note}</div>}
                <div className="muted" style={{ fontSize: 11.5, marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}>
                  <Clock size={11} /> {fmtTime(t.createdAt)}{t.raisedBy ? ` · ${t.raisedBy}` : ""}
                </div>
              </div>
              {canEdit && (
                <button className="btn btn-ghost" style={{ padding: "6px 10px", fontSize: 12.5, flexShrink: 0 }}
                        onClick={() => resolve(t.id)} disabled={busyId === t.id}>
                  {busyId === t.id ? "…" : "Resolve"}
                </button>
              )}
            </div>
          </div>
        ))}

        {tickets.length === 0 && !loadError && (
          <div className="card" style={{ padding: 20, textAlign: "center" }}>
            <Inbox size={22} style={{ color: "var(--st-present)" }} />
            <div style={{ fontWeight: 600, marginTop: 8 }}>No open exceptions</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>Anything you log will appear here.</div>
          </div>
        )}
      </div>
    </div>
  );
}
