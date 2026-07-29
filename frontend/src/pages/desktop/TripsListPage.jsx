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
import { Loader2, AlertCircle, Bus, Users, Sparkles, Search, MapPin, Plus, Pencil, Trash2, X } from "lucide-react";
import { apiGet, apiPost, apiPatch, apiDelete, getPermissions, getUser } from "../../lib/api.js";
import { useLang } from "../../lib/i18n.jsx";
import { useTheme } from "../../lib/theme.jsx";
import "./TripCoachPage.css";

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
    coachCapacity: "",
  });
  // Whether "Current day" is a deliberate manual override vs. auto-computed
  // from startDate (see syncTripDayOf(), backend/db/dashboard.js). Editing
  // the number below sets this true; "Use automatic day" clears it.
  const [dayOfManual, setDayOfManual] = useState(!!trip?.dayOfIsManual);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // Staff normally set the real start date 2–3 days BEFORE the trip actually
  // begins, so a start date already in the past is unusual enough to be
  // worth a second look (e.g. picked the wrong month) rather than saving
  // silently — shows an inline "are you sure" instead of a hard block.
  const [pastDateWarningShown, setPastDateWarningShown] = useState(false);
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setPastDateWarningShown(false); };

  // Matches the backend's own "today" for the auto-day feature (syncTripDayOf
  // computes in Asia/Singapore, not the browser's local zone or UTC — see
  // backend/db/dashboard.js) so this warning agrees with what the backend
  // will actually compute once saved, regardless of the device's own timezone.
  const todaySGT = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore" }).format(new Date());
  const isPastStartDate = !!form.startDate && form.startDate < todaySGT();

  async function handleSubmit(confirmedPastDate = false) {
    if (!form.name.trim()) { setError(t("A trip name is required.")); return; }
    if (!form.startDate) { setError(t("Actual start date is required.")); return; }
    if (isPastStartDate && !confirmedPastDate) { setPastDateWarningShown(true); return; }
    setSaving(true); setError(null); setPastDateWarningShown(false);
    try {
      const payload = {
        name: form.name.trim(), dateRange: computeDateRange(form.startDate, form.totalDays), status: form.status,
        lead: form.lead.trim(), totalDays: Number(form.totalDays) || 1,
        startDate: form.startDate || null,
      };
      if (!editing || dayOfManual) payload.dayOf = Number(form.dayOf) || 1;
      else payload.resetDayOfAuto = true; // editing + not manual: let the backend recompute from startDate
      const saved = editing ? await apiPatch(`/trips/${trip.id}`, payload) : await apiPost(`/trips`, payload);
      // Bulk coach capacity — separate call, only sent if the admin actually
      // typed a value (left blank = leave each coach's own capacity alone).
      const capacityValue = Number(form.coachCapacity);
      if (editing && form.coachCapacity.trim() && capacityValue > 0) {
        await apiPatch(`/trips/${trip.id}/coaches/capacity`, { capacity: capacityValue });
      }
      onSaved(saved, editing);
      onClose();
    } catch (e) { setError(e.message); setSaving(false); }
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
              <input className="tf-input" value={form.lead} placeholder={t("Optional")} onChange={(e) => set("lead", e.target.value)} />
            </div>
          </div>

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

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            <div>
              <label className="tf-field-label">{t("Current day")}</label>
              <input type="number" min={1} className="tf-input" value={form.dayOf}
                onChange={(e) => { set("dayOf", e.target.value); setDayOfManual(true); }} />
              {form.startDate && (
                dayOfManual ? (
                  <button type="button" className="tf-btn tf-btn-ghost" style={{ padding: "2px 0", fontSize: 12, height: "auto", marginTop: 4 }}
                    onClick={() => setDayOfManual(false)}>
                    {t("↺ Use automatic day")}
                  </button>
                ) : (
                  <p className="tf-muted" style={{ fontSize: 12, marginTop: 4, marginBottom: 0 }}>
                    {t("Auto-calculated from start date")}
                  </p>
                )
              )}
            </div>
            <div>
              <label className="tf-field-label">{t("Total days")}</label>
              <input type="number" min={1} className="tf-input" value={form.totalDays} onChange={(e) => set("totalDays", e.target.value)} />
            </div>
          </div>

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
  const [seeding, setSeeding] = useState(false);
  const [seedMessage, setSeedMessage] = useState(null);
  const [query, setQuery] = useState("");
  const [formTrip, setFormTrip] = useState(null);   // null = closed · {} = new · {…trip} = edit
  const [deleteTripState, setDeleteTripState] = useState(null);
  const [captainTripIds, setCaptainTripIds] = useState(null); // Set of trip ids this account captains
  const canEdit = getPermissions().manageTrips; // gate edit controls (see permissions.js)

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

  async function handleSeed() {
    setSeeding(true);
    setSeedMessage(null);
    try {
      const result = await apiPost("/trips/seed", {});
      await fetchTrips();
      setSeedMessage(
        result.created > 0
          ? `+${result.created} ${t("new trip")}${result.created === 1 ? "" : "s"} ${t("added")}`
          : t("All demo trips are already on the board")
      );
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setSeeding(false);
      setTimeout(() => setSeedMessage(null), 4000);
    }
  }

  const filteredTrips = useMemo(() => {
    if (!trips) return [];
    // Captains only ever see the trip(s) they're assigned to.
    const base = isCaptain ? trips.filter((tr) => captainTripIds.has(tr.id)) : trips;
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((tr) => tr.name.toLowerCase().includes(q) || (tr.lead || "").toLowerCase().includes(q));
  }, [trips, query, isCaptain, captainTripIds]);

  return (
    <div className={`tf-root${dark ? " tf-dark" : ""}`}>
      <div className="tf-page">
        <div className="tf-topbar">
          <div>
            <div className="tf-hero-eyebrow" style={{ color: "var(--tf-text-3)" }}>{t("Trip management")}</div>
            <h1 style={{ fontSize: 28, fontWeight: 800, marginTop: 2 }}>{t("Trips & coaches")}</h1>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {/* Persistent seed control — previously only reachable from the
               zero-trips empty state, so once any trip existed there was no
               UI path left to add the newer demo trips. Gated on manageTrips. */}
            {canEdit && !isCaptain && trips && !loadError && (
              <>
                {seedMessage && (
                  <span className="tf-muted" style={{ fontSize: 12.5, fontWeight: 600 }}>{seedMessage}</span>
                )}
                <button className="tf-btn tf-btn-solid tf-btn-sm" onClick={handleSeed} disabled={seeding}>
                  {seeding ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} {t("Seed more trips")}
                </button>
                <button className="tf-btn tf-btn-primary tf-btn-sm" onClick={() => setFormTrip({})}>
                  <Plus size={14} /> {t("New trip")}
                </button>
              </>
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
                ? t("Create your first trip, or use “Seed more trips” above to explore with demo data.")
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
                <p className="tf-muted" style={{ fontSize: 13.5, gridColumn: "1 / -1" }}>{t("No trips match your search.")}</p>
              )}
            </div>
          </>
        )}
      </div>

      {formTrip && (
        <TripFormModal
          trip={formTrip}
          onClose={() => setFormTrip(null)}
          onSaved={() => { setFormTrip(null); fetchTrips(); }}
        />
      )}
      {deleteTripState && (
        <DeleteTripDialog
          trip={deleteTripState}
          onClose={() => setDeleteTripState(null)}
          onDeleted={fetchTrips}
        />
      )}
    </div>
  );
}
