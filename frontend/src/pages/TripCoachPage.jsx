// frontend/src/pages/TripCoachPage.jsx
// Owner: Desmond — "TransitFlow" — Trip Booking & Dynamic Coach Management
//
// v2 — "Live Travel Operations Dashboard" redesign. Still lives entirely
// inside this file + TripsListPage.jsx + the new TripCoachPage.css, per the
// original team rules (no teammate files touched).
//
// v3 — "operational workspace" pass. This page is a working tool for event
// coordinators managing a trip in real time, NOT an executive KPI dashboard —
// so it should answer "where are we / how are delegates distributed / what
// needs attention now" at a glance, not read like a stats report. Changes
// from v2:
//   - Removed the dedicated 5-card KPI row entirely. Numbers are folded into
//     context instead: a red "N missing" pill appears in the hero ONLY when
//     something needs attention (quiet otherwise), a "Fleet" meta item folds
//     coach/delegate counts into the hero header, and checked-in/capacity
//     numbers moved into the Fleet section's own heading.
//   - Journey timeline: clicking a stop now expands an inline detail panel
//     BELOW the whole track (time, category, location, fleet context)
//     instead of a small floating popover — reads as part of the page.
//   - Fleet workspace: switched from a horizontally-scrolling row of
//     "floating" cards to a CSS Grid that wraps and aligns on desktop (one
//     coherent workspace, consistent card heights, no stray horizontal
//     scrollbar); the swipeable filmstrip is now mobile-only, where
//     horizontal swiping is the expected pattern (see TripCoachPage.css).
//   - Delegate cards: unchanged compact height, but now reveal the full
//     notes/company/accessibility text via a hover/focus tooltip
//     (progressive disclosure) instead of only silently truncating it.
//   - Activity feed: visually quieter side panel (flatter card, no shadow)
//     with small kind-coloured icon badges instead of plain dots.
//
// A few concrete interpretations of the brief, called out here because
// they're simplifications, not oversights (see DESMOND-TRIPS-INTEGRATION.md
// for the full list):
//   - The animated "bus" is a styled 2D icon whose position is computed from
//     the itinerary and animated with a CSS transition — not a 3D/WebGL
//     model (no 3D library is part of this stack, and adding one wasn't
//     approved as a new dependency).
//   - A coach's "current location" / "ETA" is derived from the trip's shared
//     itinerary (today's stop the timeline says is current/next) — the
//     schema has one itinerary per TRIP, not a separate route per coach, so
//     the timeline's inline stop detail shows the whole fleet's coach/
//     delegate counts rather than per-stop coach assignment.
//   - The activity feed is a live, ephemeral, in-memory list (resets if the
//     backend restarts) — deliberately mirroring data.js's own ACTIVITY
//     pattern for JQ's Dashboard, not a new persisted audit table.
//   - Reassignment: mouse/pen users can still drag a card between fleet
//     cards; EVERYONE (including touch) can also reassign from the delegate
//     detail panel's "Move to" control — that's this feature's
//     touch-friendly alternative to drag, rather than a separate gesture.
//
// ROUTING WORKAROUND (unchanged from v1): App.jsx only ever routes a bare
// "/trips" to this component, so it switches between the trip grid
// (TripsListPage.jsx) and this trip's board using the ?tripId= search param
// instead of a route param.
//
// API paths: unchanged from v1 (see backend/routes/desmond.js's header for
// the full route-collision-avoidance rationale), plus
// GET/POST /api/trips/:tripId/activity and PATCH /api/delegates/:id/details.

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  PencilLine, UserPlus, Loader2, AlertCircle, GripVertical, CheckCircle2,
  ArrowRight, Star, X, Plus, Trash2, Edit2, Bus, Users, MessageSquare,
  Search, Activity, MapPin, Building2, Landmark, UtensilsCrossed,
  Factory, Plane, Accessibility, Clock, Navigation, Gauge,
} from "lucide-react";
import { apiGet, apiPost, apiPatch, apiDelete, getPermissions } from "../lib/api.js";
import { useLang } from "../lib/i18n.jsx";
import TripsListPage, { useTfTheme } from "./TripsListPage.jsx";
import "./TripCoachPage.css";

const UNASSIGNED_COL = "__unassigned__";
const DRAG_THRESHOLD = 8; // px — below this a pointer-up is a tap, not a drag
const STOP_W = 148; // px — must match .tf-stop { width: 148px } in the CSS

