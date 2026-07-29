/* =============================================================================
 *  OWNED BY:  Jayden — Exception Logging, Critical Alerts & QR Fallback
 *
 *  Mobile Exception inbox — the "Exceptions" segment of the Ops screen
 *  (MobileOpsPage: [ Delegates | Exceptions | Trips ]).
 *
 *  This is the phone-shaped counterpart of the desktop Screen 5 inbox
 *  (pages/desktop/ExceptionInboxPage.jsx) and deliberately tracks the same
 *  feature set — summary tiles, tab + search filtering, ageing, resolved-by/at,
 *  escalate, manual override and delete — so the two never drift apart.
 *
 *  It differs from MobileIssuesPage.jsx (/mobile/issues), which mounts Jayden's
 *  IssuesPanel: that screen is the log-a-ticket FORM plus the open list. This
 *  one is the full trip-wide inbox with actions, and reuses LogExceptionModal
 *  for creation rather than carrying its own form.
 *
 *  Renders inside MobileOpsPage, which already owns the trip context and KPI
 *  strip above it — so this component starts straight at the tickets.
 *
 *  Self-contained: builds only on Jayden's own data layer (exceptionsApi.js)
 *  plus the shared lib/api.js, and adds no global CSS — every rule below is
 *  namespaced `mexc-*`.
 *
 *  NOTE ON `t` — useLang()'s translate function owns that name here, so a
 *  ticket in a callback is always `tk`.
 * ============================================================================= */
import { useEffect, useMemo, useState, useCallback } from "react";
import {
  AlertTriangle, Plus, UserCheck, Search, ChevronsUp, CheckCircle2,
  Clock, X, Trash2,
} from "lucide-react";
import StatusBadge from "../../components/StatusBadge.jsx";
import LogExceptionModal from "../../components/LogExceptionModal.jsx";
import { getPermissions } from "../../lib/api.js";
import { useLang } from "../../lib/i18n.jsx";
import {
  listExceptions, resolveException, deleteException, manualOverride, updatePriority,
  subscribeStream, fmtTime, issueLabel, ageMinutes, fmtAge, ageLevel, resolveMinutes,
  isCheckedIn,
} from "../../lib/exceptionsApi.js";
import "../desktop/ExceptionInboxPage.css"; // LogExceptionModal's .exc-modal styles (mobile sheet)

const TABS = [
  { key: "All",      countKey: "all",      filter: {} },
  { key: "Critical", countKey: "critical", filter: { priority: "CRITICAL" } },
  { key: "Open",     countKey: "open",     filter: { status: "OPEN" } },
  { key: "Resolved", countKey: "resolved", filter: { status: "RESOLVED" } },
];

const AGE_TICK_MS = 30000;

