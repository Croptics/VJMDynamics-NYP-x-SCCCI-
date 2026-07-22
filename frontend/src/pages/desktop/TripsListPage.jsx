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

import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, AlertCircle, Bus, Users, Sparkles, Search, MapPin, Plus, Pencil, Trash2, X } from "lucide-react";
import { apiGet, apiPost, apiPatch, apiDelete, getPermissions } from "../../lib/api.js";
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

/** Create / edit a trip. `trip` with an id = edit; anything else = create.
 *  Self-contained (calls the API itself). Reuses the .tf-modal-* / .tf-input
 *  classes already in TripCoachPage.css, so no new styles are needed. */
function TripFormModal({ trip, onClose, onSaved }) {
  const { t } = useLang();
  const editing = !!(trip && trip.id);
  const [form, setForm] = useState({
    name: trip?.name || "",
    dateRange: trip?.dateRange || "",
    status: trip?.status || "Planning",
    lead: trip?.lead || "",
    totalDays: trip?.totalDays || 5,
    dayOf: trip?.dayOf || 1,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function handleSubmit() {
    if (!form.name.trim()) { setError(t("A trip name is required.")); return; }
    setSaving(true); setError(null);
    try {
      const payload = {
        name: form.name.trim(), dateRange: form.dateRange.trim(), status: form.status,
        lead: form.lead.trim(), totalDays: Number(form.totalDays) || 1, dayOf: Number(form.dayOf) || 1,
      };
      const saved = editing ? await apiPatch(`/trips/${trip.id}`, payload) : await apiPost(`/trips`, payload);
      onSaved(saved, editing);
      onClose();
    } catch (e) { setError(e.message); setSaving(false); }
  }

  return (
    <div className="tf-modal-overlay" onClick={saving ? undefined : onClose}>
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

          <label className="tf-field-label">{t("Dates")}</label>
          <input className="tf-input" style={{ marginBottom: 14 }} value={form.dateRange}
            placeholder={t("e.g. 3–7 Sep 2026")} onChange={(e) => set("dateRange", e.target.value)} />

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

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            <div>
              <label className="tf-field-label">{t("Current day")}</label>
              <input type="number" min={1} className="tf-input" value={form.dayOf} onChange={(e) => set("dayOf", e.target.value)} />
            </div>
            <div>
              <label className="tf-field-label">{t("Total days")}</label>
              <input type="number" min={1} className="tf-input" value={form.totalDays} onChange={(e) => set("totalDays", e.target.value)} />
            </div>
          </div>

          {error && <p style={{ color: "var(--tf-red)", fontSize: 13, marginTop: 12 }}>{error}</p>}
        </div>
        <div className="tf-modal-footer">
          <button className="tf-btn tf-btn-ghost" onClick={onClose} disabled={saving}>{t("Cancel")}</button>
          <button className="tf-btn tf-btn-primary" onClick={handleSubmit} disabled={saving}>
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
  async function handleDelete() {
    setBusy(true); setError(null);
    try { await apiDelete(`/trips/${trip.id}`); onDeleted(); onClose(); }
    catch (e) { setError(e.message); setBusy(false); }
  }
  return (
    <div className="tf-modal-overlay" onClick={busy ? undefined : onClose}>
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
  const canEdit = getPermissions().manageTrips; // gate edit controls (see permissions.js)

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
    const q = query.trim().toLowerCase();
    if (!q) return trips;
    return trips.filter((tr) => tr.name.toLowerCase().includes(q) || (tr.lead || "").toLowerCase().includes(q));
  }, [trips, query]);

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
            {canEdit && trips && !loadError && (
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
              {canEdit
                ? t("Create your first trip, or use “Seed more trips” above to explore with demo data.")
                : t("No trips have been added yet. Please check back later.")}
            </p>
            {canEdit && (
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
              <span className="tf-muted" style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap" }}>
                {query.trim() ? `${filteredTrips.length} ${t("of")} ${trips.length}` : trips.length} {t(trips.length === 1 ? "trip" : "trips")}
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
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
                      {canEdit && (
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