const TRIP_STATUS_COLOR = { "In progress": "green", Planning: "blue", Completed: "grey", Cancelled: "red" };

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
const AVATAR_COLORS = ["blue", "purple", "green", "yellow", "grey"];
function avatarColorKey(id) {
  const s = String(id);
  return AVATAR_COLORS[s.charCodeAt(s.length - 1) % AVATAR_COLORS.length];
}
function toMinutes(hhmm) {
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
function coachOccupancy(coach) {
  const pct = coach.capacity > 0 ? (coach.total / coach.capacity) * 100 : 0;
  if (pct >= 100) return { pct, label: "Full", color: "red" };
  if (pct >= 70) return { pct, label: "Nearly Full", color: "yellow" };
  return { pct, label: "Available", color: "green" };
}
function timeAgo(iso) {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
const ACTIVITY_COLOR = { checkin: "green", coach: "blue", delegate: "blue", itinerary: "yellow", system: "grey" };
const ACTIVITY_ICON = { checkin: CheckCircle2, coach: Bus, delegate: Users, itinerary: MapPin, system: Activity };

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
      <div className="tf-skeleton" style={{ height: 150, borderRadius: 24, marginBottom: 20 }} />
      <div className="tf-skeleton" style={{ height: 140, borderRadius: 16, marginBottom: 20 }} />
      <div className="tf-flex tf-gap-12">
        {[0, 1, 2].map((i) => <div key={i} className="tf-skeleton" style={{ height: 220, width: 264, borderRadius: 16, flexShrink: 0 }} />)}
      </div>
    </div>
  );
}

/* ---- DelegateCard ------------------------------------------------------------
 * The WHOLE card is the drag target for mouse/pen (onPointerDown lives on the
 * outer div). Every pointer type can also tap to open the detail panel, which
 * includes a "Move to" control — the touch-friendly alternative to drag.
 * v3: cards stay compact regardless of content — a hover/focus tooltip
 * reveals the full company/accessibility/notes text (progressive disclosure)
 * instead of growing the card's default height.
 * ---------------------------------------------------------------------------- */