const MEXC_CSS = `
.mexc-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; }
.mexc-stat { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); padding: 10px 11px; }
.mexc-stat__label { font-size: 10.5px; font-weight: 600; color: var(--ink-3); text-transform: uppercase; letter-spacing: .04em; }
.mexc-stat__value { font-size: 20px; font-weight: 700; color: var(--ink); line-height: 1.2; margin-top: 2px; font-variant-numeric: tabular-nums; }
.mexc-stat.danger { border-color: var(--scc-red-tint-2); background: var(--scc-red-tint); }
.mexc-stat.danger .mexc-stat__value { color: var(--scc-red); }
.mexc-stat.warn { border-color: var(--st-review-bg); background: var(--st-review-bg); }
.mexc-stat.warn .mexc-stat__value { color: var(--st-review); }

.mexc-banner { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; margin-bottom: 12px;
  background: var(--scc-red-tint); border: 1px solid var(--scc-red-tint-2); border-left: 4px solid var(--scc-red);
  border-radius: var(--r-md); }
.mexc-banner__title { font-weight: 700; color: var(--scc-red-700); font-size: 13.5px; }
.mexc-banner__sub { color: var(--scc-red-700); font-size: 12px; margin-top: 2px; }

.mexc-tabs { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; margin-bottom: 10px; -webkit-overflow-scrolling: touch; }
.mexc-tab { flex-shrink: 0; border: 1px solid var(--line); background: var(--surface); color: var(--ink-2);
  border-radius: 999px; padding: 7px 14px; font-size: 13px; font-weight: 600; white-space: nowrap; }
.mexc-tab.active { background: var(--ink); color: var(--surface); border-color: var(--ink); }
.mexc-tab .count { opacity: .7; font-variant-numeric: tabular-nums; }

.mexc-search { display: flex; align-items: center; gap: 8px; border: 1px solid var(--line); background: var(--surface);
  border-radius: var(--r-sm); padding: 0 10px; height: 40px; color: var(--ink-3); margin-bottom: 12px; }
.mexc-search input { flex: 1; min-width: 0; border: none; outline: none; background: none; font-size: 14px; color: var(--ink); }
.mexc-search button { border: none; background: none; color: var(--ink-3); display: inline-flex; padding: 2px; }

.mexc-card { border: 1px solid var(--line); border-radius: var(--r-md); padding: 13px 14px; margin-bottom: 10px; background: var(--surface); }
.mexc-card.crit { border-left: 3px solid var(--scc-red); }
.mexc-card__top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 7px; }
.mexc-title { font-weight: 600; font-size: 14.5px; }
.mexc-vip { font-size: 9.5px; font-weight: 700; color: var(--scc-red); background: var(--scc-red-tint); padding: 1px 5px; border-radius: 5px; margin-left: 5px; }
.mexc-note { color: var(--ink-3); font-size: 12.5px; margin-top: 2px; }
.mexc-meta { color: var(--ink-3); font-size: 12px; margin-top: 5px; }
.mexc-age { display: inline-flex; align-items: center; gap: 4px; margin-top: 6px; font-size: 11px; font-weight: 600;
  color: var(--ink-3); background: var(--st-neutral-bg); padding: 2px 7px; border-radius: 999px; font-variant-numeric: tabular-nums; }
.mexc-age.warn { color: var(--st-review); background: var(--st-review-bg); }
.mexc-age.late { color: var(--scc-red); background: var(--scc-red-tint); }
.mexc-resolved { display: block; margin-top: 5px; font-size: 11.5px; color: var(--st-present); }

.mexc-actions { display: flex; gap: 7px; flex-wrap: wrap; margin-top: 11px; }
.mexc-btn { flex: 1 1 auto; min-width: 88px; display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  font-size: 13px; font-weight: 600; padding: 9px 10px; border-radius: var(--r-sm);
  border: 1px solid var(--line); background: var(--surface); color: var(--ink-2); }
.mexc-btn.resolve  { color: var(--st-present); border-color: var(--st-present-bg); }
.mexc-btn.escalate { color: var(--st-review);  border-color: var(--st-review-bg); }
.mexc-btn.danger   { color: var(--scc-red);    border-color: var(--scc-red-tint-2); flex: 0 0 auto; min-width: 0; }
.mexc-btn:disabled { opacity: .5; }
.mexc-present { display: inline-flex; align-items: center; justify-content: center; gap: 5px; flex: 1 1 auto; min-width: 88px;
  font-size: 12.5px; font-weight: 600; color: var(--st-present); background: var(--st-present-bg);
  padding: 9px 10px; border-radius: var(--r-sm); }

.mexc-empty { text-align: center; padding: 30px 16px; color: var(--ink-3); font-size: 13.5px; }
.mexc-log { width: 100%; margin-top: 12px; }
.mexc-toast { position: fixed; left: 50%; bottom: 78px; transform: translateX(-50%); z-index: 60;
  background: var(--ink); color: var(--surface); padding: 10px 18px; border-radius: 999px; font-size: 13.5px;
  font-weight: 500; box-shadow: var(--shadow-lg); max-width: 90vw; text-align: center; }
.mexc-live { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600;
  color: var(--st-present); background: var(--st-present-bg); padding: 3px 9px; border-radius: 999px; }
.mexc-live.off { color: var(--ink-3); background: var(--st-neutral-bg); }
.mexc-live .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
`;

