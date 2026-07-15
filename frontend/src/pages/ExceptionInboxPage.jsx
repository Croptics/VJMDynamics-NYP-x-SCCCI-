/* =============================================================================
 *  OWNED BY:  Jayden — Exception Logging & QR Fallback
 *  Screen 5 — Exception Inbox / Support Tickets
 *
 *  Full ticket CRUD over the shared backend:
 *    create  → POST   /api/trips/:id/exceptions   ("Log exception")
 *    read    → GET    /api/trips/:id/exceptions   (All / Critical / Open / Resolved)
 *    update  → PATCH  /api/exceptions/:id         (resolve, escalate)
 *    delete  → DELETE /api/exceptions/:id         (raised in error)
 *  Plus manual attendance override and a live critical-alert banner (SSE).
 * ============================================================================= */
import { useEffect, useState, useCallback } from "react";
import { AlertTriangle, Plus, UserCheck } from "lucide-react";
import StatusBadge from "../components/StatusBadge.jsx";
import LogExceptionModal from "../components/LogExceptionModal.jsx";
import { getPermissions } from "../lib/api.js";
import {
  listExceptions, resolveException, deleteException, manualOverride,
  subscribeStream, fmtTime, issueLabel,
} from "../lib/exceptionsApi.js";
import "./ExceptionInboxPage.css";

const TABS = [
  { key: "All",      countKey: "all",      filter: {} },
  { key: "Critical", countKey: "critical", filter: { priority: "CRITICAL" } },
  { key: "Open",     countKey: "open",     filter: { status: "OPEN" } },
  { key: "Resolved", countKey: "resolved", filter: { status: "RESOLVED" } },
];

