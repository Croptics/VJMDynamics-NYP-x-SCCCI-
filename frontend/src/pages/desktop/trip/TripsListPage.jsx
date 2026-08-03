// frontend/src/pages/TripsListPage.jsx
// Owner: Desmond — "TransitFlow" — Trip Booking & Dynamic Coach Management
//
// Grid of every trip. Clicking a card navigates to /trips?tripId=<uuid> —
// NOT /trips/<uuid> — because App.jsx (owned by JQ, off-limits) only ever
// routes a bare "/trips" to TripCoachPage.jsx. TripCoachPage.jsx renders THIS
// component itself whenever ?tripId= is absent from the URL.
//
// Data comes from GET /all-trips (Desmond's own endpoint), not GET /trips —
// JQ's GET /api/trips always returns just the single hardcoded Beijing trip.
//
// Styling: TripCoachPage.css (new, scoped under .tf-root — see that file's
// header). tokens.css is not touched; nothing here can leak onto other pages.
//
// This file also owns the shared light/dark theme hook (useTfTheme) used by
// both this page and TripCoachPage.jsx. It now just mirrors the app-wide
// theme (lib/theme.jsx) so the Trips feature stays in sync with the same
// dark-mode toggle used everywhere else, instead of tracking its own
// separate on/off state.
//
// v3: trip cards now show a real progress indicator (dayOf/totalDays, which
// GET /all-trips added in v3 — see desmond.js) and the empty state got a
// small illustration, per the "operational workspace" redesign brief.

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, AlertCircle, Bus, Users, Sparkles, Search, MapPin, Plus, Pencil, Trash2, X, ChevronDown } from "lucide-react";
import { apiGet, apiPost, apiPatch, apiDelete, getPermissions, getUser } from "../../../lib/api.js";
import { useLang } from "../../../lib/i18n.jsx";
import { useTheme } from "../../../lib/theme.jsx";
import "../../../styles/TripCoachPage.css";

/** Shared light/dark toggle for the Trips feature — now just a thin wrapper
 *  around the app-wide theme, so this page's dark mode always matches every
 *  other page's instead of tracking its own separate state. */
export function useTfTheme() {
  const { theme, toggleTheme } = useTheme();
  return [theme === "dark", toggleTheme];
}

const STATUS_COLOR = {
  "In progress": "green",
  Planning: "blue",
  Completed: "grey",
  Cancelled: "red",
};

function StatusChip({ status }) {
  const { t } = useLang();
  const color = STATUS_COLOR[status] || "grey";
  return (
    <span className="tf-status-chip" style={{ color: `var(--tf-${color})`, background: `var(--tf-${color}-bg)` }}>
      {t(status || "—")}
    </span>
  );
}

/** Per-trip progress bar. Always renders a track + label for every status
 *  (rather than returning null for Planning/Cancelled) so every card in the
 *  grid is the same height and the list stays visually aligned. Planning and
 *  Cancelled show an empty (0%) track with a muted label instead of a
 *  percentage, since "progress" isn't a meaningful concept for either. */
function TripProgress({ trip }) {
  const { t } = useLang();

  if (trip.status === "Completed") {
    return (
      <div>
        <div className="tf-trip-progress-track"><div className="tf-trip-progress-fill is-complete" style={{ width: "100%" }} /></div>
        <div className="tf-trip-progress-label">{t("Completed")}</div>
      </div>
    );
  }

  if (trip.status === "In progress" && trip.totalDays) {
    const pct = Math.round(Math.min(1, Math.max(0, (trip.dayOf || 0) / trip.totalDays)) * 100);
    return (
      <div>
        <div className="tf-trip-progress-track"><div className="tf-trip-progress-fill" style={{ width: `${pct}%` }} /></div>
        <div className="tf-trip-progress-label">{t("Day")} {trip.dayOf} {t("of")} {trip.totalDays}</div>
      </div>
    );
  }

  if (trip.status === "Cancelled") {
    return (
      <div>
        <div className="tf-trip-progress-track"><div className="tf-trip-progress-fill" style={{ width: "0%" }} /></div>
        <div className="tf-trip-progress-label">{t("Cancelled")}</div>
      </div>
    );
  }

  // Planning (or any status without enough data to compute a percentage).
  return (
    <div>
      <div className="tf-trip-progress-track"><div className="tf-trip-progress-fill" style={{ width: "0%" }} /></div>
      <div className="tf-trip-progress-label">{t("Not started yet")}</div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="tf-card" style={{ margin: 0 }}>
      <div className="tf-skeleton" style={{ height: 18, width: "70%", marginBottom: 10 }} />
      <div className="tf-skeleton" style={{ height: 12, width: "40%", marginBottom: 14 }} />
      <div className="tf-skeleton" style={{ height: 12, width: "90%" }} />
    </div>
  );
}

