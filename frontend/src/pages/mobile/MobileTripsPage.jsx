import { useEffect, useState, useRef, useCallback } from "react";
import { ChevronRight, ArrowLeft, Bus, Users, X, Trash2, Loader2 } from "lucide-react";
import { apiGet, apiPatch, apiDelete, getPermissions } from "../../lib/api.js";
import { useLang } from "../../lib/i18n.jsx";

function initials(name) {
  return (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

/**
 * Mobile Trips — the phone-friendly counterpart to Desmond's desktop
 * TripCoachPage board. A tap-through list → per-trip monitoring view
 * (itinerary + coach assignments + delegates), read-only: on-ground staff
 * WATCH a trip here; the full editing board stays on desktop (this is a first
 * pass — reassigning/editing on mobile can be layered on later).
 *
 * Status-aware, mirroring the desktop modes:
 *   In progress → live "today's itinerary" + boarding + bus arrival
 *   Planning    → the plan (all stops) + seat counts
 *   Completed   → itinerary recap + final assignments
 *
 * Uses the mobile design system (.mobile-card / .badge / --st-* tokens), not
 * the desktop .tf-* one, so it fits the rest of the mobile app.
 */

const TRIP_TONE = { "In progress": "present", Planning: "assigned", Completed: "", Cancelled: "missing" };
const DELEGATE_TONE = { PRESENT: "present", ARRIVED: "present", ASSIGNED: "assigned", LATE: "late", MISSING: "missing", UNASSIGNED: "" };
const ITIN_TONE = { delayed: "late", moved: "assigned", cancelled: "missing" };
const ITIN_LABEL = { delayed: "Delayed", moved: "Moved", cancelled: "Cancelled" };
const ARRIVAL_SHORT = { not_arrived: "Not arrived", en_route: "On route", arrived: "Arrived" };
const ARRIVAL_STYLE = {
  not_arrived: { color: "var(--ink-3)", background: "var(--line)" },
  en_route: { color: "var(--st-late)", background: "var(--st-late-bg)" },
  arrived: { color: "var(--st-present)", background: "var(--st-present-bg)" },
};

function fmtDelay(mins) {
  const m0 = Math.max(0, Number(mins) || 0);
  const h = Math.floor(m0 / 60), m = m0 % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
}

function StatusBadge({ tone, children }) {
  if (!tone) return <span className="badge" style={{ color: "var(--ink-3)", background: "var(--line)" }}>{children}</span>;
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function DelegateChip({ d, onSelect }) {
  const tone = DELEGATE_TONE[d.status] || "";
  const dot = tone ? `var(--st-${tone})` : "var(--ink-3)";
  return (
    <button
      type="button"
      onClick={() => onSelect(d)}
      className="row"
      style={{ gap: 5, fontSize: 12.5, padding: "5px 10px", borderRadius: 999, background: "var(--surface)", border: "1px solid var(--line)", cursor: "pointer", color: "inherit", font: "inherit" }}
    >
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot, flexShrink: 0 }} />
      {d.name}{d.vip ? " ★" : ""}
    </button>
  );
}

const STATUS_LABEL = { PRESENT: "Arrived", ARRIVED: "Arrived", ASSIGNED: "Assigned", LATE: "Late", MISSING: "Missing", UNASSIGNED: "Unassigned" };

/* ---- Delegate detail bottom-sheet — the touch-friendly alternative to
 * dragging. Move to another coach, edit details, or remove. Editing is gated
 * on manageTrips + a non-completed trip; otherwise it's read-only. ---------- */
function DelegateSheet({ delegate, coaches, canEdit, onClose, onChanged }) {
  const { t } = useLang();
  const [moveTo, setMoveTo] = useState(delegate.coachId || "");
  const [form, setForm] = useState({ company: delegate.company || "", accessibilityNotes: delegate.accessibilityNotes || "", notes: delegate.notes || "" });
  const [moving, setMoving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [err, setErr] = useState(null);
  const tone = DELEGATE_TONE[delegate.status] || "";

  async function move() {
    const toCoachId = moveTo || null;
    if (toCoachId === (delegate.coachId || null)) return;
    // Mirror the desktop reassign rule: an unassigned delegate becomes ASSIGNED
    // when put on a coach; one that already has a real status keeps it.
    const nextStatus = toCoachId === null ? "UNASSIGNED" : (delegate.status === "UNASSIGNED" ? "ASSIGNED" : delegate.status);
    setMoving(true); setErr(null);
    try { await apiPatch(`/delegates/${delegate.id}`, { coachId: toCoachId, status: nextStatus }); await onChanged(); onClose(); }
    catch (e) { setErr(e.message); setMoving(false); }
  }
  async function save() {
    setSaving(true); setErr(null);
    try { await apiPatch(`/delegates/${delegate.id}/details`, form); await onChanged(); onClose(); }
    catch (e) { setErr(e.message); setSaving(false); }
  }
  async function remove() {
    if (!confirmRemove) { setConfirmRemove(true); return; }
    setRemoving(true); setErr(null);
    try { await apiDelete(`/delegates/${delegate.id}`); await onChanged(); onClose(); }
    catch (e) { setErr(e.message); setRemoving(false); setConfirmRemove(false); }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,0.45)", display: "flex", alignItems: "flex-end", zIndex: 60 }} onClick={onClose}>
      <div className="mobile-card" onClick={(e) => e.stopPropagation()} style={{ width: "100%", margin: 0, borderRadius: "16px 16px 0 0", padding: 18, paddingBottom: 28, maxHeight: "88vh", overflowY: "auto" }}>
        <div className="row between" style={{ marginBottom: 14 }}>
          <div className="row" style={{ gap: 10 }}>
            <span className="avatar" style={{ background: tone ? `var(--st-${tone}-bg)` : "var(--line)", color: tone ? `var(--st-${tone})` : "var(--ink-3)" }}>{initials(delegate.name)}</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{delegate.name}{delegate.vip ? " ★" : ""}</div>
              <StatusBadge tone={tone}>{t(STATUS_LABEL[delegate.status] || delegate.status)}</StatusBadge>
            </div>
          </div>
          <button onClick={onClose} className="btn btn-ghost" style={{ padding: 8 }} aria-label={t("Close")}><X size={16} /></button>
        </div>

        {canEdit ? (
          <>
            <label className="muted" style={{ fontSize: 12, fontWeight: 700 }}>{t("Move to coach")}</label>
            <div className="row" style={{ gap: 8, marginTop: 6, marginBottom: 16 }}>
              <select className="select" style={{ flex: 1 }} value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                <option value="">{t("Unassigned")}</option>
                {coaches.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <button className="btn btn-dark" onClick={move} disabled={moving || moveTo === (delegate.coachId || "")}>
                {moving ? <Loader2 size={14} className="spin" /> : t("Move")}
              </button>
            </div>

            <label className="muted" style={{ fontSize: 12, fontWeight: 700 }}>{t("Company")}</label>
            <input className="input" style={{ marginTop: 6, marginBottom: 12 }} value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} placeholder={t("Optional")} />
            <label className="muted" style={{ fontSize: 12, fontWeight: 700 }}>{t("Accessibility notes")}</label>
            <input className="input" style={{ marginTop: 6, marginBottom: 12 }} value={form.accessibilityNotes} onChange={(e) => setForm((f) => ({ ...f, accessibilityNotes: e.target.value }))} placeholder={t("e.g. wheelchair access, dietary needs")} />
            <label className="muted" style={{ fontSize: 12, fontWeight: 700 }}>{t("Notes")}</label>
            <textarea className="input" rows={3} style={{ marginTop: 6, marginBottom: 14, resize: "vertical", fontFamily: "inherit" }} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder={t("Dietary needs, medical notes, flight details…")} />

            {err && <div style={{ color: "var(--st-missing)", fontSize: 13, marginBottom: 10 }}>{err}</div>}
            <button className="btn btn-dark btn-block" onClick={save} disabled={saving}>{saving ? <Loader2 size={14} className="spin" /> : null} {t("Save changes")}</button>
            <button className="btn btn-ghost btn-block" onClick={remove} disabled={removing} style={{ marginTop: 10, color: "var(--st-missing)" }}>
              {removing ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />} {confirmRemove ? t("Tap again to confirm") : t("Remove delegate")}
            </button>
          </>
        ) : (
          <div>
            {delegate.company && <div style={{ fontSize: 14, marginBottom: 6 }}><span className="muted">{t("Company")}: </span>{delegate.company}</div>}
            {delegate.accessibilityNotes && <div style={{ fontSize: 14, marginBottom: 6 }}><span className="muted">{t("Accessibility notes")}: </span>{delegate.accessibilityNotes}</div>}
            {delegate.notes && <div style={{ fontSize: 14 }}><span className="muted">{t("Notes")}: </span>{delegate.notes}</div>}
            {!delegate.company && !delegate.accessibilityNotes && !delegate.notes && <div className="muted" style={{ fontSize: 13 }}>{t("No additional details.")}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---- Per-trip monitoring view -------------------------------------------- */
function TripDetail({ tripId, onBack }) {
  const { t } = useLang();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [selectedDelegate, setSelectedDelegate] = useState(null);
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const [summary, coaches, itin, del] = await Promise.all([
        apiGet(`/trips/${tripId}/summary`),
        apiGet(`/trips/${tripId}/coaches`),
        apiGet(`/trips/${tripId}/itinerary`),
        apiGet(`/delegates?tripId=${tripId}`),
      ]);
      setData({ summary, coaches: coaches.coaches || [], itinerary: itin.items || [], delegates: del.delegates || [] });
      setError(null);
    } catch (e) { setError(e.message); }
    finally { busy.current = false; }
  }, [tripId]);

  useEffect(() => {
    load();
    const id = setInterval(load, 3000); // live refresh while watching
    return () => clearInterval(id);
  }, [load]);

  const trip = data?.summary;
  const mode = trip?.status === "In progress" ? "live" : trip?.status === "Planning" ? "planning" : "completed";
  const editable = getPermissions().manageTrips && mode !== "completed";

  const coachIds = new Set((data?.coaches || []).map((c) => c.id));
  const byCoach = {};
  for (const d of (data?.delegates || [])) {
    const key = d.coachId && coachIds.has(d.coachId) ? d.coachId : "__un__";
    (byCoach[key] = byCoach[key] || []).push(d);
  }
  const currentDay = trip?.dayOf ?? 1;
  const stops = (data?.itinerary || []).slice().sort((a, b) => (a.dayNumber - b.dayNumber) || a.startTime.localeCompare(b.startTime));
  const shownStops = mode === "live" ? stops.filter((s) => s.dayNumber === currentDay) : stops;

  return (
    <div>
      <button className="btn btn-ghost" onClick={onBack} style={{ padding: "6px 10px", marginBottom: 10 }}>
        <ArrowLeft size={15} /> {t("Trips")}
      </button>

      {error && (
        <div className="mobile-card" style={{ color: "var(--st-missing)", borderColor: "var(--st-missing)" }}>
          {t("Couldn't reach the backend")} — {error}
        </div>
      )}

      {!trip ? <div className="muted">{t("Loading…")}</div> : (
        <>
          <div className="row between" style={{ alignItems: "flex-start", gap: 8 }}>
            <h1 style={{ fontSize: 20, margin: 0 }}>{trip.name}</h1>
            <StatusBadge tone={TRIP_TONE[trip.status]}>{t(trip.status)}</StatusBadge>
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
            {trip.dateRange}{trip.dateRange ? " · " : ""}
            {mode === "live"
              ? `${t("Day")} ${trip.dayOf} ${t("of")} ${trip.totalDays}`
              : `${(data.coaches || []).length} ${t("coaches")} · ${(data.delegates || []).length} ${t("delegates")}`}
          </div>

          {/* Itinerary */}
          <div className="mobile-card" style={{ marginTop: 14, border: "1px solid var(--line)", background: "var(--surface)" }}>
            <div className="muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 8 }}>
              {mode === "live" ? `${t("Today's itinerary")} · ${t("Day")} ${currentDay}` : mode === "planning" ? t("Trip plan") : t("Itinerary recap")}
            </div>
            {shownStops.length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>{t("No activities")}</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {shownStops.map((s) => {
                  const st = s.status && s.status !== "scheduled" ? s.status : null;
                  const struck = s.completed || s.status === "cancelled";
                  return (
                    <div key={s.id} className="row between" style={{ gap: 8, fontSize: 13, opacity: s.completed ? 0.6 : 1 }}>
                      <div className="row" style={{ gap: 8, minWidth: 0 }}>
                        <span className="mono" style={{ fontWeight: 700, flexShrink: 0 }}>{s.startTime}</span>
                        <span style={{ textDecoration: struck ? "line-through" : "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {mode !== "live" ? `D${s.dayNumber} · ` : ""}{s.title}
                        </span>
                      </div>
                      {st && <StatusBadge tone={ITIN_TONE[st]}>{t(ITIN_LABEL[st])}{st === "delayed" && s.delayMinutes ? ` +${fmtDelay(s.delayMinutes)}` : ""}</StatusBadge>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Coach assignments */}
          <div style={{ margin: "18px 0 8px" }}>
            <div className="muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>
              {mode === "completed" ? t("Final coach assignments") : t("Coach assignments")}
            </div>
            {editable && <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{t("Tap a delegate to move or edit")}</div>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {(data.coaches || []).map((c) => {
              const list = byCoach[c.id] || [];
              const missing = list.filter((d) => d.status === "MISSING").length;
              return (
                <div key={c.id} className="mobile-card" style={{ border: "1px solid var(--line)", background: "var(--surface)" }}>
                  <div className="row between" style={{ alignItems: "flex-start", gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{c.label}</div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {mode === "planning"
                          ? `${c.total ?? list.length} ${t("delegates")}${c.capacity ? ` · ${c.capacity} ${t("seats")}` : ""}`
                          : `${c.boarded ?? 0}/${c.total ?? 0} ${t("boarded")}`}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                      {mode === "live" && c.arrivalStatus && (
                        <span className="badge" style={{ ...ARRIVAL_STYLE[c.arrivalStatus], display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <Bus size={11} /> {t(ARRIVAL_SHORT[c.arrivalStatus])}
                        </span>
                      )}
                      {mode !== "planning" && (missing > 0 ? <StatusBadge tone="missing">{missing} {t("missing")}</StatusBadge> : <StatusBadge tone="present">{t("All in")}</StatusBadge>)}
                    </div>
                  </div>
                  {list.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                      {list.map((d) => <DelegateChip key={d.id} d={d} onSelect={setSelectedDelegate} />)}
                    </div>
                  )}
                  {list.length === 0 && <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{t("Empty")}</div>}
                </div>
              );
            })}

            {(byCoach["__un__"] || []).length > 0 && (
              <div className="mobile-card" style={{ border: "1px dashed var(--st-late)", background: "var(--st-late-bg)" }}>
                <div className="row between">
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{t("Unassigned")}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{t("Needs a coach")}</div>
                  </div>
                  <StatusBadge tone="late">{byCoach["__un__"].length}</StatusBadge>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                  {byCoach["__un__"].map((d) => <DelegateChip key={d.id} d={d} onSelect={setSelectedDelegate} />)}
                </div>
              </div>
            )}

            {(data.coaches || []).length === 0 && (byCoach["__un__"] || []).length === 0 && (
              <div className="muted" style={{ fontSize: 13 }}>{t("No coaches yet.")}</div>
            )}
          </div>
        </>
      )}

      {selectedDelegate && (
        <DelegateSheet
          delegate={selectedDelegate}
          coaches={data?.coaches || []}
          canEdit={editable}
          onClose={() => setSelectedDelegate(null)}
          onChanged={load}
        />
      )}
      <style>{`.spin{animation:mg-spin 0.9s linear infinite}@keyframes mg-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

/* ---- Trips list ----------------------------------------------------------- */
export default function MobileTripsPage() {
  const { t } = useLang();
  const [trips, setTrips] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);

  // Staff (without viewMobileAllTrips) only see the trip that's actually
  // happening right now — Planning/Completed trips are filtered out client-
  // side rather than requested differently, since /all-trips is a shared
  // read-only endpoint with no reason for a second, narrower backend route.
  // Admin bypasses every permission check, so this is a no-op filter for them.
  const canSeeAllTrips = getPermissions().viewMobileAllTrips;

  function load() {
    apiGet("/all-trips").then((d) => { setTrips(d.trips); setError(null); }).catch((e) => setError(e.message));
  }
  useEffect(() => { load(); }, []);

  const visibleTrips = canSeeAllTrips ? trips : (trips || []).filter((trip) => trip.status === "In progress");

  if (selected) return <TripDetail tripId={selected} onBack={() => { setSelected(null); load(); }} />;

  return (
    <div>
      <div className="muted" style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>{t("Trip management")}</div>
      <h1 style={{ fontSize: 22, margin: "4px 0 12px" }}>{t("Trips")}</h1>

      {error && <div className="mobile-card" style={{ color: "var(--st-missing)", borderColor: "var(--st-missing)" }}>{t("Couldn't reach the backend")} — {error}</div>}
      {!trips && !error && <div className="muted">{t("Loading…")}</div>}
      {trips && visibleTrips.length === 0 && <div className="muted">{t(canSeeAllTrips ? "No trips yet" : "No trip currently in progress")}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {(visibleTrips || []).map((trip) => (
          <button
            key={trip.id}
            className="mobile-card"
            onClick={() => setSelected(trip.id)}
            style={{ width: "100%", textAlign: "left", cursor: "pointer", border: "1px solid var(--line)", background: "var(--surface)" }}
          >
            <div className="row between" style={{ alignItems: "flex-start", gap: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{trip.name}</div>
              <StatusBadge tone={TRIP_TONE[trip.status]}>{t(trip.status)}</StatusBadge>
            </div>
            {trip.dateRange && <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>{trip.dateRange}</div>}
            {trip.status === "In progress" && trip.totalDays ? (
              <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{t("Day")} {trip.dayOf} {t("of")} {trip.totalDays}</div>
            ) : null}
            <div className="row" style={{ gap: 14, marginTop: 8, fontSize: 12.5, color: "var(--ink-3)" }}>
              <span className="row" style={{ gap: 5 }}><Bus size={13} /> {trip.coachCount} {t("coaches")}</span>
              <span className="row" style={{ gap: 5 }}><Users size={13} /> {trip.delegateCount} {t("delegates")}</span>
              <ChevronRight size={15} style={{ marginLeft: "auto" }} />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
