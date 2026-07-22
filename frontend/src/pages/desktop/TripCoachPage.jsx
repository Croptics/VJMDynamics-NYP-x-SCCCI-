// frontend/src/pages/TripCoachPage.jsx
// Owner: Desmond — "TransitFlow" — Trip Booking & Dynamic Coach Management
//
// v4 — RESET TO REFERENCE. A concrete "Screen 3 — Trip Management and Coach
// Assignment" mockup is now the actual target for this page, replacing the
// "premium dashboard" direction v2/v3 took. Per that reference:
//   - Hero is a plain white card: title + status pill + two buttons on one
//     row, one grey subtitle line below (date · coaches · delegates · lead).
//     No LIVE badge, no live clock, no trip progress bar, no KPI cards, no
//     "missing" attention pill — none of that appears in the reference.
//   - Today's itinerary is a plain arrow-chain of stop boxes (time + title),
//     the current stop just gets a red border + "NOW" — no route line, no
//     animated bus marker, no click-to-expand panel (location/notes for a
//     stop are still visible and editable in the Edit itinerary modal, just
//     not duplicated here).
//   - Fleet ("Coach assignments") cards are plain bordered columns: coach
//     name, "X/Y boarded" (replaced by a "Dropping here…" label while
//     something's hovering over the column), and a green "All in" / red
//     "N missing" badge. No progress bar, no driver/guide/ETA rows on the
//     card face (still editable via the existing "Switch staff" modal).
//     Long delegate lists are truncated with a "+N more" expand, matching
//     the reference's "+29 more" / "+37 more".
//   - Delegate cards are trimmed to avatar + name + drag handle (on the
//     right, matching the reference) with a status-driven avatar colour
//     (green = Present, red = Missing, yellow = Unassigned). Company/
//     accessibility/notes text still exists but only surfaces via the
//     hover/focus tooltip already built in v3 — kept because it's invisible
//     at rest, so it doesn't change the resting look the reference shows.
//   - Dark mode and the live activity feed panel are removed from this page
//     entirely (per explicit instruction / because there's no room for a
//     side panel in the reference's full-width 4-column layout). The
//     backend still logs activity (see desmond.js) in case a future screen
//     wants to show it — only the frontend polling/rendering was dropped.
//   - The search/filter/sort toolbar above the fleet grid is removed too —
//     not present in the reference; delegates within each column are just
//     sorted by name.
//
// PORTED INTO THE INTEGRATION BRANCH (this copy, from a standalone build
// that never went through the JQ-branch integration pass):
//   - Permission gating re-added. The integration pass put Trips editing
//     behind permissions.js's "manageTrips" ("view for all, edit gated" —
//     see INTEGRATION_NOTES.md) after this v4 rewrite was written elsewhere,
//     so it never had a canEdit concept at all. canEdit hides/disables every
//     mutating control (hero actions, add/remove coach, remove delegate,
//     switch staff, the detail panel's move/save/remove controls, the
//     mobile FAB) exactly like the pre-port file did — everyone can still
//     view the board.
//   - Reassignment polish on top of the plain port (still flat/boxy, no new
//     gradients or shadows): drop-target feedback is blue (info) instead of
//     red (this file's own color system reserves red for "critical", which
//     a plain valid drop zone isn't), and a coach already at/over capacity
//     flags itself in red — "Full" — while something is dragged over it, a
//     real signal for the reassignment decision instead of just decoration.
//     A focused delegate card also opens its detail panel on Enter/Space,
//     not just on tap/click — keyboard parity with the pointer-drag path.
//
// Still true from v1: only this file + TripsListPage.jsx + TripCoachPage.css
// are touched (no teammate files); App.jsx only ever routes a bare "/trips"
// here, so ?tripId= (not a route param) decides list-vs-board; drag uses
// plain Pointer Events (no @dnd-kit); reassigning out of Unassigned sets
// MISSING not PRESENT; a tap on a delegate card still opens the full detail
// panel (with "Move to coach" as the touch-friendly, no-drag alternative,
// now also with a "Remove delegate" action so removal doesn't only live on
// the card's small inline × button).
//
// API paths: unchanged (see backend/routes/desmond.js's header for the full
// route-collision-avoidance rationale).

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  PencilLine, UserPlus, Loader2, AlertCircle, GripVertical, CheckCircle2,
  Star, X, Plus, Trash2, Edit2, Bus, Users, MessageSquare, MapPin,
  Building2, Landmark, UtensilsCrossed, Factory, Plane, Accessibility, Navigation, Settings, Clock, Circle,
} from "lucide-react";
import { apiGet, apiPost, apiPatch, apiDelete, getPermissions } from "../../lib/api.js";
import { useLang } from "../../lib/i18n.jsx";
import TripsListPage from "./TripsListPage.jsx";
import "./TripCoachPage.css";

const UNASSIGNED_COL = "__unassigned__";
const DRAG_THRESHOLD = 8; // px — below this a pointer-up is a tap, not a drag
const VISIBLE_LIMIT = 6; // delegate cards shown per column before "+N more"

const TRIP_STATUS_COLOR = { "In progress": "green", Planning: "blue", Completed: "grey", Cancelled: "red" };
// 5-status delegate model (integration-wide, see INTEGRATION_NOTES.md):
// UNASSIGNED → ASSIGNED → ARRIVED → LATE → MISSING. PRESENT is a legacy alias
// for ARRIVED (some check-in routes still write it), so it maps to the same
// green. UNASSIGNED is muted grey (2026-07-19, was yellow).
const STATUS_AVATAR = { PRESENT: "green", ARRIVED: "green", ASSIGNED: "blue", LATE: "orange", MISSING: "red", UNASSIGNED: "grey" };

// Live itinerary-stop status (see desmond.js). "scheduled" is the on-time
// default and renders no tag; the other three surface a coloured tag on the
// stop box + feed the schedule summary.
const ITIN_STATUS_META = {
  delayed:   { label: "Delayed",   color: "orange" },
  moved:     { label: "Moved",     color: "blue" },
  cancelled: { label: "Cancelled", color: "red" },
};
// Coach bus-arrival status — the badge cycles through these in order.
const COACH_ARRIVAL_META = {
  not_arrived: { label: "Bus not arrived", short: "Not arrived", color: "grey" },
  en_route:    { label: "Bus on route",    short: "On route",    color: "orange" },
  arrived:     { label: "Bus arrived",     short: "Arrived",     color: "green" },
};
const ARRIVAL_CYCLE = { not_arrived: "en_route", en_route: "arrived", arrived: "not_arrived" };

const CATEGORY_META = {
  hotel:      { icon: Building2,      label: "Hotel" },
  attraction: { icon: Landmark,       label: "Attraction" },
  meal:       { icon: UtensilsCrossed, label: "Meal" },
  factory:    { icon: Factory,        label: "Factory visit" },
  airport:    { icon: Plane,          label: "Airport" },
  transport:  { icon: Bus,            label: "Transport" },
  other:      { icon: MapPin,         label: "Stop" },
};

