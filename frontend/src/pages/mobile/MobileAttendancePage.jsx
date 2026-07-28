import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { RefreshCw, AlertTriangle, Crown, Search, MapPin, X, Phone, PencilLine, CheckCircle2, Clock, LocateFixed, Siren } from "lucide-react";
import { getCurrentLocationString, geolocationErrorMessage } from "../../lib/geolocation.js";
import { apiGet, apiPost, apiPatch, getPermissions } from "../../lib/api.js";
import { useLang } from "../../lib/i18n.jsx";
import DelegateAvatar from "../../components/DelegateAvatar.jsx";
import DelegateLocationMap from "../../components/DelegateLocationMap.jsx";
import DelegateTimeline from "../../components/DelegateTimeline.jsx";

import { getMobileTripId } from "../../lib/mobileTrip.js";
// UNASSIGNED is deliberately excluded — delegates are assigned to a coach by
// staff on the desktop admin pages BEFORE the event; mobile's job during the
// event is tracking who's arrived/late/missing, not doing the assignment
// itself, so unassigned delegates don't belong on this list or its filters.
const FILTERS = ["ALL", "ASSIGNED", "ARRIVED", "LATE", "MISSING"];
// Same reasoning as FILTERS above — the "Update status" sheet only offers
// active operational states during the event, not the pre-event Unassigned
// state (that's set by staff on desktop before delegates ever board).
const STATUS_OPTIONS = ["ASSIGNED", "ARRIVED", "LATE", "MISSING"];
// Legacy alias — some check-in routes still write "PRESENT" directly (see
// normalize() in backend/data.js), not yet migrated to "ARRIVED".
const effectiveStatus = (d) => (d.status === "PRESENT" ? "ARRIVED" : d.status);
const STATUS_BADGE_CLASS = {
  PRESENT: "badge-arrived", ARRIVED: "badge-arrived", ASSIGNED: "badge-assigned",
  LATE: "badge-late", MISSING: "badge-missing", UNASSIGNED: "badge-unassigned",
};

