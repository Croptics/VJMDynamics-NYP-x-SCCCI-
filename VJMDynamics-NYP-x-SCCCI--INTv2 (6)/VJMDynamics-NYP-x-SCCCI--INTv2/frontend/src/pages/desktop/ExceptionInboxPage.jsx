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
 *
 *  NOTE ON `t` — useLang()'s translate function owns that name in this file, so
 *  a ticket inside a callback is always `tk`. Shadowing `t` with a ticket makes
 *  every label in that scope render as garbage, which is why the convention is
 *  worth keeping even where it reads a little oddly.
 *
 *  FILTERING IS CLIENT-SIDE. The list endpoint accepts status/priority filters,
 *  but this screen fetches the trip's tickets once and slices them in the
 *  browser instead. One trip's exception list is small (tens of rows, not
 *  thousands), and doing it here buys three things a per-tab round-trip can't:
 *  tabs switch with no spinner, the search box filters as you type, and the
 *  summary tiles stay computed over EVERY ticket rather than just the tab you
 *  happen to be looking at. The server's counts still drive the tab badges.
 * ============================================================================= */
import { useEffect, useMemo, useState, useCallback } from "react";
import {
  AlertTriangle, Plus, UserCheck, Search, Download, ChevronsUp,
  CheckCircle2, Clock, X,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import StatusBadge from "../../components/StatusBadge.jsx";
import LogExceptionModal from "../../components/exception/LogExceptionModal.jsx";
import EscalateModal from "../../components/EscalateModal.jsx";
import ConfirmDialog from "../../components/ConfirmDialog.jsx";
import { getPermissions, apiPost, apiGet } from "../../lib/api.js";
import { useLang } from "../../lib/i18n.jsx";
import {
  listExceptions, resolveException, deleteException, manualOverride, updatePriority,
  subscribeStream, fmtTime, issueLabel, ageMinutes, fmtAge, ageLevel, resolveMinutes,
  exportTicketsCsv, isCheckedIn,
} from "../../lib/exception/exceptionsApi.js";
// Follows the same trip DashboardPage/TripCoachPage have selected (2026-07-31
// — "add the trip change to exception"), instead of the fixed base TRIP_ID
// this inbox used to always read regardless of the trip switcher.
import { getActiveTripId, resolveActiveTripId, ACTIVE_TRIP_EVENT } from "../../lib/activeTrip.js";
// Offline-capable READ (2026-07-31) — the Exceptions inbox is one of the
// pages flagged as most important ("the manual, attendance, exception,
// trip"): load() below used to just error out on any failure, including a
// dead signal. See lib/cachedFetch.js.
import { cachedFetch } from "../../lib/localstorage/cachedFetch.js";
import CachedDataBadge from "../../components/localstorage/CachedDataBadge.jsx";
import "../../styles/ExceptionInboxPage.css";

// Every tab is mutually exclusive by design (2026-07-31 — "for the all tab,
// hide the resolved one" / "pls fix the for critical tab also" / "the open
// tab shouldn't show critical") — a ticket belongs on exactly ONE of
// Critical/Open/Resolved, and All is just Critical+Open together, so nothing
// is ever double-counted or double-shown across tabs:
//   All      = every OPEN ticket, any priority
//   Critical = OPEN + CRITICAL
//   Open     = OPEN + NOT critical
//   Resolved = RESOLVED, any priority
// `count` computes each badge directly from the server's counts object
// (open/criticalOpen) instead of a single countKey, since "Open"'s badge is
// now a subtraction (open minus criticalOpen) that no single server field
// already holds.
const TABS = [
  { key: "All",      count: (c) => c.open ?? 0,                          filter: { excludeStatus: "RESOLVED" } },
  { key: "Critical", count: (c) => c.criticalOpen ?? 0,                  filter: { priority: "CRITICAL", excludeStatus: "RESOLVED" } },
  { key: "Open",     count: (c) => Math.max(0, (c.open ?? 0) - (c.criticalOpen ?? 0)), filter: { status: "OPEN", excludePriority: "CRITICAL" } },
  { key: "Resolved", count: (c) => c.resolved ?? 0,                      filter: { status: "RESOLVED" } },
];

/* Donut slice colours, reused from the status palette so the chart reads as
 * part of the same system as the pills. Cycled if there are more issue types. */
const SLICE_COLOURS = [
  "var(--st-missing)", "var(--st-normal)", "var(--st-review)",
  "var(--st-present)", "var(--st-unassigned)", "var(--st-neutral)",
];

/** Ages tick over in the background, so re-render on a timer rather than only
 *  when a ticket changes — otherwise "8m" would sit there stale for an hour. */
const AGE_TICK_MS = 30000;

export default function ExceptionInboxPage() {
  const { t } = useLang();
  const canEdit = getPermissions().manageExceptions; // view-for-all, edit-gated (see permissions.js)
  const [tab, setTab] = useState("All");
  const [allTickets, setAllTickets] = useState([]);
  const [counts, setCounts] = useState({ all: 0, critical: 0, open: 0, resolved: 0, criticalOpen: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [live, setLive] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [cacheStale, setCacheStale] = useState(false);
  const [cacheAt, setCacheAt] = useState(null);
  // Escalate pop-up + Resolve/Delete confirmations (2026-07-31 — "add the
  // pop-up to select who to escalate to" / "add warning to delete, resolve").
  const [escalatingTicket, setEscalatingTicket] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null); // { type: "resolve" | "delete", ticket }

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), AGE_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    setError("");
    const tripId = getActiveTripId();
    try {
      const r = await cachedFetch(`exceptions:${tripId}`, () => listExceptions({}, tripId)); // unfiltered — sliced below
      const { tickets, counts } = r.data;
      setCacheStale(r.stale);
      setCacheAt(r.at);
      setAllTickets(tickets);
      setCounts(counts);
      // Drop selections for tickets that no longer exist or are no longer open.
      setSelected((prev) => {
        if (!prev.size) return prev;
        const openIds = new Set(tickets.filter((tk) => tk.status === "OPEN").map((tk) => tk.id));
        const next = new Set([...prev].filter((id) => openIds.has(id)));
        return next.size === prev.size ? prev : next;
      });
    } catch (e) {
      setError(e.message || t("Couldn't load tickets."));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  // Re-load if the trip switcher changes elsewhere (Dashboard/TripCoachPage)
  // while this inbox is still mounted, same signal the ChatBubble follows.
  useEffect(() => {
    const onSwitch = () => { setLoading(true); load(); };
    window.addEventListener(ACTIVE_TRIP_EVENT, onSwitch);
    return () => window.removeEventListener(ACTIVE_TRIP_EVENT, onSwitch);
  }, [load]);

  // Real trip name + day for the eyebrow above the title. This was hardcoded
  // "Beijing study mission · Day 3" while the tickets below correctly followed
  // the active trip, so the header actively lied on any other trip. /all-trips
  // is cheap and already carries name/dayOf/totalDays — no need for the heavy
  // dashboard aggregate just for a label.
  const [tripMeta, setTripMeta] = useState(null);
  useEffect(() => {
    let alive = true;
    const loadMeta = async () => {
      try {
        const r = await apiGet("/all-trips");
        if (!alive) return;
        const list = r.trips || [];
        const id = resolveActiveTripId(getActiveTripId(), list);
        setTripMeta(list.find((tr) => tr.id === id) || null);
      } catch { /* label-only — leave it out rather than block the page */ }
    };
    loadMeta();
    window.addEventListener(ACTIVE_TRIP_EVENT, loadMeta);
    return () => { alive = false; window.removeEventListener(ACTIVE_TRIP_EVENT, loadMeta); };
  }, []);

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

  /** Fires the actual Resolve/Delete after the confirm dialog's "Confirm"
   *  (2026-07-31 — "pls add warning to delete, resolve button"). */
  function runConfirmedAction() {
    const { type, ticket } = confirmAction;
    setConfirmAction(null);
    if (type === "resolve") act(ticket.id, () => resolveException(ticket.id), t("Ticket resolved"));
    else act(ticket.id, () => deleteException(ticket.id), t("Ticket deleted"));
  }

  /** "Escalate" on a ticket (2026-07-31 — "for the exception escalate button
   *  also have the same feature to my escalate" / "add the pop-up to select
   *  who to escalate to"). Opens the SAME real "Escalate to office" modal
   *  Dashboard's own Escalate button uses (message + recipient picker), via
   *  the shared EscalateModal component — rather than firing a real alert
   *  silently with no way to say what's happening or pick who gets it. The
   *  backend's escalation-create hook (routes/escalations.js ->
   *  db/exceptionSync.js) already bumps this delegate's tracked ticket to
   *  CRITICAL on its own; the direct updatePriority call in
   *  onEscalated() below is the fallback for a manually-logged ticket (no
   *  linked auto-ticket for that hook to find). */
  function openEscalate(tk) {
    if (!tk.delegateId) return;
    setEscalatingTicket(tk);
  }
  async function onTicketEscalated() {
    const tk = escalatingTicket;
    setEscalatingTicket(null);
    flash(t("Escalated to office — alert sent"));
    if (tk) await updatePriority(tk.id, "CRITICAL").catch(() => {});
    load();
  }

  function handleCreated(_tk, wasCritical) {
    setModalOpen(false);
    flash(wasCritical ? t("Critical alert pushed to all staff devices") : t("Exception logged"));
    load();
  }

  /* ---- Slicing: tab, then search ---------------------------------------- */
  const byTab = useMemo(() => {
    const f = TABS.find((x) => x.key === tab).filter;
    return allTickets.filter(
      (tk) => (!f.status || tk.status === f.status)
        && (!f.excludeStatus || tk.status !== f.excludeStatus)
        && (!f.priority || tk.priority === f.priority)
        && (!f.excludePriority || tk.priority !== f.excludePriority)
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

  /* ---- Summary tiles: always over ALL tickets, never just the tab -------- */
  const stats = useMemo(() => {
    const resolved = allTickets.filter((tk) => tk.status === "RESOLVED");
    const mins = resolved.map(resolveMinutes).filter((m) => m != null);
    const avg = mins.length ? Math.round(mins.reduce((a, b) => a + b, 0) / mins.length) : null;

    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const today = resolved.filter((tk) => tk.resolvedAt && new Date(tk.resolvedAt) >= midnight).length;

    const open = allTickets.filter((tk) => tk.status === "OPEN");
    const oldest = open.reduce((max, tk) => Math.max(max, ageMinutes(tk.createdAt, now) ?? 0), 0);

    return { avg, today, oldest, openCount: open.length };
  }, [allTickets, now]);

  /* Open tickets grouped by issue type — the donut. */
  const mix = useMemo(() => {
    const by = new Map();
    allTickets.filter((tk) => tk.status === "OPEN").forEach((tk) => {
      const k = issueLabel(tk);
      by.set(k, (by.get(k) || 0) + 1);
    });
    return [...by.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [allTickets]);

  /* ---- Bulk selection ---------------------------------------------------- */
  const selectableIds = useMemo(
    () => tickets.filter((tk) => tk.status === "OPEN").map((tk) => tk.id),
    [tickets]
  );
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  function toggleOne(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => (allSelected ? new Set() : new Set([...prev, ...selectableIds])));
  }

  async function resolveSelected() {
    const ids = [...selected];
    if (!ids.length) return;
    setBulkBusy(true);
    let ok = 0, already = 0, failed = 0;
    // Sequential: each PATCH broadcasts over SSE, and a burst of parallel writes
    // would have every listener re-fetching the list N times over.
    for (const id of ids) {
      try { await resolveException(id); ok += 1; }
      catch (e) { if (e.code === "ALREADY_RESOLVED") already += 1; else failed += 1; }
    }
    setSelected(new Set());
    setBulkBusy(false);
    await load();
    const bits = [`${ok} ${t("resolved")}`];
    if (already) bits.push(`${already} ${t("already done")}`);
    if (failed) bits.push(`${failed} ${t("failed")}`);
    flash(bits.join(" · "));
  }

  /** "Escalate all" (2026-07-31 — "add button to Escalate all in dashboard
   *  alert and exception") — real escalations (email/SMS/WhatsApp + an
   *  `escalations` row, same as the single-ticket Escalate button), sent for
   *  every SELECTED open ticket that has a delegate. No per-ticket message
   *  picker for a bulk action this size — uses a generic message and the
   *  server's own default recipients (every admin), same fallback the
   *  EscalateModal itself uses when nothing's been unchecked. Tickets with
   *  no delegateId (a general "Dead phone" note with nobody identified) are
   *  skipped — there's no one to escalate. */
  async function escalateSelected() {
    const targets = tickets.filter((tk) => selected.has(tk.id) && tk.delegateId);
    if (!targets.length) return;
    setBulkBusy(true);
    let ok = 0, already = 0, failed = 0;
    for (const tk of targets) {
      try {
        const r = await apiPost("/escalations", { tripId: getActiveTripId(), delegateId: tk.delegateId, message: tk.note || undefined });
        if (r.alreadyOpen) already += 1; else ok += 1;
      } catch { failed += 1; }
    }
    setSelected(new Set());
    setBulkBusy(false);
    await load();
    const bits = [`${ok} ${t("escalated")}`];
    if (already) bits.push(`${already} ${t("already escalated")}`);
    if (failed) bits.push(`${failed} ${t("failed")}`);
    flash(bits.join(" · "));
  }

  function handleExport() {
    if (!tickets.length) { flash(t("Nothing to export in this view")); return; }
    const stamp = new Date().toISOString().slice(0, 10);
    const n = exportTicketsCsv(tickets, `exceptions-${tab.toLowerCase()}-${stamp}.csv`);
    flash(`${t("Exported")} ${n} ${n === 1 ? t("ticket") : t("tickets")}`);
  }

  const critical = tickets.find((tk) => tk.priority === "CRITICAL" && tk.status === "OPEN");

  /* ---- Row actions -------------------------------------------------------
   * Override (the manual "count present without a scan" fallback) was
   * removed entirely (2026-07-31 — "can you remove the override button from
   * exception") — Resolve/Escalate/Delete cover ticket handling; marking
   * actual attendance now happens on the Attendance sheet/Scanner instead.
   * ----------------------------------------------------------------------- */
  const rowActions = (tk) => {
    if (!canEdit) return null;
    return (
      <div className="exc-actions">
        {tk.status === "OPEN" && (
          <>
            <button className="exc-btn-sm resolve" disabled={busyId === tk.id}
              onClick={() => setConfirmAction({ type: "resolve", ticket: tk })}>
              {t("Resolve")}
            </button>
            {/* Only MISSING_PERSON opens the real "Escalate to office" pop-up
                (2026-07-31 — "for other issue, the escalate button should be
                how originally my teammate have. only the missing person
                should follow mine.") — every other issue type keeps Jayden's
                original one-click local priority bump. */}
            {tk.priority !== "CRITICAL" && tk.type === "MISSING_PERSON" && (
              <button className="exc-btn-sm escalate" disabled={busyId === tk.id}
                title={t("Escalate to office — emails/SMS/WhatsApps the admin team, same as Escalate to office elsewhere")}
                onClick={() => openEscalate(tk)}>
                <ChevronsUp size={14} /> {t("Escalate")}
              </button>
            )}
            {tk.priority !== "CRITICAL" && tk.type !== "MISSING_PERSON" && (
              <button className="exc-btn-sm escalate" disabled={busyId === tk.id}
                onClick={() => act(tk.id, () => updatePriority(tk.id, "CRITICAL"), t("Escalated — alert pushed to all staff"))}>
                <ChevronsUp size={14} /> {t("Escalate")}
              </button>
            )}
          </>
        )}
        <button className="exc-btn-sm danger" disabled={busyId === tk.id}
          onClick={() => setConfirmAction({ type: "delete", ticket: tk })}>
          {t("Delete")}
        </button>
      </div>
    );
  };

  /** Raised-at cell: time, who, and how long it has been sitting. */
  const raisedCell = (tk) => {
    const lvl = ageLevel(tk, now);
    return (
      <>
        <div className="muted">{fmtTime(tk.createdAt)} · {tk.raisedBy}</div>
        {tk.status === "OPEN" && (
          <span className={"exc-age" + (lvl ? " " + lvl : "")}>
            <Clock size={11} /> {fmtAge(ageMinutes(tk.createdAt, now))}
          </span>
        )}
        {tk.status === "RESOLVED" && tk.resolvedAt && (
          <span className="exc-resolved-meta">
            {t("resolved")} {fmtTime(tk.resolvedAt)}
            {tk.resolvedBy ? ` · ${tk.resolvedBy}` : ""}
            {resolveMinutes(tk) != null ? ` · ${t("took")} ${fmtAge(resolveMinutes(tk))}` : ""}
          </span>
        )}
      </>
    );
  };

  const tiles = (
    <div className="exc-stats">
      <div className="exc-stat">
        <div className="exc-stat__label">{t("Open")}</div>
        <div className="exc-stat__value">{counts.open ?? 0}</div>
        <div className="exc-stat__foot">{counts.all ?? 0} {t("total")}</div>
      </div>
      <div className={"exc-stat" + ((counts.criticalOpen ?? 0) > 0 ? " danger" : "")}>
        <div className="exc-stat__label">{t("Critical open")}</div>
        <div className="exc-stat__value">{counts.criticalOpen ?? 0}</div>
        <div className="exc-stat__foot">{counts.critical ?? 0} {t("ever raised")}</div>
      </div>
      <div className="exc-stat">
        <div className="exc-stat__label">{t("Avg resolve")}</div>
        <div className="exc-stat__value">{stats.avg == null ? "—" : fmtAge(stats.avg)}</div>
        <div className="exc-stat__foot">{counts.resolved ?? 0} {t("resolved")}</div>
      </div>
      <div className={"exc-stat" + (stats.oldest >= 30 ? " danger" : stats.oldest >= 15 ? " warn" : "")}>
        <div className="exc-stat__label">{t("Oldest open")}</div>
        <div className="exc-stat__value">{stats.openCount ? fmtAge(stats.oldest) : "—"}</div>
        <div className="exc-stat__foot">{stats.today} {t("resolved today")}</div>
      </div>

      <div className="exc-stat exc-mix">
        <div className="exc-stat__label">{t("Open by issue")}</div>
        {mix.length === 0 ? (
          <div className="exc-mix__empty">{t("Nothing open")}</div>
        ) : (
          <div className="exc-mix__body">
            <div className="exc-mix__chart">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={mix} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="100%"
                       paddingAngle={2} stroke="none" isAnimationActive={false}>
                    {mix.map((_, i) => <Cell key={i} fill={SLICE_COLOURS[i % SLICE_COLOURS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v, n) => [`${v} ${t("open")}`, n]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="exc-mix__legend">
              {mix.slice(0, 4).map((m, i) => (
                <li key={m.name}>
                  <span className="swatch" style={{ background: SLICE_COLOURS[i % SLICE_COLOURS.length] }} />
                  <span className="lbl">{m.name}</span>
                  <span className="num">{m.value}</span>
                </li>
              ))}
              {mix.length > 4 && <li className="more">+{mix.length - 4} {t("more")}</li>}
            </ul>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="page">
      <div className="exc-header">
        <div>
          <div className="page-eyebrow">
            {tripMeta
              ? `${tripMeta.name}${tripMeta.dayOf ? ` · ${t("Day")} ${tripMeta.dayOf}${tripMeta.totalDays ? `/${tripMeta.totalDays}` : ""}` : ""}`
              : t("Exceptions")}
          </div>
          <h1 className="page-title">{t("Exception inbox")}</h1>
          <p className="page-sub">{t("Log and resolve on-site exceptions; critical alerts push to all staff.")}</p>
        </div>
        {/* RE-REMOVED after taking Jayden's v2 inbox (2026-07-29 — "remove the
            live icon on exception"). His branch predates that request, so his
            overhaul brought the "Live"/"Connecting…" pill back; it's dropped
            again here. Nothing functional is lost: the SSE subscription below
            still drives the live refresh — this badge only ever DISPLAYED the
            stream's connection state, it never controlled it. `live` state is
            kept because his stream handler still sets it; only the pill goes. */}
      </div>

      <CachedDataBadge stale={cacheStale} at={cacheAt} style={{ marginBottom: 14 }} />

      {tiles}

      {critical && (
        <div className="exc-banner">
          <div className="row" style={{ alignItems: "flex-start" }}>
            <AlertTriangle size={22} color="var(--scc-red)" strokeWidth={2.2} />
            <div>
              <div className="exc-banner__title">
                {counts.criticalOpen} {t("critical open")} · {t("pushed to all staff devices")}
              </div>
              <div className="exc-banner__sub">
                {issueLabel(critical)} · {critical.coach || t("Unassigned")} ·{" "}
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
          {TABS.map(({ key, count }) => (
            <button key={key} role="tab" aria-selected={tab === key}
              className={"exc-tab" + (tab === key ? " active" : "")} onClick={() => setTab(key)}>
              {t(key)} <span className="count">· {count(counts)}</span>
            </button>
          ))}
        </div>
        <div className="exc-toolbar__right">
          <div className="exc-search">
            <Search size={15} />
            <input
              className="exc-search__input"
              placeholder={t("Search delegate, coach, issue…")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={t("Search tickets")}
            />
            {query && (
              <button className="exc-search__x" onClick={() => setQuery("")} aria-label={t("Clear search")}>
                <X size={14} />
              </button>
            )}
          </div>
          <button className="btn btn-ghost" onClick={handleExport} title={t("Download this view as CSV")}>
            <Download size={15} /> {t("Export")}
          </button>
          {canEdit && (
            <button className="btn btn-primary" onClick={() => setModalOpen(true)}>
              <Plus size={16} strokeWidth={2.5} /> {t("Log exception")}
            </button>
          )}
        </div>
      </div>

      {query && !loading && (
        <div className="exc-filterbar">
          {t("Showing")} {tickets.length} / {byTab.length} · {t(tab)}
          <button className="exc-btn-sm" onClick={() => setQuery("")}>{t("Clear")}</button>
        </div>
      )}

      {canEdit && selected.size > 0 && (
        <div className="exc-bulkbar">
          <span><strong>{selected.size}</strong> {t("selected")}</span>
          <div className="row" style={{ gap: 8 }}>
            <button className="exc-btn-sm" onClick={() => setSelected(new Set())} disabled={bulkBusy}>{t("Clear")}</button>
            <button className="exc-btn-sm escalate" onClick={escalateSelected} disabled={bulkBusy}>
              <ChevronsUp size={15} /> {bulkBusy ? t("Escalating…") : `${t("Escalate all")}`}
            </button>
            <button className="btn btn-primary" onClick={resolveSelected} disabled={bulkBusy}>
              <CheckCircle2 size={15} /> {bulkBusy ? t("Resolving…") : `${t("Resolve")} ${selected.size}`}
            </button>
          </div>
        </div>
      )}

      {/* Desktop table */}
      <div className="card exc-table-wrap" style={{ padding: 4 }}>
        <table className="table">
          <thead>
            <tr>
              {canEdit && (
                <th className="exc-checkcol">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll}
                         disabled={!selectableIds.length} aria-label={t("Select all open tickets")} />
                </th>
              )}
              <th>{t("Priority")}</th><th>{t("Issue")}</th><th>{t("Delegate")}</th>
              <th>{t("Coach")}</th><th>{t("Raised")}</th><th>{t("Status")}</th><th></th>
            </tr>
          </thead>
          <tbody>
            {loading && Array.from({ length: 4 }).map((_, i) => (
              <tr key={i}><td colSpan={canEdit ? 8 : 7}><div className="exc-skeleton" /></td></tr>
            ))}

            {!loading && !error && tickets.map((tk) => (
              <tr key={tk.id} className={selected.has(tk.id) ? "exc-row-sel" : ""}>
                {canEdit && (
                  <td className="exc-checkcol">
                    {tk.status === "OPEN" && (
                      <input type="checkbox" checked={selected.has(tk.id)} onChange={() => toggleOne(tk.id)}
                             aria-label={`${t("Select ticket")} ${issueLabel(tk)}`} />
                    )}
                  </td>
                )}
                <td><StatusBadge state={tk.priority} /></td>
                <td>
                  <div className="exc-issue-title">
                    {issueLabel(tk)}
                    {tk.delegateVip && <span className="exc-vip">VIP</span>}
                  </div>
                  <div className="exc-issue-sub">{tk.note}</div>
                </td>
                <td>{tk.delegateName || t("Unidentified")}</td>
                <td>{tk.coach || "—"}</td>
                <td>{raisedCell(tk)}</td>
                <td><StatusBadge state={tk.status} /></td>
                <td>{rowActions(tk)}</td>
              </tr>
            ))}

            {!loading && !error && tickets.length === 0 && (
              <tr><td colSpan={canEdit ? 8 : 7}>
                <div className="exc-state">
                  {query ? `${t("No tickets match")} “${query}”.` : t("All clear — no tickets in this view.")}
                </div>
              </td></tr>
            )}
            {error && (
              <tr><td colSpan={canEdit ? 8 : 7}>
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
              <div className="row" style={{ gap: 8, alignItems: "center" }}>
                {canEdit && tk.status === "OPEN" && (
                  <input type="checkbox" checked={selected.has(tk.id)} onChange={() => toggleOne(tk.id)}
                         aria-label={`${t("Select ticket")} ${issueLabel(tk)}`} />
                )}
                <StatusBadge state={tk.priority} />
              </div>
              <StatusBadge state={tk.status} />
            </div>
            <div className="exc-issue-title">
              {issueLabel(tk)}
              {tk.delegateVip && <span className="exc-vip">VIP</span>}
            </div>
            <div className="exc-issue-sub">{tk.note}</div>
            <div className="exc-card__meta">{tk.delegateName || t("Unidentified")} · {tk.coach || "—"}</div>
            <div className="exc-card__meta">{raisedCell(tk)}</div>
            {rowActions(tk)}
          </div>
        ))}
        {!loading && !error && tickets.length === 0 && (
          <div className="exc-state">
            {query ? `${t("No tickets match")} “${query}”.` : t("All clear — no tickets in this view.")}
          </div>
        )}
        {error && <div className="exc-state">{error} <button className="exc-btn-sm" onClick={load}>{t("Retry")}</button></div>}
      </div>

      {modalOpen && <LogExceptionModal onClose={() => setModalOpen(false)} onCreated={handleCreated} tripId={getActiveTripId()} />}
      {escalatingTicket && (
        <EscalateModal
          delegateId={escalatingTicket.delegateId}
          delegateName={escalatingTicket.delegateName || t("Unidentified")}
          tripId={getActiveTripId()}
          defaultMessage={escalatingTicket.note || undefined}
          onClose={() => setEscalatingTicket(null)}
          onEscalated={onTicketEscalated}
        />
      )}
      {confirmAction && (
        <ConfirmDialog
          title={confirmAction.type === "resolve" ? t("Resolve this ticket?") : t("Delete this ticket?")}
          message={confirmAction.type === "resolve"
            ? t("This marks the exception as handled. It'll move to the Resolved tab and stay in the record.")
            : t("This permanently removes the ticket — there's no undo.")}
          confirmLabel={confirmAction.type === "resolve" ? t("Resolve") : t("Delete")}
          tone={confirmAction.type === "delete" ? "danger" : "default"}
          onCancel={() => setConfirmAction(null)}
          onConfirm={runConfirmedAction}
        />
      )}
      {toast && <div className="exc-toast">{toast}</div>}
    </div>
  );
}
