/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — mobile Attendance (the Attendance half of Ops)
 * ============================================================================= */
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
// RefreshCw dropped 2026-07-29 with this page's own Refresh button — MobileOpsPage
// renders one directly above, and load() polls every 8s regardless.
import { AlertTriangle, Crown, Search, MapPin, X, Phone, PencilLine, CheckCircle2, Clock, Siren, BedDouble, Briefcase } from "lucide-react";
import { apiGet, apiPost, apiPatch, getPermissions } from "../../../lib/api.js";
import { useLang } from "../../../lib/i18n.jsx";
import DelegateAvatar from "../../../components/delegate/DelegateAvatar.jsx";
import DelegateLocationMap from "../../../components/delegate/DelegateLocationMap.jsx";
import DelegateTimeline from "../../../components/delegate/DelegateTimeline.jsx";

import { getMobileTripId } from "../../../lib/mobileTrip.js";
import { effectiveStatus } from "../../../lib/dashboard/delegateStatus.js";
// Modularization pass (2026-08-02) — see pages/mobile/attendance/ for what
// used to be defined inline in this file.
import { StatusSheet } from "./attendance/StatusSheet.jsx";
// Offline-capable delegate writes (2026-07-28) — attendance decisions taken
// on-site must survive a dead signal. See lib/outbox.js.
import { patchDelegate, applyQueuedPatches } from "../../../lib/localstorage/delegateWrites.js";
import { useVisiblePolling } from "../../../lib/useVisiblePolling.js";
// Offline-capable delegate READS (2026-07-31) — this is one of the pages
// flagged as most important ("the manual, attendance, exception, trip"): a
// dead signal used to mean load() below throws and the whole roster
// disappears behind an error banner. See lib/cachedFetch.js.
import { cachedFetch } from "../../../lib/localstorage/cachedFetch.js";
import CachedDataBadge from "../../../components/localstorage/CachedDataBadge.jsx";
// UNASSIGNED is deliberately excluded — delegates are assigned to a coach by
// staff on the desktop admin pages BEFORE the event; mobile's job during the
// event is tracking who's arrived/late/missing, not doing the assignment
// itself, so unassigned delegates don't belong on this list or its filters.
const FILTERS = ["ALL", "ASSIGNED", "ARRIVED", "LATE", "MISSING", "CANCELLED"];
// CANCELLED isn't a real `status` — a cancelled delegate is forced to
// UNASSIGNED with a `cancelled` flag + reason. This filter therefore checks
// `d.cancelled` directly, the one place here that looks past the UNASSIGNED
// exclusion on purpose.
//
// The "Update status" sheet offers only MISSING + ASSIGNED (the FILTERS row
// still shows all five — this limits what can be hand-SET, not viewed):
//  - MISSING is the field judgement this sheet exists for.
//  - ASSIGNED is its UNDO ("wrong person marked missing"); re-tapping an
//    active status is a no-op, so without it a mis-tap needed desktop.
// Don't re-add LATE or ARRIVED: LATE is scheduler-computed (server.js) and a
// hand-set value gets overwritten next tick; ARRIVED belongs to the real
// check-in paths that write a `check_in_logs` audit row, so setting it here
// would mark someone present with no trail and desync the head-count.
const STATUS_BADGE_CLASS = {
  PRESENT: "badge-arrived", ARRIVED: "badge-arrived", ASSIGNED: "badge-assigned",
  LATE: "badge-late", MISSING: "badge-missing", UNASSIGNED: "badge-unassigned",
};
// Sorted by urgency before name so people needing chasing surface at the top.
const STATUS_ORDER = { MISSING: 0, LATE: 1, ASSIGNED: 2, ARRIVED: 3, UNASSIGNED: 4 };
// Left-edge stripe colour — scannable without reading, which is what makes a
// 40-person roster usable while scrolling on a phone.
const STATUS_ACCENT = {
  MISSING: "var(--st-missing)", LATE: "var(--st-late)",
  ARRIVED: "var(--st-present)", PRESENT: "var(--st-present)",
  ASSIGNED: "var(--st-assigned)", UNASSIGNED: "var(--line)",
};

/**
 * Mobile Attendance sheet — the full delegate roster (GET /api/trips/:id/
 * delegates), searchable/filterable. The "look up one person / fix their
 * status" view; Home is the overall picture.
 *
 * Accepts ?status=MISSING (Home's KPI tiles and Coach status card link here
 * that way) so tapping "20 missing" lands on the filtered list.
 *
 * Status changes go through the StatusSheet bottom sheet, not an inline
 * <select>. MISSING/LATE rows get a one-tap call button; with no phone on file
 * it prompts for one and saves it back rather than hiding the button.
 */