/**
 * Mobile Attendance sheet — the full delegate roster (GET /api/trips/:id/
 * delegates), searchable/filterable. Takes over the tab slot freed up by
 * folding Missing into Home: this is the "look up any one person, or fix
 * their status" view, where Home is "what's the overall picture right now".
 *
 * The initial status filter can come in via ?status=MISSING (the Home page's
 * KPI tiles and Coach status card both link here that way) so tapping
 * "20 missing" lands you straight on the filtered list instead of the
 * unfiltered roster.
 *
 * Row layout mirrors the "card row between" pattern already used by
 * QRCheckInPage.jsx's Manual check-in and "Me" tabs — avatar + name/subtitle
 * on the left, a clear action button on the right — instead of the old
 * cramped inline <select>. Status is changed via a bottom-sheet picker
 * (StatusSheet below) triggered by an explicit "Update status" button, same
 * spirit as Manual check-in's obvious "Mark present" button per row. Every
 * MISSING or LATE delegate also gets a one-tap call button (delegates.phone
 * already exists, added by Vance's onboarding parser) — if no number is on
 * file yet it prompts for one first (saved back onto the delegate) rather
 * than just hiding the button, since most delegates don't have a phone
 * populated.
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
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(() => {
    const s = (searchParams.get("status") || "ALL").toUpperCase();
    return FILTERS.includes(s) ? s : "ALL";
  });
  // ?coach=<id> — set when the Home page's Coach status card links to one
  // specific coach's missing list instead of everyone's.
  const [coachFilter, setCoachFilter] = useState(() => searchParams.get("coach") || null);
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

  useEffect(() => {
    load();
    // Auto-refresh so a status change made by another signed-in staff
    // member shows up here without needing to tap the manual Refresh button.
    // Was 2s, slowed to 8s (2026-07-24, Neon egress reduction).
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, []);

  async function load() {
    if (loadingRef.current || savingIdRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const [{ delegates: d }, dash] = await Promise.all([
        apiGet(`/trips/${TRIP_ID}/delegates`),
        apiGet(`/trips/${TRIP_ID}/dashboard`),
      ]);
      setDelegates(d || []);
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
        await apiPatch(`/delegates/${d.id}`, patch);
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
      await apiPatch(`/delegates/${d.id}`, patch);
    } catch (e) {
      setDelegates(prev); // roll back the optimistic update
      setRowError({ id: d.id, message: e.message || t("Save failed.") });
    } finally {
      setSavingId(null);
    }
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return delegates
      .filter((d) => effectiveStatus(d) !== "UNASSIGNED") // see the FILTERS comment above
      .filter((d) => filter === "ALL" || effectiveStatus(d) === filter)
      .filter((d) => !coachFilter || d.coachId === coachFilter)
      .filter((d) => !q || (d.name || "").toLowerCase().includes(q))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [delegates, query, filter, coachFilter]);

  const FILTER_LABEL = {
    ALL: "All statuses", UNASSIGNED: "Unassigned", ASSIGNED: "Assigned",
    ARRIVED: "Arrived", LATE: "Late", MISSING: "Missing",
  };

  return (
    <div>
      <div className="row between" style={{ alignItems: "flex-start", marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-3)" }}>
            {t("Attendance sheet")}
          </div>
          <h1 style={{ fontSize: 22, margin: "4px 0 2px" }}>{delegates.length} {t("delegates")}</h1>
        </div>
        <button className="btn btn-ghost" onClick={load} aria-label={t("Refresh")} style={{ padding: 8 }}>
          <RefreshCw size={16} className={loading ? "spin" : ""} />
        </button>
      </div>

      {error && (
        <div className="mobile-card" style={{ borderColor: "var(--st-missing)", background: "var(--st-missing-bg)" }}>
          <div className="row" style={{ gap: 8, color: "var(--st-missing)", fontWeight: 600, fontSize: 14 }}>
            <AlertTriangle size={16} /> {t("Couldn't reach the backend")}
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t(error)}</p>
        </div>
      )}

      <div style={{ position: "relative", marginBottom: 14 }}>
        <Search size={15} style={{ position: "absolute", left: 10, top: 11, color: "var(--ink-3)" }} />
        <input
          className="input"
          placeholder={t("Search delegates…")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ paddingLeft: 32 }}
        />
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <select
          className="select"
          value={coachFilter || ""}
          onChange={(e) => setCoachFilter(e.target.value || null)}
          style={{ flex: 1, fontSize: 13 }}
        >
          <option value="">{t("All coaches")}</option>
          {coaches.map((c) => (
            <option key={c.id} value={c.id}>{[c.name, c.city].filter(Boolean).join(" · ")}</option>
          ))}
        </select>
        {coachFilter && (
          <button onClick={() => setCoachFilter(null)} aria-label={t("Clear coach filter")}
            className="btn btn-ghost" style={{ padding: "8px 10px", flexShrink: 0 }}>
            <X size={14} />
          </button>
        )}
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 16, overflowX: "auto", paddingBottom: 4 }}>
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
          const activeTone = { ASSIGNED: "assigned", ARRIVED: "present", LATE: "late", UNASSIGNED: "unassigned" }[f] || "present";
          const cls = isMissing ? "badge-missing" : active ? `badge-${activeTone}` : "badge-neutral";
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={"badge " + cls}
              style={{
                flexShrink: 0, cursor: "pointer", fontSize: 12.5, padding: "7px 13px",
                border: active ? "1.5px solid currentColor" : "1.5px solid transparent",
                opacity: isMissing && !active ? 0.75 : 1,
              }}
            >
              {t(FILTER_LABEL[f])}
            </button>
          );
        })}
      </div>

      {loading && delegates.length === 0 && !error && <div className="muted">{t("Loading…")}</div>}

      {!loading && visible.length === 0 && !error && (
        <div className="mobile-card muted" style={{ textAlign: "center" }}>
          {delegates.length === 0 ? t("No delegates yet.") : t("No delegates match your filters.")}
        </div>
      )}

      {visible.map((d) => {
        const missing = d.status === "MISSING";
        // Late delegates are the other case staff actually want to ring —
        // they haven't checked in by the trip's cutoff and might just be
        // running behind, not necessarily missing.
        const callable = missing || effectiveStatus(d) === "LATE";
        return (
          <div key={d.id} className="mobile-card" style={{ padding: 16 }}>
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
                    {coachName(d.coachId)}
                    {missing && <> · {t("last seen")} {d.lastSeen || "—"}</>}
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

            <div className="row between" style={{ marginTop: 10, gap: 8 }}>
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

            {detailDelegate.lastLocation ? (
              <div style={{ marginTop: 12 }}>
                <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>{detailDelegate.lastLocation}</div>
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

/** Bottom-sheet status picker — the "clear status update" interface, opened
 *  by the per-row "Update status" button. Three big obvious buttons instead
 *  of a cramped inline <select>, same "one clear action per row" spirit as
 *  Manual check-in's own "Mark present" button. */
