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
  Building2, Landmark, UtensilsCrossed, Factory, Plane, Accessibility, Navigation, Clock, Circle,
  ChevronDown, ChevronRight, ChevronLeft, Check, CloudOff,
} from "lucide-react";
import { apiGet, apiPost, apiPatch, apiDelete, getPermissions, getUser } from "../../lib/api.js";
// Offline-capable reassignment (Desmond, Phase 4) — wraps the validated
// PATCH /api/trips/:tripId/reassign in JQ's shared outbox so a move made with
// no signal is queued and replayed on reconnect. Shared with MobileTripsPage.
import { reassignRequest, applyQueuedReassigns } from "../../lib/reassignQueue.js";
// Offline-capable READ (2026-07-31) — the Trip/coach board is one of the
// pages flagged as most important ("the manual, attendance, exception,
// trip"): fetchAll() below used to just error out on any failure, including
// a dead signal. See lib/cachedFetch.js.
import { cachedFetch } from "../../lib/cachedFetch.js";
import CachedDataBadge from "../../components/CachedDataBadge.jsx";
import { useLang } from "../../lib/i18n.jsx";
import { useVisiblePolling } from "../../lib/useVisiblePolling.js";
import TripsListPage, { useTfTheme } from "./TripsListPage.jsx";
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
const STATUS_TEXT = { PRESENT: "Arrived", ARRIVED: "Arrived", ASSIGNED: "Assigned", LATE: "Late", MISSING: "Missing", UNASSIGNED: "Unassigned" };

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
  en_route:    { label: "Bus en route",    short: "En route",    color: "orange" },
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
// Display-only 12h formatting (2026-07-30 — "fix to 12 hr format"). The
// underlying itinerary_items.startTime stays a raw 24h "HH:MM" string
// everywhere else — toMinutes()/shiftTime()'s minute math, the sort-by-time
// comparators, and the native <input type="time"> all need that exact shape —
// this only prettifies what actually gets printed on screen.
function fmt12h(hhmm) {
  if (!hhmm) return hhmm;
  const [h, m] = String(hhmm).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${period}`;
}
// Live-derived date range (2026-07-30 — "make sure this one also follow", re
// the itinerary-driven Total days fix): trip.dateRange is a STORED string,
// only recomputed server-side when an itinerary write actually fires
// syncTotalDaysToItinerary() (desmond.js) — a trip whose totalDays this page
// already corrects on-render via displayTotalDays (below) would still show
// the OLD stale dateRange until some future edit happens to re-trigger a
// backend sync. Deriving it here the same way TripsListPage.jsx's
// computeDateRange() does — from startDate + the ALREADY-live
// displayTotalDays — means the two can never disagree on screen, regardless
// of whether the backend has caught up yet. Falls back to the stored string
// when startDate is missing (a trip nobody's set a real start date for yet).
function formatDayMonthYear(y, m, d) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, d)));
}
function liveDateRange(startDateStr, totalDays, fallback) {
  if (!startDateStr) return fallback || "";
  const [y, m, d] = startDateStr.split("-").map(Number);
  const n = Math.max(1, Number(totalDays) || 1);
  const startFmt = formatDayMonthYear(y, m, d);
  if (n <= 1) return startFmt;
  const end = new Date(Date.UTC(y, m - 1, d));
  end.setUTCDate(end.getUTCDate() + (n - 1));
  const endFmt = formatDayMonthYear(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate());
  return `${startFmt} – ${endFmt}`;
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
  // Only dismiss if the ENTIRE click gesture started on the backdrop itself
  // — not just where the mouse happened to be released. Without this, a
  // drag-to-select-text gesture that starts inside the message (or, more
  // commonly, in a field on the modal underneath this one) and ends over the
  // backdrop fires a native "click" there (click fires on the mouseup
  // target, regardless of where mousedown was), closing the dialog
  // unintentionally. 2026-07-23 fix.
  const downOnBackdrop = useRef(false);
  return (
    <div
      className="tf-modal-overlay tf-modal-overlay--confirm"
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) onCancel(); }}
    >
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


/* ---- CapacityDialog — over-capacity confirm/override -------------------------
 * Shown when a delegate is dropped onto (or moved to) a coach that's already at
 * capacity. Non-blocking: Cancel leaves everyone put; Override does the move
 * anyway. Renders as a centred dialog on desktop and a bottom sheet on mobile
 * (via .tf-cap-sheet responsive CSS). --------------------------------------- */
function CapacityDialog({ delegate, coach, onCancel, onOverride }) {
  const { t } = useLang();
  const downOnBackdrop = useRef(false);
  const used = coach.total ?? 0;
  return (
    <div
      className="tf-modal-overlay tf-cap-sheet"
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) onCancel(); }}
    >
      <div className="tf-modal-card tf-cap-dialog" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="tf-modal-header">
          <h3 style={{ fontSize: 16.5, fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
            <AlertCircle size={18} color="var(--tf-red)" /> {t("Coach is full")}
          </h3>
        </div>
        <div className="tf-modal-body">
          <p style={{ fontSize: 13.5, color: "var(--tf-text-2)", marginBottom: 14, lineHeight: 1.5 }}>
            {t("Moving")} <strong style={{ color: "var(--tf-text)" }}>{delegate.name}</strong> {t("onto")} <strong style={{ color: "var(--tf-text)" }}>{coach.label}</strong> {t("would put it over its seat capacity.")}
          </p>
          <div className="tf-cap-dialog-stats">
            <div className="tf-cap-dialog-row"><span className="tf-cap-dialog-k">{t("Coach")}</span><span className="tf-cap-dialog-v">{coach.label}</span></div>
            <div className="tf-cap-dialog-row"><span className="tf-cap-dialog-k">{t("Capacity")}</span><span className="tf-cap-dialog-v" style={{ color: "var(--tf-red)" }}>{used} / {coach.capacity} · {t("Full")}</span></div>
            <div className="tf-cap-dialog-row"><span className="tf-cap-dialog-k">{t("Delegate")}</span><span className="tf-cap-dialog-v">{delegate.name}</span></div>
          </div>
        </div>
        <div className="tf-modal-footer">
          <button className="tf-btn tf-btn-ghost" onClick={onCancel}>{t("Cancel")}</button>
          <button className="tf-btn tf-btn-primary" style={{ background: "var(--tf-red)", color: "#fff" }} onClick={onOverride}>{t("Override assignment")}</button>
        </div>
      </div>
    </div>
  );
}

/* ---- Modal shell ------------------------------------------------------------ */
function Modal({ title, onClose, maxWidth = 480, children, footer }) {
  const { t } = useLang();
  // Same drag-to-select fix as ConfirmDialog above — only dismiss if the
  // WHOLE click gesture (mousedown AND click) started on the backdrop
  // itself, not just wherever the mouse was released after a drag that
  // began inside a field (e.g. selecting text in the Activity title input).
  const downOnBackdrop = useRef(false);
  return (
    <div
      className="tf-modal-overlay"
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) onClose(); }}
    >
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
function DelegateCard({ delegate, ghost = false, dragging = false, wrongCoach = false, onPointerDownCard, onKeyOpen, onRemove }) {
  const { t } = useLang();
  const isMissing = delegate.status === "MISSING";
  const colorKey = STATUS_AVATAR[delegate.status] || "grey";
  const hasExtra = !ghost && !!(delegate.company || delegate.accessibilityNotes || delegate.notes);

  return (
    <div
      onPointerDown={ghost ? undefined : (e) => onPointerDownCard(e, delegate)}
      onKeyDown={ghost ? undefined : (e) => { if ((e.key === "Enter" || e.key === " ") && onKeyOpen) { e.preventDefault(); onKeyOpen(delegate); } }}
      tabIndex={ghost ? undefined : 0}
      className={`tf-delegate-card${dragging && !ghost ? " is-dragging" : ""}${isMissing ? " is-missing" : ""}${wrongCoach ? " is-wrongcoach" : ""}${delegate.vip ? " is-vip" : ""}`}
    >
      <div className="tf-avatar" style={{ background: `var(--tf-${colorKey}-bg)`, color: `var(--tf-${colorKey})` }}>
        {initials(delegate.name)}
      </div>
      <div className="tf-delegate-name">
        {delegate.name}
        {!!delegate.vip && <Star size={10} fill="var(--tf-purple)" color="var(--tf-purple)" />}
        {!!delegate.accessibilityNotes && <Accessibility size={10} color="var(--tf-blue)" />}
        {wrongCoach && (
          <span className="tf-wrongcoach-tag" title={t("Assigned to a coach that isn't on this trip — reassign or remove.")}>
            <AlertCircle size={10} /> {t("Wrong coach")}
          </span>
        )}
      </div>
      {!ghost && delegate.pendingSync && (
        <span className="tf-del-status" title={t("This move is waiting to sync — you're offline")} style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--tf-orange)", background: "var(--tf-orange-bg)" }}>
          <CloudOff size={9} /> {t("Pending")}
        </span>
      )}
      {!ghost && delegate.status && delegate.status !== "UNASSIGNED" && (
        <span className="tf-del-status" style={{ color: `var(--tf-${colorKey})`, background: `var(--tf-${colorKey}-bg)` }}>
          {t(STATUS_TEXT[delegate.status] || delegate.status)}
        </span>
      )}
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
function FleetCard({ coach, delegates, isUnassigned = false, isOver, colRef, onPointerDownCard, onKeyOpen, draggingId, onRemoveCoach, onRemoveDelegate, onEditStaff, onCycleArrival, mode = "live", wrongCoachIds, shake = false }) {
  const { t } = useLang();
  const [expanded, setExpanded] = useState(false);
  const missing = delegates.filter((d) => d.status === "MISSING").length;
  const showBoarding = mode !== "planning"; // "boarded"/missing/all-in are attendance facts — meaningless before the trip runs
  const visible = expanded ? delegates : delegates.slice(0, VISIBLE_LIMIT);
  const remaining = delegates.length - visible.length;
  const isFull = !isUnassigned && coach.capacity > 0 && (coach.total ?? 0) >= coach.capacity;
  // "Nearly full" (≥85%, not yet full) → amber drop tier, between blue (room)
  // and red (full), so a drag shows how much headroom a coach really has.
  const nearlyFull = !isUnassigned && !isFull && coach.capacity > 0 && (coach.total ?? 0) / coach.capacity >= 0.85;
  const dropTier = isFull ? "red" : nearlyFull ? "orange" : "blue";
  // Status accent so a coordinator can distinguish problem coaches at a glance:
  // red rail = someone missing, green rail = everyone boarded.
  const statusAccent = isUnassigned || !showBoarding ? "" : missing > 0 ? " has-missing" : (coach.total ?? 0) > 0 ? " all-in" : "";

  return (
    <div ref={colRef} className={`tf-fleet-card${isOver ? " is-drop-target" : ""}${isOver && isFull ? " is-full" : ""}${isOver && nearlyFull ? " is-nearfull" : ""}${isUnassigned ? " is-unassigned" : ""}${statusAccent}${shake ? " is-shake" : ""}`}>
      <div className="tf-fleet-head">
        <div style={{ minWidth: 0 }}>
          {!isUnassigned && onEditStaff ? (
            <button
              className="tf-fleet-label"
              onClick={() => onEditStaff(coach)}
              style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer" }}
              title={t("Switch staff")}
            >
              {!isUnassigned && <Bus size={15} className="tf-fleet-label-ico" />}{coach.label}
            </button>
          ) : (
            <span className="tf-fleet-label">{!isUnassigned && <Bus size={15} className="tf-fleet-label-ico" />}{coach.label}</span>
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
          {!isUnassigned && coach.captains?.length > 0 && (
            <div className="tf-fleet-captain">
              <Users size={11} /> {t(coach.captains.length > 1 ? "Captains" : "Captain")}: {coach.captains.map((c) => c.name || c.username).join(", ")}
            </div>
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
          ) : (coach.boarded ?? 0) < (coach.total ?? 0) ? (
            <span className="tf-badge-pill" style={{ background: "var(--tf-orange-bg)", color: "var(--tf-orange)" }}>{(coach.total ?? 0) - (coach.boarded ?? 0)} {t("not in")}</span>
          ) : (
            <span className="tf-badge-pill" style={{ background: "var(--tf-green-bg)", color: "var(--tf-green)" }}>{t("All in")}</span>
          )}
          {!isUnassigned && onRemoveCoach && (
            <button className="tf-toast-close" onClick={() => onRemoveCoach(coach.id, coach.label)} title={`${t("Remove")} ${coach.label}`}><X size={13} /></button>
          )}
        </div>
      </div>

      {!isUnassigned && coach.capacity > 0 && (() => {
        const used = coach.total ?? 0;
        const ratio = used / coach.capacity;
        const over = used > coach.capacity;
        // Operational capacity tiers (label + colour + icon) so staff read the
        // state, not the maths. Available < 85% · Almost full 85–99% · Full 100%
        // · Over capacity > 100%.
        const cap = over ? { color: "red", label: "Over capacity", Icon: AlertCircle }
          : ratio >= 1 ? { color: "red", label: "Full", Icon: AlertCircle }
          : ratio >= 0.85 ? { color: "orange", label: "Almost full", Icon: Clock }
          : { color: "green", label: "Available", Icon: CheckCircle2 };
        return (
          <div className="tf-fleet-capacity">
            <div className="tf-fleet-cap-track">
              <span key={used} className="tf-fleet-cap-fill tf-bump" style={{ width: `${Math.min(100, Math.round(ratio * 100))}%`, background: `var(--tf-${cap.color})` }} />
            </div>
            <span key={`n-${used}`} className="tf-fleet-cap-label tf-bump" style={{ color: `var(--tf-${cap.color})` }}>
              {used}<span style={{ color: "var(--tf-text-3)" }}>/{coach.capacity}</span>
            </span>
            <span className="tf-cap-badge" style={{ color: `var(--tf-${cap.color})`, background: `var(--tf-${cap.color}-bg)` }}>
              <cap.Icon size={11} /> {t(cap.label)}
            </span>
          </div>
        );
      })()}

      <div className="tf-fleet-body">
        {visible.map((d) => (
          <DelegateCard key={d.id} delegate={d} dragging={draggingId === d.id} wrongCoach={!!wrongCoachIds && wrongCoachIds.has(d.id)} onPointerDownCard={onPointerDownCard} onKeyOpen={onKeyOpen} onRemove={onRemoveDelegate} />
        ))}
        {isOver && (
          <div style={{ border: `2px dashed var(--tf-${dropTier})`, borderRadius: 10, padding: "12px 8px", textAlign: "center", color: `var(--tf-${dropTier})`, fontSize: 12, fontWeight: 700 }}>
            {isFull ? t("Coach is full") : nearlyFull ? t("Almost full — drop here") : t("Drop here")}
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
  // Same drag-to-select fix as Modal/ConfirmDialog above — only dismiss if
  // the WHOLE click gesture (mousedown AND click) started on the backdrop
  // itself, not wherever the mouse was released after a drag that began in
  // e.g. the Notes textarea.
  const downOnBackdrop = useRef(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Close on success (Desmond, 2026-08-02) — both used to leave the panel open
  // after a successful save/move, so the board change you just made was hidden
  // behind the very panel that made it. onClose() is INSIDE the try, so a
  // failure still leaves the panel up with its error rather than silently
  // dismissing the thing the user was working in.
  async function handleSave() {
    setSaving(true);
    try { await onSave(delegate.id, form); onClose(); }
    finally { setSaving(false); }
  }

  async function handleMove() {
    setMoving(true);
    try { await onReassign(delegate, moveTo || null); onClose(); }
    finally { setMoving(false); }
  }

  // 5-status labels (PRESENT is the legacy alias for ARRIVED). Chip colour
  // reuses STATUS_AVATAR since the two maps are identical value-for-value.
  const STATUS_LABEL = { PRESENT: "Arrived", ARRIVED: "Arrived", ASSIGNED: "Assigned", LATE: "Late", MISSING: "Missing", UNASSIGNED: "Unassigned" };
  const colorKey = STATUS_AVATAR[delegate.status] || "grey";

  return (
    <>
      <div
        className="tf-panel-overlay"
        onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
        onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) onClose(); }}
      />
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
function JourneyTimeline({ items, dayNumber, totalDays, onAddClick, canEdit = false, onSetStatus, onToggleComplete, onMoveStop, onOpenAttendance, isToday = true }) {
  const { t } = useLang();
  const [nowMinutes, setNowMinutes] = useState(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); });
  const [openId, setOpenId] = useState(null);       // stop whose live-status editor is open
  const [editMode, setEditMode] = useState(null);   // null | "delayed" | "moved" — reveals a sub-panel
  const [durH, setDurH] = useState(0);              // hours part of a delay / move amount
  const [durM, setDurM] = useState(15);             // minutes part of a delay / move amount
  const [moveDay, setMoveDay] = useState(dayNumber + 1);
  const [showPast, setShowPast] = useState(false);  // expand the collapsed "N done" earlier stops in the rail

  useEffect(() => {
    const iv = setInterval(() => { const d = new Date(); setNowMinutes(d.getHours() * 60 + d.getMinutes()); }, 30000);
    return () => clearInterval(iv);
  }, []);
  // Collapse the delay/move sub-panel whenever a different stop is opened.
  useEffect(() => { setEditMode(null); }, [openId]);

  // Index of the stop happening "now" = the last one whose scheduled time has
  // passed. -1 means the day hasn't reached its first stop yet. Forced to -1
  // when isToday is false — "now" is only meaningful for the trip's actual
  // current day; comparing wall-clock time-of-day against a DIFFERENT day's
  // schedule (previewed via the day switcher) would highlight a "current
  // stop" and show a misleading Now/Next/On-schedule summary for a day that
  // isn't actually happening right now.
  const segIndex = useMemo(() => {
    if (!isToday) return -1;
    let idx = -1;
    const times = items.map((i) => toMinutes(i.startTime));
    for (let i = 0; i < times.length; i++) if (times[i] <= nowMinutes) idx = i;
    return idx;
  }, [items, nowMinutes, isToday]);

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
    ? `${nextStop.title} · ${fmt12h(nextStop.startTime)}`
    : (dayNumber < totalDays ? `${t("Day")} ${dayNumber + 1}` : t("Free & easy"));
  // Phase 3 hierarchy helpers: live minutes-until-next (drives the countdown)
  // and the count of "earlier" stops (before now) that collapse behind a pill.
  const nextCountdownMin = nextStop ? toMinutes(nextStop.startTime) - nowMinutes : null;
  const pastCount = isToday && segIndex > 0 ? segIndex : 0;

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
      {/* Schedule summary — slimmed to context only (day · progress · on-time
          status). "Now"/"Next" used to be crammed in here too; they now live in
          the dominant focus band below, so this strip stays a quiet one-liner. */}
      <div className="tf-schedule">
        <span className="tf-schedule-day">{dayLabel}</span>
        {doneCount > 0 && <><span className="tf-schedule-sep">·</span><span className="tf-schedule-part">{doneCount}/{items.length} {t("done")}</span></>}
        {isToday && (
          <>
            <span className="tf-schedule-spacer" />
            {currentCancelled ? (
              <span className="tf-schedule-pill" style={{ color: "var(--tf-red)", background: "var(--tf-red-bg)" }}><AlertCircle size={12} /> {t("Current stop cancelled")}</span>
            ) : activeDelay > 0 ? (
              <span className="tf-schedule-pill" style={{ color: "var(--tf-orange)", background: "var(--tf-orange-bg)" }}><Clock size={12} /> {t("Running")} {fmtDuration(activeDelay)} {t("late")}</span>
            ) : (
              <span className="tf-schedule-pill" style={{ color: "var(--tf-green)", background: "var(--tf-green-bg)" }}><CheckCircle2 size={12} /> {t("On schedule")}</span>
            )}
          </>
        )}
      </div>


      {/* Now / Next focus band — the day's current moment made visually
          dominant, with a live countdown to the next stop. Live current-day
          only (isToday); a previewed other day has no meaningful "now" so it
          keeps just the plain rail. Each card opens the same inline status
          editor on click / Enter / Space when the user can edit. */}
      {isToday && (
        <div className="tf-focus-band">
          {(() => {
            const clickable = canEdit && !!currentStop;
            const st = currentStop && currentStop.status && currentStop.status !== "scheduled" ? currentStop.status : null;
            const meta = st ? ITIN_STATUS_META[st] : null;
            const openEditor = () => currentStop && setOpenId(openId === currentStop.id ? null : currentStop.id);
            return (
              <div
                className={`tf-focus-card tf-focus-now${currentCancelled ? " is-cancelled" : ""}${clickable ? " is-clickable" : ""}`}
                role={clickable ? "button" : undefined} tabIndex={clickable ? 0 : undefined}
                aria-expanded={clickable ? openId === currentStop.id : undefined}
                onClick={clickable ? openEditor : undefined}
                onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openEditor(); } } : undefined}
              >
                <div className="tf-focus-eyebrow">
                  <span className="tf-now-dot" aria-hidden="true" />
                  {currentStop ? t("NOW") : t("Not started")}
                  {activeDelay > 0 && !currentCancelled && (
                    <span className="tf-focus-late"><Clock size={11} /> {fmtDuration(activeDelay)} {t("late")}</span>
                  )}
                </div>
                {currentStop ? (
                  <>
                    <div className="tf-focus-time">{fmt12h(currentStop.startTime)}</div>
                    <div className="tf-focus-title">{currentStop.title}</div>
                    {currentStop.location && <div className="tf-focus-venue"><MapPin size={12} /> {currentStop.location}</div>}
                    {meta && (
                      <span className="tf-stop-tag" style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 10, padding: "3px 9px", fontSize: 11, color: `var(--tf-${meta.color})`, background: `var(--tf-${meta.color}-bg)` }}>
                        {t(meta.label)}{st === "delayed" && currentStop.delayMinutes ? ` +${fmtDuration(currentStop.delayMinutes)}` : ""}
                      </span>
                    )}
                  </>
                ) : (
                  <div className="tf-focus-title" style={{ marginTop: 6, color: "var(--tf-text-3)", fontWeight: 600 }}>{t("The day hasn't reached its first stop yet.")}</div>
                )}
              </div>
            );
          })()}

          {(() => {
            const clickable = canEdit && !!nextStop;
            const openEditor = () => nextStop && setOpenId(openId === nextStop.id ? null : nextStop.id);
            return (
              <div
                className={`tf-focus-card tf-focus-next${clickable ? " is-clickable" : ""}`}
                role={clickable ? "button" : undefined} tabIndex={clickable ? 0 : undefined}
                aria-expanded={clickable ? openId === nextStop.id : undefined}
                onClick={clickable ? openEditor : undefined}
                onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openEditor(); } } : undefined}
              >
                <div className="tf-focus-eyebrow tf-focus-eyebrow--next">
                  {t("NEXT")}
                  {nextStop && nextCountdownMin !== null && (
                    <span className="tf-focus-count"><Clock size={11} /> {nextCountdownMin > 0 ? `${t("in")} ${fmtDuration(nextCountdownMin)}` : t("now")}</span>
                  )}
                </div>
                {nextStop ? (
                  <>
                    <div className="tf-focus-time is-next">{fmt12h(nextStop.startTime)}</div>
                    <div className="tf-focus-title">{nextStop.title}</div>
                    {nextStop.location && <div className="tf-focus-venue"><MapPin size={12} /> {nextStop.location}</div>}
                  </>
                ) : (
                  <>
                    <div className="tf-focus-title" style={{ marginTop: 6 }}>{nextLabel}</div>
                    <div className="tf-focus-venue" style={{ color: "var(--tf-text-3)" }}>{dayNumber < totalDays ? t("Continues tomorrow") : t("No more scheduled stops today")}</div>
                  </>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* Full-day rail. Hierarchy (live current-day only): earlier/done stops
          collapse behind a "N done" pill, the current stop is enlarged, the
          next stop is blue-accented, later stops are de-emphasised. A previewed
          other day (isToday === false) renders every stop flat, as before. */}
      <div className="tf-stop-chain">
        {(() => {
          const rail = [];
          if (pastCount > 0) {
            rail.push(
              <button key="tf-collapsed" type="button" className="tf-stop-collapsed" aria-expanded={showPast}
                title={showPast ? t("Hide completed stops") : t("Show completed stops")}
                onClick={() => setShowPast((v) => !v)}>
                {showPast ? <ChevronLeft size={13} /> : <CheckCircle2 size={13} />}
                {showPast ? t("Hide done") : `${pastCount} ${t("done")}`}
                {!showPast && <ChevronRight size={13} />}
              </button>
            );
          }
          items.forEach((item, idx) => {
            const past = isToday && segIndex > 0 && idx < segIndex;
            if (past && !showPast) return;                    // collapsed away by default
            const completed = !!item.completed;
            const isNow = isToday && idx === segIndex && !completed;   // a ticked-off stop no longer shows "NOW"
            const isNext = isToday && !!nextStop && item.id === nextStop.id;
            const isDone = isToday && idx < segIndex && item.status !== "cancelled" && !completed;
            const isUpcoming = isToday && idx > segIndex && !isNext;
            const st = item.status && item.status !== "scheduled" ? item.status : null;
            const meta = st ? ITIN_STATUS_META[st] : null;
            const cls = `tf-stop-box${isNow ? " is-now" : ""}${isNext ? " is-next" : ""}${isUpcoming ? " is-upcoming" : ""}${isDone ? " is-done" : ""}${st ? ` is-${st}` : ""}${completed ? " is-completed" : ""}${openId === item.id ? " is-open" : ""}`;
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
                  <span>{fmt12h(item.startTime)}</span>
                  {isNow && !st && <span className="tf-stop-now-text">{t("NOW")}</span>}
                  {isNext && !st && <span className="tf-stop-next-text">{t("NEXT")}</span>}
                  {meta && (
                    <span className="tf-stop-tag" style={{ color: `var(--tf-${meta.color})`, background: `var(--tf-${meta.color}-bg)` }}>
                      {t(meta.label)}{st === "delayed" && item.delayMinutes ? ` +${fmtDuration(item.delayMinutes)}` : ""}
                    </span>
                  )}
                </div>
                <div className="tf-stop-box-title">{item.title}</div>
                {item.location && <div className="tf-stop-box-venue"><MapPin size={11} /> {item.location}</div>}
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
            if (rail.length) rail.push(<div key={`${item.id}-arrow`} className="tf-stop-arrow" aria-hidden="true">→</div>);
            rail.push(box);
          });
          return rail;
        })()}
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
            <span className="tf-muted" style={{ fontSize: 12, fontWeight: 800 }}>{fmt12h(editItem.startTime)} · {editItem.title}</span>
            <span className="tf-editor-label">{t("Schedule status")}</span>
            <button className="tf-btn tf-btn-ghost tf-btn-sm" onClick={() => applyStatus(editItem, "scheduled", 0)}><CheckCircle2 size={12} /> {t("On time")}</button>
            <button className="tf-btn tf-btn-ghost tf-btn-sm" style={{ color: "var(--tf-orange)" }} onClick={() => setEditMode(editMode === "delayed" ? null : "delayed")}><Clock size={12} /> {t("Delayed")}…</button>
            <button className="tf-btn tf-btn-ghost tf-btn-sm" style={{ color: "var(--tf-blue)" }} onClick={() => setEditMode(editMode === "moved" ? null : "moved")}>{t("Moved")}…</button>
            <button className="tf-btn tf-btn-ghost tf-btn-sm" style={{ color: "var(--tf-red)" }} onClick={() => applyStatus(editItem, "cancelled", 0)}><X size={12} /> {t("Cancelled")}</button>
            <span className="tf-editor-divider" />
            {/* "Mark done / not done" removed here 2026-07-31 — it duplicated the
                round check button on each stop box (top-left of the time). Tick
                a stop there instead. */}
            <button className="tf-btn tf-btn-ghost tf-btn-sm" onClick={() => { if (onOpenAttendance) onOpenAttendance(editItem); }}><Users size={12} /> {t("Attendance & history")}</button>
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
                    <span className="tf-plan-time">{fmt12h(s.startTime)}</span>
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
/* Live "command centre" bar — the at-a-glance operational answer for an
 * in-progress trip: how many are checked in, and the exception counts a
 * coordinator needs to spot in seconds (missing / late / unassigned). */
function LiveOpsBar({ stats }) {
  const { t } = useLang();
  return (
    <div className="tf-kpi-row tf-kpi-row-5">
      <div className="tf-kpi is-green"><span className="tf-kpi-n">{stats.present}/{stats.delegates}</span><span className="tf-kpi-l">{t("Checked in")}</span></div>
      <div className="tf-kpi is-orange"><span className="tf-kpi-n">{stats.late}</span><span className="tf-kpi-l">{t("Late")}</span></div>
      <div className="tf-kpi is-red"><span className="tf-kpi-n">{stats.missing}</span><span className="tf-kpi-l">{t("Missing")}</span></div>
      <div className="tf-kpi is-yellow"><span className="tf-kpi-n">{stats.unassigned}</span><span className="tf-kpi-l">{t("Unassigned")}</span></div>
      <div className="tf-kpi is-blue"><span className="tf-kpi-n">{stats.coaches}</span><span className="tf-kpi-l">{t("Coaches")}</span></div>
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
 *  trip's phase: Planning/In-progress can edit; Completed is read-only.
 *  "Trip settings" (the old single trip-wide Late-cutoff time) was removed
 *  2026-07-23 — every itinerary stop is now its own cutoff (see
 *  applyCheckpointLateCutoff() in backend/routes/checkpoints.js), making the
 *  single global cutoff field redundant.
 * ========================================================================== */
function Hero({ trip, coachCount, delegateCount, dateRange, mode, onEditItinerary, canEdit = true }) {
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
            <button className="tf-btn tf-btn-solid" onClick={onEditItinerary}><PencilLine size={14} /> {mode === "planning" ? t("Plan itinerary") : t("Edit itinerary")}</button>
          </div>
        )}
      </div>
      <div className="tf-hero-sub">
        {dateRange}{dateRange ? " · " : ""}{coachCount} {t(coachCount === 1 ? "coach" : "coaches")} · {delegateCount} {t(delegateCount === 1 ? "delegate" : "delegates")}
        {trip.lead ? ` · ${t("Lead")}: ${trip.lead}` : ""}
      </div>
    </div>
  );
}
/* ---- ItemForm — the add/edit itinerary item fields -----------------
 * Hoisted OUT of EditItineraryModal (2026-07-23 fix): it used to be a
 * function declared INSIDE that component's render body, which React treats
 * as a brand-new component type on every single re-render of the parent —
 * so the page's 2s live-refresh (fetchAll() below) was destroying and
 * recreating this form from scratch every 2 seconds, kicking focus out of
 * whatever input a staff member was mid-typing into. Moving it out here
 * makes it a stable component identity across re-renders, so typing no
 * longer races the refresh interval. No behavior change otherwise — same
 * props, same fields, same save/cancel logic. */
function ItemForm({ t, form, setForm, categories, error, cancelForm, handleSave, saving, activeForm }) {
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

function EditItineraryModal({ tripId, itinerary, categories, onClose, onRefresh, askConfirm }) {
  const { t } = useLang();
  const days = [...new Set(itinerary.map((i) => i.dayNumber))].sort((a, b) => a - b);
  const maxDay = days.length > 0 ? Math.max(...days) : 0;

  const [activeForm, setActiveForm] = useState(null);
  const [form, setForm] = useState({ dayNumber: 1, startTime: "", title: "", location: "", category: "other", status: "scheduled", delayMinutes: 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // Minimum gap between two stops on the same day — matches the trip's own
  // "Buffer time" setting (Settings page's "Checkpoint reset window" card,
  // see routes/checkpoints.js), decoupled from the checkpoint reset window
  // (2026-07-23 — they used to share one value, but tightening the reset
  // window for testing shouldn't also force this gap to shrink).
  const [minGapMinutes, setMinGapMinutes] = useState(30);
  useEffect(() => {
    apiGet(`/trips/${tripId}/checkpoints`).then((r) => setMinGapMinutes(r.itineraryBufferMinutes ?? 30)).catch(() => {});
  }, [tripId]);

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

  function toMinutes(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }

  async function handleSave() {
    if (!form.title.trim()) { setError(t("Title is required")); return; }
    if (!form.startTime) { setError(t("Time is required")); return; }

    const sameDayItems = itinerary.filter((i) =>
      i.dayNumber === Number(form.dayNumber) &&
      i.status !== "cancelled" &&
      !(activeForm.mode === "edit" && i.id === activeForm.item.id)
    );
    const newMinutes = toMinutes(form.startTime);
    const tooClose = sameDayItems.find((i) => Math.abs(toMinutes(i.startTime) - newMinutes) < minGapMinutes);
    if (tooClose) {
      setError(`${t("Must be at least")} ${minGapMinutes} ${t("min from")} "${tooClose.title}" (${tooClose.startTime})`);
      return;
    }

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
                    <span style={{ fontWeight: 700, fontSize: 13, minWidth: 62, flexShrink: 0 }}>{fmt12h(item.startTime)}</span>
                    <span style={{ flex: 1, fontSize: 13 }}>{item.title}</span>
                    {item.location && <span className="tf-muted" style={{ fontSize: 12, flexShrink: 0 }}>{item.location}</span>}
                    <button className="tf-btn tf-btn-ghost tf-btn-icon-only" onClick={() => openEdit(item)} title={t("Edit")}><Edit2 size={13} /></button>
                    <button className="tf-btn tf-btn-ghost tf-btn-icon-only" style={{ color: "var(--tf-red)" }} onClick={() => handleDelete(item)} title={t("Delete")}><Trash2 size={13} /></button>
                  </div>
                  {activeForm?.mode === "edit" && activeForm.item.id === item.id && (
                    <ItemForm t={t} form={form} setForm={setForm} categories={categories} error={error} cancelForm={cancelForm} handleSave={handleSave} saving={saving} activeForm={activeForm} />
                  )}
                </div>
              );
            })}
            {activeForm?.mode === "add" && Number(activeForm.dayNumber) === day && (
              <ItemForm t={t} form={form} setForm={setForm} categories={categories} error={error} cancelForm={cancelForm} handleSave={handleSave} saving={saving} activeForm={activeForm} />
            )}
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
    <Modal title={t("Add delegate")} onClose={onClose} maxWidth={480}
      footer={<>
        <button className="tf-btn tf-btn-ghost" onClick={onClose}>{t("Cancel")}</button>
        <button className="tf-btn tf-btn-primary tf-btn-lg" onClick={handleSubmit} disabled={saving}>
          {saving ? <Loader2 size={14} className="spin" /> : <UserPlus size={14} />} {t("Add delegate")}
        </button>
      </>}
    >
      <label className="tf-field-label">{t("Full name")} <span className="tf-req">*</span></label>
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

/* ---- Shared dropdown-open/outside-click plumbing (2026-07-31, "this is
 * static right? remove that" — replaces the native <select>s below, whose
 * hover/focus highlight is OS-drawn, not themeable, and reads as an
 * out-of-place native-blue chip in dark mode especially). Same pattern as
 * DashboardPage's own TripSwitcher. */
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

/* ---- Add/Edit coach modals (driver name) -------------------------------- */
/* Captains = the LOGIN accounts scoped to this coach — up to MAX_CAPTAINS
 * (2026-07-31, "allow me to select 1-3 staff"; was a single captain). When
 * set, each of them sees only this coach on the board (unless admin). Now
 * ALSO the "Staff member" field itself (2026-07-31 — collapsed with the old
 * display-only guide-directory StaffSelect, which had no login behind it and
 * just duplicated this same "who's in charge" concept). */
const MAX_CAPTAINS = 3;
// Many accounts have `name` equal to (or just a different case of) their own
// `username` — showing both then read as a literal duplicate, e.g.
// "Vance · vance (admin)" (2026-07-25 fix). Only shows the username
// separately when it's actually a distinct piece of information.
function captainLabel(a) {
  const name = (a.name || a.username || "").trim();
  const sameAsUsername = name.toLowerCase() === (a.username || "").trim().toLowerCase();
  return sameAsUsername ? `${name} (${a.role})` : `${name} · ${a.username} (${a.role})`;
}

function CaptainSelect({ value, onChange, accounts }) {
  const { t } = useLang();
  const { open, setOpen, rootRef } = useDropdown();
  const ids = value || [];
  const selectedAccounts = ids.map((id) => accounts.find((a) => a.id === id)).filter(Boolean);
  const atMax = ids.length >= MAX_CAPTAINS;
  const toggle = (id) => {
    if (ids.includes(id)) onChange(ids.filter((x) => x !== id));
    else if (!atMax) onChange([...ids, id]);
  };
  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button type="button" className="tf-input tf-select-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {selectedAccounts.length ? (
          <span>{selectedAccounts.map((a) => a.name || a.username).join(", ")}</span>
        ) : (
          <span className="tf-select-placeholder">{t("No staff assigned — anyone can see all coaches")}</span>
        )}
        <ChevronDown size={16} style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s ease" }} />
      </button>
      {open && (
        <div className="tf-select-menu" role="listbox" style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, maxHeight: 260, zIndex: 30 }}>
          <div className="tf-select-empty">{t("Select up to")} {MAX_CAPTAINS} {t("staff")}{ids.length ? ` (${ids.length}/${MAX_CAPTAINS})` : ""}</div>
          {accounts.map((a) => {
            const checked = ids.includes(a.id);
            const disabled = !checked && atMax;
            return (
              <button key={a.id} type="button" role="option" aria-selected={checked}
                className={"tf-select-item" + (checked ? " active" : "")}
                disabled={disabled}
                style={disabled ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
                onClick={() => toggle(a.id)}>
                <span className="tf-select-check">{checked && <Check size={11} />}</span>
                {captainLabel(a)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AddCoachModal({ tripId, existingCount, onClose, onAdded }) {
  const { t } = useLang();
  const [label, setLabel] = useState(`Coach ${existingCount + 1}`);
  const [capacity, setCapacity] = useState(40);
  const [driverName, setDriverName] = useState("");
  const [accountIds, setAccountIds] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const acc = await apiGet("/assignable-accounts");
        // Staff only (2026-07-31, "no need admin") — this field assigns who
        // actually runs the coach day-to-day, not account administration, so
        // admin logins are excluded from the picker (an admin can still see
        // every coach regardless of whether they're staffed on one).
        setAccounts((acc.accounts || []).filter((a) => a.role === "staff"));
      } catch (e) { setError(e.message); }
    })();
  }, []);

  async function handleSubmit() {
    if (!label.trim()) { setError(t("Label is required")); return; }
    if (capacity < 1) { setError(t("Capacity must be ≥ 1")); return; }
    setSaving(true); setError(null);
    try {
      const coach = await apiPost(`/coaches`, { tripId, label: label.trim(), capacity: Number(capacity), driverName: driverName.trim(), accountIds });
      onAdded(coach); onClose();
    } catch (e) { setError(e.message); setSaving(false); }
  }

  const capNum = Number(capacity);
  return (
    <Modal title={t("Add coach")} onClose={onClose} maxWidth={480}
      footer={<>
        <button className="tf-btn tf-btn-ghost" onClick={onClose}>{t("Cancel")}</button>
        <button className="tf-btn tf-btn-primary tf-btn-lg" onClick={handleSubmit} disabled={saving}>
          {saving ? <Loader2 size={14} className="spin" /> : <Bus size={14} />} {t("Add coach")}
        </button>
      </>}
    >
      <div className="tf-form-section">{t("Coach details")}</div>
      <label className="tf-field-label">{t("Coach label")} <span className="tf-req">*</span></label>
      <input className="tf-input" style={{ marginBottom: 14 }} value={label} autoFocus onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSubmit()} />

      <label className="tf-field-label">{t("Capacity (seats)")} <span className="tf-req">*</span></label>
      <input type="number" className="tf-input" style={{ marginBottom: capNum >= 1 ? 4 : 4 }} min={1} max={200} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
      <p className="tf-help" style={{ color: capNum < 1 ? "var(--tf-red)" : "var(--tf-text-3)" }}>
        {capNum < 1 ? t("Capacity must be at least 1.") : t("Maximum number of delegates this coach can seat.")}
      </p>

      <div className="tf-form-section">{t("Staff & access")}</div>
      {/* "Staff member" (2026-07-31) — was two separate concepts stacked here:
          a display-only guide-directory name (StaffSelect, backed by the
          `users` table, no login) plus this login-account picker labelled
          "Coach captains". Collapsed into just this one, renamed "Staff
          member" and moved to the top — the guide-directory field added a
          second "who's in charge" concept with no login behind it, which
          just duplicated what the account picker already covers. */}
      <label className="tf-field-label tf-flex tf-gap-6" style={{ alignItems: "center" }}><Users size={13} /> {t("Staff member")}</label>
      <CaptainSelect value={accountIds} onChange={setAccountIds} accounts={accounts} />
      <p className="tf-help">{t("Optional, up to 3. Each login sees only this coach on the board (admins always see all).")}</p>

      <label className="tf-field-label tf-flex tf-gap-6" style={{ alignItems: "center", marginTop: 14 }}><Navigation size={13} /> {t("Driver name")}</label>
      <input className="tf-input" placeholder={t("Optional")} value={driverName} onChange={(e) => setDriverName(e.target.value)} />
      {error && <p className="tf-form-error">{error}</p>}
    </Modal>
  );
}

function EditCoachStaffModal({ coach, onClose, onSaved }) {
  const { t } = useLang();
  const [driverName, setDriverName] = useState(coach.driverName || "");
  const [accountIds, setAccountIds] = useState((coach.captains || []).map((c) => c.id));
  // Real-world coaches don't all seat the same number of people (2026-07-30 —
  // "each coach may not have the same amount of seat"). Capacity could
  // already be set per-coach at creation time (AddCoachModal), and
  // PATCH /coaches/:id already accepted it server-side (desmond.js) — this
  // was the only edit surface for an EXISTING coach, and it simply never
  // exposed the field, leaving the bulk "set every coach on this trip to N"
  // tool on the Edit Trip form as the only way to change it after creation.
  const [capacity, setCapacity] = useState(coach.capacity || 40);
  const [accounts, setAccounts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const acc = await apiGet("/assignable-accounts");
        // Staff only (2026-07-31, "no need admin") — this field assigns who
        // actually runs the coach day-to-day, not account administration, so
        // admin logins are excluded from the picker (an admin can still see
        // every coach regardless of whether they're staffed on one).
        setAccounts((acc.accounts || []).filter((a) => a.role === "staff"));
      } catch (e) { setError(e.message); }
    })();
  }, []);

  async function handleSubmit() {
    setSaving(true); setError(null);
    try {
      const updated = await apiPatch(`/coaches/${coach.id}`, {
        driverName: driverName.trim(), accountIds,
        capacity: Math.max(1, Number(capacity) || 40),
      });
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
      {/* "Staff member" (2026-07-31) — collapsed from two separate concepts
          (a display-only guide-directory name with no login, plus this
          login-account picker labelled "Coach captains") into just this one,
          renamed and moved to the top. See AddCoachModal's matching note. */}
      <label className="tf-field-label tf-flex tf-gap-6" style={{ alignItems: "center" }}><Users size={13} /> {t("Staff member")}</label>
      <CaptainSelect value={accountIds} onChange={setAccountIds} accounts={accounts} />
      <p className="tf-muted" style={{ fontSize: 12, marginTop: 6, marginBottom: 14 }}>{t("Optional, up to 3. Each login sees only this coach on the board (admins always see all).")}</p>

      <label className="tf-field-label tf-flex tf-gap-6" style={{ alignItems: "center" }}><Navigation size={13} /> {t("Driver name")}</label>
      <input className="tf-input" style={{ marginBottom: 14 }} placeholder={t("Optional")} value={driverName} onChange={(e) => setDriverName(e.target.value)} />

      <label className="tf-field-label">{t("Capacity (seats)")}</label>
      <input type="number" min={1} max={200} className="tf-input" value={capacity}
        onChange={(e) => setCapacity(e.target.value)} />
      {(coach.total ?? 0) > Number(capacity) && (
        <p style={{ fontSize: 12, color: "var(--tf-red)", marginTop: 6, marginBottom: 0 }}>
          {t("This coach already has")} {coach.total} {t("assigned — lowering capacity below that won't remove anyone, but the board will show it as over capacity.")}
        </p>
      )}
      {error && <p style={{ color: "var(--tf-red)", fontSize: 13, marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}

/* ---- HistoryModal — persisted before/after audit for this trip -------------
 * Reads GET /api/trips/:tripId/audit (trip_event_log). Each event shows who did
 * it, when, a summary, and — for edits — a compact field-by-field "before →
 * after" diff so a coordinator can see exactly what a value changed from and to.
 * Creates show the values set; deletes show what was removed. ---------------- */
function fmtAuditVal(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}
// Prettify raw audit field keys into human labels ("day" → "Day", "startTime"
// → "Time") so the change log reads clearly instead of like a DB dump.
const AUDIT_FIELD_LABEL = {
  day: "Day", time: "Time", startTime: "Time", title: "Title", status: "Status",
  delayMinutes: "Delay (min)", label: "Coach", capacity: "Capacity", staffName: "Staff",
  captain: "Captain", name: "Name", dateRange: "Dates", lead: "Lead", dayOf: "Current day",
  totalDays: "Total days", startDate: "Start date", vip: "VIP", company: "Company",
  accessibilityNotes: "Accessibility", notes: "Notes", arrival: "Bus arrival", completed: "Completed",
};
const auditFieldLabel = (k) => AUDIT_FIELD_LABEL[k] || (k.charAt(0).toUpperCase() + k.slice(1));
function diffFields(before, after) {
  const b = before || {}; const a = after || {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  return keys
    .filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    .map((k) => ({ key: k, from: b[k], to: a[k] }));
}

const HISTORY_ICON = { coach: Bus, itinerary: MapPin, delegate: UserPlus, trip: PencilLine };
function HistoryModal({ tripId, onClose }) {
  const { t } = useLang();
  const [events, setEvents] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    apiGet(`/trips/${tripId}/audit?limit=80`)
      .then((r) => { if (live) setEvents(r.events || []); })
      .catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [tripId]);

  return (
    <Modal title={t("Change history")} onClose={onClose} maxWidth={560}>
      <p className="tf-muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 14 }}>
        {t("Every trip-management change, newest first, with what each value was before and after. Delegate attendance changes also appear in the app's History Log.")}
      </p>
      {error && <p style={{ color: "var(--tf-red)", fontSize: 13 }}>{error}</p>}
      {!events && !error && <div className="tf-flex" style={{ justifyContent: "center", padding: 20 }}><Loader2 size={18} className="spin" /></div>}
      {events && events.length === 0 && <p className="tf-muted" style={{ fontSize: 13 }}>{t("No changes recorded yet.")}</p>}
      {events && events.length > 0 && (
        <div className="tf-att-timeline" style={{ maxHeight: "60vh" }}>
          {events.map((ev) => {
            const rows = diffFields(ev.before, ev.after);
            const isCreate = !ev.before && ev.after;
            const isDelete = ev.before && !ev.after;
            const Icon = HISTORY_ICON[ev.entity] || Circle;
            const tone = isCreate ? "green" : isDelete ? "red" : "blue";
            return (
              <div key={ev.id} className="tf-tl-item">
                <span className="tf-tl-dot" style={{ color: `var(--tf-${tone})`, background: `var(--tf-${tone}-bg)` }}><Icon size={13} /></span>
                <div className="tf-tl-body" style={{ flex: 1 }}>
                  <div className="tf-audit-head">
                    <span className="tf-audit-summary">{ev.summary}</span>
                    <span className="tf-audit-meta">{ev.actor || "System"} · {new Date(ev.at).toLocaleString()}</span>
                  </div>
                  {rows.length > 0 && (
                    <div className="tf-audit-diff">
                      {rows.map((r) => (
                        <div key={r.key} className="tf-audit-row">
                          <span className="tf-audit-key">{auditFieldLabel(r.key)}</span>
                          {isCreate || isDelete ? (
                            <span className="tf-audit-to">{fmtAuditVal(isCreate ? r.to : r.from)}</span>
                          ) : (
                            <>
                              <span className="tf-audit-from">{fmtAuditVal(r.from)}</span>
                              <span className="tf-audit-arrow">→</span>
                              <span className="tf-audit-to">{fmtAuditVal(r.to)}</span>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

/* ---- AttendanceModal — per-event (checkpoint) attendance + before/after log --
 * For one itinerary stop: shows every coach's delegates with their status AT
 * that stop (present / late / missing / not recorded), lets an editor set it,
 * and lists the full before→after change history. Scoped: a captain only sees
 * (and marks) their own coach. Writes go to
 * POST /trips/:tripId/itinerary/:itemId/attendance. --------------------------- */
const ATT_META = {
  ARRIVED: { label: "Present", color: "green" },
  LATE:    { label: "Late",    color: "orange" },
  MISSING: { label: "Missing", color: "red" },
};
function AttendanceModal({ tripId, item, scopedCoachIds, canEdit, onClose }) {
  const { t } = useLang();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [savingId, setSavingId] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await apiGet(`/trips/${tripId}/itinerary/${item.id}/attendance`);
      setData(r);
    } catch (e) { setError(e.message); }
  }, [tripId, item.id]);
  useEffect(() => { load(); }, [load]);

  async function setStatus(delegateId, status) {
    setSavingId(delegateId + status); setError(null);
    try {
      await apiPost(`/trips/${tripId}/itinerary/${item.id}/attendance`, { delegateId, status });
      await load();
    } catch (e) { setError(e.message); }
    finally { setSavingId(null); }
  }

  // Group delegates by coach (respecting the captain scope).
  const groups = useMemo(() => {
    if (!data) return [];
    const rows = scopedCoachIds?.length ? data.delegates.filter((d) => scopedCoachIds.includes(d.coachId)) : data.delegates;
    const byCoach = new Map();
    for (const d of rows) {
      const key = d.coachId || "__un__";
      if (!byCoach.has(key)) byCoach.set(key, { coachId: d.coachId, coachLabel: d.coachLabel || t("Unassigned"), sort: d.coachSort ?? 999, delegates: [] });
      byCoach.get(key).delegates.push(d);
    }
    return [...byCoach.values()].sort((a, b) => a.sort - b.sort);
  }, [data, scopedCoachIds, t]);

  const history = useMemo(() => {
    if (!data) return [];
    return scopedCoachIds?.length ? data.history.filter((h) => scopedCoachIds.includes(h.coachId)) : data.history;
  }, [data, scopedCoachIds]);

  // Headline counts across everything shown — so a manager reads the numbers,
  // not counts rows by hand.
  const summary = useMemo(() => {
    const all = groups.flatMap((g) => g.delegates);
    return {
      present: all.filter((d) => d.status === "ARRIVED").length,
      late: all.filter((d) => d.status === "LATE").length,
      missing: all.filter((d) => d.status === "MISSING").length,
      total: all.length,
    };
  }, [groups]);

  const ATT_ICON = { ARRIVED: CheckCircle2, LATE: Clock, MISSING: AlertCircle };

  return (
    <Modal title={`${t("Attendance")} · ${fmt12h(item.startTime)} ${item.title}`} onClose={onClose} maxWidth={660}>
      {error && <p style={{ color: "var(--tf-red)", fontSize: 13.5 }}>{error}</p>}
      {!data && !error && <div className="tf-flex" style={{ justifyContent: "center", padding: 28 }}><Loader2 size={20} className="spin" /></div>}
      {data && (
        <>
          {/* Summary KPIs */}
          <div className="tf-att-summary">
            <div className="tf-att-kpi is-green"><span className="tf-att-kpi-n">{summary.present}</span><span className="tf-att-kpi-l">{t("Present")}</span></div>
            <div className="tf-att-kpi is-orange"><span className="tf-att-kpi-n">{summary.late}</span><span className="tf-att-kpi-l">{t("Late")}</span></div>
            <div className="tf-att-kpi is-red"><span className="tf-att-kpi-n">{summary.missing}</span><span className="tf-att-kpi-l">{t("Missing")}</span></div>
            <div className="tf-att-kpi is-grey"><span className="tf-att-kpi-n">{summary.total}</span><span className="tf-att-kpi-l">{t("Total")}</span></div>
          </div>

          {groups.length === 0 && <p className="tf-muted" style={{ fontSize: 13.5 }}>{t("No delegates to show.")}</p>}
          {groups.map((g) => {
            const present = g.delegates.filter((d) => d.status === "ARRIVED").length;
            const pct = g.delegates.length ? Math.round((present / g.delegates.length) * 100) : 0;
            return (
              <div key={g.coachId || "un"} className="tf-att-coach">
                <div className="tf-att-coach-head">
                  <span className="tf-att-coach-name"><Bus size={15} /> {g.coachLabel}</span>
                  <span className="tf-att-coach-count">{present}/{g.delegates.length} {t("present")}</span>
                  <span className="tf-att-coach-bar"><span style={{ width: `${pct}%` }} /></span>
                </div>
                {g.delegates.map((d) => {
                  const meta = d.status ? ATT_META[d.status] : null;
                  const Icon = d.status ? ATT_ICON[d.status] : null;
                  return (
                    <div key={d.delegateId} className={`tf-att-row${meta ? ` is-${meta.color}` : ""}`}>
                      <span className="tf-att-name">{d.name}</span>
                      {!canEdit && (meta
                        ? <span className="tf-badge-pill" style={{ color: `var(--tf-${meta.color})`, background: `var(--tf-${meta.color}-bg)` }}>{Icon && <Icon size={11} />} {t(meta.label)}</span>
                        : <span className="tf-badge-pill" style={{ color: "var(--tf-text-3)", background: "var(--tf-grey-bg)" }}>{t("Not recorded")}</span>)}
                      {canEdit && (
                        <span className="tf-segmented" role="group">
                          {["ARRIVED", "LATE", "MISSING"].map((s) => {
                            const SIcon = ATT_ICON[s];
                            const active = d.status === s;
                            return (
                              <button key={s} type="button"
                                className={`tf-seg is-${ATT_META[s].color}${active ? " is-active" : ""}`}
                                disabled={savingId === d.delegateId + s}
                                onClick={() => setStatus(d.delegateId, s)}>
                                <SIcon size={12} /> {t(ATT_META[s].label)}
                              </button>
                            );
                          })}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          <div className="tf-att-history-title">{t("Change history")} <span className="tf-muted" style={{ fontWeight: 600, fontSize: 12 }}>· {t("before → after")}</span></div>
          {history.length === 0
            ? <p className="tf-muted" style={{ fontSize: 13 }}>{t("No attendance changes recorded for this event yet.")}</p>
            : (
              <div className="tf-att-timeline">
                {history.map((h) => {
                  const toMeta = ATT_META[h.toStatus];
                  const Icon = ATT_ICON[h.toStatus] || CheckCircle2;
                  return (
                    <div key={h.id} className="tf-tl-item">
                      <span className="tf-tl-dot" style={{ color: `var(--tf-${toMeta?.color || "grey"})`, background: `var(--tf-${toMeta?.color || "grey"}-bg)` }}><Icon size={13} /></span>
                      <div className="tf-tl-body">
                        <div className="tf-tl-line">
                          <strong>{h.delegateName}</strong>
                          <span className="tf-audit-from">{h.fromStatus ? t(ATT_META[h.fromStatus]?.label || h.fromStatus) : t("Not recorded")}</span>
                          <span className="tf-audit-arrow">→</span>
                          <span className="tf-audit-to">{t(toMeta?.label || h.toStatus)}</span>
                        </div>
                        <div className="tf-tl-meta">{h.coachLabel ? `${h.coachLabel} · ` : ""}{t("by")} {h.actor} · {new Date(h.at).toLocaleString()}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
        </>
      )}
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
  // Mirrors the app-wide theme (2026-07-23) — the board used to always force
  // the flat light palette regardless of the rest of the app (a deliberate
  // v4 design-brief choice, documented in TripCoachPage.css's header), which
  // read as broken/inconsistent once every other page had a working dark
  // mode. Same useTfTheme() hook TripsListPage.jsx already uses.
  const [dark] = useTfTheme();
  const tfRootClass = `tf-root${dark ? " tf-dark" : ""}`;

  const [trip, setTrip] = useState(null);
  const [coaches, setCoaches] = useState([]);
  const [delegates, setDelegates] = useState([]);
  const [itinerary, setItinerary] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [cacheStale, setCacheStale] = useState(false);
  const [cacheAt, setCacheAt] = useState(null);

  const [showItinerary, setShowItinerary] = useState(false);
  const [showAddDelegate, setShowAddDelegate] = useState(false);
  const [showAddCoach, setShowAddCoach] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [attendanceItem, setAttendanceItem] = useState(null);
  const [editStaffCoach, setEditStaffCoach] = useState(null);
  const [panelDelegate, setPanelDelegate] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [shakeCoachId, setShakeCoachId] = useState(null);   // coach flashing "full" after an over-capacity drop
  const [capacityPrompt, setCapacityPrompt] = useState(null); // { delegate, coach } awaiting override/cancel

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
      const [tripRes, coachRes, itinRes, delRes] = await Promise.all([
        cachedFetch(`trip-summary:${tripId}`, () => apiGet(`/trips/${tripId}/summary`)),
        cachedFetch(`trip-coaches:${tripId}`, () => apiGet(`/trips/${tripId}/coaches`)),
        cachedFetch(`trip-itinerary:${tripId}`, () => apiGet(`/trips/${tripId}/itinerary`)),
        cachedFetch(`trip-delegates:${tripId}`, () => apiGet(`/delegates?tripId=${tripId}`)),
      ]);
      // Offline-capable READ (2026-07-31, "the manual, attendance, exception,
      // trip" — this is the "trip" one): see lib/cachedFetch.js.
      const stale = tripRes.stale || coachRes.stale || itinRes.stale || delRes.stale;
      setCacheStale(stale);
      setCacheAt([tripRes, coachRes, itinRes, delRes].find((r) => r.stale)?.at || null);
      setTrip(tripRes.data);
      setCoaches(coachRes.data.coaches);
      setItinerary(itinRes.data.items);
      setCategories(itinRes.data.categories || []);
      setDelegates(applyQueuedReassigns(delRes.data.delegates)); // keep unsynced offline moves visible
      setLoadError(null); // got usable data either way (fresh or cached) — clear any prior real error
    } catch (e) { setLoadError(e.message); }
  }, [tripId]);

  // 2s auto-refresh so a check-in from any scanner (which flips a delegate to
  // ARRIVED), or an edit by another signed-in staff member, shows up here
  // without a manual refresh — matches the integrated board's live behaviour.
  // Pauses while the tab is hidden (2026-07-29, JQ — see
  // lib/useVisiblePolling.js): 4 endpoints × every 2s is the heaviest poll in
  // the app, and it was running even in a forgotten background tab. Behaviour
  // while visible is unchanged, and it refetches immediately on re-show.
  useVisiblePolling(fetchAll, 2000, [fetchAll]);

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
  // The actual reassign (optimistic + rollback). Split out of handleReassign so
  // the over-capacity confirm/override path can call it directly after the user
  // chooses "Override".
  async function doReassign(delegate, toCoachId, { override = false } = {}) {
    // Dropping onto a coach means "expected on this coach, not yet checked
    // in" — that's ASSIGNED in the 5-status model, not MISSING. Only an
    // UNASSIGNED delegate gets this default; a delegate who already has a real
    // status (ARRIVED/LATE/MISSING/ASSIGNED) keeps it when moved. (The server
    // computes the same, and is authoritative — this is just the optimistic UI.)
    const nextStatus = toCoachId === null ? "UNASSIGNED" : (delegate.status === "UNASSIGNED" ? "ASSIGNED" : delegate.status);
    const prevSnapshot = delegate;
    const toLabel = toCoachId ? (coaches.find((c) => c.id === toCoachId)?.label || t("a coach")) : t("Unassigned");
    setDelegates((ds) => ds.map((d) => (d.id === delegate.id ? { ...d, coachId: toCoachId, status: nextStatus, pendingSync: false } : d)));
    try {
      // expectedCoachId = the coach we last saw them on → server rejects (409
      // CONFLICT) if someone else moved them meanwhile, instead of clobbering.
      const res = await reassignRequest(tripId, { delegateId: delegate.id, toCoachId, expectedCoachId: delegate.coachId || null, override }, { label: delegate.name });
      if (res && res.queued) {                        // offline — kept locally, replays on reconnect
        setDelegates((ds) => ds.map((d) => (d.id === delegate.id ? { ...d, coachId: toCoachId, status: nextStatus, pendingSync: true } : d)));
        setPanelDelegate((p) => (p && p.id === delegate.id ? { ...p, coachId: toCoachId, status: nextStatus } : p));
        pushToast(`${delegate.name} → ${toLabel} · ${t("queued (offline)")}`, "warn");
        return;
      }
      await refreshCoaches();
      pushToast(`${delegate.name} → ${toLabel}`);      // server-side endpoint logs the audit/history itself
      setPanelDelegate((p) => (p && p.id === delegate.id ? { ...p, coachId: toCoachId, status: nextStatus } : p));
    } catch (e) {
      setDelegates((ds) => ds.map((d) => (d.id === delegate.id ? prevSnapshot : d))); // roll back the optimistic move
      if (e.code === "CAPACITY_FULL" && toCoachId) {   // filled up since our last poll — offer the override dialog
        const target = coaches.find((c) => c.id === toCoachId);
        if (target) {
          setShakeCoachId(toCoachId);
          setTimeout(() => setShakeCoachId((s) => (s === toCoachId ? null : s)), 550);
          setCapacityPrompt({ delegate, coach: target });
          return;
        }
      }
      if (e.code === "CONFLICT") {                      // someone else moved them — resync to the server's truth
        pushToast(`${delegate.name}: ${t("was moved by someone else — refreshing")}`, "error");
        fetchAll();
        return;
      }
      pushToast(e.message, "error");
    }
  }

  async function handleReassign(delegate, toCoachId) {
    if (!editable) return;                        // needs manageTrips, not completed/cancelled
    if (toCoachId === (delegate.coachId || null)) return; // dropped on the same coach — no-op (edge case)
    // Capacity guard: dropping onto a coach that's ALREADY at/over capacity
    // shakes it + opens a confirm-override dialog instead of silently overfilling.
    if (toCoachId) {
      const target = coaches.find((c) => c.id === toCoachId);
      if (target && target.capacity > 0 && (target.total ?? 0) >= target.capacity) {
        setShakeCoachId(toCoachId);
        setTimeout(() => setShakeCoachId((s) => (s === toCoachId ? null : s)), 550);
        setCapacityPrompt({ delegate, coach: target });
        return;
      }
    }
    await doReassign(delegate, toCoachId);
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
      const where = changes.dayNumber ? `${t("Day")} ${payload.dayNumber}` : fmt12h(payload.startTime);
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
  // Wrong-coach / "UFO" flagging: a delegate whose coachId points at a coach
  // that ISN'T on this trip (a stale cross-trip assignment, a scan under the
  // wrong coach that stuck, or a coach that was later removed). These used to
  // be silently folded into Unassigned above, so staff had no idea anything was
  // off. Now they still show under Unassigned but are visibly FLAGGED, with a
  // board-level banner, so a coordinator can spot and reassign them. (The live
  // scanner already rejects a wrong-coach QR at scan time with COACH_MISMATCH;
  // this is the board-side visibility of anyone who ended up mis-coached.)
  const wrongCoachIds = new Set(
    delegates.filter((d) => d.coachId && !coachIdSet.has(d.coachId)).map((d) => d.id)
  );

  const currentDay = trip?.dayOf ?? 1;
  // Day switcher for the "Today's itinerary" card (2026-07-23) — it used to
  // ALWAYS show trip.dayOf with no way to preview any other day's schedule
  // from this view (only reachable via the separate Edit itinerary modal).
  // null = "not yet initialized"; syncs to the trip's real current day once
  // on load, then stays wherever the user picks — a later poll refresh
  // (fetchAll runs every 2s) must not silently snap the view back to today
  // out from under someone deliberately looking at a different day.
  const [viewDay, setViewDay] = useState(null);
  useEffect(() => { if (viewDay === null && trip) setViewDay(currentDay); }, [trip, viewDay, currentDay]);
  const displayDay = viewDay ?? currentDay;
  const todayItems = useMemo(
    () => itinerary.filter((i) => i.dayNumber === displayDay).sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [itinerary, displayDay]
  );

  // The board adapts to the trip's phase:
  //   planning  → build the plan (full itinerary, assign coaches/delegates); no live ops
  //   live      → what's happening now (schedule, delays, bus arrivals, boarding)
  //   completed → the results (attendance + itinerary recap), read-only
  // Cancelled trips are treated as a read-only record too.
  const mode = trip?.status === "In progress" ? "live" : trip?.status === "Planning" ? "planning" : "completed";
  const editable = canEdit && mode !== "completed";

  // Per-coach scoping: a signed-in person who CAPTAINS a coach on this trip and
  // isn't an admin sees ONLY their own coach — the client's "staff on Coach 1
  // sees only Coach 1" rule. Admins, and coordinators who don't captain any
  // coach here, see the whole board.
  // NB: the login only stores { username, name, role, permissions } — NO id —
  // so we match on username (coach.captains[].username) rather than account
  // id. Plural (2026-07-31, multi-captain support) — a captain can now be
  // assigned to more than one coach, so this scopes to ALL of them, not just
  // the first match.
  const me = getUser() || {};
  const myCoaches = coaches.filter((c) => me.username && (c.captains || []).some((cap) => cap.username === me.username));
  const scopedToCoach = myCoaches.length > 0 && me.role !== "admin";
  const myCoachIds = new Set(myCoaches.map((c) => c.id));
  const boardCoaches = scopedToCoach ? coaches.filter((c) => myCoachIds.has(c.id)) : coaches;
  // When scoped, every count reflects just the captain's own coach(es).
  const statDelegates = scopedToCoach ? delegates.filter((d) => myCoachIds.has(d.coachId)) : delegates;

  const summaryStats = useMemo(() => ({
    delegates: statDelegates.length,
    present: statDelegates.filter((d) => d.status === "PRESENT" || d.status === "ARRIVED").length,
    late: statDelegates.filter((d) => d.status === "LATE").length,
    missing: statDelegates.filter((d) => d.status === "MISSING").length,
    unassigned: scopedToCoach ? 0 : delegates.filter((d) => !(d.coachId && coachIdSet.has(d.coachId))).length,
    coaches: scopedToCoach ? 1 : coaches.length,
    itinStops: itinerary.length,
    itinDays: new Set(itinerary.map((i) => i.dayNumber)).size,
    itinDone: itinerary.filter((i) => i.completed).length,
    itinCancelled: itinerary.filter((i) => i.status === "cancelled").length,
  }), [delegates, statDelegates, scopedToCoach, coaches, itinerary, coachIdSet]);

  // The day-tab bar used to cap strictly at trip.totalDays, so a newly-added
  // Day 6 item was silently unreachable until someone also bumped "Total
  // days" by hand on the Edit Trip form (2026-07-30 — "I added day 6 but it's
  // not reflected"). First fix here took Math.max(trip.totalDays, itinerary
  // max) — which only ever grows. That's wrong the moment a day gets
  // DELETED ("if I remove day 8 it's still there"): trip.totalDays would
  // already be smaller after the backend's own sync (see
  // syncTotalDaysToItinerary in desmond.js, which now shrinks too), but
  // Math.max against a stale ALREADY-fetched trip object kept showing the
  // bigger number regardless. Trusting the itinerary's own max directly
  // (falling back to trip.totalDays ONLY when the itinerary is completely
  // empty, matching the backend sync's own guard) fixes both directions and
  // means the tab bar reacts on THIS render, without waiting on a trip
  // refetch to catch up.
  const displayTotalDays = useMemo(() => {
    const itineraryMax = itinerary.reduce((m, i) => Math.max(m, Number(i.dayNumber) || 0), 0);
    return itineraryMax > 0 ? itineraryMax : (Number(trip?.totalDays) || 1);
  }, [itinerary, trip?.totalDays]);

  if (!trip && !loadError) {
    return <div className={tfRootClass}><div className="tf-page"><SkeletonBoard /></div></div>;
  }
  if (loadError) {
    return (
      <div className={tfRootClass}>
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
    <div className={tfRootClass}>
      <div className="tf-page">
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
        <CachedDataBadge stale={cacheStale} at={cacheAt} style={{ marginBottom: 14 }} />
        {confirmState && <ConfirmDialog title={confirmState.title} message={confirmState.message} tone={confirmState.tone} onCancel={() => closeConfirm(false)} onConfirm={() => closeConfirm(true)} />}
        {capacityPrompt && (
          <CapacityDialog
            delegate={capacityPrompt.delegate} coach={capacityPrompt.coach}
            onCancel={() => setCapacityPrompt(null)}
            onOverride={() => { const { delegate, coach } = capacityPrompt; setCapacityPrompt(null); doReassign(delegate, coach.id, { override: true }); }}
          />
        )}
        {editStaffCoach && <EditCoachStaffModal coach={editStaffCoach} onClose={() => setEditStaffCoach(null)} onSaved={(updated) => { setCoaches((cs) => cs.map((c) => (c.id === updated.id ? { ...c, ...updated } : c))); pushToast(t("Save changes") + " ✓"); }} />}
        {showItinerary && <EditItineraryModal tripId={tripId} itinerary={itinerary} categories={categories} onClose={() => setShowItinerary(false)} onRefresh={refreshItinerary} askConfirm={askConfirm} />}
        {showAddDelegate && <AddDelegateModal tripId={tripId} onClose={() => setShowAddDelegate(false)} onAdded={handleDelegateAdded} />}
        {showAddCoach && <AddCoachModal tripId={tripId} existingCount={coaches.length} onClose={() => setShowAddCoach(false)} onAdded={(c) => { fetchAll(); pushToast(`${c.label} ${t("added")}.`); }} />}
        {showHistory && <HistoryModal tripId={tripId} onClose={() => setShowHistory(false)} />}
        {attendanceItem && (
          <AttendanceModal
            tripId={tripId} item={attendanceItem}
            scopedCoachIds={scopedToCoach ? [...myCoachIds] : null}
            canEdit={editable}
            onClose={() => setAttendanceItem(null)}
          />
        )}
        {panelDelegate && (
          <DelegateDetailPanel
            delegate={panelDelegate} coaches={coaches}
            onClose={() => setPanelDelegate(null)} onSave={handleSaveDetails}
            onReassign={(d, toId) => handleReassign(d, toId)}
            onRemove={() => handleRemoveDelegate(panelDelegate.id, panelDelegate.name)}
            canEdit={editable}
          />
        )}
        {ghost && <div className="tf-drag-ghost" style={{ position: "fixed", left: ghost.x + 14, top: ghost.y + 20, zIndex: 2000, pointerEvents: "none", width: 210 }}><DelegateCard delegate={ghost.delegate} ghost /></div>}

        <button className="tf-back-btn" style={{ marginBottom: 16 }} onClick={() => navigate("/trips")}>← {t("Back to trips")}</button>

        <Hero
          trip={trip} coachCount={coaches.length} delegateCount={delegates.length}
          dateRange={liveDateRange(trip.startDate, displayTotalDays, trip.dateRange)}
          mode={mode} canEdit={canEdit}
          onEditItinerary={() => setShowItinerary(true)}
        />

        {mode === "planning" && <TripSummaryBar mode="planning" stats={summaryStats} />}
        {mode === "live" && <LiveOpsBar stats={summaryStats} />}

        <div className="tf-card">
          {mode === "live" ? (
            <>
              <div className="tf-between" style={{ flexWrap: "wrap", gap: 8, marginBottom: displayTotalDays > 1 ? 10 : 0 }}>
                <div className="tf-section-eyebrow" style={{ marginBottom: 0 }}>
                  {displayDay === currentDay ? t("Today's itinerary") : t("Itinerary")} · {t("Day")} {displayDay}
                </div>
                {displayTotalDays > 1 && (
                  <div className="tf-flex tf-gap-6" style={{ flexWrap: "wrap" }}>
                    {Array.from({ length: displayTotalDays }, (_, i) => i + 1).map((d) => (
                      <button
                        key={d}
                        className={"tf-btn tf-btn-sm " + (d === displayDay ? "tf-btn-solid" : "tf-btn-ghost")}
                        onClick={() => setViewDay(d)}
                      >
                        {t("Day")} {d}{d === currentDay ? ` (${t("Today")})` : ""}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <JourneyTimeline
                items={todayItems} dayNumber={displayDay} totalDays={displayTotalDays} isToday={displayDay === currentDay}
                onAddClick={editable ? () => setShowItinerary(true) : undefined}
                canEdit={editable} onSetStatus={handleSetItineraryStatus} onToggleComplete={handleToggleComplete} onMoveStop={handleMoveStop}
                onOpenAttendance={(it) => setAttendanceItem(it)}
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
              {!scopedToCoach && (
                <div className="tf-section-sub">
                  {mode === "planning" ? t("Assign delegates to coaches before the trip departs")
                    : mode === "completed" ? t("Where everyone ended up")
                    : t("Drag any delegate card between columns to reassign on the fly")}
                </div>
              )}
            </div>
            <button className="tf-btn tf-btn-ghost tf-btn-sm" onClick={() => setShowHistory(true)} title={t("View change history")}>
              <Clock size={13} /> {t("History")}
            </button>
          </div>

          {scopedToCoach && (
            <div className="tf-scope-banner" role="status">
              <Users size={15} />
              <span>{t("You're the captain of")} <strong>{myCoaches.map((c) => c.label).join(", ")}</strong>. {t("Other coaches are hidden.")} ({boardCoaches.length}/{coaches.length})</span>
            </div>
          )}

          {mode === "planning" && editable && !scopedToCoach && (
            <CapacityPlanner delegateCount={delegates.length} coachCount={coaches.length} onGenerate={handleGenerateCoaches} />
          )}

          {!scopedToCoach && wrongCoachIds.size > 0 && (
            <div className="tf-wrongcoach-banner" role="alert">
              <AlertCircle size={15} />
              <span>
                <strong>{wrongCoachIds.size}</strong> {t(wrongCoachIds.size === 1 ? "delegate is on a coach that isn't on this trip" : "delegates are on a coach that isn't on this trip")}.{" "}
                {t("They're shown under Unassigned — reassign them to a coach here, or remove them.")}
              </span>
            </div>
          )}

          <div className="tf-fleet-scroll">
            {boardCoaches.map((coach) => (
              <FleetCard
                key={coach.id} coach={coach} delegates={delegatesByCoach[coach.id] || []} mode={mode}
                isOver={overCol === coach.id} colRef={(node) => { colRefs.current[coach.id] = node; }} shake={shakeCoachId === coach.id}
                onPointerDownCard={onPointerDownCard} onKeyOpen={setPanelDelegate} draggingId={ghost?.delegate?.id}
                onRemoveCoach={editable && !scopedToCoach ? handleRemoveCoach : undefined} onRemoveDelegate={editable ? handleRemoveDelegate : undefined} onEditStaff={editable && !scopedToCoach ? setEditStaffCoach : undefined}
                onCycleArrival={editable && mode === "live" ? handleCycleArrival : undefined}
              />
            ))}
            {!scopedToCoach && (
              <FleetCard
                coach={{ id: UNASSIGNED_COL, label: t("Unassigned") }} delegates={delegatesByCoach[UNASSIGNED_COL] || []} mode={mode}
                isUnassigned isOver={overCol === UNASSIGNED_COL} colRef={(node) => { colRefs.current[UNASSIGNED_COL] = node; }}
                onPointerDownCard={onPointerDownCard} onKeyOpen={setPanelDelegate} draggingId={ghost?.delegate?.id} onRemoveDelegate={editable ? handleRemoveDelegate : undefined}
                wrongCoachIds={wrongCoachIds}
              />
            )}
            {editable && !scopedToCoach && <button className="tf-add-fleet-card" onClick={() => setShowAddCoach(true)}><Plus size={18} /> {t("Add coach")}</button>}
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