export default function ExceptionInboxPage() {
  const canEdit = getPermissions().manageExceptions; // view-for-all, edit-gated (see permissions.js)
  const [tab, setTab] = useState("All");
  const [tickets, setTickets] = useState([]);
  const [counts, setCounts] = useState({ all: 0, critical: 0, open: 0, resolved: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [live, setLive] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [busyId, setBusyId] = useState(null);

  const activeFilter = TABS.find((t) => t.key === tab).filter;

  const load = useCallback(async () => {
    setError("");
    try {
      const { tickets, counts } = await listExceptions(activeFilter);
      setTickets(tickets);
      setCounts(counts);
    } catch (e) {
      setError(e.message || "Couldn't load tickets.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  // Live updates: any ticket change anywhere refreshes this inbox.
  useEffect(() => {
    const unsub = subscribeStream((event) => {
      if (event === "stream:open")  { setLive(true);  return; }
      if (event === "stream:error") { setLive(false); return; }
      setLive(true);
      load();
      if (event === "exception:critical") flash("Critical alert pushed to all staff devices");
    });
    return unsub;
  }, [load]);

  function flash(msg) { setToast(msg); setTimeout(() => setToast(""), 2800); }

  async function act(id, fn, okMsg) {
    setBusyId(id);
    try {
      await fn();
      flash(okMsg);
      await load();
    } catch (e) {
      flash(e.code === "ALREADY_RESOLVED" ? "That ticket was already resolved" : (e.message || "Action failed"));
      await load();
    } finally {
      setBusyId(null);
    }
  }

  function handleCreated(_t, wasCritical) {
    setModalOpen(false);
    flash(wasCritical ? "Critical alert pushed to all staff devices" : "Exception logged");
    load();
  }

  const critical = tickets.find((t) => t.priority === "CRITICAL" && t.status === "OPEN");

  const rowActions = (t) => canEdit && (
    <div className="exc-actions">
      {t.status === "OPEN" && (
        <>
          <button className="exc-btn-sm resolve" disabled={busyId === t.id}
            onClick={() => act(t.id, () => resolveException(t.id), "Ticket resolved")}>
            Resolve
          </button>
          {t.delegateId && (
            <button className="exc-btn-sm" disabled={busyId === t.id}
              title="Count this delegate present without a scan"
              onClick={() => act(t.id, () => manualOverride(t.delegateId), `${t.delegateName} marked present`)}>
              <UserCheck size={14} /> Override
            </button>
          )}
        </>
      )}
      <button className="exc-btn-sm danger" disabled={busyId === t.id}
        onClick={() => act(t.id, () => deleteException(t.id), "Ticket deleted")}>
        Delete
      </button>
    </div>
  );

  return (
    <div className="page">
      <div className="exc-header">
        <div>
          <div className="page-eyebrow">Beijing study mission · Day 3</div>
          <h1 className="page-title">Exception inbox</h1>
          <p className="page-sub">Log and resolve on-site exceptions; critical alerts push to all staff.</p>
        </div>
        <span className={"exc-live" + (live ? "" : " off")}>
          <span className="dot" /> {live ? "Live" : "Connecting…"}
        </span>
      </div>

      {critical && (
        <div className="exc-banner">
          <div className="row" style={{ alignItems: "flex-start" }}>
            <AlertTriangle size={22} color="var(--scc-red)" strokeWidth={2.2} />
            <div>
              <div className="exc-banner__title">
                {counts.critical} critical exception{counts.critical === 1 ? "" : "s"} · pushed to all staff devices
              </div>
              <div className="exc-banner__sub">
                {issueLabel(critical)} · {critical.coach || "Unassigned"} ·{" "}
                {critical.delegateName || "Unidentified"} · raised {fmtTime(critical.createdAt)}
              </div>
            </div>
          </div>
          {canEdit && (
            <button className="btn btn-primary" style={{ flexShrink: 0 }} disabled={busyId === critical.id}
              onClick={() => act(critical.id, () => resolveException(critical.id), "Critical ticket resolved")}>
              Resolve now
            </button>
          )}
        </div>
      )}

      <div className="exc-toolbar">
        <div className="exc-tabs" role="tablist">
          {TABS.map(({ key, countKey }) => (
            <button key={key} role="tab" aria-selected={tab === key}
              className={"exc-tab" + (tab === key ? " active" : "")} onClick={() => setTab(key)}>
              {key} <span className="count">· {counts[countKey] ?? 0}</span>
            </button>
          ))}
        </div>
        {canEdit && (
          <button className="btn btn-primary" onClick={() => setModalOpen(true)}>
            <Plus size={16} strokeWidth={2.5} /> Log exception
          </button>
        )}
      </div>

      {/* Desktop table */}
      <div className="card exc-table-wrap" style={{ padding: 4 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Priority</th><th>Issue</th><th>Delegate</th>
              <th>Coach</th><th>Raised</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {loading && Array.from({ length: 4 }).map((_, i) => (
              <tr key={i}><td colSpan={7}><div className="exc-skeleton" /></td></tr>
            ))}

            {!loading && !error && tickets.map((t) => (
              <tr key={t.id}>
                <td><StatusBadge state={t.priority} /></td>
                <td>
                  <div className="exc-issue-title">
                    {issueLabel(t)}
                    {t.delegateVip && <span className="exc-vip">VIP</span>}
                  </div>
                  <div className="exc-issue-sub">{t.note}</div>
                </td>
                <td>{t.delegateName || "Unidentified"}</td>
                <td>{t.coach || "—"}</td>
                <td className="muted">{fmtTime(t.createdAt)} · {t.raisedBy}</td>
                <td><StatusBadge state={t.status} /></td>
                <td>{rowActions(t)}</td>
              </tr>
            ))}

            {!loading && !error && tickets.length === 0 && (
              <tr><td colSpan={7}><div className="exc-state">All clear — no tickets in this view.</div></td></tr>
            )}
            {error && (
              <tr><td colSpan={7}>
                <div className="exc-state">
                  {error} <button className="exc-btn-sm" onClick={load} style={{ marginLeft: 8 }}>Retry</button>
                </div>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="card exc-cards">
        {loading && Array.from({ length: 3 }).map((_, i) => (
          <div className="exc-card" key={i}><div className="exc-skeleton" /></div>
        ))}
        {!loading && !error && tickets.map((t) => (
          <div className="exc-card" key={t.id}>
            <div className="exc-card__top">
              <StatusBadge state={t.priority} />
              <StatusBadge state={t.status} />
            </div>
            <div className="exc-issue-title">
              {issueLabel(t)}
              {t.delegateVip && <span className="exc-vip">VIP</span>}
            </div>
            <div className="exc-issue-sub">{t.note}</div>
            <div className="exc-card__meta">{t.delegateName || "Unidentified"} · {t.coach || "—"}</div>
            <div className="exc-card__meta">{fmtTime(t.createdAt)} · {t.raisedBy}</div>
            {rowActions(t)}
          </div>
        ))}
        {!loading && !error && tickets.length === 0 && <div className="exc-state">All clear — no tickets in this view.</div>}
        {error && <div className="exc-state">{error} <button className="exc-btn-sm" onClick={load}>Retry</button></div>}
      </div>

      {modalOpen && <LogExceptionModal onClose={() => setModalOpen(false)} onCreated={handleCreated} />}
      {toast && <div className="exc-toast">{toast}</div>}
    </div>
  );
}