function StatusSheet({ delegate, onPick, onClose, t }) {
  const FILTER_LABEL = { UNASSIGNED: "Unassigned", ASSIGNED: "Assigned", ARRIVED: "Arrived", LATE: "Late", MISSING: "Missing" };
  const current = effectiveStatus(delegate);
  // Picking MISSING doesn't save immediately — it switches this sheet to a
  // second step asking for a last known location first (mirrors
  // DashboardPage.jsx's Edit modal, which has always required this on
  // desktop; mobile previously let you mark someone Missing with nothing to
  // actually go find them by). Any other status still saves on tap, same as
  // before.
  const [askingLocation, setAskingLocation] = useState(false);
  const [location, setLocation] = useState(delegate.lastLocation || "");
  // "Use my current location" (2026-07-24) — reads the STAFF device's own
  // GPS as a stand-in for "where I am right now", since this app has no
  // delegate-side live tracking. locating tri-state so the button can show
  // a spinner without a separate loading flag.
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState(null);
  async function useMyLocation() {
    setLocating(true);
    setLocateError(null);
    try {
      const loc = await getCurrentLocationString();
      setLocation(loc);
    } catch (err) {
      setLocateError(geolocationErrorMessage(err));
    } finally {
      setLocating(false);
    }
  }
  // Same second-step pattern as askingLocation/MISSING above, for
  // "Cancelled" — a dedicated field action for "this person isn't coming
  // after all, here's why" (2026-07-24). See changeStatus() in the parent
  // for what actually gets sent (cancelled + cancelReason, not a status).
  const [askingCancelReason, setAskingCancelReason] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  // Only dismiss if the WHOLE click gesture started on the backdrop itself,
  // not wherever the mouse was released after dragging to select text in the
  // "Last known location" field.
  const downOnBackdrop = useRef(false);

  function pick(status) {
    if (status === "MISSING") { setAskingLocation(true); return; }
    if (status === "CANCELLED") { setAskingCancelReason(true); return; }
    onPick(status);
  }

  if (askingLocation) {
    const trimmed = location.trim();
    return (
      <div
        style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,0.45)", display: "flex", alignItems: "flex-end", zIndex: 60 }}
        onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
        onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) onClose(); }}
      >
        <div
          className="card"
          style={{ width: "100%", borderRadius: "16px 16px 0 0", padding: 18, paddingBottom: 28 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="row between" style={{ marginBottom: 4 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{t("Last known location")}</div>
              <div className="muted" style={{ fontSize: 12.5 }}>{delegate.name}</div>
            </div>
            <button onClick={onClose} aria-label={t("Close")} style={{ background: "none", border: "none", color: "var(--ink-3)", display: "flex", padding: 4 }}>
              <X size={18} />
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
            {t("Required before marking a delegate Missing, so they can actually be found.")}
          </p>
          <input
            autoFocus
            className="input"
            style={{ marginTop: 10 }}
            placeholder={t("e.g. Novotel Beijing Sanyuan, Lobby")}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-ghost"
            style={{ marginTop: 8, width: "100%" }}
            onClick={useMyLocation}
            disabled={locating}
          >
            <LocateFixed size={15} /> {locating ? t("Locating…") : t("Use my current location")}
          </button>
          {locateError && (
            <div className="muted" style={{ fontSize: 12, color: "var(--st-missing)", marginTop: 6 }}>{t(locateError)}</div>
          )}
          {trimmed && (
            <div style={{ marginTop: 10 }}>
              <DelegateLocationMap location={trimmed} height={140} />
            </div>
          )}
          <div className="row" style={{ gap: 10, marginTop: 16 }}>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setAskingLocation(false)}>
              {t("Back")}
            </button>
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={!trimmed}
              onClick={() => onPick("MISSING", trimmed)}
            >
              {t("Confirm")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (askingCancelReason) {
    return (
      <div
        style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,0.45)", display: "flex", alignItems: "flex-end", zIndex: 60 }}
        onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
        onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) onClose(); }}
      >
        <div
          className="card"
          style={{ width: "100%", borderRadius: "16px 16px 0 0", padding: 18, paddingBottom: 28 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="row between" style={{ marginBottom: 4 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{t("Mark as cancelled")}</div>
              <div className="muted" style={{ fontSize: 12.5 }}>{delegate.name}</div>
            </div>
            <button onClick={onClose} aria-label={t("Close")} style={{ background: "none", border: "none", color: "var(--ink-3)", display: "flex", padding: 4 }}>
              <X size={18} />
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
            {t("Unassigns them and frees their coach seat.")}
          </p>
          <label className="field-label" style={{ marginTop: 10 }}>{t("What happened?")}</label>
          <textarea
            autoFocus
            className="input"
            rows={3}
            style={{ marginTop: 6, resize: "vertical", fontFamily: "inherit" }}
            placeholder={t("e.g. Flight cancelled, called in sick, no longer travelling with the group…")}
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
          />
          <div className="row" style={{ gap: 10, marginTop: 16 }}>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setAskingCancelReason(false)}>
              {t("Back")}
            </button>
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              onClick={() => onPick("CANCELLED", cancelReason)}
            >
              {t("Confirm")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,0.45)", display: "flex", alignItems: "flex-end", zIndex: 60 }}
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="card"
        style={{ width: "100%", borderRadius: "16px 16px 0 0", padding: 18, paddingBottom: 28 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row between" style={{ marginBottom: 4 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{t("Update status")}</div>
            <div className="muted" style={{ fontSize: 12.5 }}>{delegate.name}</div>
          </div>
          <button onClick={onClose} aria-label={t("Close")} style={{ background: "none", border: "none", color: "var(--ink-3)", display: "flex", padding: 4 }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
          {STATUS_OPTIONS.map((status) => {
            const active = current === status;
            return (
              <button
                key={status}
                onClick={() => pick(status)}
                className="row between"
                style={{
                  padding: "12px 14px", borderRadius: "var(--r-md)", fontSize: 14, fontWeight: 600,
                  border: `1.5px solid ${active ? "var(--scc-red)" : "var(--line)"}`,
                  background: active ? "var(--scc-red-tint)" : "var(--surface)",
                  color: active ? "var(--scc-red-700)" : "var(--ink)",
                }}
              >
                {t(FILTER_LABEL[status])}
                {active && <CheckCircle2 size={16} />}
              </button>
            );
          })}
        </div>

        {/* Visually separated from the 4 operational statuses above — this
            isn't one of them, it's a distinct "drop out" action (2026-07-24,
            "need to have to be able to change the delegate status to
            unassigned, add a textfield that let staff put what happen"). */}
        <div style={{ borderTop: "1px solid var(--line)", marginTop: 14, paddingTop: 10 }}>
          <button
            onClick={() => pick("CANCELLED")}
            className="row between"
            style={{
              width: "100%", padding: "12px 14px", borderRadius: "var(--r-md)", fontSize: 14, fontWeight: 600,
              border: "1.5px solid var(--line)", background: "var(--surface)", color: "var(--ink-2)",
            }}
          >
            {t("Mark as cancelled")}
          </button>
        </div>
      </div>
    </div>
  );
}