/** v3: small illustrated empty state (soft gradient badge + bus/map icons)
 *  instead of a bare heading — built entirely from lucide-react icons + CSS
 *  already in this project, so no new dependency or hand-authored SVG. */
function EmptyIllustration() {
  return (
    <div className="tf-empty-illustration">
      <Bus size={38} color="#fff" />
      <span className="tf-empty-deco" style={{ top: -6, right: -8 }}><MapPin size={13} color="var(--tf-purple)" /></span>
      <span className="tf-empty-deco" style={{ bottom: -6, left: -8 }}><Sparkles size={12} color="var(--tf-yellow)" /></span>
    </div>
  );
}

const TRIP_STATUSES = ["Planning", "In progress", "Completed", "Cancelled"];

// Trip cards show a "24 Jul 2026 – 29 Jul 2026" style range computed FROM
// startDate + totalDays, instead of a separately-typed free-text field that
// could drift out of sync with the real dates. Date math done on UTC-midnight
// Date objects (not `new Date("YYYY-MM-DD")` directly) to avoid the classic
// local-timezone-shift-by-a-day footgun.
function formatDayMonthYear(y, m, d) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, d)));
}
function computeDateRange(startDateStr, totalDays) {
  if (!startDateStr) return "";
  const [y, m, d] = startDateStr.split("-").map(Number);
  const n = Math.max(1, Number(totalDays) || 1);
  const startFmt = formatDayMonthYear(y, m, d);
  if (n <= 1) return startFmt;
  const end = new Date(Date.UTC(y, m - 1, d));
  end.setUTCDate(end.getUTCDate() + (n - 1));
  const endFmt = formatDayMonthYear(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate());
  return `${startFmt} – ${endFmt}`;
}

/* Trip lead (2026-07-31, "the trip lead show existing admin/staff account
 * instead") — was a free-text input, so it could hold any typo'd string with
 * no link to a real login. Now picks from the same account list Coach
 * captains/staff use (both admin AND staff — unlike the coach-staffing
 * picker, a trip lead is often the coordinating admin, not a driver). Still
 * just writes the account's display name into the trip's own plain-text
 * `lead` column — no schema change, no login/visibility link like coach
 * captains have; purely "pick a real name instead of typing one". */
function useDropdown() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKeyDown = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("mousedown", onDocClick); document.removeEventListener("keydown", onKeyDown); };
  }, [open]);
  return { open, setOpen, rootRef };
}