export default function MobileAttendancePage() {
  const { t } = useLang();
  const [searchParams] = useSearchParams();
  const canEdit = getPermissions().manageDelegates;
  // Read fresh on every mount (not module-load time) so navigating here
  // after switching trips on Home picks up the CURRENT selection, not
  // whatever was in localStorage when this module first loaded.
  const TRIP_ID = getMobileTripId();
  const [delegates, setDelegates] = useState([]);
  const [coaches, setCoaches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cacheStale, setCacheStale] = useState(false);
  const [cacheAt, setCacheAt] = useState(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(() => {
    const s = (searchParams.get("status") || "ALL").toUpperCase();
    return FILTERS.includes(s) ? s : "ALL";
  });
  // ?coach=<id> — set when the Home page's Coach status card links to one
  // specific coach's missing list instead of everyone's.
  const [coachFilter, setCoachFilter] = useState(() => searchParams.get("coach") || null);
  // Tap-to-reveal-more paging (mobile convention, vs desktop's page numbers):
  // renders PAGE_SIZE of `visible`, +PAGE_SIZE per tap. Resets on
  // filter/search/coach change so a new filter never opens mid-page.
  const PAGE_SIZE = 20;
  const [shownCount, setShownCount] = useState(PAGE_SIZE);
  useEffect(() => { setShownCount(PAGE_SIZE); }, [filter, query, coachFilter]);
  const [rowError, setRowError] = useState(null); // { id, message }
  const [savingId, setSavingId] = useState(null);
  const [mapDelegate, setMapDelegate] = useState(null);
  const [statusSheetFor, setStatusSheetFor] = useState(null); // the delegate being re-statused, or null
  // Delegate detail sheet — phone/map/escalate in one place (2026-07-25,
  // mirrors the desktop profile panel) instead of only the separate small
  // icon buttons in the row above.
  const [detailDelegate, setDetailDelegate] = useState(null);
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneSaving, setPhoneSaving] = useState(false);
  async function savePhone(d) {
    const phone = phoneInput.trim();
    if (!phone) return;
    setPhoneSaving(true);
    try {
      await apiPatch(`/delegates/${d.id}`, { phone });
      setDelegates((list) => list.map((x) => (x.id === d.id ? { ...x, phone } : x)));
      setDetailDelegate((cur) => (cur && cur.id === d.id ? { ...cur, phone } : cur));
      setPhoneInput("");
    } catch (e) {
      setRowError({ id: d.id, message: e.message || t("Could not save phone number.") });
    } finally {
      setPhoneSaving(false);
    }
  }
  const [tripUuid, setTripUuid] = useState(null);
  // "Escalate to office" — same feature/endpoints as desktop's Alerts modal
  // (2026-07-25, "staff are the one to escalate" — mobile needs to be able
  // to RAISE one, not just see the banner for one already raised).
  const [escalatingDelegate, setEscalatingDelegate] = useState(null);
  const [escalateMessage, setEscalateMessage] = useState("");
  const [escalateRecipients, setEscalateRecipients] = useState([]);
  const [escalateSelected, setEscalateSelected] = useState(new Set());
  const [escalateSaving, setEscalateSaving] = useState(false);
  const [escalateErr, setEscalateErr] = useState(null);
  // Shared by the map/timeline modals below — only dismiss if the WHOLE
  // click gesture started on the backdrop itself.
  const downOnBackdrop = useRef(false);

  // Guards a poll tick against (a) overlapping with a still-in-flight
  // previous poll, and (b) landing while a row's status edit is mid-save —
  // savingId is read via a ref since the interval's closure is set up once
  // and wouldn't otherwise see later state updates.
  const loadingRef = useRef(false);
  const savingIdRef = useRef(null);
  useEffect(() => { savingIdRef.current = savingId; }, [savingId]);

  // Auto-refresh so another staff member's change appears without a Refresh
  // tap. useVisiblePolling pauses while backgrounded — this is the page staff
  // leave open on a phone all day, so that matters most here.
  useVisiblePolling(load, 8000);

  async function load() {
    if (loadingRef.current || savingIdRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const [delegatesRes, dashRes] = await Promise.all([
        cachedFetch(`mobile-attendance-delegates:${TRIP_ID}`, () => apiGet(`/trips/${TRIP_ID}/delegates`)),
        cachedFetch(`mobile-attendance-dashboard:${TRIP_ID}`, () => apiGet(`/trips/${TRIP_ID}/dashboard`)),
      ]);
      const { delegates: d } = delegatesRes.data;
      const dash = dashRes.data;
      setCacheStale(delegatesRes.stale || dashRes.stale);
      setCacheAt(delegatesRes.stale ? delegatesRes.at : dashRes.at);
      // MUST re-check here, not only at the top of load(): the entry guard
      // can't stop a poll ALREADY in flight when a save started. That
      // response predates the save, so applying it would overwrite the fresh
      // optimistic update with stale data — it looked like the app "resetting"
      // a cancellation. Bail and let the next tick fetch post-save state.
      if (savingIdRef.current) return;
      // Overlay any still-unsynced offline changes on top of the server's copy,
      // so a reload with no signal doesn't appear to throw away the staff
      // member's own attendance decisions (2026-07-28).
      setDelegates(applyQueuedPatches(d || []));
      setCoaches(dash.coaches || []);
      setTripUuid(dash.trip?.uuid_id || null);
    } catch (e) {
      setError(e.message || "Could not reach the backend.");
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }

  const coachName = (id) => {
    const c = coaches.find((x) => x.id === id);
    return c ? [c.name, c.city].filter(Boolean).join(" · ") : t("Unassigned");
  };

  // Missing AND Late delegates get a call action — Late means they haven't
  // checked in by the trip's cutoff yet (might just be running behind),
  // Missing means staff genuinely can't account for them. Works even with
  // no phone on file yet, since most demo/real delegates don't have one
  // populated — prompts for a number (saved back onto the delegate) the
  // first time, then calls.
  async function callDelegate(d) {
    let phone = d.phone;
    if (!phone) {
      const entered = window.prompt(t("No phone number on file for") + ` ${d.name}. ` + t("Enter one to call:"));
      phone = (entered || "").trim();
      if (!phone) return;
      setSavingId(d.id);
      try {
        await apiPatch(`/delegates/${d.id}`, { phone });
        setDelegates((list) => list.map((x) => (x.id === d.id ? { ...x, phone } : x)));
      } catch (e) {
        setRowError({ id: d.id, message: e.message || t("Could not save phone number.") });
        setSavingId(null);
        return;
      }
      setSavingId(null);
    }
    window.location.href = `tel:${phone}`;
  }

  function openEscalate(d) {
    setEscalatingDelegate(d);
    setEscalateMessage(t("Not answering phone calls"));
    setEscalateErr(null);
    const qs = tripUuid ? `?tripId=${encodeURIComponent(tripUuid)}` : "";
    apiGet(`/escalations/recipients${qs}`).then((r) => {
      const list = r.recipients || [];
      setEscalateRecipients(list);
      setEscalateSelected(new Set(list.map((p) => p.email)));
    }).catch(() => { setEscalateRecipients([]); setEscalateSelected(new Set()); });
  }
  function toggleEscalateRecipient(email) {
    setEscalateSelected((prev) => {
      const next = new Set(prev);
      next.has(email) ? next.delete(email) : next.add(email);
      return next;
    });
  }
  async function submitEscalation() {
    setEscalateSaving(true);
    setEscalateErr(null);
    try {
      const r = await apiPost("/escalations", {
        tripId: tripUuid || null,
        delegateId: escalatingDelegate.id,
        message: escalateMessage.trim(),
        recipientEmails: [...escalateSelected],
      });
      if (r.alreadyOpen) {
        setEscalateErr(t("This delegate already has an open escalation — no new alert was sent."));
        setEscalateSaving(false);
        return;
      }
      setEscalatingDelegate(null);
      setDetailDelegate(null);
    } catch (e) {
      setEscalateErr(e.message || t("Couldn't send the escalation. Please try again."));
    } finally {
      setEscalateSaving(false);
    }
  }

  // `location` is only ever passed (and required — see StatusSheet) when
  // status is MISSING; otherwise lastSeen/lastLocation are cleared so a
  // later Missing spell doesn't silently inherit a stale location from a
  // previous one. Mirrors DashboardPage.jsx's saveForm() on desktop.
  async function changeStatus(d, status, extra) {
    setStatusSheetFor(null);
    // "CANCELLED" isn't a real status (see backend/db/schema.js's comment on
    // the `cancelled` column) — a dedicated one-tap action in the field for
    // "this person isn't coming after all, here's why" ("need to have to be
    // able to change the delegate status to unassigned, add a textfield
    // that let staff put what happen" — 2026-07-24). The backend always
    // forces status back to UNASSIGNED and clears coachId when
    // cancelled=true, so only that flag + the reason need sending.
    if (status === "CANCELLED") {
      setRowError(null);
      setSavingId(d.id);
      const prev = delegates;
      const patch = { cancelled: true, cancelReason: (extra || "").trim() };
      setDelegates((list) => list.map((x) => (x.id === d.id ? { ...x, ...patch, status: "UNASSIGNED", coachId: null } : x)));
      try {
        // Queues instead of failing when there's no signal; the optimistic
        // update above then simply stands (2026-07-28).
        await patchDelegate(d.id, patch, { label: d.name });
      } catch (e) {
        setDelegates(prev);
        setRowError({ id: d.id, message: e.message || t("Save failed.") });
      } finally {
        setSavingId(null);
      }
      return;
    }
    const location = extra;
    const nextLocation = status === "MISSING" ? (location || "").trim() : "";
    if (status === d.status && nextLocation === (d.lastLocation || "")) return;
    setRowError(null);
    setSavingId(d.id);
    const prev = delegates;
    const patch = { status, lastLocation: nextLocation, lastSeen: status === "MISSING" ? d.lastSeen || "" : "" };
    setDelegates((list) => list.map((x) => (x.id === d.id ? { ...x, ...patch } : x)));
    try {
      // Offline-capable (2026-07-28): with no signal this queues the change and
      // resolves, so the optimistic update stands and the outbox replays it
      // later. A real refusal (403/404) still throws and rolls back below.
      await patchDelegate(d.id, patch, { label: d.name });
    } catch (e) {
      setDelegates(prev); // roll back the optimistic update
      setRowError({ id: d.id, message: e.message || t("Save failed.") });
    } finally {
      setSavingId(null);
    }
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (filter === "CANCELLED") {
      // Bypasses the UNASSIGNED exclusion below on purpose — see the FILTERS
      // comment on why "Cancelled" is the one filter that looks past it.
      return delegates
        .filter((d) => d.cancelled)
        .filter((d) => !coachFilter || d.coachId === coachFilter)
        .filter((d) => !q || (d.name || "").toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    return delegates
      .filter((d) => effectiveStatus(d) !== "UNASSIGNED") // see the FILTERS comment above
      .filter((d) => filter === "ALL" || effectiveStatus(d) === filter)
      .filter((d) => !coachFilter || d.coachId === coachFilter)
      .filter((d) => !q || (d.name || "").toLowerCase().includes(q))
      // Urgency first, then alphabetical (2026-07-29 — was alphabetical only).
      // This is an attendance sheet: the people who need action (Missing, then
      // Late) are the reason staff opened it, and burying them alphabetically
      // meant scrolling past everyone already accounted for to find them. A-Z
      // still applies WITHIN each status, so a specific person is no harder to
      // find — and Search is right there for that case anyway. No-op when a
      // single-status chip is selected, since urgency is then constant.
      .sort((a, b) =>
        (STATUS_ORDER[effectiveStatus(a)] ?? 9) - (STATUS_ORDER[effectiveStatus(b)] ?? 9)
        || (a.name || "").localeCompare(b.name || ""));
  }, [delegates, query, filter, coachFilter]);

  // Per-status counts for the filter chips. A chip reading "Missing 3" answers
  // the question staff came here with WITHOUT them having to tap it first, and
  // a "Late 0" is just as useful — it's a confirmation, not empty space, which
  // is also why all five chips stay visible even at zero rather than being
  // hidden. Scoped by the coach filter (so it reads as "missing ON THIS COACH")
  // but deliberately NOT by the search box: counts that shifted while typing a
  // name would be noise. Computed after the same UNASSIGNED exclusion the list
  // uses, so the four status counts always sum to the ALL count.
  const counts = useMemo(() => {
    const coachScoped = delegates.filter((d) => !coachFilter || d.coachId === coachFilter);
    const base = coachScoped.filter((d) => effectiveStatus(d) !== "UNASSIGNED");
    const out = { ALL: base.length, ASSIGNED: 0, ARRIVED: 0, LATE: 0, MISSING: 0, CANCELLED: 0 };
    for (const d of base) {
      const s = effectiveStatus(d);
      if (out[s] !== undefined) out[s] += 1;
    }
    // Counted separately from `base` — cancelled delegates are UNASSIGNED,
    // which `base` deliberately excludes (see the FILTERS comment above).
    out.CANCELLED = coachScoped.filter((d) => d.cancelled).length;
    return out;
  }, [delegates, coachFilter]);

  const isFiltered = filter !== "ALL" || !!coachFilter || !!query.trim();
  function clearFilters() {
    setFilter("ALL");
    setCoachFilter(null);
    setQuery("");
  }

  const FILTER_LABEL = {
    ALL: "All statuses", UNASSIGNED: "Unassigned", ASSIGNED: "Assigned",
    ARRIVED: "Arrived", LATE: "Late", MISSING: "Missing", CANCELLED: "Cancelled",
  };

  return (
    <div>
      {/* The page title and the manual Refresh button that used to sit here are
          GONE (2026-07-29 — "remove the refresh button since there alr one
          ontop"). This page is only ever reached through MobileOpsPage, which
          already renders, directly above it: a sticky "MusterGo" topbar, an
          "Operations / Live headcount" card WITH its own Refresh, and a Total
          KPI tile that said exactly what the old "N delegates" heading said.
          Three stacked headings before the first delegate row was the real
          space problem. The refresh was redundant regardless — load() polls
          every 8s, so nothing here goes stale waiting to be tapped.

          What replaces them is the one thing neither of those shows: how many
          rows the CURRENT filters are producing (rendered just above the list,
          below the chips). The old heading always counted the WHOLE roster, so
          arriving via a ?status=MISSING deep link read "10 delegates" above a
          list of 3 — actively misleading at the exact moment staff are
          counting people. */}

      <CachedDataBadge stale={cacheStale} at={cacheAt} style={{ marginBottom: 10 }} />

      {error && (
        <div className="mobile-card" style={{ borderColor: "var(--st-missing)", background: "var(--st-missing-bg)" }}>
          <div className="row" style={{ gap: 8, color: "var(--st-missing)", fontWeight: 600, fontSize: 14 }}>
            <AlertTriangle size={16} /> {t("Couldn't reach the backend")}
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t(error)}</p>
        </div>
      )}

      {/* Search + coach on ONE row (2026-07-29). They were two stacked rows,
          which together with the chip row meant three full-width bands of
          controls before the first delegate — on a 375px phone that's most of
          the first screen spent on filters nobody has touched yet. */}
      <div className="row" style={{ gap: 8, marginBottom: 10, alignItems: "stretch" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <Search size={15} style={{ position: "absolute", left: 10, top: 11, color: "var(--ink-3)", pointerEvents: "none" }} />
          <input
            className="input"
            placeholder={t("Search delegates…")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ paddingLeft: 32, paddingRight: query ? 32 : undefined }}
          />
          {/* Clearing a typo'd name meant holding backspace — on a phone, with
              one hand, while looking for someone. */}
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label={t("Clear search")}
              style={{
                position: "absolute", right: 4, top: 4, bottom: 4, width: 26, padding: 0,
                background: "none", border: "none", color: "var(--ink-3)",
                display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>
        {/* Only worth showing when there's a choice to make — a one-coach trip
            got a dropdown whose only other option was "All coaches". */}
        {coaches.length > 1 && (
          <select
            className="select"
            value={coachFilter || ""}
            onChange={(e) => setCoachFilter(e.target.value || null)}
            aria-label={t("Filter by coach")}
            style={{ flex: "0 1 42%", minWidth: 0, fontSize: 13 }}
          >
            <option value="">{t("All coaches")}</option>
            {coaches.map((c) => (
              <option key={c.id} value={c.id}>{[c.name, c.city].filter(Boolean).join(" · ")}</option>
            ))}
          </select>
        )}
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 10, overflowX: "auto", paddingBottom: 4 }}>
        {FILTERS.map((f) => {
          // Missing stays red at all times, active or not — it's the one
          // status that needs to read as urgent on sight, not just when
          // selected, so it doesn't blend in as just another neutral tab.
          // Every other filter uses ITS OWN status color when selected
          // (Assigned -> blue, Arrived -> green, Late -> orange) instead of
          // always turning green — a selected "Assigned" chip that renders
          // green reads as "Arrived", which is a different status entirely.
          const isMissing = f === "MISSING";
          const active = filter === f;
          const activeTone = { ASSIGNED: "assigned", ARRIVED: "present", LATE: "late", UNASSIGNED: "unassigned", CANCELLED: "neutral" }[f] || "present";
          const cls = isMissing ? "badge-missing" : active ? `badge-${activeTone}` : "badge-neutral";
          const n = counts[f];
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              aria-pressed={active}
              className={"badge " + cls}
              style={{
                flexShrink: 0, cursor: "pointer", fontSize: 12.5, padding: "7px 12px",
                border: active ? "1.5px solid currentColor" : "1.5px solid transparent",
                // A zero-count chip is dimmed rather than hidden — all five
                // stay put so the row never reflows under your thumb mid-tap,
                // and "Late 0" is a useful answer in its own right.
                opacity: n === 0 && !active ? 0.45 : isMissing && !active ? 0.75 : 1,
                display: "inline-flex", alignItems: "center", gap: 6,
              }}
            >
              {t(FILTER_LABEL[f])}
              <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", opacity: 0.75 }}>{n}</span>
            </button>
          );
        })}
      </div>

      {/* Replaces the old "N delegates" heading: says what's on screen RIGHT
          NOW, and gives one tap back to the full roster. Only rendered while
          something is actually filtered, so the unfiltered view stays clean. */}
      {isFiltered && !error && (
        <div className="row between" style={{ marginBottom: 12, gap: 8, fontSize: 12.5 }}>
          <span className="muted">
            {t("Showing")} <strong style={{ color: "var(--ink)" }}>{visible.length}</strong> {t("of")} {counts.ALL}
          </span>
          <button
            onClick={clearFilters}
            className="btn btn-ghost"
            style={{ padding: "5px 10px", fontSize: 12, flexShrink: 0 }}
          >
            <X size={13} /> {t("Clear filters")}
          </button>
        </div>
      )}

      {/* Skeleton rows instead of a bare "Loading…" line — the roster is the
          whole page, so showing its SHAPE while it loads avoids the layout
          jumping down once real rows arrive. */}
      {loading && delegates.length === 0 && !error && (
        <>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="mobile-card" style={{ padding: "13px 14px", display: "flex", gap: 12, alignItems: "center" }}>
              <div className="mg-skel" style={{ width: 36, height: 36, borderRadius: "50%", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mg-skel" style={{ height: 11, width: "55%", borderRadius: 4 }} />
                <div className="mg-skel" style={{ height: 9, width: "35%", borderRadius: 4, marginTop: 7 }} />
              </div>
            </div>
          ))}
          {/* The skeletons are decorative, so the load still needs to be
              announced for a screen reader. There's no global .sr-only in
              tokens.css/mobile.css, so it's defined here rather than adding a
              new app-wide class for one label. */}
          <span className="mg-sr-only">{t("Loading…")}</span>
          <style>{`
            .mg-skel{background:var(--surface-2);animation:mg-skel-pulse 1.4s ease-in-out infinite}
            @keyframes mg-skel-pulse{0%,100%{opacity:.55}50%{opacity:1}}
            @media (prefers-reduced-motion: reduce){.mg-skel{animation:none}}
            .mg-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
          `}</style>
        </>
      )}

      {/* A dead end with no way out was the old behaviour here: filter to
          "Late", get "No delegates match your filters", and the only route
          back was working out which of three controls to undo. Now the empty
          state itself offers the way out. */}
      {!loading && visible.length === 0 && !error && (
        <div className="mobile-card" style={{ textAlign: "center", padding: "22px 16px" }}>
          <CheckCircle2 size={22} style={{ color: "var(--ink-3)", marginBottom: 6 }} />
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>
            {delegates.length === 0 ? t("No delegates yet.") : t("No delegates match your filters.")}
          </div>
          {isFiltered && delegates.length > 0 && (
            <>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {counts.ALL} {t("delegates are on this trip.")}
              </div>
              <button className="btn btn-ghost" style={{ marginTop: 12, fontSize: 12.5 }} onClick={clearFilters}>
                <X size={13} /> {t("Clear filters")}
              </button>
            </>
          )}
        </div>
      )}

      {visible.slice(0, shownCount).map((d) => {
        const missing = d.status === "MISSING";
        // Late delegates are the other case staff actually want to ring —
        // they haven't checked in by the trip's cutoff and might just be
        // running behind, not necessarily missing.
        const callable = missing || effectiveStatus(d) === "LATE";
        return (
          <div
            key={d.id}
            className="mobile-card"
            style={{
              // Tightened from a flat 16 (2026-07-29). Ten rows at the old
              // height ran well past two screens; this fits noticeably more
              // roster per scroll without the tap targets getting smaller —
              // every button below keeps its own padding.
              padding: "13px 14px",
              marginBottom: 10,
              // Status stripe down the left edge — see STATUS_ACCENT.
              borderLeft: `3px solid ${STATUS_ACCENT[effectiveStatus(d)] || "var(--line)"}`,
            }}
          >
            <div className="row" style={{ gap: 12, minWidth: 0 }}>
              {/* Tap the delegate's own info to open the detail sheet
                  (phone/map/escalate all in one place, 2026-07-25) — the
                  small icon buttons to the right stay as fast one-tap
                  shortcuts, this is the fuller view. */}
              <div className="row" style={{ gap: 12, minWidth: 0, flex: 1, cursor: "pointer" }} onClick={() => setDetailDelegate(d)}>
                <DelegateAvatar delegate={d} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <span style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
                    {d.vip && <Crown size={14} color="var(--st-review)" style={{ flexShrink: 0 }} />}
                  </div>
                  <div className="muted" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {d.cancelled
                      ? <>{t("Cancelled")} · {d.cancelReason ? d.cancelReason : t("no reason given")}</>
                      : <>
                          {coachName(d.coachId)}
                          {missing && <> · {t("last seen")} {d.lastSeen || "—"}</>}
                        </>}
                  </div>
                </div>
              </div>
              {callable && (
                <button
                  onClick={() => callDelegate(d)}
                  aria-label={`${t("Call")} ${d.name}`}
                  title={`${t("Call")} ${d.name}`}
                  disabled={savingId === d.id}
                  style={{
                    background: "none", border: "none", padding: 6, flexShrink: 0,
                    color: missing ? "var(--st-missing)" : "var(--st-late)", display: "flex",
                  }}
                >
                  <Phone size={18} />
                </button>
              )}
              {/* Hidden entirely for Assigned/Arrived/Late (2026-07-23) — a
                  location only ever gets recorded for a Missing delegate, so
                  a disabled-but-visible pin for every other status was just
                  clutter, not a real affordance. */}
              {d.status === "MISSING" && (
                <button
                  onClick={() => setMapDelegate(d)}
                  aria-label={`${t("View location")} — ${d.name}`}
                  style={{
                    background: "none", border: "none", padding: 6, display: "flex", flexShrink: 0,
                    color: "var(--st-missing)", cursor: "pointer",
                  }}
                >
                  <MapPin size={18} />
                </button>
              )}
              {/* Clock/timeline icon removed (2026-07-25) — the checkpoint
                  timeline now lives inside the detail sheet (tap the row),
                  so a separate button/modal for just that was redundant. */}
            </div>

            <div className="row between" style={{ marginTop: 9, gap: 8 }}>
              <span className={"badge " + (STATUS_BADGE_CLASS[d.status] || "badge-unassigned")}>
                {savingId === d.id ? t("Saving…") : t(FILTER_LABEL[effectiveStatus(d)] || d.status)}
              </span>
              {canEdit && (
                <button
                  className="btn btn-dark"
                  style={{ padding: "7px 12px", fontSize: 12.5 }}
                  disabled={savingId === d.id}
                  onClick={() => setStatusSheetFor(d)}
                >
                  <PencilLine size={13} /> {t("Update status")}
                </button>
              )}
            </div>

            {rowError?.id === d.id && (
              <div style={{ fontSize: 12, color: "var(--st-missing)", marginTop: 6 }}>{t(rowError.message)}</div>
            )}
          </div>
        );
      })}

      {visible.length > shownCount && (
        <button
          className="btn btn-ghost btn-block"
          style={{ marginBottom: 10 }}
          onClick={() => setShownCount((n) => n + PAGE_SIZE)}
        >
          {t("Load more")} ({visible.length - shownCount} {t("more")})
        </button>
      )}

      {mapDelegate && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,0.45)", display: "grid", placeItems: "center", padding: 20, zIndex: 50 }}
          onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
          onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) setMapDelegate(null); }}>
          <div className="card" style={{ width: "min(420px, 100%)", padding: 18, background: "var(--surface)" }} onClick={(e) => e.stopPropagation()}>
            <div className="row between" style={{ marginBottom: 12 }}>
              <div>
                <h2 style={{ fontSize: 15 }}>{mapDelegate.name}</h2>
                <p className="muted" style={{ fontSize: 12, marginTop: 2 }}>{mapDelegate.lastLocation}</p>
              </div>
              <button onClick={() => setMapDelegate(null)} aria-label={t("Close")} style={{ background: "none", border: "none", color: "var(--ink-3)", display: "flex", padding: 4 }}>
                <X size={18} />
              </button>
            </div>
            {mapDelegate.lastLocation ? (
              <DelegateLocationMap location={mapDelegate.lastLocation} height={220} />
            ) : (
              <div className="muted" style={{ fontSize: 13, padding: "12px 0" }}>
                {t("No location has been recorded for this delegate yet.")}
              </div>
            )}
          </div>
        </div>
      )}


      {detailDelegate && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,0.45)", display: "grid", placeItems: "center", padding: 20, zIndex: 50 }}
          onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
          onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) setDetailDelegate(null); }}>
          <div className="card" style={{ width: "min(420px, 100%)", maxHeight: "80vh", overflowY: "auto", padding: 18, background: "var(--surface)" }} onClick={(e) => e.stopPropagation()}>
            <div className="row between" style={{ marginBottom: 12 }}>
              <div className="row" style={{ gap: 10 }}>
                <DelegateAvatar delegate={detailDelegate} />
                <div>
                  <h2 style={{ fontSize: 15 }}>{detailDelegate.name}</h2>
                  <span className={"badge " + (STATUS_BADGE_CLASS[detailDelegate.status] || "badge-unassigned")} style={{ marginTop: 2 }}>
                    {t(FILTER_LABEL[effectiveStatus(detailDelegate)] || detailDelegate.status)}
                  </span>
                </div>
              </div>
              <button onClick={() => setDetailDelegate(null)} aria-label={t("Close")} style={{ background: "none", border: "none", color: "var(--ink-3)", display: "flex", padding: 4 }}>
                <X size={18} />
              </button>
            </div>

            <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>{coachName(detailDelegate.coachId)}</div>

            {detailDelegate.phone ? (
              <a href={`tel:${detailDelegate.phone}`} className="row" style={{ gap: 8, marginTop: 10, color: "var(--st-missing)", textDecoration: "none" }}>
                <Phone size={16} /> {detailDelegate.phone}
              </a>
            ) : canEdit && (
              <div className="row" style={{ gap: 8, marginTop: 10 }}>
                <input
                  className="input"
                  style={{ flex: 1, padding: "6px 10px", fontSize: 13.5 }}
                  placeholder={t("Add a phone number")}
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                />
                <button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 12.5 }}
                  disabled={phoneSaving || !phoneInput.trim()} onClick={() => savePhone(detailDelegate)}>
                  {phoneSaving ? t("Saving…") : t("Save")}
                </button>
              </div>
            )}

            {/* Company + Room (2026-07-28 — "add the room detail to mobile
                also"). Desktop's profile has shown these for a while; mobile
                didn't, so staff on the ground couldn't see which hotel/room a
                delegate belongs to — exactly the thing you need when you're
                trying to find a missing person at night. Two compact columns
                rather than stacked blocks, since both values are short.
                Room is read-only here: allocation happens on the desktop Room
                Management tab, which is where the whole-roster view lives. */}
            {(detailDelegate.company || detailDelegate.hotel_name || detailDelegate.room_number) && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "10px 14px", marginTop: 14 }}>
                {detailDelegate.company && (
                  <div>
                    <div className="muted" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, marginBottom: 2 }}>
                      <Briefcase size={12} /> {t("Company")}
                    </div>
                    <div style={{ fontSize: 13.5, fontWeight: 500 }}>
                      {[detailDelegate.role, detailDelegate.company].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                )}
                {(detailDelegate.hotel_name || detailDelegate.room_number) && (
                  <div>
                    <div className="muted" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, marginBottom: 2 }}>
                      <BedDouble size={12} /> {t("Room")}
                    </div>
                    <div style={{ fontSize: 13.5, fontWeight: 500 }}>
                      {[detailDelegate.hotel_name, detailDelegate.room_number ? `${t("Room")} ${detailDelegate.room_number}` : null].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                )}
              </div>
            )}

            {detailDelegate.lastLocation ? (
              <div style={{ marginTop: 14 }}>
                {/* Labelled like the desktop profile's own block (2026-07-28 —
                    "maybe can indicate the this is last known location part"):
                    the address used to be a bare grey line with no clue what it
                    referred to, sitting between the phone number and a map. */}
                <div className="field-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <MapPin size={13} /> {t("Last known location")}
                </div>
                <p style={{ fontSize: 13, marginTop: 3, marginBottom: 8 }}>
                  {[detailDelegate.lastLocation, detailDelegate.lastSeen].filter(Boolean).join(" · ")}
                </p>
                <DelegateLocationMap location={detailDelegate.lastLocation} height={180} />
              </div>
            ) : (
              <div className="muted" style={{ fontSize: 13, marginTop: 12 }}>
                {t("No location has been recorded for this delegate yet.")}
              </div>
            )}

            {/* Checkpoint timeline — moved in here from its own separate
                modal (2026-07-25) so phone/map/timeline/escalate are all
                one consolidated view instead of scattered across separate
                row icons. */}
            <div style={{ marginTop: 16 }}>
              <div className="row" style={{ gap: 6, marginBottom: 8 }}>
                <Clock size={14} color="var(--ink-3)" />
                <span style={{ fontWeight: 600, fontSize: 13.5 }}>{t("Checkpoint timeline")}</span>
              </div>
              <DelegateTimeline delegateId={detailDelegate.id} defaultVisible={2} />
            </div>

            {canEdit && detailDelegate.status === "MISSING" && (
              <button
                className="btn btn-dark"
                style={{ marginTop: 16, width: "100%", background: "var(--st-missing)", borderColor: "var(--st-missing)" }}
                onClick={() => openEscalate(detailDelegate)}
              >
                <Siren size={15} /> {t("Escalate to office")}
              </button>
            )}
          </div>
        </div>
      )}

      {escalatingDelegate && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,0.45)", display: "grid", placeItems: "center", padding: 20, zIndex: 55 }}
          onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
          onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) setEscalatingDelegate(null); }}>
          <div className="card" style={{ width: "min(420px, 100%)", maxHeight: "80vh", overflowY: "auto", padding: 18, background: "var(--surface)" }} onClick={(e) => e.stopPropagation()}>
            <div className="row between" style={{ marginBottom: 4 }}>
              <div className="row" style={{ gap: 8, color: "var(--st-missing)" }}>
                <Siren size={18} />
                <h2 style={{ fontSize: 15 }}>{t("Escalate to office")}</h2>
              </div>
              <button onClick={() => setEscalatingDelegate(null)} style={{ background: "none", border: "none", color: "var(--ink-3)", display: "flex", padding: 4 }} aria-label={t("Close")}>
                <X size={18} />
              </button>
            </div>
            <p className="muted" style={{ fontSize: 13, marginTop: 6, marginBottom: 14 }}>
              {t("This alerts offsite admin/office staff right away — for when a Missing delegate isn't answering their phone.")} <strong>{escalatingDelegate.name}</strong>
            </p>
            <label className="field-label">{t("What's happening?")}</label>
            <textarea
              className="input"
              rows={3}
              style={{ marginTop: 4, resize: "vertical" }}
              value={escalateMessage}
              onChange={(e) => setEscalateMessage(e.target.value)}
            />

            <label className="field-label" style={{ marginTop: 14 }}>{t("Alert who?")}</label>
            {escalateRecipients.length === 0 ? (
              <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                {t("No admin accounts have an email on file yet — add one in Account Control to alert someone by email.")}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6, maxHeight: 150, overflowY: "auto" }}>
                {escalateRecipients.map((p) => (
                  <label key={p.email} className="row" style={{ gap: 8, fontSize: 13, cursor: "pointer" }}>
                    <input type="checkbox" checked={escalateSelected.has(p.email)} onChange={() => toggleEscalateRecipient(p.email)} />
                    <span style={{ fontWeight: 600 }}>{p.name || p.username}</span>
                    <span className="muted">{p.email}</span>
                    {p.isTripLead && <span className="badge badge-review" style={{ padding: "1px 7px", fontSize: 10.5 }}>{t("Trip lead")}</span>}
                  </label>
                ))}
              </div>
            )}

            <p className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
              {t("Emails can sometimes land in the recipient's Spam folder — ask them to check there and mark it \"Not spam\" the first time.")}
            </p>

            {escalateErr && <div style={{ color: "var(--st-missing)", fontSize: 12.5, marginTop: 10 }}>{escalateErr}</div>}
            <div className="row" style={{ gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => setEscalatingDelegate(null)} disabled={escalateSaving}>{t("Cancel")}</button>
              <button
                className="btn btn-primary"
                style={{ background: "var(--st-missing)", borderColor: "var(--st-missing)" }}
                onClick={submitEscalation}
                disabled={escalateSaving}
              >
                <Siren size={15} /> {escalateSaving ? t("Sending…") : t("Escalate now")}
              </button>
            </div>
          </div>
        </div>
      )}

      {statusSheetFor && (
        <StatusSheet
          delegate={statusSheetFor}
          onPick={(status, location) => changeStatus(statusSheetFor, status, location)}
          onClose={() => setStatusSheetFor(null)}
          t={t}
        />
      )}

      <style>{`.spin{animation:mg-spin 0.9s linear infinite}@keyframes mg-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

