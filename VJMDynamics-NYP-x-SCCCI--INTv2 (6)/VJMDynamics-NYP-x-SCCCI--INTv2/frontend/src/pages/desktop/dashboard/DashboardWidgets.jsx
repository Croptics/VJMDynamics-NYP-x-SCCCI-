/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Dashboard small presentational widgets
 *
 *  Extracted from DashboardPage.jsx (2026-08-02 modularization pass) — small,
 *  mostly-stateless building blocks (KPI tiles, roster bars, coach bars, the
 *  trip switcher, history rows) shared across the Overview/Delegate tabs.
 * ============================================================================= */
import { useState, useEffect, useRef } from "react";
import { ChevronDown, ChevronRight, Trash2, UserCheck, Users, HelpCircle } from "lucide-react";
import { useLang } from "../../../lib/i18n.jsx";
import { S } from "../../../lib/dashboard/dashboardStyles.js";
import { coachShortLabel, coachDisplayName, coachBarSegments, activityColor, translateActivityText } from "../../../lib/dashboard/dashboardHelpers.js";

/** Self-ticking device-clock chip (2026-08-02 optimization pass). Was
 *  `nowClock` state living directly in DashboardPage() — a useState +
 *  setInterval(15000) ticking at the TOP of the whole component tree, so
 *  every 15s the entire Dashboard (every KPI tile, every coach bar, the
 *  whole delegate table) re-rendered just to update this one small text
 *  string. Isolating the tick into its own leaf component means only THIS
 *  renders every 15s — same pattern this file's own LiveSyncBadge already
 *  used for an earlier per-second countdown. */
export function NowClock() {
  const [now, setNow] = useState(() =>
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true })
  );
  useEffect(() => {
    const id = setInterval(
      () => setNow(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true })),
      15000
    );
    return () => clearInterval(id);
  }, []);
  return now;
}

/** A History tracker row that expands to list the affected delegates for a
 *  consolidated system entry (2026-07-31 — "give me option to view detail by
 *  dropdown ... to see which delegate"). `a.changes.affected` (see
 *  db/history.js's logActivity()) is only ever present on the "System reset
 *  N delegates..."/"System marked N delegates late..." batch entries from
 *  routes/checkpoints.js — a normal single-delegate edit's `changes` is
 *  still the plain {field:{from,to}} diff shape HistoryLogPage's Rollback
 *  reads, untouched by this. */