/* ---- Helpers ---------------------------------------------------------------- */
function initials(name) {
  return (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}
function toMinutes(hhmm) {
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
// Format a minutes count as "1h 20m" / "45m" / "2h".
function fmtDuration(mins) {
  const total = Math.max(0, Math.round(Number(mins) || 0));
  const h = Math.floor(total / 60), m = total % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}
// Shift an "HH:MM" time by ±deltaMin minutes, wrapping within the day.
function shiftTime(hhmm, deltaMin) {
  const [h, m] = String(hhmm || "0:0").split(":").map(Number);
  let total = (h || 0) * 60 + (m || 0) + deltaMin;
  total = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/* =============================================================================
 *  Toasts
 * ========================================================================== */
function ToastStack({ toasts, onDismiss }) {
  return (
    <div className="tf-toast-stack">
      {toasts.map((tst) => (
        <div key={tst.id} className="tf-toast">
          <span className="tf-toast-icon" style={{ color: `var(--tf-${tst.kind === "error" ? "red" : tst.kind === "warn" ? "yellow" : "green"})` }}>
            {tst.kind === "error" ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
          </span>
          <span className="tf-toast-msg">{tst.message}</span>
          <button className="tf-toast-close" onClick={() => onDismiss(tst.id)}><X size={13} /></button>
        </div>
      ))}
    </div>
  );
}

/* =============================================================================
 *  Confirm dialog (replaces window.confirm everywhere in this feature)
 * ========================================================================== */
function ConfirmDialog({ title, message, tone, onCancel, onConfirm }) {
  const { t } = useLang();
  return (
    <div className="tf-modal-overlay" onClick={onCancel}>
      <div className="tf-modal-card" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
        <div className="tf-modal-header"><h3 style={{ fontSize: 16, fontWeight: 800 }}>{title}</h3></div>
        <div className="tf-modal-body"><p style={{ fontSize: 13.5, color: "var(--tf-text-2)" }}>{message}</p></div>
        <div className="tf-modal-footer">
          <button className="tf-btn tf-btn-ghost" onClick={onCancel}>{t("Cancel")}</button>
          <button
            className="tf-btn tf-btn-primary"
            style={tone === "danger" ? { background: "var(--tf-red)", color: "#fff" } : undefined}
            onClick={onConfirm}
          >
            {t("Confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---- Modal shell ------------------------------------------------------------ */
function Modal({ title, onClose, maxWidth = 480, children, footer }) {
  const { t } = useLang();
  return (
    <div className="tf-modal-overlay" onClick={onClose}>
      <div className="tf-modal-card" style={{ maxWidth }} onClick={(e) => e.stopPropagation()}>
        <div className="tf-modal-header">
          <h3 style={{ fontSize: 17, fontWeight: 800 }}>{title}</h3>
          <button className="tf-btn tf-btn-ghost tf-btn-icon-only" onClick={onClose} title={t("Close")}><X size={18} /></button>
        </div>
        <div className="tf-modal-body">{children}</div>
        {footer && <div className="tf-modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

/* ---- Skeletons --------------------------------------------------------------- */
function SkeletonBoard() {
  return (
    <div>
      <div className="tf-skeleton" style={{ height: 96, borderRadius: 16, marginBottom: 20 }} />
      <div className="tf-skeleton" style={{ height: 88, borderRadius: 16, marginBottom: 20 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
        {[0, 1, 2, 3].map((i) => <div key={i} className="tf-skeleton" style={{ height: 180, borderRadius: 14 }} />)}
      </div>
    </div>
  );
}

/* ---- DelegateCard ------------------------------------------------------------
 * Trimmed to exactly what the reference shows: avatar + name + drag handle
 * on the right. The WHOLE card is the drag target for mouse/pen
 * (onPointerDown lives on the outer div); every pointer type can also tap to
 * open the full detail panel, and a focused card opens it on Enter/Space too
 * (keyboard parity with the pointer-drag path — there's no equivalent drag
 * gesture for keyboard users, so opening the panel is the way in). Company/
 * accessibility/notes still surface via a hover/focus tooltip — invisible at
 * rest, so it doesn't change the look.
 * ---------------------------------------------------------------------------- */
function DelegateCard({ delegate, ghost = false, dragging = false, onPointerDownCard, onKeyOpen, onRemove }) {
  const { t } = useLang();
  const isMissing = delegate.status === "MISSING";
  const colorKey = STATUS_AVATAR[delegate.status] || "grey";
  const hasExtra = !ghost && !!(delegate.company || delegate.accessibilityNotes || delegate.notes);

  return (
    <div
      onPointerDown={ghost ? undefined : (e) => onPointerDownCard(e, delegate)}
      onKeyDown={ghost ? undefined : (e) => { if ((e.key === "Enter" || e.key === " ") && onKeyOpen) { e.preventDefault(); onKeyOpen(delegate); } }}
      tabIndex={ghost ? undefined : 0}
      className={`tf-delegate-card${dragging && !ghost ? " is-dragging" : ""}${isMissing ? " is-missing" : ""}${delegate.vip ? " is-vip" : ""}`}
    >
      <div className="tf-avatar" style={{ background: `var(--tf-${colorKey}-bg)`, color: `var(--tf-${colorKey})` }}>
        {initials(delegate.name)}
      </div>
      <div className="tf-delegate-name">
        {delegate.name}
        {!!delegate.vip && <Star size={10} fill="var(--tf-purple)" color="var(--tf-purple)" />}
        {!!delegate.accessibilityNotes && <Accessibility size={10} color="var(--tf-blue)" />}
      </div>
      {!ghost && onRemove && (
        <button
          className="tf-toast-close"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onRemove(delegate.id, delegate.name); }}
          title={t("Remove delegate")}
        >
          <X size={11} />
        </button>
      )}
      <GripVertical size={13} className="tf-drag-handle" />
      {hasExtra && (
        <div className="tf-delegate-tooltip">
          {delegate.company && <div><strong>{t("Company")}: </strong>{delegate.company}</div>}
          {delegate.accessibilityNotes && <div><strong>{t("Accessibility notes")}: </strong>{delegate.accessibilityNotes}</div>}
          {delegate.notes && <div><strong>{t("Notes")}: </strong>{delegate.notes}</div>}
        </div>
      )}
    </div>
  );
}

/* ---- FleetCard (one coach column in "Coach assignments") ---------------------
 * Plain bordered column: name, boarded count (or "Dropping here…" while a
 * drag is hovering — recolored red with a "Full" note when the coach is
 * already at/over capacity, so a drop that would overfill it is flagged
 * before it happens instead of after), a green "All in" / red "N missing"
 * badge, delegate cards, and a "+N more" expand when there are more than
 * VISIBLE_LIMIT.
 * ---------------------------------------------------------------------------- */
function FleetCard({ coach, delegates, isUnassigned = false, isOver, colRef, onPointerDownCard, onKeyOpen, draggingId, onRemoveCoach, onRemoveDelegate, onEditStaff, onCycleArrival, mode = "live" }) {
  const { t } = useLang();
  const [expanded, setExpanded] = useState(false);
  const missing = delegates.filter((d) => d.status === "MISSING").length;
  const showBoarding = mode !== "planning"; // "boarded"/missing/all-in are attendance facts — meaningless before the trip runs
  const visible = expanded ? delegates : delegates.slice(0, VISIBLE_LIMIT);
  const remaining = delegates.length - visible.length;
  const isFull = !isUnassigned && coach.capacity > 0 && (coach.total ?? 0) >= coach.capacity;

  return (
    <div ref={colRef} className={`tf-fleet-card${isOver ? " is-drop-target" : ""}${isOver && isFull ? " is-full" : ""}${isUnassigned ? " is-unassigned" : ""}`}>
      <div className="tf-fleet-head">
        <div style={{ minWidth: 0 }}>
          {!isUnassigned && onEditStaff ? (
            <button
              className="tf-fleet-label"
              onClick={() => onEditStaff(coach)}
              style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer" }}
              title={t("Switch staff")}
            >
              {coach.label}
            </button>
          ) : (
            <span className="tf-fleet-label">{coach.label}</span>
          )}
          {isUnassigned ? (
            <div className="tf-fleet-sub">{t("Needs a coach")}</div>
          ) : isOver ? (
            <div className={`tf-fleet-drop-label${isFull ? " is-full" : ""}`}>{isFull ? t("Dropping here… (full)") : t("Dropping here…")}</div>
          ) : showBoarding ? (
            <div className="tf-fleet-sub">{coach.boarded ?? 0}/{coach.total ?? 0} {t("boarded")}</div>
          ) : (
            <div className="tf-fleet-sub">{coach.total ?? 0} {t(coach.total === 1 ? "delegate" : "delegates")}{coach.capacity ? ` · ${coach.capacity} ${t("seats")}` : ""}</div>
          )}
          {!isUnassigned && mode === "live" && (() => {
            const av = COACH_ARRIVAL_META[coach.arrivalStatus] || COACH_ARRIVAL_META.not_arrived;
            const style = { color: `var(--tf-${av.color})`, background: `var(--tf-${av.color}-bg)` };
            return onCycleArrival ? (
              <button type="button" className="tf-arrival-badge is-clickable" style={style} title={t("Tap to update bus arrival")} onClick={() => onCycleArrival(coach)}>
                <Bus size={11} /> {t(av.short)}
              </button>
            ) : (
              <span className="tf-arrival-badge" style={style}><Bus size={11} /> {t(av.short)}</span>
            );
          })()}
        </div>
        <div className="tf-flex tf-gap-6" style={{ alignItems: "center", flexShrink: 0 }}>
          {isUnassigned ? (
            <span className="tf-badge-count" style={{ background: "var(--tf-yellow-line)", color: "var(--tf-yellow)" }}>{delegates.length}</span>
          ) : !showBoarding ? (
            <span className="tf-badge-count" style={{ background: "var(--tf-grey-bg)", color: "var(--tf-grey)" }}>{delegates.length}</span>
          ) : missing > 0 ? (
            <span className="tf-badge-pill" style={{ background: "var(--tf-red-bg)", color: "var(--tf-red)" }}>{missing} {t("missing")}</span>
          ) : (
            <span className="tf-badge-pill" style={{ background: "var(--tf-green-bg)", color: "var(--tf-green)" }}>{t("All in")}</span>
          )}
          {!isUnassigned && onRemoveCoach && (
            <button className="tf-toast-close" onClick={() => onRemoveCoach(coach.id, coach.label)} title={`${t("Remove")} ${coach.label}`}><X size={13} /></button>
          )}
        </div>
      </div>

      <div className="tf-fleet-body">
        {visible.map((d) => (
          <DelegateCard key={d.id} delegate={d} dragging={draggingId === d.id} onPointerDownCard={onPointerDownCard} onKeyOpen={onKeyOpen} onRemove={onRemoveDelegate} />
        ))}
        {isOver && (
          <div style={{ border: `2px dashed var(--tf-${isFull ? "red" : "blue"})`, borderRadius: 10, padding: "12px 8px", textAlign: "center", color: `var(--tf-${isFull ? "red" : "blue"})`, fontSize: 12, fontWeight: 700 }}>
            {isFull ? t("Coach is full") : t("Drop here")}
          </div>
        )}
        {delegates.length === 0 && !isOver && <div className="tf-fleet-empty">{t("Empty")}</div>}
        {remaining > 0 && <button className="tf-fleet-more" onClick={() => setExpanded(true)}>+{remaining} {t("more")}</button>}
      </div>
    </div>
  );
}

/* ---- DelegateDetailPanel — slide-out on tap, with a reassignment control ----- */
function DelegateDetailPanel({ delegate, coaches, onClose, onSave, onReassign, onRemove, canEdit = true }) {
  const { t } = useLang();
  const [visible, setVisible] = useState(false);
  const [form, setForm] = useState({
    notes: delegate.notes || "", company: delegate.company || "", accessibilityNotes: delegate.accessibilityNotes || "",
  });
  const [moveTo, setMoveTo] = useState(delegate.coachId || "");
  const [saving, setSaving] = useState(false);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  async function handleSave() {
    setSaving(true);
    try { await onSave(delegate.id, form); }
    finally { setSaving(false); }
  }

  async function handleMove() {
    setMoving(true);
    try { await onReassign(delegate, moveTo || null); }
    finally { setMoving(false); }
  }

  // 5-status labels (PRESENT is the legacy alias for ARRIVED). Chip colour
  // reuses STATUS_AVATAR since the two maps are identical value-for-value.
  const STATUS_LABEL = { PRESENT: "Arrived", ARRIVED: "Arrived", ASSIGNED: "Assigned", LATE: "Late", MISSING: "Missing", UNASSIGNED: "Unassigned" };
  const colorKey = STATUS_AVATAR[delegate.status] || "grey";

  return (
    <>
      <div className="tf-panel-overlay" onClick={onClose} />
      <div className="tf-panel" style={{ transform: visible ? "translateX(0)" : "translateX(100%)" }}>
        <div className="tf-between" style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 18, fontWeight: 800 }}>{t("Delegate details")}</h3>
          <button className="tf-btn tf-btn-ghost tf-btn-icon-only" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="tf-flex tf-gap-12" style={{ marginBottom: 18 }}>
          <div className="tf-avatar" style={{ width: 42, height: 42, fontSize: 14, background: `var(--tf-${colorKey}-bg)`, color: `var(--tf-${colorKey})` }}>
            {initials(delegate.name)}
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>
              {delegate.name}
              {!!delegate.vip && <Star size={14} fill="var(--tf-purple)" color="var(--tf-purple)" style={{ marginLeft: 6, verticalAlign: "middle" }} />}
            </div>
            <span className="tf-badge-pill" style={{ marginTop: 4, color: `var(--tf-${colorKey})`, background: `var(--tf-${colorKey}-bg)` }}>
              {t(STATUS_LABEL[delegate.status] || delegate.status)}
            </span>
          </div>
        </div>

        {canEdit && (
        <div className="tf-card" style={{ padding: 14, marginBottom: 16 }}>
          <label className="tf-field-label">{t("Move to coach")}</label>
          <div className="tf-flex tf-gap-8">
            <select className="tf-input" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} style={{ flex: 1 }}>
              <option value="">{t("Unassigned")}</option>
              {coaches.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <button className="tf-btn tf-btn-primary tf-btn-sm" onClick={handleMove} disabled={moving || moveTo === (delegate.coachId || "")}>
              {moving ? <Loader2 size={13} className="spin" /> : t("Move")}
            </button>
          </div>
          <p className="tf-muted" style={{ fontSize: 11, marginTop: 6 }}>{t("Works from any device — the alternative to dragging on touchscreens.")}</p>
        </div>
        )}

        <label className="tf-field-label">{t("Company")}</label>
        <input className="tf-input" readOnly={!canEdit} style={{ marginBottom: 14 }} value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} placeholder={t("Optional")} />

        <label className="tf-field-label tf-flex tf-gap-6" style={{ alignItems: "center" }}><Accessibility size={13} /> {t("Accessibility notes")}</label>
        <input className="tf-input" readOnly={!canEdit} style={{ marginBottom: 14 }} value={form.accessibilityNotes} onChange={(e) => setForm((f) => ({ ...f, accessibilityNotes: e.target.value }))} placeholder={t("e.g. wheelchair access, dietary needs")} />

        <label className="tf-field-label tf-flex tf-gap-6" style={{ alignItems: "center" }}><MessageSquare size={13} /> {t("Notes")}</label>
        <textarea className="tf-input" readOnly={!canEdit} rows={5} style={{ resize: "vertical", fontFamily: "inherit" }} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder={t("Dietary needs, medical notes, flight details…")} />

        {canEdit && (
        <button className="tf-btn tf-btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 14 }} onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 size={14} className="spin" /> : null} {t("Save changes")}
        </button>
        )}

        {canEdit && onRemove && (
          <button
            className="tf-btn tf-btn-ghost"
            style={{ width: "100%", justifyContent: "center", marginTop: 10, color: "var(--tf-red)" }}
            onClick={onRemove}
          >
            <Trash2 size={13} /> {t("Remove delegate")}
          </button>
        )}
      </div>
    </>
  );
}

/* =============================================================================
 *  JourneyTimeline — today's itinerary as a plain arrow-chain of stop boxes.
 *  No route line, no animated bus, no click-to-expand — matches the
 *  reference exactly. The current stop still gets a red border + "NOW";
 *  that classification is worked out locally from the trip's actual clock.
 * ========================================================================== */
function JourneyTimeline({ items, dayNumber, totalDays, onAddClick, canEdit = false, onSetStatus, onToggleComplete, onMoveStop }) {
  const { t } = useLang();
  const [nowMinutes, setNowMinutes] = useState(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); });
  const [openId, setOpenId] = useState(null);       // stop whose live-status editor is open
  const [editMode, setEditMode] = useState(null);   // null | "delayed" | "moved" — reveals a sub-panel
  const [durH, setDurH] = useState(0);              // hours part of a delay / move amount
  const [durM, setDurM] = useState(15);             // minutes part of a delay / move amount
  const [moveDay, setMoveDay] = useState(dayNumber + 1);

  useEffect(() => {
    const iv = setInterval(() => { const d = new Date(); setNowMinutes(d.getHours() * 60 + d.getMinutes()); }, 30000);
    return () => clearInterval(iv);
  }, []);
  // Collapse the delay/move sub-panel whenever a different stop is opened.
  useEffect(() => { setEditMode(null); }, [openId]);

  // Index of the stop happening "now" = the last one whose scheduled time has
  // passed. -1 means the day hasn't reached its first stop yet.
  const segIndex = useMemo(() => {
    let idx = -1;
    const times = items.map((i) => toMinutes(i.startTime));
    for (let i = 0; i < times.length; i++) if (times[i] <= nowMinutes) idx = i;
    return idx;
  }, [items, nowMinutes]);

  const dayLabel = `${t("Day")} ${dayNumber}${totalDays ? ` ${t("of")} ${totalDays}` : ""}`;

  if (items.length === 0) {
    return (
      <div>
        <div className="tf-schedule"><span className="tf-schedule-day">{dayLabel}</span></div>
        <p style={{ fontSize: 13, color: "var(--tf-text-3)", marginTop: 10 }}>
          {t("No activities for Day")} {dayNumber}.{onAddClick && " "}
          {onAddClick && (
            <button style={{ background: "none", border: "none", color: "var(--tf-blue)", cursor: "pointer", fontSize: 13, padding: 0, fontWeight: 700 }} onClick={onAddClick}>
              {t("Add one →")}
            </button>
          )}
        </p>
      </div>
    );
  }

  const currentStop = segIndex >= 0 ? items[segIndex] : null;
  const nextStop = items.slice(segIndex + 1).find((i) => i.status !== "cancelled") || null;
  // Largest delay among stops up to and including "now" — the amount the day is
  // currently running behind by.
  let activeDelay = 0;
  for (let i = 0; i <= segIndex && i < items.length; i++) {
    if (items[i].status === "delayed") activeDelay = Math.max(activeDelay, Number(items[i].delayMinutes) || 0);
  }
  const currentCancelled = currentStop && currentStop.status === "cancelled";
  const doneCount = items.filter((i) => i.completed).length;
  // When today's stops are exhausted, "Next" points to the following day, or —
  // on the final day — to unstructured "Free & easy" time, not a blank "End of day".
  const nextLabel = nextStop
    ? `${nextStop.title} · ${nextStop.startTime}`
    : (dayNumber < totalDays ? `${t("Day")} ${dayNumber + 1}` : t("Free & easy"));

  function applyStatus(item, status, delayMinutes) {
    setOpenId(null);
    if (onSetStatus) onSetStatus(item.id, status, delayMinutes);
  }
  function doMove(item, changes) {
    setOpenId(null);
    if (onMoveStop) onMoveStop(item, changes);
  }
  const amountMins = () => (Number(durH) || 0) * 60 + (Number(durM) || 0);

  const editItem = openId ? items.find((i) => i.id === openId) : null;

  return (
    <div>
      {/* Schedule summary: which day, where we are now / next, and whether the
          day is on schedule, running late (by how long), or has a cancelled stop. */}
      <div className="tf-schedule">
        <span className="tf-schedule-day">{dayLabel}</span>
        {doneCount > 0 && <><span className="tf-schedule-sep">·</span><span className="tf-schedule-part">{doneCount}/{items.length} {t("done")}</span></>}
        <span className="tf-schedule-sep">·</span>
        <span className="tf-schedule-part"><strong>{t("Now")}:</strong> {currentStop ? `${currentStop.title} · ${currentStop.startTime}` : t("Not started")}</span>
        <span className="tf-schedule-sep">·</span>
        <span className="tf-schedule-part"><strong>{t("Next")}:</strong> {nextLabel}</span>
        <span className="tf-schedule-spacer" />
        {currentCancelled ? (
          <span className="tf-schedule-pill" style={{ color: "var(--tf-red)", background: "var(--tf-red-bg)" }}><AlertCircle size={12} /> {t("Current stop cancelled")}</span>
        ) : activeDelay > 0 ? (
          <span className="tf-schedule-pill" style={{ color: "var(--tf-orange)", background: "var(--tf-orange-bg)" }}><Clock size={12} /> {t("Running")} {fmtDuration(activeDelay)} {t("late")}</span>
        ) : (
          <span className="tf-schedule-pill" style={{ color: "var(--tf-green)", background: "var(--tf-green-bg)" }}><CheckCircle2 size={12} /> {t("On schedule")}</span>
        )}
      </div>

      <div className="tf-stop-chain">
        {items.flatMap((item, idx) => {
          const completed = !!item.completed;
          const isNow = idx === segIndex && !completed;   // a ticked-off stop no longer shows "NOW"
          const isDone = idx < segIndex && item.status !== "cancelled" && !completed;
          const st = item.status && item.status !== "scheduled" ? item.status : null;
          const meta = st ? ITIN_STATUS_META[st] : null;
          const cls = `tf-stop-box${isNow ? " is-now" : ""}${isDone ? " is-done" : ""}${st ? ` is-${st}` : ""}${completed ? " is-completed" : ""}${openId === item.id ? " is-open" : ""}`;
          const inner = (
            <>
              <div className="tf-stop-box-time">
                {canEdit ? (
                  <button type="button" className="tf-stop-check" aria-pressed={completed}
                    title={completed ? t("Mark not done") : t("Mark completed")}
                    onClick={(e) => { e.stopPropagation(); if (onToggleComplete) onToggleComplete(item); }}>
                    {completed ? <CheckCircle2 size={15} color="var(--tf-green)" /> : <Circle size={15} />}
                  </button>
                ) : (completed && <CheckCircle2 size={14} color="var(--tf-green)" style={{ flexShrink: 0 }} />)}
                <span>{item.startTime}</span>
                {isNow && !st && <span className="tf-stop-now-text">{t("NOW")}</span>}
                {meta && (
                  <span className="tf-stop-tag" style={{ color: `var(--tf-${meta.color})`, background: `var(--tf-${meta.color}-bg)` }}>
                    {t(meta.label)}{st === "delayed" && item.delayMinutes ? ` +${fmtDuration(item.delayMinutes)}` : ""}
                  </span>
                )}
              </div>
              <div className="tf-stop-box-title">{item.title}</div>
            </>
          );
          // The box body opens the live-status editor (edit users). The check
          // button above stops propagation so ticking "done" doesn't also open
          // the editor. A plain <div> (not a nested <button>) keeps the check
          // button valid inside it.
          const box = canEdit ? (
            <div key={item.id} className={cls} role="button" tabIndex={0}
              onClick={() => setOpenId(openId === item.id ? null : item.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenId(openId === item.id ? null : item.id); } }}
              aria-expanded={openId === item.id}>
              {inner}
            </div>
          ) : (
            <div key={item.id} className={cls}>{inner}</div>
          );
          if (idx === items.length - 1) return [box];
          return [box, <div key={`${item.id}-arrow`} className="tf-stop-arrow">→</div>];
        })}
      </div>

      {/* Inline editor (edit permission only). Two separate ideas, grouped so
          they don't get confused:
            • Schedule status — is this stop running on time / late / moved /
              cancelled? (what's shown on the timeline)
            • Completed — a manual tick that crosses the stop off once it's
              actually happened. A stop can be, say, "delayed" and then done. */}
      {canEdit && editItem && (
        <div className="tf-stop-status-editor">
          <div className="tf-flex tf-gap-8" style={{ flexWrap: "wrap", alignItems: "center" }}>
            <span className="tf-muted" style={{ fontSize: 12, fontWeight: 800 }}>{editItem.startTime} · {editItem.title}</span>
            <span className="tf-editor-label">{t("Schedule status")}</span>
            <button className="tf-btn tf-btn-ghost tf-btn-sm" onClick={() => applyStatus(editItem, "scheduled", 0)}><CheckCircle2 size={12} /> {t("On time")}</button>
            <button className="tf-btn tf-btn-ghost tf-btn-sm" style={{ color: "var(--tf-orange)" }} onClick={() => setEditMode(editMode === "delayed" ? null : "delayed")}><Clock size={12} /> {t("Delayed")}…</button>
            <button className="tf-btn tf-btn-ghost tf-btn-sm" style={{ color: "var(--tf-blue)" }} onClick={() => setEditMode(editMode === "moved" ? null : "moved")}>{t("Moved")}…</button>
            <button className="tf-btn tf-btn-ghost tf-btn-sm" style={{ color: "var(--tf-red)" }} onClick={() => applyStatus(editItem, "cancelled", 0)}><X size={12} /> {t("Cancelled")}</button>
            <span className="tf-editor-divider" />
            <span className="tf-editor-label">{t("Completed")}</span>
            <button className="tf-btn tf-btn-ghost tf-btn-sm" style={{ color: "var(--tf-green)" }} onClick={() => { if (onToggleComplete) onToggleComplete(editItem); }}>
              {editItem.completed ? <><Circle size={12} /> {t("Mark not done")}</> : <><CheckCircle2 size={12} /> {t("Mark done")}</>}
            </button>
            <button className="tf-btn tf-btn-ghost tf-btn-sm" style={{ marginLeft: "auto" }} onClick={() => setOpenId(null)}>{t("Close")}</button>
          </div>

          {editMode === "delayed" && (
            <div className="tf-editor-sub">
              <span className="tf-muted" style={{ fontSize: 12, fontWeight: 700 }}>{t("Delayed by")}</span>
              <input type="number" min={0} className="tf-input tf-num" value={durH} onChange={(e) => setDurH(e.target.value)} aria-label={t("Hours")} />
              <span className="tf-muted" style={{ fontSize: 12 }}>{t("h")}</span>
              <input type="number" min={0} max={59} className="tf-input tf-num" value={durM} onChange={(e) => setDurM(e.target.value)} aria-label={t("Minutes")} />
              <span className="tf-muted" style={{ fontSize: 12 }}>{t("min")}</span>
              <button className="tf-btn tf-btn-primary tf-btn-sm" disabled={amountMins() <= 0} onClick={() => applyStatus(editItem, "delayed", amountMins())}>{t("Apply delay")}</button>
            </div>
          )}

          {editMode === "moved" && (
            <div className="tf-editor-sub" style={{ flexWrap: "wrap" }}>
              <span className="tf-muted" style={{ fontSize: 12, fontWeight: 700 }}>{t("Move by")}</span>
              <input type="number" min={0} className="tf-input tf-num" value={durH} onChange={(e) => setDurH(e.target.value)} aria-label={t("Hours")} />
              <span className="tf-muted" style={{ fontSize: 12 }}>{t("h")}</span>
              <input type="number" min={0} max={59} className="tf-input tf-num" value={durM} onChange={(e) => setDurM(e.target.value)} aria-label={t("Minutes")} />
              <span className="tf-muted" style={{ fontSize: 12 }}>{t("min")}</span>
              <button className="tf-btn tf-btn-ghost tf-btn-sm" disabled={amountMins() <= 0} onClick={() => doMove(editItem, { startTime: shiftTime(editItem.startTime, -amountMins()) })}>← {t("Earlier")}</button>
              <button className="tf-btn tf-btn-ghost tf-btn-sm" disabled={amountMins() <= 0} onClick={() => doMove(editItem, { startTime: shiftTime(editItem.startTime, amountMins()) })}>{t("Later")} →</button>
              <span className="tf-editor-divider" />
              <span className="tf-muted" style={{ fontSize: 12 }}>{t("or to")} {t("Day")}</span>
              <input type="number" min={1} className="tf-input tf-num" value={moveDay} onChange={(e) => setMoveDay(e.target.value)} aria-label={t("Day")} />
              <button className="tf-btn tf-btn-ghost tf-btn-sm" onClick={() => doMove(editItem, { dayNumber: Number(moveDay) || editItem.dayNumber })}>{t("Move to day")}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* =============================================================================
 *  ItineraryOverview — the whole plan across every day, not just "today".
 *  Used for Planning trips (the plan being built) and Completed trips (the
 *  record of what happened). Read-only; each stop shows its final status /
 *  completion. "Today" has no meaning outside an in-progress trip, so these
 *  modes never use the live JourneyTimeline.
 * ========================================================================== */
function ItineraryOverview({ itinerary, mode, onAddClick }) {
  const { t } = useLang();
  if (itinerary.length === 0) {
    return (
      <p style={{ fontSize: 13, color: "var(--tf-text-3)" }}>
        {mode === "completed" ? t("No itinerary was recorded for this trip.") : t("No itinerary planned yet.")}
        {mode !== "completed" && onAddClick && (
          <> <button style={{ background: "none", border: "none", color: "var(--tf-blue)", cursor: "pointer", fontSize: 13, padding: 0, fontWeight: 700 }} onClick={onAddClick}>{t("Plan the itinerary →")}</button></>
        )}
      </p>
    );
  }
  const days = [...new Set(itinerary.map((i) => i.dayNumber))].sort((a, b) => a - b);
  return (
    <div className="tf-plan">
      {days.map((day) => {
        const stops = itinerary.filter((i) => i.dayNumber === day).sort((a, b) => a.startTime.localeCompare(b.startTime));
        return (
          <div key={day} className="tf-plan-day">
            <div className="tf-plan-day-label">{t("Day")} {day}</div>
            <div className="tf-plan-stops">
              {stops.map((s) => {
                const st = s.status && s.status !== "scheduled" ? s.status : null;
                const meta = st ? ITIN_STATUS_META[st] : null;
                return (
                  <div key={s.id} className={`tf-plan-stop${s.completed ? " is-completed" : ""}`}>
                    {mode === "completed" && (s.completed
                      ? <CheckCircle2 size={13} color="var(--tf-green)" style={{ flexShrink: 0 }} />
                      : <Circle size={13} color="var(--tf-text-3)" style={{ flexShrink: 0 }} />)}
                    <span className="tf-plan-time">{s.startTime}</span>
                    <span className="tf-plan-title">{s.title}{s.location ? <span className="tf-muted"> · {s.location}</span> : null}</span>
                    {meta && (
                      <span className="tf-stop-tag" style={{ color: `var(--tf-${meta.color})`, background: `var(--tf-${meta.color}-bg)` }}>
                        {t(meta.label)}{st === "delayed" && s.delayMinutes ? ` +${fmtDuration(s.delayMinutes)}` : ""}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---- TripSummaryBar — readiness (Planning) or results (Completed) ---------- */
function SummaryStat({ label, value, tone }) {
  return (
    <div className="tf-summary-stat">
      <div className="tf-summary-stat-label">{label}</div>
      <div className="tf-summary-stat-value" style={tone ? { color: `var(--tf-${tone})` } : undefined}>{value}</div>
    </div>
  );
}
function TripSummaryBar({ mode, stats }) {
  const { t } = useLang();
  if (mode === "planning") {
    return (
      <div className="tf-summary-bar">
        <span className="tf-summary-eyebrow">{t("Getting ready")}</span>
        <SummaryStat label={t("Itinerary")} value={`${stats.itinStops} ${t("stops")} · ${stats.itinDays} ${t("days")}`} />
        <SummaryStat label={t("Coaches")} value={stats.coaches} />
        <SummaryStat label={t("Delegates")} value={stats.delegates} />
        <SummaryStat label={t("Unassigned")} value={stats.unassigned} tone={stats.unassigned > 0 ? "yellow" : "green"} />
      </div>
    );
  }
  return (
    <div className="tf-summary-bar">
      <span className="tf-summary-eyebrow">{t("Trip results")}</span>
      <SummaryStat label={t("Arrived")} value={`${stats.present}/${stats.delegates}`} tone="green" />
      <SummaryStat label={t("Missing")} value={stats.missing} tone={stats.missing > 0 ? "red" : "green"} />
      <SummaryStat label={t("Stops completed")} value={`${stats.itinDone}/${stats.itinStops}`} />
      {stats.itinCancelled > 0 && <SummaryStat label={t("Cancelled")} value={stats.itinCancelled} tone="red" />}
      <SummaryStat label={t("Coaches")} value={stats.coaches} />
    </div>
  );
}

/* ---- CapacityPlanner (Planning) — size the fleet to the headcount ----------
 * "How many delegates are coming?" → the right number of coaches to seat them
 * (generated automatically, named Coach N). Coaches start staffless; a guide
 * gets assigned later via "Switch staff". ------------------------------------ */
function CapacityPlanner({ delegateCount, coachCount, onGenerate }) {
  const { t } = useLang();
  const [headcount, setHeadcount] = useState(delegateCount || 0);
  const [seats, setSeats] = useState(40);
  const [busy, setBusy] = useState(false);
  const needed = Math.max(0, Math.ceil((Number(headcount) || 0) / (Number(seats) || 40)));
  const toAdd = Math.max(0, needed - coachCount);

  async function handleGenerate() {
    setBusy(true);
    try { await onGenerate(toAdd, Number(seats) || 40); }
    finally { setBusy(false); }
  }

  return (
    <div className="tf-planner">
      <span className="tf-planner-label">{t("Capacity planner")}</span>
      <div className="tf-planner-field">
        <span className="tf-muted">{t("Delegates coming")}</span>
        <input type="number" min={0} className="tf-input tf-num" value={headcount} onChange={(e) => setHeadcount(e.target.value)} />
      </div>
      <div className="tf-planner-field">
        <span className="tf-muted">{t("Seats / coach")}</span>
        <input type="number" min={1} className="tf-input tf-num" value={seats} onChange={(e) => setSeats(e.target.value)} />
      </div>
      <span className="tf-planner-result">
        {t("Need")} <strong>{needed}</strong> {t(needed === 1 ? "coach" : "coaches")} · {t("have")} {coachCount}
      </span>
      {toAdd > 0 ? (
        <button className="tf-btn tf-btn-primary tf-btn-sm" onClick={handleGenerate} disabled={busy}>
          {busy ? <Loader2 size={13} className="spin" /> : <Plus size={13} />} {t("Generate")} {toAdd} {t(toAdd === 1 ? "coach" : "coaches")}
        </button>
      ) : (
        <span className="tf-planner-ok"><CheckCircle2 size={13} /> {t("Enough coaches")}</span>
      )}
    </div>
  );
}

/* =============================================================================
 *  Hero — plain contextual header matching the reference: title + status
 *  pill + a row of buttons, one grey subtitle line below. Actions adapt to the
 *  trip's phase: Planning/In-progress can edit; Completed is read-only, and
 *  "Trip settings" (the live Late-cutoff) only makes sense in-progress.
 * ========================================================================== */
function Hero({ trip, coachCount, delegateCount, mode, onEditItinerary, onAddDelegate, onTripSettings, canEdit = true }) {
  const { t } = useLang();
  const statusColor = TRIP_STATUS_COLOR[trip.status] || "grey";
  const showActions = canEdit && mode !== "completed";

  return (
    <div className="tf-hero">
      <div className="tf-hero-top">
        <div className="tf-hero-title-row">
          <span className="tf-hero-title">{trip.name}</span>
          <span className="tf-badge-pill" style={{ color: `var(--tf-${statusColor})`, background: `var(--tf-${statusColor}-bg)` }}>{t(trip.status)}</span>
        </div>
        {showActions && (
          <div className="tf-hero-actions">
            {mode === "live" && <button className="tf-btn tf-btn-solid" onClick={onTripSettings}><Settings size={14} /> {t("Trip settings")}</button>}
            <button className="tf-btn tf-btn-solid" onClick={onEditItinerary}><PencilLine size={14} /> {mode === "planning" ? t("Plan itinerary") : t("Edit itinerary")}</button>
            <button className="tf-btn tf-btn-primary" onClick={onAddDelegate}><UserPlus size={14} /> {t("Add delegate")}</button>
          </div>
        )}
      </div>
      <div className="tf-hero-sub">
        {trip.dateRange}{trip.dateRange ? " · " : ""}{coachCount} {t(coachCount === 1 ? "coach" : "coaches")} · {delegateCount} {t(delegateCount === 1 ? "delegate" : "delegates")}
        {trip.lead ? ` · ${t("Lead")}: ${trip.lead}` : ""}
      </div>
    </div>
  );
}

/* ---- TripSettingsModal — per-trip Late-status auto-transition cutoff -------
 * Any delegate still ASSIGNED (not yet checked in) at/past this time on this
 * trip gets auto-flipped to LATE by applyLateCutoff() in backend/data.js.
 * Defaults to "10:00" for any trip nobody has customised.
 * ---------------------------------------------------------------------------- */
function TripSettingsModal({ tripId, initialCutoff, onClose, onSaved }) {
  const { t } = useLang();
  const [cutoff, setCutoff] = useState(initialCutoff || "10:00");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSave() {
    setSaving(true); setError(null);
    try {
      const updated = await apiPatch(`/trips/${tripId}/late-cutoff`, { lateCutoffTime: cutoff });
      onSaved(updated.lateCutoffTime);
      onClose();
    } catch (e) {
      setError(e.message || t("Save failed."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={t("Trip settings")} onClose={onClose} maxWidth={420}
      footer={<>
        <button className="tf-btn tf-btn-ghost" onClick={onClose} disabled={saving}>{t("Cancel")}</button>
        <button className="tf-btn tf-btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />} {t("Save changes")}
        </button>
      </>}
    >
      <label className="tf-field-label">{t("Late-status cutoff time")}</label>
      <input type="time" className="tf-input" value={cutoff} onChange={(e) => setCutoff(e.target.value)} />
      <p className="tf-muted" style={{ fontSize: 12, marginTop: 8 }}>
        {t("A delegate still Assigned (not yet checked in) at or after this time is automatically marked Late.")}
      </p>
      {error && <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--tf-red)" }}>{error}</div>}
    </Modal>
  );
}

/* ---- EditItineraryModal (category select) -------------------------- */
function EditItineraryModal({ tripId, itinerary, categories, onClose, onRefresh, askConfirm }) {
  const { t } = useLang();
  const days = [...new Set(itinerary.map((i) => i.dayNumber))].sort((a, b) => a - b);
  const maxDay = days.length > 0 ? Math.max(...days) : 0;

  const [activeForm, setActiveForm] = useState(null);
  const [form, setForm] = useState({ dayNumber: 1, startTime: "", title: "", location: "", category: "other", status: "scheduled", delayMinutes: 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function openAdd(day) {
    setForm({ dayNumber: day, startTime: "", title: "", location: "", category: "other", status: "scheduled", delayMinutes: 0 });
    setActiveForm({ mode: "add", dayNumber: day });
    setError(null);
  }
  function openEdit(item) {
    setForm({ dayNumber: item.dayNumber, startTime: item.startTime, title: item.title, location: item.location || "", category: item.category || "other", status: item.status || "scheduled", delayMinutes: item.delayMinutes || 0 });
    setActiveForm({ mode: "edit", item });
    setError(null);
  }
  function cancelForm() { setActiveForm(null); setError(null); }

  async function handleSave() {
    if (!form.title.trim()) { setError(t("Title is required")); return; }
    if (!form.startTime) { setError(t("Time is required")); return; }
    setSaving(true); setError(null);
    try {
      const statusFields = { status: form.status, delayMinutes: form.status === "delayed" ? Number(form.delayMinutes) || 0 : 0 };
      if (activeForm.mode === "add") {
        await apiPost(`/trips/${tripId}/itinerary`, {
          dayNumber: Number(form.dayNumber), startTime: form.startTime, category: form.category,
          title: form.title.trim(), location: form.location.trim() || null,
          sortOrder: itinerary.filter((i) => i.dayNumber === Number(form.dayNumber)).length,
          ...statusFields,
        });
      } else {
        await apiPatch(`/trips/${tripId}/itinerary/${activeForm.item.id}`, {
          dayNumber: Number(form.dayNumber), startTime: form.startTime, category: form.category,
          title: form.title.trim(), location: form.location.trim() || null,
          ...statusFields,
        });
      }
      await onRefresh();
      setActiveForm(null);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(item) {
    if (!(await askConfirm(t("Delete this item?"), `${t('Delete')} "${item.title}"?`, "danger"))) return;
    try { await apiDelete(`/trips/${tripId}/itinerary/${item.id}`); await onRefresh(); }
    catch (e) { setError(e.message); }
  }

  function ItemForm() {
    return (
      <div style={{ background: "var(--tf-surface-2)", border: "1px solid var(--tf-border)", borderRadius: 12, padding: 14, marginTop: 8, marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginBottom: 10 }}>
          <div>
            <label className="tf-field-label">{t("Day")}</label>
            <input type="number" min={1} className="tf-input" value={form.dayNumber} onChange={(e) => setForm((f) => ({ ...f, dayNumber: e.target.value }))} />
          </div>
          <div>
            <label className="tf-field-label">{t("Time")} <span style={{ color: "var(--tf-red)" }}>*</span></label>
            <input type="time" className="tf-input" value={form.startTime} onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginBottom: 10 }}>
          <div>
            <label className="tf-field-label">{t("Category")}</label>
            <select className="tf-input" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
              {(categories || Object.keys(CATEGORY_META)).map((c) => <option key={c} value={c}>{t(CATEGORY_META[c]?.label || c)}</option>)}
            </select>
          </div>
          <div>
            <label className="tf-field-label">{t("Location")}</label>
            <input type="text" className="tf-input" placeholder={t("Optional")} value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
          </div>
        </div>
        <div style={{ marginBottom: 10 }}>
          <label className="tf-field-label">{t("Activity title")} <span style={{ color: "var(--tf-red)" }}>*</span></label>
          <input type="text" className="tf-input" placeholder={t("e.g. Forbidden City visit")} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} autoFocus />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: form.status === "delayed" ? "1fr 1fr" : "1fr", gap: 10, marginBottom: 10 }}>
          <div>
            <label className="tf-field-label">{t("Live status")}</label>
            <select className="tf-input" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
              <option value="scheduled">{t("On time")}</option>
              <option value="delayed">{t("Delayed")}</option>
              <option value="moved">{t("Moved")}</option>
              <option value="cancelled">{t("Cancelled")}</option>
            </select>
          </div>
          {form.status === "delayed" && (
            <div>
              <label className="tf-field-label">{t("Delayed by (min)")}</label>
              <input type="number" min={0} className="tf-input" value={form.delayMinutes} onChange={(e) => setForm((f) => ({ ...f, delayMinutes: e.target.value }))} />
            </div>
          )}
        </div>
        {error && <p style={{ color: "var(--tf-red)", fontSize: 13, marginBottom: 8 }}>{error}</p>}
        <div className="tf-flex tf-gap-8" style={{ justifyContent: "flex-end" }}>
          <button className="tf-btn tf-btn-ghost tf-btn-sm" onClick={cancelForm}>{t("Cancel")}</button>
          <button className="tf-btn tf-btn-primary tf-btn-sm" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={13} className="spin" /> : null} {activeForm?.mode === "add" ? t("Add item") : t("Save changes")}
          </button>
        </div>
      </div>
    );
  }

  const allDays = [...new Set([...days, ...(activeForm?.mode === "add" ? [Number(activeForm.dayNumber)] : [])])].sort((a, b) => a - b);

  return (
    <Modal title={t("Edit itinerary")} onClose={onClose} maxWidth={680} footer={<button className="tf-btn tf-btn-ghost" onClick={onClose}>{t("Close")}</button>}>
      {allDays.length === 0 && !activeForm && <p style={{ color: "var(--tf-text-3)", fontSize: 14 }}>{t("No itinerary items yet. Add your first item below.")}</p>}
      {allDays.map((day) => {
        const items = itinerary.filter((i) => i.dayNumber === day).sort((a, b) => a.startTime.localeCompare(b.startTime));
        return (
          <div key={day} style={{ marginBottom: 20 }}>
            <div className="tf-between" style={{ marginBottom: 10 }}>
              <span style={{ fontWeight: 800, fontSize: 14 }}>{t("Day")} {day}</span>
              {!(activeForm?.mode === "add" && Number(activeForm.dayNumber) === day) && (
                <button className="tf-btn tf-btn-ghost tf-btn-sm" onClick={() => openAdd(day)}><Plus size={12} /> {t("Add item")}</button>
              )}
            </div>
            {items.map((item) => {
              const meta = CATEGORY_META[item.category] || CATEGORY_META.other;
              const Icon = meta.icon;
              return (
                <div key={item.id}>
                  <div className="tf-flex tf-gap-10" style={{ alignItems: "center", padding: "8px 10px", borderRadius: 10, background: "var(--tf-surface-2)", border: "1px solid var(--tf-border)", marginBottom: 6 }}>
                    <Icon size={14} color="var(--tf-text-3)" />
                    <span style={{ fontWeight: 700, fontSize: 13, minWidth: 42, flexShrink: 0 }}>{item.startTime}</span>
                    <span style={{ flex: 1, fontSize: 13 }}>{item.title}</span>
                    {item.location && <span className="tf-muted" style={{ fontSize: 12, flexShrink: 0 }}>{item.location}</span>}
                    <button className="tf-btn tf-btn-ghost tf-btn-icon-only" onClick={() => openEdit(item)} title={t("Edit")}><Edit2 size={13} /></button>
                    <button className="tf-btn tf-btn-ghost tf-btn-icon-only" style={{ color: "var(--tf-red)" }} onClick={() => handleDelete(item)} title={t("Delete")}><Trash2 size={13} /></button>
                  </div>
                  {activeForm?.mode === "edit" && activeForm.item.id === item.id && <ItemForm />}
                </div>
              );
            })}
            {activeForm?.mode === "add" && Number(activeForm.dayNumber) === day && <ItemForm />}
          </div>
        );
      })}
      {!activeForm && (
        <button className="tf-btn tf-btn-ghost" style={{ width: "100%", marginTop: 4, borderStyle: "dashed" }} onClick={() => openAdd(maxDay + 1)}>
          <Plus size={14} /> {t("Add Day")} {maxDay + 1}
        </button>
      )}
    </Modal>
  );
}

/* ---- AddDelegateModal (company/accessibility) --------------------------- */
function AddDelegateModal({ tripId, onClose, onAdded }) {
  const { t } = useLang();
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [accessibilityNotes, setAccessibilityNotes] = useState("");
  const [vip, setVip] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Real people roster from the team's shared data (Vance's onboarding writes
  // every parsed delegate to the delegates table; /assistant/roster exposes
  // them). Offered as name suggestions so a coordinator adds a REAL person
  // instead of free-typing placeholder text, and their company auto-fills.
  // Degrades silently to a plain text field if the roster can't be reached.
  const [roster, setRoster] = useState([]);
  useEffect(() => {
    let alive = true;
    apiGet("/assistant/roster")
      .then((r) => {
        if (!alive) return;
        const seen = new Set();
        const people = [];
        for (const d of r.delegates || []) {
          const key = (d.name || "").trim().toLowerCase();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          people.push({ name: d.name.trim(), company: d.company || "" });
        }
        people.sort((a, b) => a.name.localeCompare(b.name));
        setRoster(people);
      })
      .catch(() => { /* roster is a convenience only; ignore if unavailable */ });
    return () => { alive = false; };
  }, []);

  // Picking (or typing) a roster name auto-fills that person's company, unless
  // the coordinator has already entered one.
  function handleNameChange(value) {
    setName(value);
    const match = roster.find((p) => p.name.toLowerCase() === value.trim().toLowerCase());
    if (match && match.company && !company.trim()) setCompany(match.company);
  }

  async function handleSubmit() {
    if (!name.trim()) { setError(t("Full name is required")); return; }
    setSaving(true); setError(null);
    try {
      const delegate = await apiPost(`/delegates`, { tripId, name: name.trim(), vip, notes: notes.trim(), company: company.trim(), accessibilityNotes: accessibilityNotes.trim() });
      onAdded(delegate); onClose();
    } catch (e) { setError(e.message); setSaving(false); }
  }

  return (
    <Modal title={t("Add delegate")} onClose={onClose} maxWidth={440}
      footer={<>
        <button className="tf-btn tf-btn-ghost" onClick={onClose}>{t("Cancel")}</button>
        <button className="tf-btn tf-btn-primary" onClick={handleSubmit} disabled={saving}>
          {saving ? <Loader2 size={14} className="spin" /> : <UserPlus size={14} />} {t("Add delegate")}
        </button>
      </>}
    >
      <label className="tf-field-label">{t("Full name")} <span style={{ color: "var(--tf-red)" }}>*</span></label>
      <input className="tf-input" style={{ marginBottom: roster.length ? 4 : 14 }} placeholder={t("e.g. Tan S.L.")} value={name}
        list="tf-roster-names" autoComplete="off"
        onChange={(e) => handleNameChange(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSubmit()} autoFocus />
      <datalist id="tf-roster-names">
        {roster.map((p) => <option key={p.name} value={p.name}>{p.company}</option>)}
      </datalist>
      {roster.length > 0 && (
        <p className="tf-muted" style={{ fontSize: 11.5, marginBottom: 14 }}>
          {t("Pick an existing delegate from the roster, or type a new name.")} · {roster.length} {t("in roster")}
        </p>
      )}

      <label className="tf-field-label">{t("Company")}</label>
      <input className="tf-input" style={{ marginBottom: 14 }} placeholder={t("Optional")} value={company} onChange={(e) => setCompany(e.target.value)} />

      <div
        className="tf-flex tf-gap-10"
        style={{ alignItems: "center", padding: "10px 12px", border: "1px solid var(--tf-border)", borderRadius: 10, cursor: "pointer", marginBottom: 14, background: vip ? "var(--tf-purple-bg)" : "transparent", borderColor: vip ? "var(--tf-purple-line)" : "var(--tf-border)" }}
        onClick={() => setVip((v) => !v)} role="checkbox" aria-checked={vip} tabIndex={0} onKeyDown={(e) => e.key === " " && setVip((v) => !v)}
      >
        <Star size={15} fill={vip ? "var(--tf-purple)" : "none"} color="var(--tf-purple)" />
        <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>{t("Mark as VIP")}</span>
        <div style={{ width: 36, height: 20, borderRadius: 10, background: vip ? "var(--tf-purple)" : "var(--tf-border)", position: "relative", transition: "background 0.2s" }}>
          <div style={{ width: 14, height: 14, borderRadius: 7, background: "#fff", position: "absolute", top: 3, left: vip ? 18 : 3, transition: "left 0.2s" }} />
        </div>
      </div>

      <label className="tf-field-label tf-flex tf-gap-6" style={{ alignItems: "center" }}><Accessibility size={13} /> {t("Accessibility notes")}</label>
      <input className="tf-input" style={{ marginBottom: 14 }} placeholder={t("e.g. wheelchair access, dietary needs")} value={accessibilityNotes} onChange={(e) => setAccessibilityNotes(e.target.value)} />

      <label className="tf-field-label tf-flex tf-gap-6" style={{ alignItems: "center" }}><MessageSquare size={13} /> {t("Notes (optional)")}</label>
      <textarea className="tf-input" rows={3} style={{ resize: "vertical", fontFamily: "inherit" }} placeholder={t("Dietary needs, medical notes, flight details…")} value={notes} onChange={(e) => setNotes(e.target.value)} />

      <p className="tf-muted" style={{ fontSize: 12, marginTop: 10 }}>{t("The delegate will appear in")} <strong>{t("Unassigned")}</strong>. {t("Drag them onto a coach to assign, or use the detail panel's Move control.")}</p>
      {error && <p style={{ color: "var(--tf-red)", fontSize: 13, marginTop: 8 }}>{error}</p>}
    </Modal>
  );
}

/* ---- Staff select + Add/Edit coach modals (driver name) ----------------- */
function StaffSelect({ value, onChange, staff, assignments, excludeCoachId }) {
  const { t } = useLang();
  const assignedElsewhere = (userId) => assignments.find((a) => a.staffUserId === userId && a.coachId !== excludeCoachId);
  return (
    <select className="tf-input" value={value || ""} onChange={(e) => onChange(e.target.value)}>
      <option value="" disabled>{t("Select a staff member…")}</option>
      {staff.map((s) => {
        const other = assignedElsewhere(s.id);
        return <option key={s.id} value={s.id}>{s.name} ({s.role}){other ? ` — ${t("already on")} ${other.coachLabel}` : ""}</option>;
      })}
    </select>
  );
}

function AddCoachModal({ tripId, existingCount, onClose, onAdded }) {
  const { t } = useLang();
  const [label, setLabel] = useState(`Coach ${existingCount + 1}`);
  const [capacity, setCapacity] = useState(40);
  const [driverName, setDriverName] = useState("");
  const [staffUserId, setStaffUserId] = useState("");
  const [staff, setStaff] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [s, a] = await Promise.all([apiGet("/users/staff"), apiGet("/coaches/staff-assignments")]);
        setStaff(s.staff); setAssignments(a.assignments);
      } catch (e) { setError(e.message); }
    })();
  }, []);

  async function handleSubmit() {
    if (!label.trim()) { setError(t("Label is required")); return; }
    if (capacity < 1) { setError(t("Capacity must be ≥ 1")); return; }
    if (!staffUserId) { setError(t("Every coach needs a staff member")); return; }
    setSaving(true); setError(null);
    try {
      const coach = await apiPost(`/coaches`, { tripId, label: label.trim(), capacity: Number(capacity), staffUserId, driverName: driverName.trim() });
      onAdded(coach); onClose();
    } catch (e) { setError(e.message); setSaving(false); }
  }

  return (
    <Modal title={t("Add coach")} onClose={onClose} maxWidth={420}
      footer={<>
        <button className="tf-btn tf-btn-ghost" onClick={onClose}>{t("Cancel")}</button>
        <button className="tf-btn tf-btn-primary" onClick={handleSubmit} disabled={saving}>
          {saving ? <Loader2 size={14} className="spin" /> : <Bus size={14} />} {t("Add coach")}
        </button>
      </>}
    >
      <label className="tf-field-label">{t("Coach label")} <span style={{ color: "var(--tf-red)" }}>*</span></label>
      <input className="tf-input" style={{ marginBottom: 14 }} value={label} autoFocus onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSubmit()} />

      <label className="tf-field-label">{t("Capacity (seats)")}</label>
      <input type="number" className="tf-input" style={{ marginBottom: 14 }} min={1} max={200} value={capacity} onChange={(e) => setCapacity(e.target.value)} />

      <label className="tf-field-label tf-flex tf-gap-6" style={{ alignItems: "center" }}><Navigation size={13} /> {t("Driver name")}</label>
      <input className="tf-input" style={{ marginBottom: 14 }} placeholder={t("Optional")} value={driverName} onChange={(e) => setDriverName(e.target.value)} />

      <label className="tf-field-label tf-flex tf-gap-6" style={{ alignItems: "center" }}><Users size={13} /> {t("Staff member")} <span style={{ color: "var(--tf-red)" }}>*</span></label>
      <StaffSelect value={staffUserId} onChange={setStaffUserId} staff={staff} assignments={assignments} excludeCoachId={null} />
      <p className="tf-muted" style={{ fontSize: 12, marginTop: 6 }}>{t("Every coach needs at least one staff member assigned.")}</p>
      {error && <p style={{ color: "var(--tf-red)", fontSize: 13, marginTop: 8 }}>{error}</p>}
    </Modal>
  );
}

function EditCoachStaffModal({ coach, onClose, onSaved }) {
  const { t } = useLang();
  const [staffUserId, setStaffUserId] = useState(coach.staffUserId || "");
  const [driverName, setDriverName] = useState(coach.driverName || "");
  const [staff, setStaff] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [s, a] = await Promise.all([apiGet("/users/staff"), apiGet("/coaches/staff-assignments")]);
        setStaff(s.staff); setAssignments(a.assignments);
      } catch (e) { setError(e.message); }
    })();
  }, []);

  async function handleSubmit() {
    if (!staffUserId) { setError(t("Every coach needs a staff member")); return; }
    setSaving(true); setError(null);
    try {
      const updated = await apiPatch(`/coaches/${coach.id}`, { staffUserId, driverName: driverName.trim() });
      onSaved(updated); onClose();
    } catch (e) { setError(e.message); setSaving(false); }
  }

  return (
    <Modal title={`${t("Switch staff")} — ${coach.label}`} onClose={onClose} maxWidth={420}
      footer={<>
        <button className="tf-btn tf-btn-ghost" onClick={onClose}>{t("Cancel")}</button>
        <button className="tf-btn tf-btn-primary" onClick={handleSubmit} disabled={saving}>
          {saving ? <Loader2 size={14} className="spin" /> : <Users size={14} />} {t("Save")}
        </button>
      </>}
    >
      <label className="tf-field-label">{t("Staff member")} <span style={{ color: "var(--tf-red)" }}>*</span></label>
      <StaffSelect value={staffUserId} onChange={setStaffUserId} staff={staff} assignments={assignments} excludeCoachId={coach.id} />
      <p className="tf-muted" style={{ fontSize: 12, margin: "6px 0 14px" }}>
        {t("Picking someone already on another coach moves them here — it doesn't remove them there automatically, so you'll see them flagged on both boards until you fix the other one up too.")}
      </p>
      <label className="tf-field-label tf-flex tf-gap-6" style={{ alignItems: "center" }}><Navigation size={13} /> {t("Driver name")}</label>
      <input className="tf-input" placeholder={t("Optional")} value={driverName} onChange={(e) => setDriverName(e.target.value)} />
      {error && <p style={{ color: "var(--tf-red)", fontSize: 13, marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}

/* =============================================================================
 *  CoachBoardView — the actual board for one trip (?tripId=...)
 * ========================================================================== */
function CoachBoardView({ tripId }) {
  const navigate = useNavigate();
  const { t } = useLang();
  const canEdit = getPermissions().manageTrips; // "View for all, edit gated" (see permissions.js)

  const [trip, setTrip] = useState(null);
  const [coaches, setCoaches] = useState([]);
  const [delegates, setDelegates] = useState([]);
  const [itinerary, setItinerary] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loadError, setLoadError] = useState(null);

  const [showItinerary, setShowItinerary] = useState(false);
  const [showTripSettings, setShowTripSettings] = useState(false);
  const [showAddDelegate, setShowAddDelegate] = useState(false);
  const [showAddCoach, setShowAddCoach] = useState(false);
  const [editStaffCoach, setEditStaffCoach] = useState(null);
  const [panelDelegate, setPanelDelegate] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const [toasts, setToasts] = useState([]);

  const dragInfo = useRef({ delegate: null, startX: 0, startY: 0, dragging: false });
  const [ghost, setGhost] = useState(null);
  const [overCol, setOverCol] = useState(null);
  const colRefs = useRef({});

  const pushToast = useCallback((message, kind = "success") => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((ts) => [...ts, { id, message, kind }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 4200);
  }, []);
  const dismissToast = useCallback((id) => setToasts((ts) => ts.filter((x) => x.id !== id)), []);

  function askConfirm(title, message, tone = "default") {
    return new Promise((resolve) => setConfirmState({ title, message, tone, resolve }));
  }
  function closeConfirm(result) { confirmState?.resolve(result); setConfirmState(null); }

  // Still reports to the backend's activity log (see desmond.js) even though
  // this page no longer displays a feed — kept in case a future screen wants
  // to show activity history; there's no frontend cost to leaving this in.
  const reportActivity = useCallback((text, kind) => {
    apiPost(`/trips/${tripId}/activity`, { text, kind }).catch(() => { /* best-effort */ });
  }, [tripId]);

  const fetchAll = useCallback(async () => {
    try {
      const [tripData, coachData, itinData, delData] = await Promise.all([
        apiGet(`/trips/${tripId}/summary`),
        apiGet(`/trips/${tripId}/coaches`),
        apiGet(`/trips/${tripId}/itinerary`),
        apiGet(`/delegates?tripId=${tripId}`),
      ]);
      setTrip(tripData);
      setCoaches(coachData.coaches);
      setItinerary(itinData.items);
      setCategories(itinData.categories || []);
      setDelegates(delData.delegates);
    } catch (e) { setLoadError(e.message); }
  }, [tripId]);

  // 2s auto-refresh so a check-in from any scanner (which flips a delegate to
  // ARRIVED), or an edit by another signed-in staff member, shows up here
  // without a manual refresh — matches the integrated board's live behaviour.
  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 2000);
    return () => clearInterval(id);
  }, [fetchAll]);

  const refreshCoaches = useCallback(async () => { const cd = await apiGet(`/trips/${tripId}/coaches`); setCoaches(cd.coaches); }, [tripId]);
  const refreshItinerary = useCallback(async () => { const data = await apiGet(`/trips/${tripId}/itinerary`); setItinerary(data.items); }, [tripId]);

  /* ---- drag handlers (mouse/pen — see file header for the touch alternative) ---- */
  function findColumnAt(x, y) {
    for (const key of Object.keys(colRefs.current)) {
      const node = colRefs.current[key];
      if (!node) continue;
      const r = node.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return key;
    }
    return null;
  }
  function onPointerMove(e) {
    const info = dragInfo.current;
    if (!info.delegate) return;
    const dist = Math.hypot(e.clientX - info.startX, e.clientY - info.startY);
    if (!info.dragging && dist > DRAG_THRESHOLD) { info.dragging = true; document.body.style.cursor = "grabbing"; }
    if (info.dragging) { setGhost({ delegate: info.delegate, x: e.clientX, y: e.clientY }); setOverCol(findColumnAt(e.clientX, e.clientY)); }
  }
  function onPointerUp(e) {
    window.removeEventListener("pointermove", onPointerMove);
    document.body.style.cursor = "";
    const info = dragInfo.current;
    const target = findColumnAt(e.clientX, e.clientY);
    dragInfo.current = { delegate: null, startX: 0, startY: 0, dragging: false };
    setGhost(null); setOverCol(null);
    if (!info.delegate) return;
    if (info.dragging) { if (target) handleReassign(info.delegate, target === UNASSIGNED_COL ? null : target); }
    else { setPanelDelegate(info.delegate); }
  }
  function onPointerDownCard(e, delegate) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragInfo.current = { delegate, startX: e.clientX, startY: e.clientY, dragging: false };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  }

  /* ---- mutations ---- */
  async function handleReassign(delegate, toCoachId) {
    if (!editable) return; // needs manageTrips, and not on a completed/cancelled trip
    if (toCoachId === delegate.coachId) return;
    // Dropping onto a coach means "expected on this coach, not yet checked
    // in" — that's ASSIGNED in the 5-status model, not MISSING. MISSING is
    // reserved for a genuine check-in miss or explicit staff override. Only
    // an UNASSIGNED delegate gets this default; a delegate who already has a
    // real status (ARRIVED/LATE/MISSING/ASSIGNED) keeps it when moved between
    // coaches — being dragged elsewhere doesn't reset their arrival state.
    const nextStatus = toCoachId === null ? "UNASSIGNED" : (delegate.status === "UNASSIGNED" ? "ASSIGNED" : delegate.status);
    const prevSnapshot = delegate;
    setDelegates((ds) => ds.map((d) => (d.id === delegate.id ? { ...d, coachId: toCoachId, status: nextStatus } : d)));
    try {
      await apiPatch(`/delegates/${delegate.id}`, { coachId: toCoachId, status: nextStatus });
      await refreshCoaches();
      const toLabel = toCoachId ? (coaches.find((c) => c.id === toCoachId)?.label || "a coach") : t("Unassigned");
      reportActivity(`${delegate.name} moved to ${toLabel}.`, "delegate");
      pushToast(`${delegate.name} → ${toLabel}`);
      setPanelDelegate((p) => (p && p.id === delegate.id ? { ...p, coachId: toCoachId, status: nextStatus } : p));
    } catch (e) {
      setDelegates((ds) => ds.map((d) => (d.id === delegate.id ? prevSnapshot : d)));
      pushToast(e.message, "error");
    }
  }

  function handleDelegateAdded(newDelegate) {
    setDelegates((ds) => [...ds, newDelegate]);
    setTrip((tr) => (tr ? { ...tr, delegateCount: (tr.delegateCount || 0) + 1 } : tr));
    pushToast(`${newDelegate.name} ${t("added")}.`);
  }

  async function handleRemoveDelegate(delegateId, name) {
    if (!(await askConfirm(t("Remove delegate?"), `${t("Remove")} ${name} ${t("from this trip?")}`, "danger"))) return;
    try {
      await apiDelete(`/delegates/${delegateId}`);
      setDelegates((ds) => ds.filter((d) => d.id !== delegateId));
      if (panelDelegate?.id === delegateId) setPanelDelegate(null);
      setTrip((tr) => (tr ? { ...tr, delegateCount: Math.max(0, (tr.delegateCount || 1) - 1) } : tr));
      await refreshCoaches();
      reportActivity(`${name} was removed from the trip.`, "delegate");
      pushToast(`${name} ${t("removed")}.`);
    } catch (e) { pushToast(e.message, "error"); }
  }

  async function handleRemoveCoach(coachId, label) {
    if (!(await askConfirm(t("Remove coach?"), `${t("Remove")} ${label}?`, "danger"))) return;
    try {
      await apiDelete(`/coaches/${coachId}`);
      setCoaches((cs) => cs.filter((c) => c.id !== coachId));
      pushToast(`${label} ${t("removed")}.`);
    } catch (e) { pushToast(e.message, "error"); }
  }

  // Planning: create N staffless "Coach N" coaches sized to the headcount.
  async function handleGenerateCoaches(count, capacity) {
    if (!editable || count <= 0) return;
    try {
      const r = await apiPost(`/coaches/generate`, { tripId, count, capacity });
      await fetchAll();
      pushToast(`${(r.created || []).length} ${t("coaches generated")}.`);
    } catch (e) { pushToast(e.message, "error"); }
  }

  async function handleSaveDetails(delegateId, fields) {
    const updated = await apiPatch(`/delegates/${delegateId}/details`, fields);
    setDelegates((ds) => ds.map((d) => (d.id === delegateId ? updated : d)));
    setPanelDelegate(updated);
    pushToast(t("Save changes") + " ✓");
  }

  // Live itinerary-stop status change from the timeline (on-time/delayed/moved/
  // cancelled). Optimistic, with a refresh + rollback-by-refresh on failure.
  async function handleSetItineraryStatus(itemId, status, delayMinutes) {
    if (!canEdit) return;
    const delay = status === "delayed" ? Math.max(0, Number(delayMinutes) || 0) : 0;
    setItinerary((its) => its.map((i) => (i.id === itemId ? { ...i, status, delayMinutes: delay } : i)));
    try {
      await apiPatch(`/trips/${tripId}/itinerary/${itemId}/status`, { status, delayMinutes: delay });
      const label = status === "delayed" ? `${t("Delayed")} ${delay} ${t("min")}` : t(ITIN_STATUS_META[status]?.label || "On time");
      pushToast(`${t("Stop updated")}: ${label}`);
    } catch (e) {
      await refreshItinerary();
      pushToast(e.message, "error");
    }
  }

  // Reschedule a stop (move earlier/later within the day, or to another day),
  // flagging it "moved". Reuses the full itinerary PATCH, so it carries the
  // stop's existing title/category through.
  async function handleMoveStop(item, changes) {
    if (!canEdit) return;
    const payload = {
      dayNumber: changes.dayNumber ?? item.dayNumber,
      startTime: changes.startTime ?? item.startTime,
      title: item.title,
      location: item.location || null,
      category: item.category || "other",
      status: "moved",
      delayMinutes: 0,
    };
    try {
      await apiPatch(`/trips/${tripId}/itinerary/${item.id}`, payload);
      await refreshItinerary();
      const where = changes.dayNumber ? `${t("Day")} ${payload.dayNumber}` : payload.startTime;
      pushToast(`${item.title} → ${where}`);
    } catch (e) { pushToast(e.message, "error"); }
  }

  // Tick / untick an itinerary stop as completed (crossed out on the board).
  async function handleToggleComplete(item) {
    if (!canEdit) return;
    const next = !item.completed;
    setItinerary((its) => its.map((i) => (i.id === item.id ? { ...i, completed: next } : i)));
    try {
      await apiPatch(`/trips/${tripId}/itinerary/${item.id}/complete`, { completed: next });
    } catch (e) {
      await refreshItinerary();
      pushToast(e.message, "error");
    }
  }

  // Cycle a coach's bus-arrival status (not arrived → en route → arrived → …).
  async function handleCycleArrival(coach) {
    if (!canEdit) return;
    const next = ARRIVAL_CYCLE[coach.arrivalStatus] || "en_route";
    setCoaches((cs) => cs.map((c) => (c.id === coach.id ? { ...c, arrivalStatus: next } : c)));
    try {
      await apiPatch(`/coaches/${coach.id}/arrival`, { arrivalStatus: next });
      pushToast(`${coach.label}: ${t(COACH_ARRIVAL_META[next].short)}`);
    } catch (e) {
      await refreshCoaches();
      pushToast(e.message, "error");
    }
  }

  /* ---- derived ---- */
  // A delegate belongs to this trip (its trip_id matched the fetch), but its
  // coachId can point at a coach that ISN'T on this trip — a stale assignment
  // left behind after a coach was removed, or cross-trip data written by
  // another feature. Group by coachId ONLY when that coach actually exists on
  // this board; otherwise fall the delegate back to Unassigned so it stays
  // visible. Without this, such a delegate is bucketed under a coachId that
  // never renders and vanishes entirely (the "delegates not showing" bug).
  const coachIdSet = new Set(coaches.map((c) => c.id));
  const delegatesByCoach = {};
  for (const d of [...delegates].sort((a, b) => a.name.localeCompare(b.name))) {
    const key = d.coachId && coachIdSet.has(d.coachId) ? d.coachId : UNASSIGNED_COL;
    if (!delegatesByCoach[key]) delegatesByCoach[key] = [];
    delegatesByCoach[key].push(d);
  }

  const currentDay = trip?.dayOf ?? 1;
  const todayItems = useMemo(
    () => itinerary.filter((i) => i.dayNumber === currentDay).sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [itinerary, currentDay]
  );

  // The board adapts to the trip's phase:
  //   planning  → build the plan (full itinerary, assign coaches/delegates); no live ops
  //   live      → what's happening now (schedule, delays, bus arrivals, boarding)
  //   completed → the results (attendance + itinerary recap), read-only
  // Cancelled trips are treated as a read-only record too.
  const mode = trip?.status === "In progress" ? "live" : trip?.status === "Planning" ? "planning" : "completed";
  const editable = canEdit && mode !== "completed";

  const summaryStats = useMemo(() => ({
    delegates: delegates.length,
    present: delegates.filter((d) => d.status === "PRESENT" || d.status === "ARRIVED").length,
    missing: delegates.filter((d) => d.status === "MISSING").length,
    unassigned: delegates.filter((d) => !(d.coachId && coachIdSet.has(d.coachId))).length,
    coaches: coaches.length,
    itinStops: itinerary.length,
    itinDays: new Set(itinerary.map((i) => i.dayNumber)).size,
    itinDone: itinerary.filter((i) => i.completed).length,
    itinCancelled: itinerary.filter((i) => i.status === "cancelled").length,
  }), [delegates, coaches, itinerary, coachIdSet]);

  if (!trip && !loadError) {
    return <div className="tf-root"><div className="tf-page"><SkeletonBoard /></div></div>;
  }
  if (loadError) {
    return (
      <div className="tf-root">
        <div className="tf-page">
          <button className="tf-back-btn" style={{ marginBottom: 16 }} onClick={() => navigate("/trips")}>← {t("Back to trips")}</button>
          <div className="tf-card" style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--tf-red)" }}>
            <AlertCircle size={20} /> <span>{t("Couldn't reach the backend")} — {loadError}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tf-root">
      <div className="tf-page">
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
        {confirmState && <ConfirmDialog title={confirmState.title} message={confirmState.message} tone={confirmState.tone} onCancel={() => closeConfirm(false)} onConfirm={() => closeConfirm(true)} />}
        {editStaffCoach && <EditCoachStaffModal coach={editStaffCoach} onClose={() => setEditStaffCoach(null)} onSaved={(updated) => { setCoaches((cs) => cs.map((c) => (c.id === updated.id ? { ...c, ...updated } : c))); pushToast(t("Save changes") + " ✓"); }} />}
        {showItinerary && <EditItineraryModal tripId={tripId} itinerary={itinerary} categories={categories} onClose={() => setShowItinerary(false)} onRefresh={refreshItinerary} askConfirm={askConfirm} />}
        {showTripSettings && (
          <TripSettingsModal
            tripId={tripId}
            initialCutoff={trip?.lateCutoffTime}
            onClose={() => setShowTripSettings(false)}
            onSaved={(lateCutoffTime) => { setTrip((tr) => (tr ? { ...tr, lateCutoffTime } : tr)); pushToast(t("Save changes") + " ✓"); }}
          />
        )}
        {showAddDelegate && <AddDelegateModal tripId={tripId} onClose={() => setShowAddDelegate(false)} onAdded={handleDelegateAdded} />}
        {showAddCoach && <AddCoachModal tripId={tripId} existingCount={coaches.length} onClose={() => setShowAddCoach(false)} onAdded={(c) => { fetchAll(); pushToast(`${c.label} ${t("added")}.`); }} />}
        {panelDelegate && (
          <DelegateDetailPanel
            delegate={panelDelegate} coaches={coaches}
            onClose={() => setPanelDelegate(null)} onSave={handleSaveDetails}
            onReassign={(d, toId) => handleReassign(d, toId)}
            onRemove={() => handleRemoveDelegate(panelDelegate.id, panelDelegate.name)}
            canEdit={editable}
          />
        )}
        {ghost && <div style={{ position: "fixed", left: ghost.x + 12, top: ghost.y + 12, zIndex: 2000, pointerEvents: "none", width: 200 }}><DelegateCard delegate={ghost.delegate} ghost /></div>}

        <button className="tf-back-btn" style={{ marginBottom: 16 }} onClick={() => navigate("/trips")}>← {t("Back to trips")}</button>

        <Hero
          trip={trip} coachCount={coaches.length} delegateCount={delegates.length}
          mode={mode} canEdit={canEdit}
          onEditItinerary={() => setShowItinerary(true)} onAddDelegate={() => setShowAddDelegate(true)}
          onTripSettings={() => setShowTripSettings(true)}
        />

        {mode === "planning" && <TripSummaryBar mode="planning" stats={summaryStats} />}

        <div className="tf-card">
          {mode === "live" ? (
            <>
              <div className="tf-section-eyebrow">{t("Today's itinerary")} · {t("Day")} {currentDay}</div>
              <JourneyTimeline
                items={todayItems} dayNumber={currentDay} totalDays={trip.totalDays}
                onAddClick={editable ? () => setShowItinerary(true) : undefined}
                canEdit={editable} onSetStatus={handleSetItineraryStatus} onToggleComplete={handleToggleComplete} onMoveStop={handleMoveStop}
              />
            </>
          ) : mode === "planning" ? (
            <>
              <div className="tf-between" style={{ marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                <span className="tf-section-eyebrow">{t("Trip plan")} · {summaryStats.itinStops} {t("stops")} · {summaryStats.itinDays} {t("days")}</span>
                {editable && (
                  <button className="tf-btn tf-btn-solid tf-btn-sm" onClick={() => setShowItinerary(true)}>
                    <PencilLine size={13} /> {t("Edit days & stops")}
                  </button>
                )}
              </div>
              <ItineraryOverview itinerary={itinerary} mode="planning" onAddClick={editable ? () => setShowItinerary(true) : undefined} />
            </>
          ) : (
            <>
              <div className="tf-section-eyebrow">{t("Trip completed")}{summaryStats.itinStops > 0 ? ` · ${summaryStats.itinDone}/${summaryStats.itinStops} ${t("stops completed")}` : ""}</div>
              <ItineraryOverview itinerary={itinerary} mode="completed" />
            </>
          )}
        </div>

        <div className="tf-card">
          <div className="tf-section-head">
            <div>
              <span className="tf-section-title">{mode === "completed" ? t("Final coach assignments") : t("Coach assignments")}</span>
              <div className="tf-section-sub">
                {mode === "planning" ? t("Assign delegates to coaches before the trip departs")
                  : mode === "completed" ? t("Where everyone ended up")
                  : t("Drag any delegate card between columns to reassign on the fly")}
              </div>
            </div>
          </div>

          {mode === "planning" && editable && (
            <CapacityPlanner delegateCount={delegates.length} coachCount={coaches.length} onGenerate={handleGenerateCoaches} />
          )}

          <div className="tf-fleet-scroll">
            {coaches.map((coach) => (
              <FleetCard
                key={coach.id} coach={coach} delegates={delegatesByCoach[coach.id] || []} mode={mode}
                isOver={overCol === coach.id} colRef={(node) => { colRefs.current[coach.id] = node; }}
                onPointerDownCard={onPointerDownCard} onKeyOpen={setPanelDelegate} draggingId={ghost?.delegate?.id}
                onRemoveCoach={editable ? handleRemoveCoach : undefined} onRemoveDelegate={editable ? handleRemoveDelegate : undefined} onEditStaff={editable ? setEditStaffCoach : undefined}
                onCycleArrival={editable && mode === "live" ? handleCycleArrival : undefined}
              />
            ))}
            <FleetCard
              coach={{ id: UNASSIGNED_COL, label: t("Unassigned") }} delegates={delegatesByCoach[UNASSIGNED_COL] || []} mode={mode}
              isUnassigned isOver={overCol === UNASSIGNED_COL} colRef={(node) => { colRefs.current[UNASSIGNED_COL] = node; }}
              onPointerDownCard={onPointerDownCard} onKeyOpen={setPanelDelegate} draggingId={ghost?.delegate?.id} onRemoveDelegate={editable ? handleRemoveDelegate : undefined}
            />
            {editable && <button className="tf-add-fleet-card" onClick={() => setShowAddCoach(true)}><Plus size={18} /> {t("Add coach")}</button>}
          </div>
        </div>
      </div>

      {/* Mobile floating quick actions */}
      {editable && (
      <div className="tf-fab-stack" style={{ display: "none" }} data-tf-mobile-fab>
        <button className="tf-fab" onClick={() => setShowAddDelegate(true)} title={t("Add delegate")}><UserPlus size={20} /></button>
        <button className="tf-fab tf-fab-mini" onClick={() => setShowAddCoach(true)} title={t("Add coach")}><Bus size={18} /></button>
      </div>
      )}
      <style>{`@media (max-width: 720px) { [data-tf-mobile-fab] { display: flex !important; } }`}</style>
    </div>
  );
}

/* =============================================================================
 *  TripCoachPage — decides List vs Board from ?tripId=
 * ========================================================================== */
export default function TripCoachPage() {
  const [searchParams] = useSearchParams();
  const tripId = searchParams.get("tripId");

  if (!tripId) return <TripsListPage />;
  return <CoachBoardView tripId={tripId} />;
}
