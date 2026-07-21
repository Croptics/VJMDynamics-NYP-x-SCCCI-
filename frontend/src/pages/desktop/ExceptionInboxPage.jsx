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
import StatusBadge from "../../components/StatusBadge.jsx";
import LogExceptionModal from "../../components/LogExceptionModal.jsx";
import { getPermissions } from "../../lib/api.js";
import { useLang } from "../../lib/i18n.jsx";
import {
  listExceptions, resolveException, deleteException, manualOverride,
  subscribeStream, fmtTime, issueLabel,
} from "../../lib/exceptionsApi.js";
import "./ExceptionInboxPage.css";

const TABS = [
  { key: "All",      countKey: "all",      filter: {} },
  { key: "Critical", countKey: "critical", filter: { priority: "CRITICAL" } },
  { key: "Open",     countKey: "open",     filter: { status: "OPEN" } },
  { key: "Resolved", countKey: "resolved", filter: { status: "RESOLVED" } },
];

export default function ExceptionInboxPage() {
  const { t } = useLang();
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
      setError(e.message || t("Couldn't load tickets."));
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
      if (event === "exception:critical") flash(t("Critical alert pushed to all staff devices"));
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
      flash(e.code === "ALREADY_RESOLVED" ? t("That ticket was already resolved") : (e.message || t("Action failed")));
      await load();
    } finally {
      setBusyId(null);
    }
  }

  function handleCreated(_t, wasCritical) {
    setModalOpen(false);
    flash(wasCritical ? t("Critical alert pushed to all staff devices") : t("Exception logged"));
    load();
  }

  const critical = tickets.find((tk) => tk.priority === "CRITICAL" && tk.status === "OPEN");

  const rowActions = (tk) => canEdit && (
    <div className="exc-actions">
      {tk.status === "OPEN" && (
        <>
          <button className="exc-btn-sm resolve" disabled={busyId === tk.id}
            onClick={() => act(tk.id, () => resolveException(tk.id), t("Ticket resolved"))}>
            {t("Resolve")}
          </button>
          {tk.delegateId && (
            <button className="exc-btn-sm" disabled={busyId === tk.id}
              title={t("Count this delegate present without a scan")}
              onClick={() => act(tk.id, () => manualOverride(tk.delegateId), `${tk.delegateName} ${t("marked present")}`)}>
              <UserCheck size={14} /> {t("Override")}
            </button>
          )}
        </>
      )}
      <button className="exc-btn-sm danger" disabled={busyId === tk.id}
        onClick={() => act(tk.id, () => deleteException(tk.id), t("Ticket deleted"))}>
        {t("Delete")}
      </button>
    </div>
  );

  return (
    <div className="page">
      <div className="exc-header">
        <div>
          <div className="page-eyebrow">{t("Beijing study mission · Day 3")}</div>
          <h1 className="page-title">{t("Exception inbox")}</h1>
          <p className="page-sub">{t("Log and resolve on-site exceptions; critical alerts push to all staff.")}</p>
        </div>
        <span className={"exc-live" + (live ? "" : " off")}>
          <span className="dot" /> {live ? t("Live") : t("Connecting…")}
        </span>
      </div>

      {critical && (
        <div className="exc-banner">
          <div className="row" style={{ alignItems: "flex-start" }}>
            <AlertTriangle size={22} color="var(--scc-red)" strokeWidth={2.2} />
            <div>
              <div className="exc-banner__title">
                {counts.critical} {t(counts.critical === 1 ? "critical exception" : "critical exceptions")} · {t("pushed to all staff devices")}
              </div>
              <div className="exc-banner__sub">
                {t(issueLabel(critical))} · {critical.coach || t("Unassigned")} ·{" "}
                {critical.delegateName || t("Unidentified")} · {t("raised")} {fmtTime(critical.createdAt)}
              </div>
            </div>
          </div>
          {canEdit && (
            <button className="btn btn-primary" style={{ flexShrink: 0 }} disabled={busyId === critical.id}
              onClick={() => act(critical.id, () => resolveException(critical.id), t("Critical ticket resolved"))}>
              {t("Resolve now")}
            </button>
          )}
        </div>
      )}

      <div className="exc-toolbar">
        <div className="exc-tabs" role="tablist">
          {TABS.map(({ key, countKey }) => (
            <button key={key} role="tab" aria-selected={tab === key}
              className={"exc-tab" + (tab === key ? " active" : "")} onClick={() => setTab(key)}>
              {t(key)} <span className="count">· {counts[countKey] ?? 0}</span>
            </button>
          ))}
        </div>
        {canEdit && (
          <button className="btn btn-primary" onClick={() => setModalOpen(true)}>
            <Plus size={16} strokeWidth={2.5} /> {t("Log exception")}
          </button>
        )}
      </div>

      {/* Desktop table */}
      <div className="card exc-table-wrap" style={{ padding: 4 }}>
        <table className="table">
          <thead>
            <tr>
              <th>{t("Priority")}</th><th>{t("Issue")}</th><th>{t("Delegate")}</th>
              <th>{t("Coach")}</th><th>{t("Raised")}</th><th>{t("Status")}</th><th></th>
            </tr>
          </thead>
          <tbody>
            {loading && Array.from({ length: 4 }).map((_, i) => (
              <tr key={i}><td colSpan={7}><div className="exc-skeleton" /></td></tr>
            ))}

            {!loading && !error && tickets.map((tk) => (
              <tr key={tk.id}>
                <td><StatusBadge state={tk.priority} /></td>
                <td>
                  <div className="exc-issue-title">
                    {t(issueLabel(tk))}
                    {tk.delegateVip && <span className="exc-vip">{t("VIP")}</span>}
                  </div>
                  <div className="exc-issue-sub">{tk.note}</div>
                </td>
                <td>{tk.delegateName || t("Unidentified")}</td>
                <td>{tk.coach || "—"}</td>
                <td className="muted">{fmtTime(tk.createdAt)} · {tk.raisedBy}</td>
                <td><StatusBadge state={tk.status} /></td>
                <td>{rowActions(tk)}</td>
              </tr>
            ))}

            {!loading && !error && tickets.length === 0 && (
              <tr><td colSpan={7}><div className="exc-state">{t("All clear — no tickets in this view.")}</div></td></tr>
            )}
            {error && (
              <tr><td colSpan={7}>
                <div className="exc-state">
                  {error} <button className="exc-btn-sm" onClick={load} style={{ marginLeft: 8 }}>{t("Retry")}</button>
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
        {!loading && !error && tickets.map((tk) => (
          <div className="exc-card" key={tk.id}>
            <div className="exc-card__top">
              <StatusBadge state={tk.priority} />
              <StatusBadge state={tk.status} />
            </div>
            <div className="exc-issue-title">
              {t(issueLabel(tk))}
              {tk.delegateVip && <span className="exc-vip">VIP</span>}
            </div>
            <div className="exc-issue-sub">{tk.note}</div>
            <div className="exc-card__meta">{tk.delegateName || t("Unidentified")} · {tk.coach || "—"}</div>
            <div className="exc-card__meta">{fmtTime(tk.createdAt)} · {tk.raisedBy}</div>
            {rowActions(tk)}
          </div>
        ))}
        {!loading && !error && tickets.length === 0 && <div className="exc-state">{t("All clear — no tickets in this view.")}</div>}
        {error && <div className="exc-state">{error} <button className="exc-btn-sm" onClick={load}>{t("Retry")}</button></div>}
      </div>

      {modalOpen && <LogExceptionModal onClose={() => setModalOpen(false)} onCreated={handleCreated} />}
      {toast && <div className="exc-toast">{toast}</div>}
    </div>
  );
}
