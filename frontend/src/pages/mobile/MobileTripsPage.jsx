import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { ChevronRight, ArrowLeft, Bus, Users, X, Trash2, Loader2, AlertCircle, CheckCircle2, Clock, ClipboardList, Phone, BedDouble, MapPin } from "lucide-react";
import { apiGet, apiPost, apiPatch, apiDelete, getPermissions, getUser } from "../../lib/api.js";
import { useLang } from "../../lib/i18n.jsx";
import DelegateLocationMap from "../../components/DelegateLocationMap.jsx";
import DelegateTimeline from "../../components/DelegateTimeline.jsx";

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
const ARRIVAL_SHORT = { not_arrived: "Not arrived", en_route: "En route", arrived: "Arrived" };
const ATT_META = { ARRIVED: { label: "Present", tone: "present" }, LATE: { label: "Late", tone: "late" }, MISSING: { label: "Missing", tone: "missing" } };
const ATT_ICON = { ARRIVED: CheckCircle2, LATE: Clock, MISSING: AlertCircle };
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
// Display-only 12h formatting (2026-07-30 — "fix to 12 hr format"). The raw
// 24h "HH:MM" itinerary_items.startTime stays untouched everywhere else —
// the sort-by-time comparator below needs that exact shape — this only
// prettifies what actually gets printed on screen. Same helper as the desktop
// TripCoachPage.jsx; kept local rather than shared since it's a one-line pure
// function, matching this codebase's existing per-file small-helper pattern.
function fmt12h(hhmm) {
  if (!hhmm) return hhmm;
  const [h, m] = String(hhmm).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${period}`;
}

function StatusBadge({ tone, children }) {
  if (!tone) return <span className="badge" style={{ color: "var(--ink-3)", background: "var(--line)" }}>{children}</span>;
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function DelegateChip({ d, onSelect, wrongCoach = false }) {
  const tone = DELEGATE_TONE[d.status] || "";
  const dot = tone ? `var(--st-${tone})` : "var(--ink-3)";
  return (
    <button
      type="button"
      onClick={() => onSelect(d)}
      className="row"
      style={{ gap: 5, fontSize: 12.5, padding: "5px 10px", borderRadius: 999, background: "var(--surface)", cursor: "pointer", color: "inherit", font: "inherit",
        border: wrongCoach ? "1px solid var(--st-missing)" : "1px solid var(--line)" }}
    >
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot, flexShrink: 0 }} />
      {d.name}{d.vip ? " ★" : ""}
      {wrongCoach && <AlertCircle size={11} color="var(--st-missing)" />}
    </button>
  );
}

const STATUS_LABEL = { PRESENT: "Arrived", ARRIVED: "Arrived", ASSIGNED: "Assigned", LATE: "Late", MISSING: "Missing", UNASSIGNED: "Unassigned" };

/* ---- Delegate detail bottom-sheet — the touch-friendly alternative to
 * dragging. Move to another coach, edit details, or remove. Editing is gated
 * on manageTrips + a non-completed trip; otherwise it's read-only. ---------- */
/* ---- Delegate detail sheet (2026-07-30 — "if i click on delegate, i don't
 * want that ui, i want to see delegate detail page, additionally add a
 * button to move the delegate to different coach") — this used to open
 * straight into an edit FORM (move dropdown + Company/Accessibility/Notes
 * inputs + Remove). Tapping a delegate chip on the coach board is someone
 * checking WHO this is and WHERE they are first, not editing their record —
 * so this now leads with the same read-only detail (status, coach, phone,
 * room, last known location, checkpoint timeline) MobileAttendancePage.jsx's
 * own delegate detail sheet already shows, with "Move to coach" — the one
 * capability actually needed from this board — added as its own action.
 * Editing company/accessibility/notes and removing the delegate move to a
 * collapsed "Edit details" section below, so nothing is lost, it's just not
 * the first thing you see. */
function DelegateSheet({ delegate, coaches, canEdit, onClose, onChanged }) {
  const { t } = useLang();
  const [moveTo, setMoveTo] = useState(delegate.coachId || "");
  const [moving, setMoving] = useState(false);
  const [moveErr, setMoveErr] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState({ company: delegate.company || "", accessibilityNotes: delegate.accessibilityNotes || "", notes: delegate.notes || "" });
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [editErr, setEditErr] = useState(null);
  const tone = DELEGATE_TONE[delegate.status] || "";
  // "Coach 4 · Suzhou" — same [name, city] join MobileAttendancePage.jsx's
  // own coachName() helper uses, not just the bare label ("C3"). Falls back
  // to label alone for a coach with no name/city set (e.g. one generated via
  // "Generate coaches", which has no city field at all).
  const matchedCoach = coaches.find((c) => c.id === delegate.coachId);
  const coachLabel = matchedCoach && ([matchedCoach.name, matchedCoach.city].filter(Boolean).join(" · ") || matchedCoach.label);
  // Only dismiss if the WHOLE click gesture started on the backdrop itself,
  // not wherever the mouse was released after dragging to select text in
  // e.g. the Notes field.
  const downOnBackdrop = useRef(false);

  async function move() {
    const toCoachId = moveTo || null;
    if (toCoachId === (delegate.coachId || null)) return;
    // Mirror the desktop reassign rule: an unassigned delegate becomes ASSIGNED
    // when put on a coach; one that already has a real status keeps it.
    const nextStatus = toCoachId === null ? "UNASSIGNED" : (delegate.status === "UNASSIGNED" ? "ASSIGNED" : delegate.status);
    setMoving(true); setMoveErr(null);
    try { await apiPatch(`/delegates/${delegate.id}`, { coachId: toCoachId, status: nextStatus }); await onChanged(); onClose(); }
    catch (e) { setMoveErr(e.message); setMoving(false); }
  }
  async function save() {
    setSaving(true); setEditErr(null);
    try { await apiPatch(`/delegates/${delegate.id}/details`, form); await onChanged(); onClose(); }
    catch (e) { setEditErr(e.message); setSaving(false); }
  }
  async function remove() {
    if (!confirmRemove) { setConfirmRemove(true); return; }
    setRemoving(true); setEditErr(null);
    try { await apiDelete(`/delegates/${delegate.id}`); await onChanged(); onClose(); }
    catch (e) { setEditErr(e.message); setRemoving(false); setConfirmRemove(false); }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,0.45)", display: "flex", alignItems: "flex-end", zIndex: 60 }}
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) onClose(); }}>
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

        {coachLabel && <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>{coachLabel}</div>}

        {delegate.phone && (
          <a href={`tel:${delegate.phone}`} className="row" style={{ gap: 8, marginTop: 8, color: "var(--st-missing)", textDecoration: "none" }}>
            <Phone size={16} /> {delegate.phone}
          </a>
        )}

        {(delegate.company || delegate.hotel_name || delegate.room_number) && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "10px 14px", marginTop: 14 }}>
            {delegate.company && (
              <div>
                <div className="muted" style={{ fontSize: 11.5, marginBottom: 2 }}>{t("Company")}</div>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>{delegate.company}</div>
              </div>
            )}
            {(delegate.hotel_name || delegate.room_number) && (
              <div>
                <div className="muted" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, marginBottom: 2 }}>
                  <BedDouble size={12} /> {t("Room")}
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>
                  {[delegate.hotel_name, delegate.room_number ? `${t("Room")} ${delegate.room_number}` : null].filter(Boolean).join(" · ")}
                </div>
              </div>
            )}
          </div>
        )}

        {delegate.lastLocation ? (
          <div style={{ marginTop: 14 }}>
            <div className="field-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <MapPin size={13} /> {t("Last known location")}
            </div>
            <p style={{ fontSize: 13, marginTop: 3, marginBottom: 8 }}>
              {[delegate.lastLocation, delegate.lastSeen].filter(Boolean).join(" · ")}
            </p>
            <DelegateLocationMap location={delegate.lastLocation} height={160} />
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 13, marginTop: 12 }}>
            {t("No location has been recorded for this delegate yet.")}
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <div className="row" style={{ gap: 6, marginBottom: 8 }}>
            <Clock size={14} color="var(--ink-3)" />
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>{t("Checkpoint timeline")}</span>
          </div>
          <DelegateTimeline delegateId={delegate.id} defaultVisible={2} />
        </div>

        {canEdit && (
          <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
            <label className="muted" style={{ fontSize: 12, fontWeight: 700 }}>{t("Move to coach")}</label>
            <div className="row" style={{ gap: 8, marginTop: 6 }}>
              <select className="select" style={{ flex: 1 }} value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                <option value="">{t("Unassigned")}</option>
                {coaches.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <button className="btn btn-dark" onClick={move} disabled={moving || moveTo === (delegate.coachId || "")}>
                {moving ? <Loader2 size={14} className="spin" /> : t("Move")}
              </button>
            </div>
            {moveErr && <div style={{ color: "var(--st-missing)", fontSize: 13, marginTop: 8 }}>{moveErr}</div>}
          </div>
        )}

        {canEdit && (
          <div style={{ marginTop: 18 }}>
            <button className="btn btn-ghost btn-block" onClick={() => setEditOpen((v) => !v)}>
              {t("Edit details")}
            </button>
            {editOpen && (
              <div style={{ marginTop: 12 }}>
                <label className="muted" style={{ fontSize: 12, fontWeight: 700 }}>{t("Company")}</label>
                <input className="input" style={{ marginTop: 6, marginBottom: 12 }} value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} placeholder={t("Optional")} />
                <label className="muted" style={{ fontSize: 12, fontWeight: 700 }}>{t("Accessibility notes")}</label>
                <input className="input" style={{ marginTop: 6, marginBottom: 12 }} value={form.accessibilityNotes} onChange={(e) => setForm((f) => ({ ...f, accessibilityNotes: e.target.value }))} placeholder={t("e.g. wheelchair access, dietary needs")} />
                <label className="muted" style={{ fontSize: 12, fontWeight: 700 }}>{t("Notes")}</label>
                <textarea className="input" rows={3} style={{ marginTop: 6, marginBottom: 14, resize: "vertical", fontFamily: "inherit" }} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder={t("Dietary needs, medical notes, flight details…")} />

                {editErr && <div style={{ color: "var(--st-missing)", fontSize: 13, marginBottom: 10 }}>{editErr}</div>}
                <button className="btn btn-dark btn-block" onClick={save} disabled={saving}>{saving ? <Loader2 size={14} className="spin" /> : null} {t("Save changes")}</button>
                <button className="btn btn-ghost btn-block" onClick={remove} disabled={removing} style={{ marginTop: 10, color: "var(--st-missing)" }}>
                  {removing ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />} {confirmRemove ? t("Tap again to confirm") : t("Remove delegate")}
                </button>
              </div>
            )}
          </div>
        )}

        {!canEdit && (
          <div style={{ marginTop: 16 }}>
            {delegate.accessibilityNotes && <div style={{ fontSize: 14, marginBottom: 6 }}><span className="muted">{t("Accessibility notes")}: </span>{delegate.accessibilityNotes}</div>}
            {delegate.notes && <div style={{ fontSize: 14 }}><span className="muted">{t("Notes")}: </span>{delegate.notes}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---- Per-event attendance bottom-sheet (mirrors desktop AttendanceModal) --- */
function MobileAttendanceSheet({ tripId, item, scopedCoachId, canEdit, onClose }) {
  const { t } = useLang();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const downOnBackdrop = useRef(false);

  const load = useCallback(async () => {
    try { setData(await apiGet(`/trips/${tripId}/itinerary/${item.id}/attendance`)); }
    catch (e) { setError(e.message); }
  }, [tripId, item.id]);
  useEffect(() => { load(); }, [load]);

  async function setStatus(delegateId, status) {
    setSavingId(delegateId + status); setError(null);
    try { await apiPost(`/trips/${tripId}/itinerary/${item.id}/attendance`, { delegateId, status }); await load(); }
    catch (e) { setError(e.message); } finally { setSavingId(null); }
  }

  const groups = useMemo(() => {
    if (!data) return [];
    const rows = scopedCoachId ? data.delegates.filter((d) => d.coachId === scopedCoachId) : data.delegates;
    const byCoach = new Map();
    for (const d of rows) {
      const key = d.coachId || "__un__";
      if (!byCoach.has(key)) byCoach.set(key, { coachId: d.coachId, coachLabel: d.coachLabel || t("Unassigned"), sort: d.coachSort ?? 999, delegates: [] });
      byCoach.get(key).delegates.push(d);
    }
    return [...byCoach.values()].sort((a, b) => a.sort - b.sort);
  }, [data, scopedCoachId, t]);

  const history = useMemo(() => (!data ? [] : (scopedCoachId ? data.history.filter((h) => h.coachId === scopedCoachId) : data.history)), [data, scopedCoachId]);
  const summary = useMemo(() => {
    const all = groups.flatMap((g) => g.delegates);
    return { present: all.filter((d) => d.status === "ARRIVED").length, late: all.filter((d) => d.status === "LATE").length, missing: all.filter((d) => d.status === "MISSING").length, total: all.length };
  }, [groups]);

  const kpi = (n, label, tone) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 1, padding: "9px 10px", borderRadius: 12, color: `var(--st-${tone})`, background: `var(--st-${tone}-bg)` }}>
      <span style={{ fontSize: 20, fontWeight: 800, lineHeight: 1 }}>{n}</span>
      <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,0.45)", display: "flex", alignItems: "flex-end", zIndex: 70 }}
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) onClose(); }}>
      <div className="mobile-card" onClick={(e) => e.stopPropagation()} style={{ width: "100%", margin: 0, borderRadius: "16px 16px 0 0", padding: 18, paddingBottom: 28, maxHeight: "90vh", overflowY: "auto" }}>
        <div className="row between" style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 15.5, minWidth: 0 }}>{t("Attendance")} · {fmt12h(item.startTime)} {item.title}</div>
          <button onClick={onClose} className="btn btn-ghost" style={{ padding: 8, flexShrink: 0 }} aria-label={t("Close")}><X size={16} /></button>
        </div>
        {error && <div style={{ color: "var(--st-missing)", fontSize: 13, marginBottom: 10 }}>{error}</div>}
        {!data && !error && <div className="row" style={{ justifyContent: "center", padding: 18 }}><Loader2 size={18} className="spin" /></div>}
        {data && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
              {kpi(summary.present, t("Present"), "present")}
              {kpi(summary.late, t("Late"), "late")}
              {kpi(summary.missing, t("Missing"), "missing")}
              <div style={{ display: "flex", flexDirection: "column", gap: 1, padding: "9px 10px", borderRadius: 12, color: "var(--ink)", background: "var(--line)" }}>
                <span style={{ fontSize: 20, fontWeight: 800, lineHeight: 1 }}>{summary.total}</span>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{t("Total")}</span>
              </div>
            </div>

            {groups.map((g) => (
              <div key={g.coachId || "un"} style={{ marginTop: 16 }}>
                <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 8 }}>{g.coachLabel} <span className="muted" style={{ fontWeight: 600 }}>· {g.delegates.filter((d) => d.status === "ARRIVED").length}/{g.delegates.length} {t("present")}</span></div>
                {g.delegates.map((d) => {
                  const meta = d.status ? ATT_META[d.status] : null;
                  return (
                    <div key={d.delegateId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 0", borderTop: "1px solid var(--line)" }}>
                      <span style={{ flex: 1, fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
                      {!canEdit && (meta ? <StatusBadge tone={meta.tone}>{t(meta.label)}</StatusBadge> : <span className="badge" style={{ color: "var(--ink-3)", background: "var(--line)" }}>{t("Not recorded")}</span>)}
                      {canEdit && (
                        <div style={{ display: "inline-flex", borderRadius: 9, overflow: "hidden", border: "1px solid var(--line)", flexShrink: 0 }}>
                          {["ARRIVED", "LATE", "MISSING"].map((s) => {
                            const active = d.status === s;
                            const tone = ATT_META[s].tone;
                            return (
                              <button key={s} type="button" disabled={savingId === d.delegateId + s} onClick={() => setStatus(d.delegateId, s)}
                                style={{ fontSize: 11.5, fontWeight: 700, padding: "7px 9px", border: "none", borderLeft: s === "ARRIVED" ? "none" : "1px solid var(--line)", background: active ? `var(--st-${tone})` : "var(--surface)", color: active ? "#fff" : "var(--ink-2)", cursor: "pointer" }}>
                                {t(ATT_META[s].label)}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

            <div style={{ fontWeight: 800, fontSize: 13, margin: "18px 0 10px", paddingTop: 14, borderTop: "1px solid var(--line)" }}>{t("Change history")} <span className="muted" style={{ fontWeight: 600 }}>· {t("before → after")}</span></div>
            {history.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>{t("No attendance changes recorded for this event yet.")}</div> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {history.map((h) => {
                  const toMeta = ATT_META[h.toStatus];
                  const Icon = ATT_ICON[h.toStatus] || CheckCircle2;
                  return (
                    <div key={h.id} className="row" style={{ gap: 10, alignItems: "flex-start" }}>
                      <span className="avatar" style={{ width: 24, height: 24, flexShrink: 0, color: `var(--st-${toMeta?.tone || "present"})`, background: `var(--st-${toMeta?.tone || "present"}-bg)` }}><Icon size={12} /></span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13 }}><b>{h.delegateName}</b> <span style={{ color: "var(--st-missing)", textDecoration: "line-through" }}>{h.fromStatus ? t(ATT_META[h.fromStatus]?.label || h.fromStatus) : t("Not recorded")}</span> → <span style={{ color: "var(--st-present)", fontWeight: 700 }}>{t(toMeta?.label || h.toStatus)}</span></div>
                        <div className="muted" style={{ fontSize: 11.5 }}>{t("by")} {h.actor} · {new Date(h.at).toLocaleString()}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
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
  const [attItem, setAttItem] = useState(null);
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
  // Wrong-coach ("UFO") flag — delegates on a coach that isn't on this trip.
  // Mirrors the desktop board: they fall under Unassigned but are flagged.
  const wrongCoachIds = new Set(
    (data?.delegates || []).filter((d) => d.coachId && !coachIds.has(d.coachId)).map((d) => d.id)
  );
  // Per-coach scoping (mirrors desktop): a non-admin captain of a coach on this
  // trip sees only their own coach. Match on username — the login stores no id.
  const me = getUser() || {};
  const myCoach = (data?.coaches || []).find((c) => c.captainUsername && me.username && c.captainUsername === me.username) || null;
  const scopedToCoach = !!myCoach && me.role !== "admin";
  const shownCoaches = scopedToCoach ? (data?.coaches || []).filter((c) => c.id === myCoach.id) : (data?.coaches || []);
  const currentDay = trip?.dayOf ?? 1;
  const stops = (data?.itinerary || []).slice().sort((a, b) => (a.dayNumber - b.dayNumber) || a.startTime.localeCompare(b.startTime));
  const shownStops = mode === "live" ? stops.filter((s) => s.dayNumber === currentDay) : stops;
  // Scoped counts for the command-centre KPI row.
  const statDelegates = scopedToCoach ? (data?.delegates || []).filter((d) => d.coachId === myCoach.id) : (data?.delegates || []);
  const stats = {
    present: statDelegates.filter((d) => d.status === "PRESENT" || d.status === "ARRIVED").length,
    late: statDelegates.filter((d) => d.status === "LATE").length,
    missing: statDelegates.filter((d) => d.status === "MISSING").length,
    unassigned: scopedToCoach ? 0 : (data?.delegates || []).filter((d) => !(d.coachId && coachIds.has(d.coachId))).length,
    coaches: scopedToCoach ? 1 : (data?.coaches || []).length,
    total: statDelegates.length,
  };
  const opsKpi = (n, label, tone) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "10px 12px", borderRadius: 12, background: "var(--surface)", border: "1px solid var(--line)", borderTop: `3px solid var(--st-${tone}, var(--ink))` }}>
      <span style={{ fontSize: 22, fontWeight: 800, lineHeight: 1, color: `var(--st-${tone}, var(--ink))` }}>{n}</span>
      <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--ink-3)" }}>{label}</span>
    </div>
  );

  // m-fade-in to match the rest of the mobile UI (2026-07-29).
  return (
    <div className="m-fade-in">
      {onBack && (
        <button className="btn btn-ghost" onClick={onBack} style={{ padding: "6px 10px", marginBottom: 10 }}>
          <ArrowLeft size={15} /> {t("Trips")}
        </button>
      )}

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

          {/* Command-centre KPIs (live) */}
          {mode === "live" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginTop: 14 }}>
              {opsKpi(`${stats.present}/${stats.total}`, t("Checked in"), "present")}
              {opsKpi(stats.late, t("Late"), "late")}
              {opsKpi(stats.missing, t("Missing"), "missing")}
              {opsKpi(stats.unassigned, t("Unassigned"), "late")}
            </div>
          )}

          {/* Itinerary */}
          <div className="mobile-card" style={{ marginTop: 14, border: "1px solid var(--line)", background: "var(--surface)" }}>
            <div className="muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 8 }}>
              {mode === "live" ? `${t("Today's itinerary")} · ${t("Day")} ${currentDay}` : mode === "planning" ? t("Trip plan") : t("Itinerary recap")}
            </div>
            {shownStops.length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>{t("No activities")}</div>
            ) : (
              <>
                <div className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>{t("Tap a stop to take attendance")}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {shownStops.map((s) => {
                    const st = s.status && s.status !== "scheduled" ? s.status : null;
                    const struck = s.completed || s.status === "cancelled";
                    return (
                      <button key={s.id} type="button" onClick={() => setAttItem(s)}
                        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 13, opacity: s.completed ? 0.6 : 1,
                          width: "100%", textAlign: "left", background: "transparent", border: "none", borderRadius: 8, padding: "7px 6px", cursor: "pointer", color: "inherit", font: "inherit" }}>
                        <span className="row" style={{ gap: 8, minWidth: 0 }}>
                          <span className="mono" style={{ fontWeight: 700, flexShrink: 0 }}>{fmt12h(s.startTime)}</span>
                          <span style={{ textDecoration: struck ? "line-through" : "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {mode !== "live" ? `D${s.dayNumber} · ` : ""}{s.title}
                          </span>
                        </span>
                        <span className="row" style={{ gap: 8, flexShrink: 0 }}>
                          {st && <StatusBadge tone={ITIN_TONE[st]}>{t(ITIN_LABEL[st])}{st === "delayed" && s.delayMinutes ? ` +${fmtDelay(s.delayMinutes)}` : ""}</StatusBadge>}
                          <ClipboardList size={15} color="var(--ink-3)" />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Coach assignments */}
          <div style={{ margin: "18px 0 8px" }}>
            <div className="muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>
              {mode === "completed" ? t("Final coach assignments") : t("Coach assignments")}
            </div>
            {editable && <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{t("Tap a delegate to move or edit")}</div>}
          </div>
          {scopedToCoach && (
            <div className="mobile-card" role="status" style={{ margin: "0 0 10px", border: "1px solid var(--st-present)", background: "var(--st-present-bg)", color: "var(--st-present)", fontSize: 12.5 }}>
              {t("You're the captain of")} <strong>{myCoach.label}</strong>. {t("Other coaches are hidden.")} ({shownCoaches.length}/{(data?.coaches || []).length})
            </div>
          )}
          {!scopedToCoach && wrongCoachIds.size > 0 && (
            <div className="mobile-card" role="alert" style={{ margin: "0 0 10px", border: "1px solid var(--st-missing)", background: "var(--st-missing-bg)", color: "var(--st-missing)", fontSize: 12.5, display: "flex", gap: 8, alignItems: "center" }}>
              <AlertCircle size={15} style={{ flexShrink: 0 }} />
              <span><strong>{wrongCoachIds.size}</strong> {t("under Unassigned are on a coach not on this trip — tap to reassign.")}</span>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {shownCoaches.map((c) => {
              const list = byCoach[c.id] || [];
              const missing = list.filter((d) => d.status === "MISSING").length;
              const boarded = c.boarded ?? 0;
              const total = c.total ?? list.length;
              const notIn = Math.max(0, total - boarded);
              const cap = c.capacity || 0;
              const ratio = cap ? Math.min(1, total / cap) : 0;
              const capColor = cap && (total > cap || ratio >= 1) ? "missing" : cap && ratio >= 0.85 ? "late" : "present";
              const accent = mode === "planning" ? "var(--line)" : missing > 0 ? "var(--st-missing)" : (total > 0 && boarded >= total) ? "var(--st-present)" : "var(--st-late)";
              return (
                <div key={c.id} className="mobile-card" style={{ border: "1px solid var(--line)", borderLeft: `3px solid ${accent}`, background: "var(--surface)" }}>
                  <div className="row between" style={{ alignItems: "flex-start", gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="row" style={{ gap: 6, fontWeight: 800, fontSize: 15 }}><Bus size={14} color="var(--ink-3)" /> {c.label}</div>
                      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                        {mode === "planning"
                          ? `${total} ${t("delegates")}${cap ? ` · ${cap} ${t("seats")}` : ""}`
                          : `${boarded}/${total} ${t("boarded")}`}
                      </div>
                      {(c.captainName || c.captainUsername) && (
                        <div className="row muted" style={{ gap: 5, fontSize: 12, marginTop: 4, fontWeight: 600 }}><Users size={11} /> {t("Captain")}: {c.captainName || c.captainUsername}</div>
                      )}
                    </div>
                    <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                      {mode === "live" && c.arrivalStatus && (
                        <span className="badge" style={{ ...ARRIVAL_STYLE[c.arrivalStatus], display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <Bus size={11} /> {t(ARRIVAL_SHORT[c.arrivalStatus])}
                        </span>
                      )}
                      {mode !== "planning" && (missing > 0
                        ? <StatusBadge tone="missing">{missing} {t("missing")}</StatusBadge>
                        : notIn > 0 ? <StatusBadge tone="late">{notIn} {t("not in")}</StatusBadge>
                        : <StatusBadge tone="present">{t("All in")}</StatusBadge>)}
                    </div>
                  </div>
                  {cap > 0 && (
                    <div className="row" style={{ gap: 8, marginTop: 10, alignItems: "center" }}>
                      <div style={{ flex: 1, height: 8, borderRadius: 999, background: "var(--line)", overflow: "hidden" }}>
                        <span style={{ display: "block", height: "100%", width: `${Math.round(ratio * 100)}%`, background: `var(--st-${capColor})`, borderRadius: 999 }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 800, color: `var(--st-${capColor})`, flexShrink: 0 }}>{total}/{cap} {t("seats")}</span>
                    </div>
                  )}
                  {list.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                      {list.map((d) => <DelegateChip key={d.id} d={d} onSelect={setSelectedDelegate} />)}
                    </div>
                  )}
                  {list.length === 0 && <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{t("Empty")}</div>}
                </div>
              );
            })}

            {!scopedToCoach && (byCoach["__un__"] || []).length > 0 && (
              <div className="mobile-card" style={{ border: "1px dashed var(--st-late)", background: "var(--st-late-bg)" }}>
                <div className="row between">
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{t("Unassigned")}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{t("Needs a coach")}</div>
                  </div>
                  <StatusBadge tone="late">{byCoach["__un__"].length}</StatusBadge>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                  {byCoach["__un__"].map((d) => <DelegateChip key={d.id} d={d} onSelect={setSelectedDelegate} wrongCoach={wrongCoachIds.has(d.id)} />)}
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
      {attItem && (
        <MobileAttendanceSheet
          tripId={tripId}
          item={attItem}
          scopedCoachId={scopedToCoach ? myCoach.id : null}
          canEdit={editable}
          onClose={() => setAttItem(null)}
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
  const [captainTripIds, setCaptainTripIds] = useState(null); // Set of trip ids this account captains
  // "Load more" paging (2026-07-30 — "same for exception, trip tab") — see
  // the identical pattern in MobileAttendancePage.jsx.
  const TRIPS_PAGE_SIZE = 20;
  const [shownTripCount, setShownTripCount] = useState(TRIPS_PAGE_SIZE);
  const me = getUser() || {};

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
  // Which trips does this account captain? (empty for admins/coordinators)
  useEffect(() => {
    apiGet("/my-captain-coaches")
      .then((r) => setCaptainTripIds(new Set((r.coaches || []).map((c) => c.tripId))))
      .catch(() => setCaptainTripIds(new Set()));
  }, []);

  // A non-admin who captains a coach sees ONLY the trip(s) they're assigned to.
  const isCaptain = me.role !== "admin" && !!captainTripIds && captainTripIds.size > 0;
  const visibleTrips = isCaptain
    ? (trips || []).filter((trip) => captainTripIds.has(trip.id))
    : (canSeeAllTrips ? trips : (trips || []).filter((trip) => trip.status === "In progress"));

  // A captain with exactly one trip skips the list — the Trips tab opens their
  // board directly (the list would just be one card that says what's already
  // shown above). No back button in that case (nothing to go back to).
  const soloTripId = isCaptain && visibleTrips.length === 1 ? visibleTrips[0].id : null;
  useEffect(() => { if (soloTripId && selected == null) setSelected(soloTripId); }, [soloTripId, selected]);

  if (selected) return <TripDetail tripId={selected} onBack={soloTripId ? null : () => { setSelected(null); load(); }} />;

  // Don't flash the full trip list before we know whether this is a captain.
  if (trips && me.role !== "admin" && captainTripIds === null) {
    return <div className="muted">{t("Loading…")}</div>;
  }

  // Styling brought over from Vimal's version (2026-07-29) — the m-* design
  // classes, so this page matches the rest of the mobile UI. Only presentation
  // was taken: his copy predates the per-itinerary-stop attendance marking and
  // the wrong-coach warning below, so taking it wholesale would delete both.
  return (
    <div className="m-fade-in">
      <div className="m-eyebrow">{t("Trip management")}</div>
      <h1 className="m-page-title" style={{ marginBottom: 12 }}>{t("Trips")}</h1>

      {error && <div className="mobile-card" style={{ color: "var(--st-missing)", borderColor: "var(--st-missing)" }}>{t("Couldn't reach the backend")} — {error}</div>}
      {!trips && !error && <div className="muted">{t("Loading…")}</div>}
      {trips && visibleTrips.length === 0 && <div className="muted">{t(canSeeAllTrips ? "No trips yet" : "No trip currently in progress")}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {(visibleTrips || []).slice(0, shownTripCount).map((trip) => (
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

      {(visibleTrips || []).length > shownTripCount && (
        <button
          className="btn btn-ghost btn-block"
          style={{ marginTop: 10 }}
          onClick={() => setShownTripCount((n) => n + TRIPS_PAGE_SIZE)}
        >
          {t("Load more")} ({visibleTrips.length - shownTripCount} {t("more")})
        </button>
      )}
    </div>
  );
}