function DelegateCard({ delegate, ghost = false, dragging = false, onPointerDownCard, onRemove }) {
  const { t } = useLang();
  const isMissing = delegate.status === "MISSING";
  const colorKey = avatarColorKey(delegate.id);
  const hasExtra = !ghost && !!(delegate.company || delegate.accessibilityNotes || delegate.notes);

  return (
    <div
      onPointerDown={ghost ? undefined : (e) => onPointerDownCard(e, delegate)}
      tabIndex={ghost ? undefined : 0}
      className={`tf-delegate-card${dragging && !ghost ? " is-dragging" : ""}${isMissing ? " is-missing" : ""}${delegate.vip ? " is-vip" : ""}`}
    >
      <GripVertical size={13} style={{ color: "var(--tf-text-3)", flexShrink: 0, marginTop: 2 }} />
      {delegate.photoUrl ? (
        <img src={delegate.photoUrl} alt="" className="tf-avatar" style={{ objectFit: "cover" }} />
      ) : (
        <div className="tf-avatar" style={{ background: isMissing ? "var(--tf-red-bg)" : `var(--tf-${colorKey}-bg)`, color: isMissing ? "var(--tf-red)" : `var(--tf-${colorKey})` }}>
          {initials(delegate.name)}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="tf-delegate-name">
          {delegate.name}
          {!!delegate.vip && <Star size={11} fill="var(--tf-purple)" color="var(--tf-purple)" />}
          {!!delegate.accessibilityNotes && <Accessibility size={11} color="var(--tf-blue)" />}
        </div>
        {delegate.company && <div className="tf-delegate-company">{delegate.company}</div>}
        {delegate.notes && <div className="tf-delegate-note">{delegate.notes}</div>}
      </div>
      {!ghost && onRemove && (
        <button
          className="tf-toast-close"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onRemove(delegate.id, delegate.name); }}
          title={t("Remove delegate")}
        >
          <X size={12} />
        </button>
      )}
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

/* ---- FleetCard (coach column in the unified Fleet workspace grid) ------------- */
function FleetCard({ coach, delegates, isUnassigned = false, isOver, colRef, onPointerDownCard, draggingId, onRemoveCoach, onRemoveDelegate, onEditStaff, currentStopLabel, nextStop }) {
  const { t } = useLang();
  const occ = isUnassigned ? null : coachOccupancy(coach);
  const missing = delegates.filter((d) => d.status === "MISSING").length;

  return (
    <div ref={colRef} className={`tf-fleet-card${isOver ? " is-drop-target" : ""}${isUnassigned ? " is-unassigned" : ""}`}>
      <div className="tf-fleet-head">
        <div className="tf-flex tf-gap-10" style={{ minWidth: 0 }}>
          <div className="tf-fleet-bus-icon" style={{ background: isUnassigned ? "var(--tf-yellow-bg)" : "var(--tf-accent-grad)", color: isUnassigned ? "var(--tf-yellow)" : "#fff" }}>
            <Bus size={20} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="tf-fleet-label" title={coach.label}>{coach.label}</div>
            {!isUnassigned && <div className="tf-fleet-sub">{coach.capacity} {t("seats")}</div>}
          </div>
        </div>
        <div className="tf-flex tf-gap-6" style={{ alignItems: "flex-start" }}>
          {!isUnassigned && occ && (
            <span className="tf-status-chip" style={{ color: `var(--tf-${occ.color})`, background: `var(--tf-${occ.color}-bg)` }}>{t(occ.label)}</span>
          )}
          {!isUnassigned && onRemoveCoach && (
            <button className="tf-toast-close" onClick={() => onRemoveCoach(coach.id, coach.label)} title={`${t("Remove")} ${coach.label}`}><X size={14} /></button>
          )}
        </div>
      </div>

      {!isUnassigned && occ && (
        <div className="tf-progress-bar">
          <div className="tf-progress-fill" style={{ width: `${Math.min(100, occ.pct)}%`, background: `var(--tf-${occ.color})` }} />
        </div>
      )}

      {!isUnassigned ? (
        <div className="tf-fleet-people">
          <div className="tf-fleet-people-row"><Users size={12} color="var(--tf-text-3)" style={{ flexShrink: 0 }} />
            {onEditStaff ? (
              <button onClick={() => onEditStaff(coach)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--tf-text)", fontWeight: 700, textDecoration: "underline dotted" }}>
                {coach.staffName || t("No staff assigned")}
              </button>
            ) : (
              <span style={{ fontWeight: 700 }}>{coach.staffName || t("No staff assigned")}</span>
            )}
            <span className="tf-muted" style={{ flexShrink: 0 }}>· {t("guide")}</span>
          </div>
          <div className="tf-fleet-people-row"><Navigation size={12} color="var(--tf-text-3)" style={{ flexShrink: 0 }} /> <span>{coach.driverName || t("No driver set")}</span> <span className="tf-muted" style={{ flexShrink: 0 }}>· {t("driver")}</span></div>
          <div className="tf-fleet-people-row"><MapPin size={12} color="var(--tf-text-3)" style={{ flexShrink: 0 }} /> <span className="tf-muted">{currentStopLabel || t("No itinerary yet")}</span></div>
          {nextStop && <div className="tf-fleet-people-row"><Clock size={12} color="var(--tf-text-3)" style={{ flexShrink: 0 }} /> <span className="tf-muted">{t("ETA")} {nextStop.startTime} — {nextStop.title}</span></div>}
          <div className="tf-fleet-people-row">
            <Gauge size={12} color="var(--tf-text-3)" style={{ flexShrink: 0 }} />
            <span>{coach.boarded ?? 0}/{coach.total ?? 0} {t("boarded")}</span>
            {missing > 0 && <span style={{ color: "var(--tf-red)", fontWeight: 700, flexShrink: 0 }}>· {missing} {t("missing")}</span>}
          </div>
        </div>
      ) : (
        <div className="tf-muted" style={{ fontSize: 12, marginTop: 10 }}>{t("Needs a coach")}</div>
      )}

      <div className="tf-fleet-body">
        {delegates.map((d) => (
          <DelegateCard key={d.id} delegate={d} dragging={draggingId === d.id} onPointerDownCard={onPointerDownCard} onRemove={onRemoveDelegate} />
        ))}
        {isOver && <div style={{ border: "2px dashed var(--tf-blue)", borderRadius: 10, padding: "14px 8px", textAlign: "center", color: "var(--tf-blue)", fontSize: 12, fontWeight: 700 }}>{t("Drop here")}</div>}
        {delegates.length === 0 && !isOver && <div className="tf-fleet-empty">{t("Empty")}</div>}
      </div>
    </div>
  );
}

/* ---- DelegateDetailPanel — slide-out on tap, with a reassignment control ----- */
function DelegateDetailPanel({ delegate, coaches, coachLabel, onClose, onSave, onReassign, canEdit = true }) {
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

  // PRESENT kept as a legacy alias — some check-in routes still write it
  // directly (see normalize() in backend/data.js), not yet migrated to
  // ARRIVED (deferred, see the 5-status plan).
  const STATUS_LABEL = { PRESENT: "Arrived", ARRIVED: "Arrived", ASSIGNED: "Assigned", LATE: "Late", MISSING: "Missing", UNASSIGNED: "Unassigned" };
  const STATUS_COLOR2 = { PRESENT: "green", ARRIVED: "green", ASSIGNED: "blue", LATE: "orange", MISSING: "red", UNASSIGNED: "yellow" };
  const colorKey = avatarColorKey(delegate.id);

  return (
    <>
      <div className="tf-panel-overlay" onClick={onClose} />
      <div className="tf-panel" style={{ transform: visible ? "translateX(0)" : "translateX(100%)" }}>
        <div className="tf-between" style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 18, fontWeight: 800 }}>{t("Delegate details")}</h3>
          <button className="tf-btn tf-btn-ghost tf-btn-icon-only" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="tf-flex tf-gap-12" style={{ marginBottom: 18 }}>
          {delegate.photoUrl ? (
            <img src={delegate.photoUrl} alt="" className="tf-avatar" style={{ width: 46, height: 46, objectFit: "cover" }} />
          ) : (
            <div className="tf-avatar" style={{ width: 46, height: 46, fontSize: 16, background: `var(--tf-${colorKey}-bg)`, color: `var(--tf-${colorKey})` }}>
              {initials(delegate.name)}
            </div>
          )}
          <div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>
              {delegate.name}
              {!!delegate.vip && <Star size={14} fill="var(--tf-purple)" color="var(--tf-purple)" style={{ marginLeft: 6, verticalAlign: "middle" }} />}
            </div>
            <span className="tf-status-chip" style={{ marginTop: 4, color: `var(--tf-${STATUS_COLOR2[delegate.status]})`, background: `var(--tf-${STATUS_COLOR2[delegate.status]}-bg)` }}>
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
      </div>
    </>
  );
}