function TripLeadSelect({ value, onChange }) {
  const { t } = useLang();
  const { open, setOpen, rootRef } = useDropdown();
  const [accounts, setAccounts] = useState([]);
  useEffect(() => {
    apiGet("/assignable-accounts").then((r) => setAccounts(r.accounts || [])).catch(() => {});
  }, []);
  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button type="button" className="tf-input tf-select-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {value ? <span>{value}</span> : <span className="tf-select-placeholder">{t("Optional")}</span>}
        <ChevronDown size={16} style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s ease" }} />
      </button>
      {open && (
        <div className="tf-select-menu" role="listbox" style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, maxHeight: 220, zIndex: 30 }}>
          {accounts.length === 0 && <div className="tf-select-empty">{t("No accounts found.")}</div>}
          {accounts.map((a) => {
            const label = a.name || a.username;
            return (
              <button key={a.id} type="button" role="option" aria-selected={value === label}
                className={"tf-select-item" + (value === label ? " active" : "")}
                onClick={() => { onChange(label); setOpen(false); }}>
                {label} ({a.role})
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Create / edit a trip. `trip` with an id = edit; anything else = create.
 *  Self-contained (calls the API itself). Reuses the .tf-modal-* / .tf-input
 *  classes already in TripCoachPage.css, so no new styles are needed. */
function TripFormModal({ trip, onClose, onSaved }) {
  const { t } = useLang();
  const editing = !!(trip && trip.id);
  // Same drag-to-select fix as TripCoachPage.jsx's Modal — only dismiss if
  // the WHOLE click gesture started on the backdrop, not wherever the mouse
  // was released after a drag that began in one of this form's fields.
  const downOnBackdrop = useRef(false);
  const [form, setForm] = useState({
    name: trip?.name || "",
    status: trip?.status || "Planning",
    lead: trip?.lead || "",
    totalDays: trip?.totalDays || 5,
    dayOf: trip?.dayOf || 1,
    startDate: trip?.startDate || "",
    departureTime: trip?.departureTime || "10:00",
    countryFrom: trip?.countryFrom || "Singapore",
    countryTo: trip?.countryTo || "",
    coachCapacity: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // "Total days" now follows the itinerary rather than being a second,
  // independently-typed number (2026-07-30 — "you can create new days in the
  // itinerary right? link that instead"): a trip whose itinerary already has
  // Day 6 items but whose card still says "Day 5 of 5" read as broken. Null
  // until the fetch below resolves; 0 once resolved with an empty itinerary.
  const [itineraryDayCount, setItineraryDayCount] = useState(null);
  useEffect(() => {
    if (!editing) { setItineraryDayCount(0); return; }
    let cancelled = false;
    apiGet(`/trips/${trip.id}/itinerary`)
      .then((data) => {
        if (cancelled) return;
        const max = (data?.items || []).reduce((m, i) => Math.max(m, Number(i.dayNumber) || 0), 0);
        setItineraryDayCount(max);
        if (max > 0) setForm((f) => ({ ...f, totalDays: max }));
      })
      .catch(() => { if (!cancelled) setItineraryDayCount(0); }); // fetch failed — fall back to the manual field rather than blocking the form
    return () => { cancelled = true; };
  }, [editing, trip?.id]);
  // Once the itinerary has at least one day, it's the source of truth —
  // manually typing a bigger/smaller number here wouldn't add or remove any
  // actual itinerary days, so it'd just be a number that lies.
  const totalDaysFromItinerary = itineraryDayCount > 0;
  // Staff normally set the real start date 2–3 days BEFORE the trip actually
  // begins, so a start date already in the past is unusual enough to be
  // worth a second look (e.g. picked the wrong month) rather than saving
  // silently — shows an inline "are you sure" instead of a hard block.
  const [pastDateWarningShown, setPastDateWarningShown] = useState(false);
  // Staff single-active-trip guardrail (2026-08-02) — set when the backend's
  // PATCH /trips/:id responds 409 STAFF_TRIP_CONFLICT (see desmond.js): one of
  // this trip's own coach captains already captains a different trip that's
  // already "In progress". Confirming resends the same save with
  // confirmUnassignConflicts:true, which auto-unassigns them from THIS trip.
  const [staffConflictWarning, setStaffConflictWarning] = useState(null);
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setPastDateWarningShown(false); setStaffConflictWarning(null); };

  // Matches the backend's own "today" for the auto-day feature (syncTripDayOf
  // computes in Asia/Singapore, not the browser's local zone or UTC — see
  // backend/db/dashboard.js) so this warning agrees with what the backend
  // will actually compute once saved, regardless of the device's own timezone.
  const todaySGT = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore" }).format(new Date());
  const isPastStartDate = !!form.startDate && form.startDate < todaySGT();

  async function handleSubmit(confirmedPastDate = false, confirmedStaffConflict = false) {
    if (!form.name.trim()) { setError(t("A trip name is required.")); return; }
    if (!form.startDate) { setError(t("Actual start date is required.")); return; }
    if (isPastStartDate && !confirmedPastDate) { setPastDateWarningShown(true); return; }
    setSaving(true); setError(null); setPastDateWarningShown(false); setStaffConflictWarning(null);
    try {
      const payload = {
        name: form.name.trim(), dateRange: computeDateRange(form.startDate, form.totalDays), status: form.status,
        lead: form.lead.trim(), totalDays: Number(form.totalDays) || 1,
        startDate: form.startDate || null,
        departureTime: form.departureTime || null,
        countryFrom: form.countryFrom.trim() || null,
        countryTo: form.countryTo.trim() || null,
      };
      if (confirmedStaffConflict) payload.confirmUnassignConflicts = true;
      // ALWAYS reset to automatic on save now (2026-07-30 — "the logic for
      // the actual start date is broken... set ytd start so today should be
      // day 2, not day 5"): "Current day" was hidden from this form entirely
      // (no more input, no more "Use automatic day" toggle), on the premise
      // that it's fully automatic now — but a trip that already had
      // `dayOfIsManual=true` from BEFORE that change (or from any other
      // path) had no way back: dayOfManual could still read true from the
      // trip's own data, and the branch below would keep resending the
      // stale `form.dayOf` forever, permanently ignoring every future
      // startDate edit. There is no UI left that can legitimately WANT a
      // manual override anymore, so every save now clears it unconditionally
      // — a brand new trip has no override to clear either, so this is safe
      // for both create and edit.
      payload.resetDayOfAuto = true;
      const saved = editing ? await apiPatch(`/trips/${trip.id}`, payload) : await apiPost(`/trips`, payload);
      // Bulk coach capacity — separate call, only sent if the admin actually
      // typed a value (left blank = leave each coach's own capacity alone).
      const capacityValue = Number(form.coachCapacity);
      if (editing && form.coachCapacity.trim() && capacityValue > 0) {
        await apiPatch(`/trips/${trip.id}/coaches/capacity`, { capacity: capacityValue });
      }
      onSaved(saved, editing);
      onClose();
    } catch (e) {
      if (e.code === "STAFF_TRIP_CONFLICT") {
        setStaffConflictWarning({ message: e.message, conflicts: e.data?.conflicts || [] });
        setSaving(false);
        return;
      }
      setError(e.message); setSaving(false);
    }
  }

  return (
    <div className="tf-modal-overlay"
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (!saving && downOnBackdrop.current && e.target === e.currentTarget) onClose(); }}>
      <div className="tf-modal-card" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="tf-modal-header">
          <h3 style={{ fontSize: 17, fontWeight: 800 }}>{editing ? t("Edit trip") : t("New trip")}</h3>
          <button className="tf-btn tf-btn-ghost tf-btn-icon-only" onClick={onClose} title={t("Close")}><X size={18} /></button>
        </div>
        <div className="tf-modal-body">
          <label className="tf-field-label">{t("Trip name")} <span style={{ color: "var(--tf-red)" }}>*</span></label>
          <input className="tf-input" style={{ marginBottom: 14 }} value={form.name} autoFocus
            placeholder={t("e.g. Shanghai Innovation Mission")}
            onChange={(e) => set("name", e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSubmit()} />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 14 }}>
            <div>
              <label className="tf-field-label">{t("Status")}</label>
              <select className="tf-input" value={form.status} onChange={(e) => set("status", e.target.value)}>
                {TRIP_STATUSES.map((s) => <option key={s} value={s}>{t(s)}</option>)}
              </select>
            </div>
            <div>
              <label className="tf-field-label">{t("Trip lead")}</label>
              <TripLeadSelect value={form.lead} onChange={(v) => set("lead", v)} />
            </div>
          </div>

          {staffConflictWarning && (
            <div style={{ background: "rgba(220,38,38,0.08)", border: "1px solid var(--tf-red)", borderRadius: 8, padding: 10, marginBottom: 14 }}>
              <p style={{ fontSize: 13, color: "var(--tf-red)", margin: 0 }}>{staffConflictWarning.message}</p>
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <button type="button" className="tf-btn tf-btn-ghost" onClick={() => setStaffConflictWarning(null)}>{t("Cancel")}</button>
                <button type="button" className="tf-btn tf-btn-primary" style={{ background: "var(--tf-red)", color: "#fff" }} onClick={() => handleSubmit(true, true)}>{t("Update anyway")}</button>
              </div>
            </div>
          )}

          <label className="tf-field-label">{t("Actual start date (for auto day tracking)")} <span style={{ color: "var(--tf-red)" }}>*</span></label>
          <input type="date" className="tf-input" style={{ marginBottom: 4 }} value={form.startDate}
            onChange={(e) => set("startDate", e.target.value)} />
          <p className="tf-muted" style={{ fontSize: 12, marginTop: 0, marginBottom: form.startDate ? 4 : 14 }}>
            {t("Set 2–3 days before the trip actually begins. \"Current day\" below auto-advances every midnight from this date.")}
          </p>
          {form.startDate && (
            <p className="tf-muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 14 }}>
              {t("Shown on trip cards as")}: <b>{computeDateRange(form.startDate, form.totalDays)}</b>
            </p>
          )}
          {pastDateWarningShown && (
            <div style={{ background: "rgba(220,38,38,0.08)", border: "1px solid var(--tf-red)", borderRadius: 8, padding: 10, marginBottom: 14 }}>
              <p style={{ fontSize: 13, color: "var(--tf-red)", margin: 0 }}>
                {t("This start date is already in the past. Trips are usually set up 2–3 days BEFORE they begin — double check this is the date you meant.")}
              </p>
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <button type="button" className="tf-btn tf-btn-ghost" onClick={() => setPastDateWarningShown(false)}>{t("Go back")}</button>
                <button type="button" className="tf-btn tf-btn-primary" onClick={() => handleSubmit(true)}>{t("Save anyway")}</button>
              </div>
            </div>
          )}

          {/* "Current day" and "Total days" removed from this form entirely
              (2026-07-30 — "hide both part"): both are now fully automatic —
              Current day from startDate (syncTripDayOf, backend), Total days
              from the itinerary's own day count (see totalDaysFromItinerary
              above) — so two disabled-looking number inputs just cluttered
              the form with nothing left for staff to actually do here. Every
              save now unconditionally sends `resetDayOfAuto: true` (see
              handleSubmit) rather than conditionally, precisely BECAUSE this
              UI is gone: a trip that already had a manual override set from
              before this change (or from any other path) had no way back —
              nothing left could ever flip it off again, so a startDate edit
              would silently keep being ignored forever (2026-07-30 bug
              report: "set ytd start so today should be day 2, not day 5" —
              stuck on an old manual value with no reset control in sight).
              Total days grows/shrinks on its own once itinerary items exist
              (syncTotalDaysToItinerary, desmond.js) — nothing to reset there. */}

          {/* Real anchor for the "Departure in" countdown on Dashboard/mobile
              Home/mobile topbar (2026-07-30 — that chip was a frozen seed
              string, "04:53", that never changed; there was no departure time
              anywhere to compute a live countdown against). Departure is
              assumed to be on the trip's LAST day — the same day "Total days"
              already points at. */}
          <label className="tf-field-label" style={{ marginTop: 14 }}>{t("Departure time (last day)")}</label>
          <input type="time" className="tf-input" style={{ marginBottom: 4 }} value={form.departureTime}
            onChange={(e) => set("departureTime", e.target.value)} />
          <p className="tf-muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 14 }}>
            {t("Powers the live \"Departure in\" countdown on Dashboard and mobile.")}
          </p>

          {/* 2026-07-30 — "add the country from and to": the "Departure in"
              chip previously had no way to say WHERE the delegation is
              departing back TO without hardcoding "Singapore" in the code,
              which would silently be wrong the day a trip isn't SCCCI's usual
              Singapore-based one. "From" defaults to Singapore (matches the
              chip's real-world usage today) but is editable per trip. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            <div>
              <label className="tf-field-label">{t("From (country)")}</label>
              <input className="tf-input" value={form.countryFrom}
                placeholder="Singapore" onChange={(e) => set("countryFrom", e.target.value)} />
            </div>
            <div>
              <label className="tf-field-label">{t("To (country)")}</label>
              <input className="tf-input" value={form.countryTo}
                placeholder={t("e.g. China")} onChange={(e) => set("countryTo", e.target.value)} />
            </div>
          </div>
          <p className="tf-muted" style={{ fontSize: 12, marginTop: 4, marginBottom: 14 }}>
            {t("\"From\" is what the \"Departure back to...\" countdown shows.")}
          </p>

          {editing && (
            <>
              <label className="tf-field-label" style={{ marginTop: 14 }}>{t("Max delegates per coach")}</label>
              <input type="number" min={1} max={200} className="tf-input" style={{ marginBottom: 4 }} value={form.coachCapacity}
                placeholder={t("e.g. 50 — leave blank to leave unchanged")} onChange={(e) => set("coachCapacity", e.target.value)} />
              <p className="tf-muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 14 }}>
                {trip?.coachCount
                  ? `${t("Sets EVERY coach on this trip (Coach 1–")}${trip.coachCount}${t(") to this capacity — leave blank to leave each coach's capacity as-is.")}`
                  : t("Sets every coach on this trip to this capacity — leave blank to leave each coach's capacity as-is.")}
              </p>
            </>
          )}

          {error && <p style={{ color: "var(--tf-red)", fontSize: 13, marginTop: 12 }}>{error}</p>}
        </div>
        <div className="tf-modal-footer">
          <button className="tf-btn tf-btn-ghost" onClick={onClose} disabled={saving}>{t("Cancel")}</button>
          <button className="tf-btn tf-btn-primary" onClick={() => handleSubmit()} disabled={saving}>
            {saving ? <Loader2 size={14} className="spin" /> : null} {editing ? t("Save changes") : t("Create trip")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Delete-trip confirmation. Self-contained; surfaces the backend's "can't
 *  delete a non-empty / primary trip" messages inline instead of failing
 *  silently. */
function DeleteTripDialog({ trip, onClose, onDeleted }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const downOnBackdrop = useRef(false);
  async function handleDelete() {
    setBusy(true); setError(null);
    try { await apiDelete(`/trips/${trip.id}`); onDeleted(); onClose(); }
    catch (e) { setError(e.message); setBusy(false); }
  }
  return (
    <div className="tf-modal-overlay"
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (!busy && downOnBackdrop.current && e.target === e.currentTarget) onClose(); }}>
      <div className="tf-modal-card" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
        <div className="tf-modal-header"><h3 style={{ fontSize: 16, fontWeight: 800 }}>{t("Delete trip?")}</h3></div>
        <div className="tf-modal-body">
          <p style={{ fontSize: 13.5, color: "var(--tf-text-2)" }}>{t("Delete")} “{trip.name}”? {t("This can't be undone.")}</p>
          <p className="tf-muted" style={{ fontSize: 12, marginTop: 8 }}>{t("A trip that still has coaches or delegates can't be deleted — clear its board first.")}</p>
          {error && <p style={{ color: "var(--tf-red)", fontSize: 13, marginTop: 10 }}>{error}</p>}
        </div>
        <div className="tf-modal-footer">
          <button className="tf-btn tf-btn-ghost" onClick={onClose} disabled={busy}>{t("Cancel")}</button>
          <button className="tf-btn tf-btn-primary" style={{ background: "var(--tf-red)", color: "#fff" }} onClick={handleDelete} disabled={busy}>
            {busy ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />} {t("Delete")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TripsListPage() {
  const navigate = useNavigate();
  const { t } = useLang();
  const [dark] = useTfTheme();
  const [trips, setTrips] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState("In progress"); // status tab (admins/coordinators)
  const [formTrip, setFormTrip] = useState(null);   // null = closed · {} = new · {…trip} = edit
  const [deleteTripState, setDeleteTripState] = useState(null);
  const [captainTripIds, setCaptainTripIds] = useState(null); // Set of trip ids this account captains
  const canEdit = getPermissions().manageTrips; // gate edit controls (see permissions.js)
  // Staff single-active-trip guardrail (2026-08-02) — brief toast when a
  // Planning -> In-progress save auto-unassigned a double-booked captain
  // (see TripFormModal's staffConflictWarning confirm flow and desmond.js's
  // PATCH /trips/:tripId). Same local toast+timeout pattern MediaManager.jsx
  // already uses — this app has no shared toast component.
  const [unassignNotice, setUnassignNotice] = useState(null);
  const unassignNoticeTimer = useRef(null);

  // A non-admin who captains at least one coach is a "coach captain": they see
  // ONLY the trip(s) they're assigned to, and can't create/seed trips. Admins
  // and non-captain coordinators keep the full list.
  const me = getUser() || {};
  const isCaptain = me.role !== "admin" && !!captainTripIds && captainTripIds.size > 0;
  // Trip-level create/edit/delete is coordinator/admin territory — never a captain's.
  const canManageTrips = canEdit && !isCaptain;

  const fetchTrips = useCallback(async () => {
    try {
      const data = await apiGet("/all-trips");
      setTrips(data.trips);
      setLoadError(null);
    } catch (err) {
      setLoadError(err.message);
    }
  }, []);

  useEffect(() => { fetchTrips(); }, [fetchTrips]);

  // Which trips does the signed-in account captain? (empty for admins/coordinators)
  useEffect(() => {
    apiGet("/my-captain-coaches")
      .then((r) => setCaptainTripIds(new Set((r.coaches || []).map((c) => c.tripId))))
      .catch(() => setCaptainTripIds(new Set()));
  }, []);

  // Status tabs group the (often long) trip list into Planning / In progress /
  // Completed / Cancelled so an admin/coordinator isn't scrolling one giant
  // grid. Captains only ever have their own trip(s), so tabs are hidden for them.
  const showTabs = !isCaptain;
  const tabBase = useMemo(
    () => (!trips ? [] : (isCaptain ? trips.filter((tr) => captainTripIds.has(tr.id)) : trips)),
    [trips, isCaptain, captainTripIds]
  );
  const tabCounts = useMemo(() => {
    const c = {};
    for (const s of TRIP_STATUSES) c[s] = tabBase.filter((tr) => tr.status === s).length;
    return c;
  }, [tabBase]);

  const filteredTrips = useMemo(() => {
    let base = tabBase;
    if (showTabs) base = base.filter((tr) => tr.status === activeTab);
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((tr) => tr.name.toLowerCase().includes(q) || (tr.lead || "").toLowerCase().includes(q));
  }, [tabBase, query, showTabs, activeTab]);

  return (
    <div className={`tf-root${dark ? " tf-dark" : ""}`}>
      <div className="tf-page">
        <div className="tf-topbar">
          <div>
            <div className="tf-hero-eyebrow" style={{ color: "var(--tf-text-3)" }}>{t("Trip management")}</div>
            <h1 style={{ fontSize: 28, fontWeight: 800, marginTop: 2 }}>{t("Trips & coaches")}</h1>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {/* "Seed more trips" REMOVED 2026-07-30 ("remove the seed data") —
                it was a dev-only demo-data convenience, not something a real
                event coordinator ever needs once trips are real. */}
            {canEdit && !isCaptain && trips && !loadError && (
              <button className="tf-btn tf-btn-primary tf-btn-sm" onClick={() => setFormTrip({})}>
                <Plus size={14} /> {t("New trip")}
              </button>
            )}
          </div>
        </div>
        <p className="tf-muted" style={{ fontSize: 14, marginBottom: 20 }}>
          {t("Manage itineraries and reassign delegates between coaches on the fly.")}
        </p>

        {!trips && !loadError && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
            {[0, 1, 2].map((i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {loadError && (
          <div className="tf-card" style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--tf-red)" }}>
            <AlertCircle size={20} />
            <span>{t("Couldn't reach the backend")} — {loadError}</span>
          </div>
        )}

        {trips && !loadError && trips.length === 0 && (
          <div className="tf-card" style={{ textAlign: "center", padding: "48px 20px" }}>
            <EmptyIllustration />
            <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>{t("No trips yet")}</h2>
            <p className="tf-muted" style={{ fontSize: 13.5, maxWidth: 360, marginLeft: "auto", marginRight: "auto" }}>
              {canManageTrips
                ? t("Create your first trip to get started.")
                : t("No trips have been added yet. Please check back later.")}
            </p>
            {canManageTrips && (
              <button className="tf-btn tf-btn-primary" style={{ marginTop: 16 }} onClick={() => setFormTrip({})}>
                <Plus size={14} /> {t("New trip")}
              </button>
            )}
          </div>
        )}

        {trips && !loadError && trips.length > 0 && (
          <>
            {showTabs && (
              <div className="tf-trip-tabs" role="tablist">
                {TRIP_STATUSES.map((s) => (
                  <button key={s} type="button" role="tab" aria-selected={activeTab === s}
                    className={`tf-trip-tab${activeTab === s ? " is-active" : ""}`}
                    onClick={() => setActiveTab(s)}>
                    <span className="tf-trip-tab-dot" style={{ background: `var(--tf-${STATUS_COLOR[s] || "grey"})` }} />
                    {t(s)}
                    <span className="tf-trip-tab-count">{tabCounts[s] || 0}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="tf-between" style={{ marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
              <div className="tf-search" style={{ maxWidth: 340, flex: "1 1 240px" }}>
                <Search size={15} color="var(--tf-text-3)" />
                <input placeholder={t("Search trips…")} value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
              {filteredTrips.map((trip) => (
                <div
                  key={trip.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/trips?tripId=${trip.id}`)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/trips?tripId=${trip.id}`); } }}
                  className="tf-card"
                  style={{
                    margin: 0, textAlign: "left", cursor: "pointer", display: "flex", flexDirection: "column", gap: 10,
                    borderLeft: `4px solid var(--tf-${STATUS_COLOR[trip.status] || "grey"})`,
                    transition: "transform 0.15s ease, box-shadow 0.15s ease",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "var(--tf-shadow-md)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "var(--tf-shadow-sm)"; }}
                >
                  <div className="tf-between" style={{ alignItems: "flex-start", gap: 8 }}>
                    <h3 style={{ fontSize: 16.5, fontWeight: 800, minWidth: 0 }}>{trip.name}</h3>
                    <div className="tf-flex tf-gap-6" style={{ alignItems: "center", flexShrink: 0 }}>
                      <StatusChip status={trip.status} />
                      {canManageTrips && (
                        <>
                          <button
                            className="tf-btn tf-btn-ghost tf-btn-icon-only"
                            title={t("Edit trip")}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); setFormTrip(trip); }}
                          ><Pencil size={13} /></button>
                          <button
                            className="tf-btn tf-btn-ghost tf-btn-icon-only"
                            title={t("Delete trip")}
                            style={{ color: "var(--tf-red)" }}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); setDeleteTripState(trip); }}
                          ><Trash2 size={13} /></button>
                        </>
                      )}
                    </div>
                  </div>

                  {trip.dateRange && <div className="tf-muted" style={{ fontSize: 13 }}>{trip.dateRange}</div>}
                  {trip.lead && <div className="tf-muted" style={{ fontSize: 12 }}>{t("Lead")}: {trip.lead}</div>}

                  <TripProgress trip={trip} />

                  <div className="tf-flex tf-gap-12" style={{ marginTop: 2, fontSize: 13, color: "var(--tf-text-2)" }}>
                    <span className="tf-flex tf-gap-6" style={{ alignItems: "center" }}>
                      <Bus size={14} /> {trip.coachCount} {t("coaches")}
                    </span>
                    <span className="tf-flex tf-gap-6" style={{ alignItems: "center" }}>
                      <Users size={14} /> {trip.delegateCount} {t(trip.delegateCount === 1 ? "delegate" : "delegates")}
                    </span>
                  </div>

                  <span className="tf-flex tf-gap-6" style={{ alignItems: "center", fontSize: 12.5, fontWeight: 700, color: "var(--tf-blue)", marginTop: 2 }}>
                    {t("Open board")} →
                  </span>
                </div>
              ))}
              {filteredTrips.length === 0 && (
                <p className="tf-muted" style={{ fontSize: 13.5, gridColumn: "1 / -1" }}>
                  {query.trim() ? t("No trips match your search.") : showTabs ? `${t("No")} ${t(activeTab)} ${t("trips")}.` : t("No trips to show.")}
                </p>
              )}
            </div>
          </>
        )}
      </div>

      {formTrip && (
        <TripFormModal
          trip={formTrip}
          onClose={() => setFormTrip(null)}
          onSaved={(saved) => {
            setFormTrip(null); fetchTrips();
            if (saved?.unassigned?.length) {
              const names = saved.unassigned.map((u) => `${u.name} (${u.coachLabel})`).join(", ");
              setUnassignNotice(`${t("Auto-unassigned")}: ${names} — ${t("already captaining another active trip.")}`);
              clearTimeout(unassignNoticeTimer.current);
              unassignNoticeTimer.current = setTimeout(() => setUnassignNotice(null), 6000);
            }
          }}
        />
      )}
      {deleteTripState && (
        <DeleteTripDialog
          trip={deleteTripState}
          onClose={() => setDeleteTripState(null)}
          onDeleted={fetchTrips}
        />
      )}
      {unassignNotice && (
        <div style={{
          position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 200,
          background: "var(--tf-red)", color: "#fff", padding: "10px 16px", borderRadius: 8,
          fontSize: 13, fontWeight: 600, boxShadow: "var(--shadow-md)", maxWidth: "90vw",
        }}>
          {unassignNotice}
        </div>
      )}
    </div>
  );
}