export default function MobileExceptionsPage() {
  const { t } = useLang();
  const canEdit = getPermissions().manageExceptions;

  const [tab, setTab] = useState("Open"); // phones default to what needs action
  const [allTickets, setAllTickets] = useState([]);
  const [counts, setCounts] = useState({ all: 0, critical: 0, open: 0, resolved: 0, criticalOpen: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [live, setLive] = useState(false);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), AGE_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    setError("");
    try {
      const { tickets, counts } = await listExceptions(); // sliced client-side, as on desktop
      setAllTickets(tickets);
      setCounts(counts);
    } catch (e) {
      setError(e.message || t("Couldn't load tickets."));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { setLoading(true); load(); }, [load]);

  useEffect(() => {
    const off = subscribeStream((event) => {
      if (event === "stream:open")  { setLive(true);  return; }
      if (event === "stream:error") { setLive(false); return; }
      setLive(true);
      load();
      if (event === "exception:critical") flash(t("Critical alert pushed to all staff devices"));
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  function flash(msg) { setToast(msg); setTimeout(() => setToast(""), 2600); }

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

  const byTab = useMemo(() => {
    const f = TABS.find((x) => x.key === tab).filter;
    return allTickets.filter(
      (tk) => (!f.status || tk.status === f.status) && (!f.priority || tk.priority === f.priority)
    );
  }, [allTickets, tab]);

  const tickets = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return byTab;
    return byTab.filter((tk) =>
      [issueLabel(tk), tk.delegateName, tk.coach, tk.note, tk.raisedBy, tk.resolvedBy]
        .some((v) => (v || "").toLowerCase().includes(q))
    );
  }, [byTab, query]);

  const oldest = useMemo(() => {
    const open = allTickets.filter((tk) => tk.status === "OPEN");
    return open.reduce((max, tk) => Math.max(max, ageMinutes(tk.createdAt, now) ?? 0), 0);
  }, [allTickets, now]);

  const critical = allTickets.find((tk) => tk.priority === "CRITICAL" && tk.status === "OPEN");

  return (
    <div>
      <style>{MEXC_CSS}</style>

      {/* The "Live"/"…" pill that used to sit here is gone (2026-07-29 —
          "hide all the unnecessary sync part, cause already have on top of
          the mobile top bar" — MobileLayout's own topbar already carries a
          connectivity chip on every mobile screen). Purely decorative either
          way: it only ever DISPLAYED the SSE stream's connection state, never
          controlled it — the stream below still drives the live refresh. */}
      <div style={{ margin: "4px 0 12px" }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{t("Exception inbox")}</div>
      </div>

      <div className="mexc-stats">
        <div className="mexc-stat">
          <div className="mexc-stat__label">{t("Open")}</div>
          <div className="mexc-stat__value">{counts.open ?? 0}</div>
        </div>
        <div className={"mexc-stat" + ((counts.criticalOpen ?? 0) > 0 ? " danger" : "")}>
          <div className="mexc-stat__label">{t("Critical")}</div>
          <div className="mexc-stat__value">{counts.criticalOpen ?? 0}</div>
        </div>
        <div className={"mexc-stat" + (oldest >= 30 ? " danger" : oldest >= 15 ? " warn" : "")}>
          <div className="mexc-stat__label">{t("Oldest")}</div>
          <div className="mexc-stat__value">{counts.open ? fmtAge(oldest) : "—"}</div>
        </div>
      </div>

      {critical && (
        <div className="mexc-banner">
          <AlertTriangle size={18} color="var(--scc-red)" strokeWidth={2.2} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ minWidth: 0 }}>
            <div className="mexc-banner__title">
              {counts.criticalOpen} {t("critical open")} · {t("pushed to all staff")}
            </div>
            <div className="mexc-banner__sub">
              {issueLabel(critical)} · {critical.delegateName || t("Unidentified")} · {fmtTime(critical.createdAt)}
            </div>
          </div>
        </div>
      )}

      <div className="mexc-tabs" role="tablist">
        {TABS.map(({ key, countKey }) => (
          <button key={key} role="tab" aria-selected={tab === key}
            className={"mexc-tab" + (tab === key ? " active" : "")} onClick={() => setTab(key)}>
            {t(key)} <span className="count">· {counts[countKey] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="mexc-search">
        <Search size={15} />
        <input value={query} onChange={(e) => setQuery(e.target.value)}
               placeholder={t("Search delegate, coach, issue…")} aria-label={t("Search tickets")} />
        {query && <button onClick={() => setQuery("")} aria-label={t("Clear search")}><X size={14} /></button>}
      </div>

      {error && (
        <div className="mexc-card" style={{ borderColor: "var(--st-missing)", background: "var(--st-missing-bg)" }}>
          <div className="row" style={{ gap: 8, color: "var(--st-missing)", fontWeight: 600, fontSize: 14 }}>
            <AlertTriangle size={16} /> {t("Couldn't load tickets.")}
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>{error}</p>
          <button className="mexc-btn" style={{ marginTop: 10 }} onClick={load}>{t("Retry")}</button>
        </div>
      )}

      {loading && !allTickets.length && !error && <div className="muted">{t("Loading…")}</div>}

      {!loading && !error && tickets.length === 0 && (
        <div className="mexc-empty">
          {query ? `${t("No tickets match")} “${query}”.` : t("All clear — nothing in this view.")}
        </div>
      )}

      {!error && tickets.map((tk) => {
        const lvl = ageLevel(tk, now);
        const present = isCheckedIn(tk.delegateStatus);
        const busy = busyId === tk.id;
        return (
          <div key={tk.id} className={"mexc-card" + (tk.priority === "CRITICAL" && tk.status === "OPEN" ? " crit" : "")}>
            <div className="mexc-card__top">
              <StatusBadge state={tk.priority} />
              <StatusBadge state={tk.status} />
            </div>

            <div className="mexc-title">
              {issueLabel(tk)}
              {tk.delegateVip && <span className="mexc-vip">VIP</span>}
            </div>
            {tk.note && <div className="mexc-note">{tk.note}</div>}
            <div className="mexc-meta">{tk.delegateName || t("Unidentified")} · {tk.coach || "—"}</div>
            <div className="mexc-meta">{fmtTime(tk.createdAt)} · {tk.raisedBy}</div>

            {tk.status === "OPEN" && (
              <span className={"mexc-age" + (lvl ? " " + lvl : "")}>
                <Clock size={11} /> {fmtAge(ageMinutes(tk.createdAt, now))}
              </span>
            )}
            {tk.status === "RESOLVED" && tk.resolvedAt && (
              <span className="mexc-resolved">
                {t("resolved")} {fmtTime(tk.resolvedAt)}
                {tk.resolvedBy ? ` · ${tk.resolvedBy}` : ""}
                {resolveMinutes(tk) != null ? ` · ${t("took")} ${fmtAge(resolveMinutes(tk))}` : ""}
              </span>
            )}

            {canEdit && (
              <div className="mexc-actions">
                {tk.status === "OPEN" && (
                  <>
                    <button className="mexc-btn resolve" disabled={busy}
                      onClick={() => act(tk.id, () => resolveException(tk.id), t("Ticket resolved"))}>
                      <CheckCircle2 size={14} /> {t("Resolve")}
                    </button>
                    {tk.priority !== "CRITICAL" && (
                      <button className="mexc-btn escalate" disabled={busy}
                        onClick={() => act(tk.id, () => updatePriority(tk.id, "CRITICAL"), t("Escalated — alert pushed to all staff"))}>
                        <ChevronsUp size={14} /> {t("Escalate")}
                      </button>
                    )}
                    {tk.delegateId && !present && (
                      <button className="mexc-btn" disabled={busy}
                        onClick={() => act(tk.id, () => manualOverride(tk.delegateId), `${tk.delegateName} ${t("marked present")}`)}>
                        <UserCheck size={14} /> {t("Override")}
                      </button>
                    )}
                    {tk.delegateId && present && (
                      <span className="mexc-present"><CheckCircle2 size={14} /> {t("Present")}</span>
                    )}
                  </>
                )}
                <button className="mexc-btn danger" disabled={busy} aria-label={t("Delete")}
                  onClick={() => act(tk.id, () => deleteException(tk.id), t("Ticket deleted"))}>
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </div>
        );
      })}

      {canEdit && (
        <button className="btn btn-primary mexc-log" onClick={() => setModalOpen(true)}>
          <Plus size={16} strokeWidth={2.5} /> {t("Log exception")}
        </button>
      )}

      {modalOpen && (
        <LogExceptionModal
          onClose={() => setModalOpen(false)}
          onCreated={(_tk, wasCritical) => {
            setModalOpen(false);
            flash(wasCritical ? t("Critical alert pushed to all staff devices") : t("Exception logged"));
            load();
          }}
        />
      )}

      {toast && <div className="mexc-toast">{toast}</div>}
    </div>
  );
}