/* =============================================================================
 *  JourneyTimeline — today's itinerary with an animated bus marker
 *  v3: clicking a stop expands an INLINE detail panel below the whole track
 *  (time / category / location / fleet context) instead of a floating
 *  popover — the brief wants this to read as part of the page, not an
 *  overlay. Coaches aren't tied to individual stops in the schema (the whole
 *  fleet shares one itinerary), so "assigned coaches" here honestly means
 *  "the whole fleet, currently" rather than invented per-stop assignment.
 * ========================================================================== */
function JourneyTimeline({ items, dayNumber, onAddClick, coachCount, delegateCount }) {
  const { t } = useLang();
  const [openId, setOpenId] = useState(null);
  const [nowMinutes, setNowMinutes] = useState(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); });

  useEffect(() => {
    const iv = setInterval(() => { const d = new Date(); setNowMinutes(d.getHours() * 60 + d.getMinutes()); }, 30000);
    return () => clearInterval(iv);
  }, []);

  const { segIndex, frac } = useMemo(() => {
    if (items.length === 0) return { segIndex: 0, frac: 0 };
    const times = items.map((i) => toMinutes(i.startTime));
    let idx = 0;
    for (let i = 0; i < times.length; i++) if (times[i] <= nowMinutes) idx = i;
    let f = 0;
    if (idx < items.length - 1) {
      const a = times[idx], b = times[idx + 1];
      f = b > a ? Math.min(1, Math.max(0, (nowMinutes - a) / (b - a))) : 0;
    }
    return { segIndex: idx, frac: f };
  }, [items, nowMinutes]);

  if (items.length === 0) {
    return (
      <p style={{ fontSize: 13, color: "var(--tf-text-3)" }}>
        {t("No activities for Day")} {dayNumber}.{onAddClick && " "}
        {onAddClick && (
          <button style={{ background: "none", border: "none", color: "var(--tf-blue)", cursor: "pointer", fontSize: 13, padding: 0, fontWeight: 700 }} onClick={onAddClick}>
            {t("Add one →")}
          </button>
        )}
      </p>
    );
  }

  // All three of these share one coordinate system: pixels from the track's
  // own left edge. Stop i's node is centered at i*STOP_W + STOP_W/2 (stops
  // are STOP_W-wide flex columns with the node centered inside), so the line
  // itself starts at STOP_W/2 and the bus/fill positions line up exactly
  // under the stop nodes regardless of how many stops there are.
  const busPos = (segIndex + frac) * STOP_W + STOP_W / 2;
  const lineStart = STOP_W / 2;
  const lineWidth = Math.max(0, (items.length - 1) * STOP_W);
  const openItem = openId ? items.find((i) => i.id === openId) : null;
  const openMeta = openItem ? (CATEGORY_META[openItem.category] || CATEGORY_META.other) : null;
  const OpenIcon = openMeta ? openMeta.icon : null;

  return (
    <div className="tf-timeline-wrap">
      <div className="tf-timeline-track">
        <div className="tf-timeline-line" style={{ left: lineStart, width: lineWidth }}>
          <div className="tf-timeline-line-fill" style={{ width: Math.max(0, busPos - lineStart) }} />
        </div>
        <div className="tf-bus-marker" style={{ left: busPos }}>
          <div className="tf-bus-marker-icon"><Bus size={16} /></div>
        </div>
        {items.map((item, idx) => {
          const meta = CATEGORY_META[item.category] || CATEGORY_META.other;
          const Icon = meta.icon;
          const state = idx < segIndex ? "is-done" : idx === segIndex ? "is-now" : idx === segIndex + 1 ? "is-next" : "";
          return (
            <button
              key={item.id}
              className={`tf-stop ${state}${openId === item.id ? " is-open" : ""}`}
              style={{ width: STOP_W }}
              onClick={() => setOpenId(openId === item.id ? null : item.id)}
              aria-expanded={openId === item.id}
            >
              {state === "is-now" && <span className="tf-stop-now-pill">{t("NOW")}</span>}
              <div className="tf-stop-node"><Icon size={17} /></div>
              <div className="tf-stop-time">{item.startTime}</div>
              <div className="tf-stop-title">{item.title}</div>
            </button>
          );
        })}
      </div>

      {openItem && (
        <div className="tf-stop-detail">
          <div className="tf-stop-detail-head">
            <span className="tf-stop-detail-title">{OpenIcon && <OpenIcon size={16} />} {openItem.title}</span>
            <button className="tf-stop-detail-close" onClick={() => setOpenId(null)} title={t("Close")}><X size={15} /></button>
          </div>
          <div className="tf-stop-detail-grid">
            <div className="tf-stop-detail-item">
              <span className="tf-stop-detail-label">{t("Time")}</span>
              <span className="tf-stop-detail-value"><Clock size={13} /> {openItem.startTime}</span>
            </div>
            <div className="tf-stop-detail-item">
              <span className="tf-stop-detail-label">{t("Category")}</span>
              <span className="tf-stop-detail-value">{t(openMeta.label)}</span>
            </div>
            {openItem.location && (
              <div className="tf-stop-detail-item">
                <span className="tf-stop-detail-label">{t("Location")}</span>
                <span className="tf-stop-detail-value"><MapPin size={13} /> {openItem.location}</span>
              </div>
            )}
            {typeof coachCount === "number" && (
              <div className="tf-stop-detail-item">
                <span className="tf-stop-detail-label">{t("Assigned coaches")}</span>
                <span className="tf-stop-detail-value"><Bus size={13} /> {coachCount} {t(coachCount === 1 ? "coach" : "coaches")}</span>
              </div>
            )}
            {typeof delegateCount === "number" && (
              <div className="tf-stop-detail-item">
                <span className="tf-stop-detail-label">{t("Delegates")}</span>
                <span className="tf-stop-detail-value"><Users size={13} /> {delegateCount}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* =============================================================================
 *  Hero — contextual header, not a stats dashboard. v3 drops every KPI card;
 *  the only thing it surfaces proactively is a red "N missing" pill, and only
 *  when N > 0, so the header stays calm when there's nothing to flag.
 * ========================================================================== */
function Hero({ trip, currentStop, nextStop, progressFraction, missingCount, coachCount, delegateCount, onEditItinerary, onAddDelegate, canEdit = true }) {
  const { t } = useLang();
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => { const iv = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(iv); }, []);

  return (
    <div className="tf-hero">
      <div className="tf-hero-top">
        <div>
          <div className="tf-flex tf-gap-8" style={{ alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
            <span className="tf-live-badge"><span className="tf-live-dot" /> {t("LIVE")}</span>
            <span className="tf-status-chip" style={{ background: "rgba(255,255,255,0.18)", color: "#fff" }}>{t(trip.status)}</span>
            {missingCount > 0 && (
              <span className="tf-hero-alert"><AlertCircle size={12} /> {missingCount} {t("missing")}</span>
            )}
          </div>
          <div className="tf-hero-title">{trip.name}</div>
        </div>
      </div>

      <div className="tf-hero-meta">
        <div className="tf-hero-meta-item">
          <span className="tf-hero-meta-label">{t("Day")}</span>
          <span className="tf-hero-meta-value">{trip.dayOf} / {trip.totalDays}</span>
        </div>
        <div className="tf-hero-meta-item">
          <span className="tf-hero-meta-label">{t("Current location")}</span>
          <span className="tf-hero-meta-value"><MapPin size={13} /> {currentStop?.title || trip.name}</span>
        </div>
        <div className="tf-hero-meta-item">
          <span className="tf-hero-meta-label">{t("Next destination")}</span>
          <span className="tf-hero-meta-value"><ArrowRight size={13} /> {nextStop?.title || t("End of day")}</span>
        </div>
        <div className="tf-hero-meta-item">
          <span className="tf-hero-meta-label">{t("Fleet")}</span>
          <span className="tf-hero-meta-value">
            <Bus size={13} /> {coachCount} {t(coachCount === 1 ? "coach" : "coaches")} · {delegateCount} {t(delegateCount === 1 ? "delegate" : "delegates")}
          </span>
        </div>
        <div className="tf-hero-meta-item">
          <span className="tf-hero-meta-label">{t("Local time")}</span>
          <span className="tf-hero-meta-value"><Clock size={13} /> {clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      </div>

      <div className="tf-hero-progress">
        <div className="tf-hero-progress-track"><div className="tf-hero-progress-fill" style={{ width: `${Math.round(progressFraction * 100)}%` }} /></div>
        <div className="tf-hero-progress-label">{t("Trip progress")} · {Math.round(progressFraction * 100)}%</div>
      </div>

      {canEdit && (
      <div className="tf-hero-actions">
        <button className="tf-btn tf-btn-glass" onClick={onEditItinerary}><PencilLine size={14} /> {t("Edit itinerary")}</button>
        <button className="tf-btn tf-btn-solid" onClick={onAddDelegate}><UserPlus size={14} /> {t("Add delegate")}</button>
      </div>
      )}
    </div>
  );
}

/* =============================================================================
 *  Activity feed — v3: a visually quieter supporting side panel (flatter
 *  card, no shadow — see .tf-activity-panel) with small kind-coloured icon
 *  badges instead of plain dots.
 * ========================================================================== */
function ActivityFeed({ activity }) {
  const { t } = useLang();
  return (
    <div className="tf-card tf-activity-panel" style={{ maxHeight: 340, overflowY: "auto" }}>
      <div className="tf-section-head" style={{ marginBottom: 10 }}>
        <span className="tf-section-title" style={{ fontSize: 15 }}><Activity size={15} /> {t("Live activity")}</span>
      </div>
      {activity.length === 0 ? (
        <div className="tf-activity-empty">{t("No activity yet.")}</div>
      ) : (
        activity.map((a) => {
          const Icon = ACTIVITY_ICON[a.kind] || Activity;
          const color = ACTIVITY_COLOR[a.kind] || "grey";
          return (
            <div key={a.id} className="tf-activity-item">
              <span className="tf-activity-icon" style={{ background: `var(--tf-${color}-bg)`, color: `var(--tf-${color})` }}>
                <Icon size={12} />
              </span>
              <div>
                <div className="tf-activity-text">{a.text}</div>
                <div className="tf-activity-time">{timeAgo(a.at)}</div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

/* ---- EditItineraryModal (category select) -------------------------- */
function EditItineraryModal({ tripId, itinerary, categories, onClose, onRefresh, askConfirm }) {
  const { t } = useLang();
  const days = [...new Set(itinerary.map((i) => i.dayNumber))].sort((a, b) => a - b);
  const maxDay = days.length > 0 ? Math.max(...days) : 0;

  const [activeForm, setActiveForm] = useState(null);
  const [form, setForm] = useState({ dayNumber: 1, startTime: "", title: "", location: "", category: "other" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function openAdd(day) {
    setForm({ dayNumber: day, startTime: "", title: "", location: "", category: "other" });
    setActiveForm({ mode: "add", dayNumber: day });
    setError(null);
  }
  function openEdit(item) {
    setForm({ dayNumber: item.dayNumber, startTime: item.startTime, title: item.title, location: item.location || "", category: item.category || "other" });
    setActiveForm({ mode: "edit", item });
    setError(null);
  }
  function cancelForm() { setActiveForm(null); setError(null); }

  async function handleSave() {
    if (!form.title.trim()) { setError(t("Title is required")); return; }
    if (!form.startTime) { setError(t("Time is required")); return; }
    setSaving(true); setError(null);
    try {
      if (activeForm.mode === "add") {
        await apiPost(`/trips/${tripId}/itinerary`, {
          dayNumber: Number(form.dayNumber), startTime: form.startTime, category: form.category,
          title: form.title.trim(), location: form.location.trim() || null,
          sortOrder: itinerary.filter((i) => i.dayNumber === Number(form.dayNumber)).length,
        });
      } else {
        await apiPatch(`/trips/${tripId}/itinerary/${activeForm.item.id}`, {
          dayNumber: Number(form.dayNumber), startTime: form.startTime, category: form.category,
          title: form.title.trim(), location: form.location.trim() || null,
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
      <input className="tf-input" style={{ marginBottom: 14 }} placeholder={t("e.g. Tan S.L.")} value={name}
        onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSubmit()} autoFocus />

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
  const [dark] = useTfTheme();
  const canEdit = getPermissions().manageTrips; // "View for all, edit gated" (see permissions.js)

  const [trip, setTrip] = useState(null);
  const [coaches, setCoaches] = useState([]);
  const [delegates, setDelegates] = useState([]);
  const [itinerary, setItinerary] = useState([]);
  const [categories, setCategories] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loadError, setLoadError] = useState(null);

  const [showItinerary, setShowItinerary] = useState(false);
  const [showAddDelegate, setShowAddDelegate] = useState(false);
  const [showAddCoach, setShowAddCoach] = useState(false);
  const [editStaffCoach, setEditStaffCoach] = useState(null);
  const [panelDelegate, setPanelDelegate] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const [toasts, setToasts] = useState([]);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [sortMode, setSortMode] = useState("name");

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

  // Reports an event to the shared activity feed. Used both for this file's
  // own mutations and — crucially — for the two actions that actually run
  // through JQ's own routes (reassign, remove), which this router never sees.
  const reportActivity = useCallback((text, kind) => {
    apiPost(`/trips/${tripId}/activity`, { text, kind }).catch(() => { /* best-effort */ });
  }, [tripId]);

  const fetchAll = useCallback(async () => {
    try {
      const [tripData, coachData, itinData, delData, actData] = await Promise.all([
        apiGet(`/trips/${tripId}/summary`),
        apiGet(`/trips/${tripId}/coaches`),
        apiGet(`/trips/${tripId}/itinerary`),
        apiGet(`/delegates?tripId=${tripId}`),
        apiGet(`/trips/${tripId}/activity`),
      ]);
      setTrip(tripData);
      setCoaches(coachData.coaches);
      setItinerary(itinData.items);
      setCategories(itinData.categories || []);
      setDelegates(delData.delegates);
      setActivity(actData.activity || []);
    } catch (e) { setLoadError(e.message); }
  }, [tripId]);

  // 2s auto-refresh (was a one-shot load + a separate 15s activity-only
  // poll) so a change made by another signed-in staff member — a coach
  // capacity edit, a delegate reassignment, an itinerary update — shows up
  // here without a manual refresh. fetchAll() already covers activity too,
  // so the old dedicated activity interval is now redundant and removed.
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
    if (!canEdit) return; // reassign needs the manageTrips permission
    if (toCoachId === delegate.coachId) return;
    // Dropping onto a coach means "expected on this coach, not yet checked
    // in" — that's ASSIGNED in the 5-status model, not MISSING. MISSING is
    // reserved for a genuine failure to show (a real check-in/scan miss, or
    // an explicit staff override), not just "hasn't boarded yet because they
    // were only just assigned a minute ago". Only UNASSIGNED delegates get
    // this default; a delegate who already has a real status (ARRIVED/LATE/
    // MISSING/ASSIGNED) keeps it when moved between coaches — being dragged
    // to a different coach doesn't reset their arrival state.
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

  async function handleSaveDetails(delegateId, fields) {
    const updated = await apiPatch(`/delegates/${delegateId}/details`, fields);
    setDelegates((ds) => ds.map((d) => (d.id === delegateId ? updated : d)));
    setPanelDelegate(updated);
    pushToast(t("Save changes") + " ✓");
  }

  /* ---- derived ---- */
  const visibleDelegates = useMemo(() => {
    let list = delegates;
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((d) => d.name.toLowerCase().includes(q) || (d.company || "").toLowerCase().includes(q));
    // Legacy rows may still hold "PRESENT" (routes that haven't migrated to
    // writing "ARRIVED" yet) — alias so they show up under "Arrived" instead
    // of vanishing from that filter.
    if (statusFilter !== "ALL") list = list.filter((d) => (d.status === "PRESENT" ? "ARRIVED" : d.status) === statusFilter);
    list = [...list].sort((a, b) => {
      if (sortMode === "vip") return (b.vip ? 1 : 0) - (a.vip ? 1 : 0) || a.name.localeCompare(b.name);
      if (sortMode === "status") return a.status.localeCompare(b.status) || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [delegates, query, statusFilter, sortMode]);

  const delegatesByCoach = {};
  for (const d of visibleDelegates) {
    const key = d.coachId ?? UNASSIGNED_COL;
    if (!delegatesByCoach[key]) delegatesByCoach[key] = [];
    delegatesByCoach[key].push(d);
  }

  const currentDay = trip?.dayOf ?? 1;
  const todayItems = useMemo(
    () => itinerary.filter((i) => i.dayNumber === currentDay).sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [itinerary, currentDay]
  );
  const nowMinutes = useMemo(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }, [activity]); // re-derive periodically alongside activity polling
  const { currentStop, nextStop, dayFraction } = useMemo(() => {
    if (todayItems.length === 0) return { currentStop: null, nextStop: null, dayFraction: 0 };
    const times = todayItems.map((i) => toMinutes(i.startTime));
    let idx = 0;
    for (let i = 0; i < times.length; i++) if (times[i] <= nowMinutes) idx = i;
    const frac = todayItems.length > 1 ? idx / (todayItems.length - 1) : 1;
    return { currentStop: todayItems[idx], nextStop: todayItems[idx + 1] || null, dayFraction: frac };
  }, [todayItems, nowMinutes]);

  const tripProgress = trip ? Math.min(1, ((trip.dayOf - 1) + dayFraction) / Math.max(1, trip.totalDays)) : 0;
  const presentCount = delegates.filter((d) => d.status === "PRESENT").length;
  const missingCount = delegates.filter((d) => d.status === "MISSING").length;
  const capacityTotal = coaches.reduce((s, c) => s + (c.capacity || 0), 0);
  const capacityUsed = coaches.reduce((s, c) => s + (c.total || 0), 0);
  const capacityPct = capacityTotal > 0 ? Math.round((capacityUsed / capacityTotal) * 100) : 0;

  const panelCoachLabel = panelDelegate ? (coaches.find((c) => c.id === panelDelegate.coachId)?.label || null) : null;

  if (!trip && !loadError) {
    return <div className={`tf-root${dark ? " tf-dark" : ""}`}><div className="tf-page"><SkeletonBoard /></div></div>;
  }
  if (loadError) {
    return (
      <div className={`tf-root${dark ? " tf-dark" : ""}`}>
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
    <div className={`tf-root${dark ? " tf-dark" : ""}`}>
      <div className="tf-page">
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
        {confirmState && <ConfirmDialog title={confirmState.title} message={confirmState.message} tone={confirmState.tone} onCancel={() => closeConfirm(false)} onConfirm={() => closeConfirm(true)} />}
        {editStaffCoach && <EditCoachStaffModal coach={editStaffCoach} onClose={() => setEditStaffCoach(null)} onSaved={(updated) => { setCoaches((cs) => cs.map((c) => (c.id === updated.id ? { ...c, ...updated } : c))); pushToast(t("Save changes") + " ✓"); }} />}
        {showItinerary && <EditItineraryModal tripId={tripId} itinerary={itinerary} categories={categories} onClose={() => setShowItinerary(false)} onRefresh={refreshItinerary} askConfirm={askConfirm} />}
        {showAddDelegate && <AddDelegateModal tripId={tripId} onClose={() => setShowAddDelegate(false)} onAdded={handleDelegateAdded} />}
        {showAddCoach && <AddCoachModal tripId={tripId} existingCount={coaches.length} onClose={() => setShowAddCoach(false)} onAdded={(c) => { fetchAll(); pushToast(`${c.label} ${t("added")}.`); }} />}
        {panelDelegate && (
          <DelegateDetailPanel
            delegate={panelDelegate} coaches={coaches} coachLabel={panelCoachLabel}
            onClose={() => setPanelDelegate(null)} onSave={handleSaveDetails}
            onReassign={(d, toId) => handleReassign(d, toId)} canEdit={canEdit}
          />
        )}
        {ghost && <div className="tf-bus-marker" style={{ position: "fixed", left: ghost.x + 12, top: ghost.y + 12, transform: "none", zIndex: 2000, pointerEvents: "none", width: 220 }}><DelegateCard delegate={ghost.delegate} ghost /></div>}

        <button className="tf-back-btn" style={{ marginBottom: 16 }} onClick={() => navigate("/trips")}>← {t("Back to trips")}</button>

        <Hero
          trip={trip} currentStop={currentStop} nextStop={nextStop} progressFraction={tripProgress}
          missingCount={missingCount} coachCount={coaches.length} delegateCount={delegates.length}
          canEdit={canEdit}
          onEditItinerary={() => setShowItinerary(true)} onAddDelegate={() => setShowAddDelegate(true)}
        />

        <div className="tf-card">
          <div className="tf-section-head">
            <span className="tf-section-title"><Navigation size={16} /> {t("Journey timeline")} · {t("Day")} {currentDay}</span>
          </div>
          <JourneyTimeline items={todayItems} dayNumber={currentDay} onAddClick={canEdit ? () => setShowItinerary(true) : undefined} coachCount={coaches.length} delegateCount={delegates.length} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "2.2fr 1fr", gap: 20, alignItems: "flex-start" }}>
          <div className="tf-card" style={{ minWidth: 0 }}>
            <div className="tf-section-head">
              <div>
                <span className="tf-section-title"><Bus size={16} /> {t("Fleet")}</span>
                <div className="tf-section-sub">{t("Drag any delegate card between coaches to reassign — a quick tap opens their details.")}</div>
              </div>
              <div className="tf-section-stats">
                <span>{presentCount}/{delegates.length} {t("checked in")}</span>
                <span>·</span>
                <span>{capacityPct}% {t("capacity")}</span>
                {missingCount > 0 && (
                  <>
                    <span>·</span>
                    <span className="tf-alert-text">{missingCount} {t("missing")}</span>
                  </>
                )}
              </div>
            </div>

            <div className="tf-toolbar">
              <div className="tf-search"><Search size={14} color="var(--tf-text-3)" /><input placeholder={t("Search delegates or company…")} value={query} onChange={(e) => setQuery(e.target.value)} /></div>
              <select className="tf-select-pill" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="ALL">{t("All statuses")}</option>
                <option value="UNASSIGNED">{t("Unassigned")}</option>
                <option value="ASSIGNED">{t("Assigned")}</option>
                <option value="ARRIVED">{t("Arrived")}</option>
                <option value="LATE">{t("Late")}</option>
                <option value="MISSING">{t("Missing")}</option>
              </select>
              <select className="tf-select-pill" value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
                <option value="name">{t("Sort: Name")}</option>
                <option value="vip">{t("Sort: VIP first")}</option>
                <option value="status">{t("Sort: Status")}</option>
              </select>
            </div>

            <div className="tf-fleet-scroll">
              {coaches.map((coach) => (
                <FleetCard
                  key={coach.id} coach={coach} delegates={delegatesByCoach[coach.id] || []}
                  isOver={overCol === coach.id} colRef={(node) => { colRefs.current[coach.id] = node; }}
                  onPointerDownCard={onPointerDownCard} draggingId={ghost?.delegate?.id}
                  onRemoveCoach={canEdit ? handleRemoveCoach : undefined} onRemoveDelegate={canEdit ? handleRemoveDelegate : undefined} onEditStaff={canEdit ? setEditStaffCoach : undefined}
                  currentStopLabel={currentStop?.title} nextStop={nextStop}
                />
              ))}
              <FleetCard
                coach={{ id: UNASSIGNED_COL, label: t("Unassigned") }} delegates={delegatesByCoach[UNASSIGNED_COL] || []}
                isUnassigned isOver={overCol === UNASSIGNED_COL} colRef={(node) => { colRefs.current[UNASSIGNED_COL] = node; }}
                onPointerDownCard={onPointerDownCard} draggingId={ghost?.delegate?.id} onRemoveDelegate={canEdit ? handleRemoveDelegate : undefined}
              />
              {canEdit && <button className="tf-add-fleet-card" onClick={() => setShowAddCoach(true)}><Plus size={18} /> {t("Add coach")}</button>}
            </div>
          </div>

          <ActivityFeed activity={activity} />
        </div>
      </div>

      {/* Mobile floating quick actions */}
      {canEdit && (
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