export function HistoryEntryRow({ a, t, onDelete, canDelete }) {
  const [open, setOpen] = useState(false);
  const affected = a.changes?.affected;
  return (
    <div style={{ flexShrink: 0 }}>
      <div className="row between" style={{ gap: 12, alignItems: "flex-start" }}>
        <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
          <span style={{ ...S.dot, background: activityColor(a.kind), marginTop: 6 }} />
          <div>
            <div style={{ fontSize: 14 }}>{translateActivityText(a.text, t)}</div>
            <div className="muted" style={{ fontSize: 12 }}>{a.time} · {a.via === "you" ? t("you") : a.via}</div>
            {affected?.length > 0 && (
              <button
                className="btn btn-ghost"
                style={{ fontSize: 11.5, padding: "2px 8px", marginTop: 6 }}
                onClick={() => setOpen((v) => !v)}
              >
                {open ? t("Hide delegates") : t("View delegates")} ({affected.length}) <ChevronDown size={12} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
              </button>
            )}
            {open && affected?.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {affected.map((d) => (
                  <span key={d.id} className="badge badge-neutral">{d.name}</span>
                ))}
              </div>
            )}
          </div>
        </div>
        {canDelete && (
          <button onClick={() => onDelete(a.id)} aria-label="Delete" style={{ ...S.iconBtn, color: "var(--st-missing)" }}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

export function LiveSyncBadge({ seconds, t, dotStyle }) {
  return (
    <span className="badge badge-present" title={t(`Auto-refreshes every ${seconds} seconds`)}>
      <span style={dotStyle} /> {t("Synced")}
    </span>
  );
}

/* ---- Trip switcher (2026-07-30 — "fix the button color for dark theme
 * mode" / "i don't like the hover effect, color"). This USED to be a native
 * <select> laid invisibly over the styled title text (kept for its built-in
 * keyboard handling and native dropdown) — but a native <option> list's
 * hover/highlight colors are drawn by the OS, not by our CSS, and in dark
 * theme that OS highlight came out dark-on-dark — genuinely unreadable, not
 * something author CSS can reliably fix cross-browser. Rebuilt as a real,
 * fully-styled dropdown (a button + our own absolutely-positioned menu) so
 * every pixel — including the hover state — uses this app's own theme
 * tokens (`--surface-2`, the same hover fill every other menu/nav item in
 * the app already uses) instead of the browser's native option styling. */
export function TripSwitcher({ trip, tripOptions, selectedTripId, t, onPick }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); }
    function onKeyDown(e) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span className="mg-title-switch" ref={rootRef}>
      <button
        type="button"
        className="mg-title-switch-btn"
        onClick={() => setOpen((v) => !v)}
        title={t("Switch trip")}
        aria-label={t("Switch trip")}
        aria-expanded={open}
      >
        <span className="mg-title-name">
          {trip ? `${trip.name}${trip.countryTo ? ` (${trip.countryTo})` : ""}` : t("Dashboard")}
        </span>
        <ChevronDown size={20} strokeWidth={2.5} aria-hidden="true" />
      </button>
      {open && (
        <div className="mg-title-menu" role="listbox">
          {tripOptions.map((tr) => (
            <button
              key={tr.id}
              type="button"
              role="option"
              aria-selected={tr.id === selectedTripId}
              className={"mg-title-menu-item" + (tr.id === selectedTripId ? " active" : "")}
              onClick={() => { onPick(tr.id); setOpen(false); }}
            >
              {tr.name}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/* ---- Small progress ring — the KPI tiles' only visual data accent beyond
 * plain numbers (2026-07-24, "the Overview tab feels plain" feedback). Pure
 * SVG, no charting library — this is small enough not to warrant pulling
 * AnalyticsPanel's recharts dependency into every page load. */
export function ProgressRing({ value, total, tone, size = 34, strokeWidth = 4 }) {
  const pct = total > 0 ? Math.min(1, value / total) : 0;
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={strokeWidth} />
      {pct > 0 && (
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`var(--st-${tone})`} strokeWidth={strokeWidth}
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      )}
    </svg>
  );
}

/* ---- KPI tile ----------------------------------------------------------- */
export function Kpi({ tone, icon: Icon, label, value, suffix, foot, big, onClick, ringValue, ringTotal }) {
  const clickable = !!onClick;
  const showRing = ringValue != null && ringTotal > 0;
  return (
    <div
      className={"card" + (clickable ? " kpi-clickable" : "")}
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onClick()) : undefined}
      style={{
        padding: 20, display: "flex", flexDirection: "column", gap: 10, cursor: clickable ? "pointer" : undefined,
        "--kpi-tone": `var(--st-${tone})`,
      }}
    >
      <div className="row between">
        <span className="page-eyebrow" style={{ color: `var(--st-${tone})` }}>{label}</span>
        {showRing ? (
          <div style={{ position: "relative", width: 34, height: 34 }}>
            <ProgressRing value={ringValue} total={ringTotal} tone={tone} />
            <Icon size={14} color={`var(--st-${tone})`} style={{ position: "absolute", inset: 0, margin: "auto" }} />
          </div>
        ) : (
          <Icon size={18} color={`var(--st-${tone})`} />
        )}
      </div>
      <div className="row" style={{ alignItems: "baseline", gap: 8 }}>
        <span className="mono"
          style={{ fontSize: big ? 44 : 40, fontWeight: 700, color: `var(--st-${tone})`, lineHeight: 1 }}>
          {value}
        </span>
        {suffix && <span className="muted" style={{ fontSize: 16 }}>{suffix}</span>}
      </div>
      {foot && <div className="muted" style={{ fontSize: 13 }}>{foot}</div>}
    </div>
  );
}

/* ---- Roster breakdown card -----------------------------------------------
 * Folds Arrived / Assigned / Unassigned into one card: a proportional stacked
 * bar (share of the roster in each status) plus 3 compact clickable stats —
 * the calmer counts don't need a full KPI tile each like Missing/Late do. */
export function RosterCard({ t, k, onFilter }) {
  const segments = [
    { tone: "present", value: k.present },
    { tone: "assigned", value: k.assigned ?? 0 },
    { tone: "unassigned", value: k.unassigned },
  ];
  // Percentages are relative to the sum of the 3 segments actually drawn
  // here (not k.total) — Missing/Late already have their own tiles and
  // aren't represented in this bar, so using k.total left an unexplained
  // blank gap at the end instead of the bar reading as "the whole thing".
  const total = Math.max(segments.reduce((sum, s) => sum + s.value, 0), 1);

  return (
    <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column" }}>
      <span className="page-eyebrow" style={{ color: "var(--ink-3)" }}>{t("Roster breakdown")}</span>
      <div className="roster-bar" style={{ marginTop: 12 }}>
        {segments.map((s) => s.value > 0 && (
          <span key={s.tone} style={{ width: `${(s.value / total) * 100}%`, background: `var(--st-${s.tone})` }} />
        ))}
      </div>
      <div className="roster-stats">
        <RosterStat tone="present" icon={UserCheck} label={t("Arrived")} value={k.present} onClick={() => onFilter("ARRIVED")} />
        <RosterStat tone="assigned" icon={Users} label={t("Assigned")} value={k.assigned ?? 0} onClick={() => onFilter("ASSIGNED")} />
        <RosterStat tone="unassigned" icon={HelpCircle} label={t("Unassigned")} value={k.unassigned} onClick={() => onFilter("UNASSIGNED")} />
      </div>
    </div>
  );
}

export function RosterStat({ tone, icon: Icon, label, value, onClick }) {
  return (
    <button className="roster-stat" onClick={onClick} style={{ "--roster-tone": `var(--st-${tone})` }}>
      <span className="row" style={{ gap: 6, color: `var(--st-${tone})` }}>
        <Icon size={14} />
        <span className="muted" style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{label}</span>
      </span>
      <span className="mono" style={{ fontSize: 24, fontWeight: 700, color: `var(--st-${tone})`, lineHeight: 1.2 }}>{value}</span>
    </button>
  );
}

/* ---- Coach progress bar -------------------------------------------------
 * When onOpen is provided the whole row is clickable and navigates to that
 * trip's board on the Trips (Desmond) page.
 * ------------------------------------------------------------------------- */
export function CoachBar({ coach, onOpen }) {
  const { t } = useLang();
  // Simplified two-state headline (per request): a coach is "Missing" if it
  // holds ANYONE not yet accounted for — LATE is folded in with MISSING, no
  // separate Late badge — and "Arrived" only when everyone assigned has
  // actually boarded. `attention` is that combined not-here count.
  const attention = (coach.missing || 0) + (coach.late || 0);
  const allArrived = coach.total > 0 && attention === 0 && coach.boarded === coach.total;
  const BAR_H = 8;
  const segs = coachBarSegments(coach);
  const clickable = !!onOpen;
  return (
    <div
      onClick={onOpen}
      role={clickable ? "button" : undefined}
      title={clickable ? t("Open in Trips board") : undefined}
      style={clickable ? { cursor: "pointer", borderRadius: "var(--r-sm)", padding: 6, margin: -6 } : undefined}
      className={clickable ? "coach-row" : undefined}
    >
      <div className="row between" style={{ marginBottom: 6 }}>
        <div className="row" style={{ gap: 10 }}>
          <span className="avatar" style={{ background: "var(--st-neutral-bg)", color: "var(--ink-2)" }}>
            {coachShortLabel(coach)}
          </span>
          <span style={{ fontWeight: 500, fontSize: 14 }}>{coachDisplayName(coach)}</span>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {attention > 0 ? (
            <span className="badge badge-missing">{attention} {t("not boarded")}</span>
          ) : allArrived ? (
            <span className="badge badge-present">{t("Arrived")}</span>
          ) : coach.total > 0 ? (
            <span className="badge badge-neutral">{coach.total - coach.boarded} {t("to board")}</span>
          ) : (
            <span className="badge badge-neutral">{t("Empty")}</span>
          )}
          {clickable && <ChevronRight size={16} className="muted" />}
        </div>
      </div>
      <div className="roster-bar" style={{ height: BAR_H }}>
        {segs.map((s, i) => <span key={i} style={{ width: `${s.pct}%`, background: `var(--st-${s.tone})` }} />)}
      </div>
      <div className="muted mono" style={{ fontSize: 12, marginTop: 4 }}>
        {coach.boarded}/{coach.capacity} {t("boarded")}
        {coach.late > 0 && <> · <span style={{ color: "var(--st-late)" }}>{coach.late} {t("late")}</span></>}
        {coach.missing > 0 && <> · <span style={{ color: "var(--st-missing)" }}>{coach.missing} {t("missing")}</span></>}
      </div>
    </div>
  );
}

// One labelled value in the delegate profile panel — skips rendering
// entirely when there's nothing to show, so an incomplete profile doesn't
// leave a grid of empty "—" rows (2026-07-24). `action` renders a small
// icon button (e.g. Call) beside the value instead of making the value
// itself a clickable link — a plain phone number that's secretly a tel:
// link reads as an odd, unlabeled focus outline (2026-07-24 feedback).
export function ProfileField({ icon: Icon, label, value, action, mono }) {
  if (!value) return null;
  return (
    <div>
      <div className="muted" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, marginBottom: 2 }}>
        {Icon && <Icon size={12} />} {label}
      </div>
      <div className="row" style={{ gap: 8, alignItems: "center" }}>
        <span className={mono ? "mono" : undefined} style={{ fontSize: 14, fontWeight: 500 }}>{value}</span>
        {action}
      </div>
    </div>
  );
}
