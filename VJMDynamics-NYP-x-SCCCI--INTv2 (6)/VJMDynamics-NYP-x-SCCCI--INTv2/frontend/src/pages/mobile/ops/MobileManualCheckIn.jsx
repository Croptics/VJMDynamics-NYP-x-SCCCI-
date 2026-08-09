// frontend/src/pages/mobile/MobileManualCheckIn.jsx
//
// Manual check-in, built for a phone held at a coach door — the fallback path
// when a scan can't work (no badge, dead phone, face won't match, delegate
// never enrolled). Replaces the desktop ManualTrackingPanel that /mobile/scan/
// manual used to mount: that panel is `position:absolute; inset:0`, designed to
// fill the scanner's fixed camera square, so inside the mobile page's
// height-less "manual" viewport it collapsed to nothing — the roster was
// literally invisible on the phone. The desktop panel stays untouched for the
// desktop scanner; this is the touch-first version.
//
// What makes it a real manual check-in rather than a list with buttons:
//   · Swipe a row right to check someone in (swipe a just-marked row left to
//     undo) — one-handed, no aiming at a small button. The button is still
//     there for accessibility and for mouse/keyboard.
//   · Multi-select for a queue of people ("Check in 6") instead of six
//     round-trips through the same tap.
//   · An audit reason (why was a scan bypassed?) captured ONCE per session and
//     written as a LOW-priority exception ticket, so the override trail says
//     more than "someone pressed a button". Skippable — speed wins at a door.
//   · A 6-second undo snackbar, the standard for destructive-ish one-taps,
//     alongside the per-row undo.
//   · Offline-aware: manualOverride() queues in lib/outbox.js with no signal,
//     so rows show "Queued" and undo is withheld until the write lands (the
//     undo endpoint has no idempotency key — see exceptionsApi.js).
//
// Writes go through Jayden's data layer (manualOverride → POST
// /api/checkins/manual) exactly as before; no new backend surface.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search, X, CheckCircle2, UserCheck, ShieldAlert, PencilLine, Undo2, Crown,
  ScanFace, QrCode, BatteryWarning, UserPlus, ListChecks, WifiOff, Check, Users,
} from "lucide-react";
import { getPermissions } from "../../../lib/api.js";
import {
  manualOverride, undoManualOverride, createException,
  queuedCheckinIds, isCheckinQueued, TYPE_OTHER_MAX,
} from "../../../lib/exception/exceptionsApi.js";
import { useLang } from "../../../lib/i18n.jsx";

const haptic = (pattern) => { try { navigator.vibrate && navigator.vibrate(pattern); } catch { /* unsupported */ } };

const initialsOf = (name = "?") =>
  name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

const hhmm = () => new Date().toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", hour12: false });

// Same 5-status vocabulary as the Dashboard and the desktop panel; PRESENT is
// the legacy alias some check-in routes still write.
const STATUS_LABEL = {
  ARRIVED: "Arrived", PRESENT: "Arrived", ASSIGNED: "Assigned",
  LATE: "Late", MISSING: "Missing", UNASSIGNED: "Unassigned",
};
const STATUS_TONE = {
  ARRIVED: "var(--st-present)", PRESENT: "var(--st-present)", ASSIGNED: "var(--st-assigned)",
  LATE: "var(--st-late)", MISSING: "var(--st-missing)", UNASSIGNED: "var(--st-neutral)",
};
const STATUS_BG = {
  ARRIVED: "var(--st-present-bg)", PRESENT: "var(--st-present-bg)", ASSIGNED: "var(--st-assigned-bg)",
  LATE: "var(--st-late-bg)", MISSING: "var(--st-missing-bg)", UNASSIGNED: "var(--st-neutral-bg)",
};
// Still-to-act-on first, already-in last — the order staff actually work in.
const SORT_RANK = { MISSING: 0, LATE: 1, ASSIGNED: 2, UNASSIGNED: 3, ARRIVED: 4, PRESENT: 4 };
const isPresent = (s) => s === "ARRIVED" || s === "PRESENT";

/* Why a scan was bypassed. Mapped onto the exception_type enum the tickets
 * table already has (exceptionsApi.ISSUE_LABEL) so these overrides land in the
 * SAME inbox staff already review — no new vocabulary, no schema change.
 * "Not enrolled" has no enum value of its own, so it rides OTHER + typeOther
 * (which the backend caps at TYPE_OTHER_MAX chars). */
const REASONS = [
  { key: "LOST_BADGE", type: "LOST_BADGE", label: "No badge", hint: "Lost, damaged or left behind", Icon: QrCode },
  { key: "DEAD_PHONE", type: "DEAD_PHONE", label: "Dead phone", hint: "Can't show their QR", Icon: BatteryWarning },
  { key: "FACE_MATCH_FAILED", type: "FACE_MATCH_FAILED", label: "Face won't match", hint: "Scanner can't confirm them", Icon: ScanFace },
  { key: "NOT_ENROLLED", type: "OTHER", typeOther: "Not enrolled", label: "Not enrolled", hint: "No face or voice on file", Icon: UserPlus },
  { key: "VIP_REQUEST", type: "VIP_REQUEST", label: "VIP fast-track", hint: "Waved through on request", Icon: Crown },
  { key: "OTHER", type: "OTHER", label: "Other", hint: "Type a short note", Icon: PencilLine },
];

// Late/Missing/Everyone removed (2026-07-30 — "can you remove late,
// missing, everyone tab") — the underlying filter values still work if
// something else ever links here with ?filter=LATE etc (see `visible`'s
// filter predicate below, untouched), this only trims which ones render as
// tappable chips on this screen.
const FILTERS = [
  { key: "TODO", label: "To check in" },
  { key: "DONE", label: "Checked in" },
];

const HINT_KEY = "musterGo.manualSwipeHintSeen";
const UNDO_SECONDS = 6;

/**
 * @param {object}   p
 * @param {object}   p.coach        GET /attendance/:trip/coach/:id payload (or null)
 * @param {string}   p.coachLabel   "Coach 2"
 * @param {string}   p.coachId      c2 — stamped on the audit ticket
 * @param {string}   p.tripId       the mobile trip switcher's current trip; forwarded
 *                                  as manualOverride's checkpointTripId so the
 *                                  checkpoint-scoped KPIs follow the override too
 *                                  (the check_in_logs write stays on "t-1" — see
 *                                  exceptionsApi.manualOverride's comment).
 * @param {Function} p.onCheckedIn  refetch hook — the page re-pulls coach + coaches
 */
export default function MobileManualCheckIn({ coach, coachLabel, coachId, tripId, onCheckedIn }) {
  const { t } = useLang();
  const canEdit = getPermissions().manageExceptions;

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("TODO");
  // Optimistic ARRIVED, seeded from the offline outbox so a check-in taken with
  // no signal still READS as present after a reload instead of silently
  // reverting until the queue drains (re-tapping is harmless — clientEventId
  // dedupes — but it looks broken).
  const [justMarked, setJustMarked] = useState(() => new Set(queuedCheckinIds()));
  const [markedAt, setMarkedAt] = useState({});      // delegateId → "21:36", for the row subtitle
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [error, setError] = useState("");

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());

  // Session reason: asked once, then reused for every check-in on this screen.
  // `reasonChosen` distinguishes "not asked yet" from "asked, chose not to log".
  const [reason, setReason] = useState(null);
  const [reasonChosen, setReasonChosen] = useState(false);
  const [sheetFor, setSheetFor] = useState(null);    // delegates awaiting a reason, or null

  const [undoState, setUndoState] = useState(null);  // { ids, names, left }
  const [hintSeen, setHintSeen] = useState(() => {
    try { return localStorage.getItem(HINT_KEY) === "1"; } catch { return true; }
  });

  const roster = coach?.delegates || [];
  const statusOf = (d) => (justMarked.has(d.delegateId) ? "ARRIVED" : d.status);

  const counts = useMemo(() => {
    const c = { TODO: 0, LATE: 0, MISSING: 0, DONE: 0, ALL: roster.length };
    roster.forEach((d) => {
      const s = statusOf(d);
      if (isPresent(s)) c.DONE += 1; else c.TODO += 1;
      if (s === "LATE") c.LATE += 1;
      if (s === "MISSING") c.MISSING += 1;
    });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, justMarked]);

  const visible = useMemo(() => {
    const qq = query.trim().toLowerCase();
    return roster
      .filter((d) => {
        const s = statusOf(d);
        if (filter === "TODO" && isPresent(s)) return false;
        if (filter === "DONE" && !isPresent(s)) return false;
        if (filter === "LATE" && s !== "LATE") return false;
        if (filter === "MISSING" && s !== "MISSING") return false;
        if (!qq) return true;
        // Name, id, or monogram — typing "jt" finds Jia Tan on a moving coach.
        return d.name.toLowerCase().includes(qq)
          || String(d.delegateId).toLowerCase().includes(qq)
          || (d.initials || initialsOf(d.name)).toLowerCase().startsWith(qq);
      })
      .sort((a, b) => {
        const ra = SORT_RANK[statusOf(a)] ?? 3;
        const rb = SORT_RANK[statusOf(b)] ?? 3;
        if (ra !== rb) return ra - rb;
        if (!!b.vip !== !!a.vip) return b.vip ? 1 : -1;   // VIPs first within a status
        return a.name.localeCompare(b.name);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, query, filter, justMarked]);

  // Sticky section headers — the list reads as "Missing 3 · Late 2 · Assigned 12"
  // rather than one undifferentiated scroll.
  const groups = useMemo(() => {
    const out = [];
    visible.forEach((d) => {
      const s = statusOf(d);
      const key = isPresent(s) ? "ARRIVED" : s;
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(d);
      else out.push({ key, items: [d] });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, justMarked]);

  /* Undo countdown. One interval for the whole snackbar; clearing it on unmount
   * matters because a check-in can be the last thing staff do before switching
   * to the QR tab. */
  useEffect(() => {
    if (!undoState) return undefined;
    const id = setInterval(() => {
      setUndoState((cur) => (!cur ? null : cur.left <= 1 ? null : { ...cur, left: cur.left - 1 }));
    }, 1000);
    return () => clearInterval(id);
  }, [undoState]);

  const dismissHint = () => {
    setHintSeen(true);
    try { localStorage.setItem(HINT_KEY, "1"); } catch { /* private mode — hint just returns */ }
  };

  /* ---- writes ------------------------------------------------------------ */

  /** Entry point for every check-in path (button, swipe, bulk bar). Asks for the
   *  session reason first time round, then commits. */
  function requestCheckIn(list) {
    const targets = list.filter((d) => !isPresent(statusOf(d)) && !busyIds.has(d.delegateId));
    if (!canEdit || targets.length === 0) return;
    if (!reasonChosen) { setSheetFor(targets); return; }
    commit(targets, reason);
  }

  async function commit(list, why) {
    setError("");
    setSheetFor(null);
    setSelectMode(false);
    setSelected(new Set());
    setBusyIds((prev) => { const n = new Set(prev); list.forEach((d) => n.add(d.delegateId)); return n; });
    setJustMarked((prev) => { const n = new Set(prev); list.forEach((d) => n.add(d.delegateId)); return n; });

    const stamp = hhmm();
    const done = [];
    const failed = [];
    for (const d of list) {
      try {
        const res = await manualOverride(d.delegateId, tripId, { name: d.name });
        done.push({ ...d, queued: !!res?.queued });
      } catch (e) {
        failed.push(d);
        setJustMarked((prev) => { const n = new Set(prev); n.delete(d.delegateId); return n; });
        setError(
          e.status === 403
            ? t("You need the ‘Manage exceptions’ permission for manual check-in.")
            : `${d.name} — ${e.message || t("could not be checked in. Try again.")}`
        );
      }
    }
    setBusyIds((prev) => { const n = new Set(prev); list.forEach((d) => n.delete(d.delegateId)); return n; });

    if (done.length) {
      setMarkedAt((prev) => {
        const n = { ...prev };
        done.forEach((d) => { n[d.delegateId] = stamp; });
        return n;
      });
      haptic([16, 36, 16]);
      logReason(done, why);
      // Only rows that actually reached the server can be undone — the undo
      // endpoint has no idempotency key, so replaying it alongside a queued
      // check-in could land out of order.
      const undoable = done.filter((d) => !d.queued);
      setUndoState(undoable.length
        ? { items: undoable.map((d) => ({ id: d.delegateId, name: d.name })), left: UNDO_SECONDS }
        : null);
      onCheckedIn?.();
    }
    if (failed.length && done.length) {
      setError(`${done.length} ${t("checked in")} · ${failed.length} ${t("failed")}`);
    }
  }

  /** Audit trail for the override. Best-effort and fire-and-forget: a ticket
   *  that fails to write must never make staff re-do a check-in that already
   *  landed. One ticket per batch (not per person) so a 20-person bulk
   *  check-in doesn't bury the issues inbox. */
  function logReason(list, why) {
    if (!why) return;
    const names = list.map((d) => d.name).join(", ");
    createException({
      type: why.type,
      typeOther: why.type === "OTHER" ? (why.typeOther || why.note || "Manual").slice(0, TYPE_OTHER_MAX) : undefined,
      delegateId: list.length === 1 ? list[0].delegateId : null,
      coachId: coachId || null,
      note: `${t("Manual check-in")}${list.length > 1 ? ` ×${list.length}` : ""} · ${coachLabel || t("Coach")} · ${names}`
        + (why.note ? ` · ${why.note}` : ""),
      priority: "LOW",
      tripId,
    }).catch(() => { /* audit note only — the check-in itself already succeeded */ });
  }

  async function undoOne(d) {
    if (!canEdit || isCheckinQueued(d.delegateId)) return;
    setBusyIds((prev) => new Set(prev).add(d.delegateId));
    setError("");
    try {
      await undoManualOverride(d.delegateId, tripId);
      setJustMarked((prev) => { const n = new Set(prev); n.delete(d.delegateId); return n; });
      // Keep the snackbar honest if a row was undone individually while it was
      // still counting down.
      setUndoState((cur) => {
        if (!cur) return null;
        const items = cur.items.filter((it) => it.id !== d.delegateId);
        return items.length ? { ...cur, items } : null;
      });
      haptic(12);
      onCheckedIn?.();
    } catch (e) {
      setError(e.message || t("Could not undo — try again."));
    } finally {
      setBusyIds((prev) => { const n = new Set(prev); n.delete(d.delegateId); return n; });
    }
  }

  async function undoBatch() {
    if (!undoState) return;
    const ids = undoState.items.map((it) => it.id);
    setUndoState(null);
    setBusyIds((prev) => { const n = new Set(prev); ids.forEach((id) => n.add(id)); return n; });
    for (const id of ids) {
      try {
        await undoManualOverride(id, tripId);
        setJustMarked((prev) => { const n = new Set(prev); n.delete(id); return n; });
      } catch (e) {
        setError(e.message || t("Could not undo — try again."));
      }
    }
    setBusyIds((prev) => { const n = new Set(prev); ids.forEach((id) => n.delete(id)); return n; });
    haptic(12);
    onCheckedIn?.();
  }

  function toggleSelect(d) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(d.delegateId)) n.delete(d.delegateId); else n.add(d.delegateId);
      return n;
    });
    haptic(6);
  }

  /* ---- render ------------------------------------------------------------ */

  const doneCount = counts.DONE;
  const total = roster.length;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;
  const queuedCount = roster.filter((d) => isCheckinQueued(d.delegateId)).length;
  const selectedDelegates = roster.filter((d) => selected.has(d.delegateId));
  const selectableInView = visible.filter((d) => !isPresent(statusOf(d)));

  return (
    <div className="mman-card">
      {/* ---- header: progress, search, filters ---- */}
      <div className="mman-head">
        <div className="row between" style={{ alignItems: "flex-start", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div className="mman-count">
              {doneCount}<span style={{ fontSize: 15, fontWeight: 700, color: "var(--ink-3)" }}> / {total}</span>
            </div>
            <div className="m-eyebrow" style={{ marginTop: 3 }}>
              {coachLabel ? `${coachLabel} · ` : ""}{t("checked in by hand or scan")}
            </div>
          </div>
          {canEdit && total > 0 && (
            <button
              className="m-chip"
              style={selectMode ? { background: "var(--scc-red-tint)", color: "var(--scc-red)", borderColor: "var(--scc-red-tint-2)" } : undefined}
              onClick={() => { setSelectMode((v) => !v); setSelected(new Set()); }}
              aria-pressed={selectMode}
            >
              {selectMode ? <><X size={14} /> {t("Cancel")}</> : <><ListChecks size={14} /> {t("Select")}</>}
            </button>
          )}
        </div>

        <div className="m-progress" style={{ marginTop: 10 }}>
          <i style={{ width: `${pct}%` }} />
        </div>
        <div className="row between" style={{ marginTop: 6 }}>
          <span style={{ fontSize: 11.5, color: "var(--ink-3)", fontWeight: 600 }}>
            {counts.TODO > 0
              ? `${counts.TODO} ${t("still to check in")}`
              : total > 0 ? t("Everyone is accounted for") : ""}
          </span>
          {queuedCount > 0 && (
            <span className="mman-tag" style={{ color: "var(--st-late)", borderColor: "var(--st-late)" }}>
              <WifiOff size={11} /> {queuedCount} {t("queued")}
            </span>
          )}
        </div>

        <div className="mman-search-wrap">
          <Search size={16} className="mman-search-ic" />
          <input
            className="mman-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Search name or initials…")}
            aria-label={t("Search delegates")}
            autoComplete="off"
          />
          {query && (
            <button className="mman-search-clear" onClick={() => setQuery("")} aria-label={t("Clear search")}>
              <X size={15} />
            </button>
          )}
        </div>

        <div className="m-chip-row" style={{ marginTop: 10 }}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`m-chip ${filter === f.key ? "active" : ""}`}
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
            >
              {t(f.label)} <span className="mono" style={{ opacity: 0.7 }}>{counts[f.key]}</span>
            </button>
          ))}
        </div>

        {/* Session reason — set once, shown here, changeable any time. */}
        {canEdit && reasonChosen && (
          <button
            className="row between"
            onClick={() => setSheetFor([])}
            style={{
              width: "100%", marginTop: 10, padding: "8px 11px", borderRadius: "var(--r-sm)",
              border: "1px dashed var(--line)", background: "var(--surface-2)", color: "var(--ink-2)",
              font: "inherit", fontSize: 12, fontWeight: 600, textAlign: "left",
            }}
          >
            <span className="row" style={{ gap: 7, minWidth: 0 }}>
              <PencilLine size={13} style={{ color: "var(--ink-3)", flexShrink: 0 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {/* An "Other" reason shows the words staff actually typed,
                    not the generic enum label. */}
                {reason ? `${t("Logging as")}: ${reason.note || t(reason.label)}` : t("Not logging a reason")}
              </span>
            </span>
            <span style={{ color: "var(--scc-red)", fontWeight: 700, flexShrink: 0 }}>{t("Change")}</span>
          </button>
        )}
      </div>

      {!canEdit && (
        <div style={{
          margin: "12px 12px 0", padding: "9px 11px", borderRadius: "var(--r-sm)", fontSize: 12,
          background: "var(--st-unassigned-bg)", color: "var(--st-unassigned)", border: "1px solid var(--st-unassigned)",
        }}>
          <ShieldAlert size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
          {t("Read-only — manual check-in needs the “Manage exceptions” permission.")}
        </div>
      )}

      {error && (
        <div style={{
          margin: "12px 12px 0", padding: "9px 11px", borderRadius: "var(--r-sm)", fontSize: 12.5,
          background: "var(--st-missing-bg)", color: "var(--scc-red-700)", border: "1px solid var(--scc-red-tint-2)",
        }}>
          {error}
        </div>
      )}

      {/* One-time gesture discovery — a swipe affordance nobody tells you about
          is a swipe affordance nobody uses. */}
      {canEdit && !hintSeen && total > 0 && (
        <div className="row between" style={{
          margin: "12px 12px 0", padding: "9px 11px", borderRadius: "var(--r-sm)", gap: 8,
          background: "var(--st-present-bg)", color: "var(--st-present)", fontSize: 12, fontWeight: 600,
        }}>
          <span className="row" style={{ gap: 7 }}>
            <UserCheck size={14} style={{ flexShrink: 0 }} /> {t("Swipe a row right to check in")}
          </span>
          <button onClick={dismissHint} aria-label={t("Dismiss")} style={{ background: "none", border: "none", color: "inherit", display: "flex", padding: 2 }}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* ---- roster ---- */}
      {!coach ? (
        <div className="m-empty">
          <span className="m-empty-ic"><Users size={20} /></span>
          <div style={{ fontWeight: 700, color: "var(--ink)" }}>{t("Pick a coach first")}</div>
          <div style={{ fontSize: 12.5 }}>{t("Choose the coach above to load its roster.")}</div>
        </div>
      ) : total === 0 ? (
        <div className="m-empty">
          <span className="m-empty-ic"><PencilLine size={20} /></span>
          <div style={{ fontWeight: 700, color: "var(--ink)" }}>{t("No delegates on this coach")}</div>
          <div style={{ fontSize: 12.5 }}>{t("Assign delegates to it on the Trips tab, then come back.")}</div>
        </div>
      ) : visible.length === 0 ? (
        <div className="m-empty">
          <span className="m-empty-ic"><Search size={19} /></span>
          <div style={{ fontWeight: 700, color: "var(--ink)" }}>
            {query ? t("No match on this coach") : t("Nothing in this filter")}
          </div>
          <div style={{ fontSize: 12.5 }}>
            {query
              ? t("They may be on another coach — switch coach above.")
              : t("Try another filter.")}
          </div>
        </div>
      ) : (
        <div className="mman-list">
          {groups.map((g) => (
            <div key={`${g.key}-${g.items[0].delegateId}`}>
              <div className="mman-group">
                <i style={{ background: STATUS_TONE[g.key] }} />
                {t(STATUS_LABEL[g.key] || g.key)} · {g.items.length}
              </div>
              {g.items.map((d) => {
                const status = statusOf(d);
                const present = isPresent(status);
                const queued = isCheckinQueued(d.delegateId);
                return (
                  <ManualRow
                    key={d.delegateId}
                    d={d}
                    status={status}
                    present={present}
                    queued={queued}
                    markedHere={justMarked.has(d.delegateId)}
                    markedAt={markedAt[d.delegateId]}
                    busy={busyIds.has(d.delegateId)}
                    canEdit={canEdit}
                    selectMode={selectMode}
                    selected={selected.has(d.delegateId)}
                    onCheckIn={() => requestCheckIn([d])}
                    onUndo={() => undoOne(d)}
                    onToggleSelect={() => toggleSelect(d)}
                    onSwipeUsed={dismissHint}
                    t={t}
                  />
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* ---- bulk action bar ---- */}
      {selectMode && (
        <div className="mman-bulkbar">
          <button
            className="btn btn-ghost"
            style={{ padding: "8px 10px", fontSize: 12.5, flexShrink: 0 }}
            onClick={() => setSelected(
              selected.size === selectableInView.length
                ? new Set()
                : new Set(selectableInView.map((d) => d.delegateId))
            )}
            disabled={selectableInView.length === 0}
          >
            {selected.size === selectableInView.length && selected.size > 0 ? t("Clear") : `${t("All")} ${selectableInView.length}`}
          </button>
          <button
            className="btn btn-primary"
            style={{ flex: 1, padding: "11px 0", fontSize: 14 }}
            disabled={selected.size === 0}
            onClick={() => requestCheckIn(selectedDelegates)}
          >
            <UserCheck size={16} />
            {selected.size === 0 ? t("Select people") : `${t("Check in")} ${selected.size}`}
          </button>
        </div>
      )}

      {/* ---- undo snackbar ---- */}
      {!selectMode && undoState && (
        <div className="mman-snack" role="status">
          <CheckCircle2 size={17} style={{ color: "#6ee7b7", flexShrink: 0 }} />
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {undoState.items.length === 1
              ? `${undoState.items[0].name} ${t("checked in")}`
              : `${undoState.items.length} ${t("checked in")}`}
          </span>
          <button onClick={undoBatch}>
            <Undo2 size={14} /> {t("Undo")} {undoState.left}
          </button>
        </div>
      )}

      {/* ---- reason sheet ---- */}
      {sheetFor && (
        <ReasonSheet
          count={sheetFor.length}
          suggested={suggestReason(sheetFor)}
          current={reason}
          onClose={() => setSheetFor(null)}
          onPick={(picked) => {
            setReason(picked);
            setReasonChosen(true);
            if (sheetFor.length) commit(sheetFor, picked); else setSheetFor(null);
          }}
          t={t}
        />
      )}
    </div>
  );
}

/** Pre-select the likeliest reason from what the roster already knows: a
 *  delegate with no biometric template on file can't be scanned at all, so
 *  "Not enrolled" is the honest default; anyone else standing here has a scan
 *  that refused to match. */
function suggestReason(list) {
  if (!list || !list.length) return null;
  const noneEnrolled = list.every((d) => d.enrolled === false);
  return REASONS.find((r) => r.key === (noneEnrolled ? "NOT_ENROLLED" : "FACE_MATCH_FAILED")) || null;
}

/**
 * One roster row. Swipe right → check in; swipe left on a row THIS session
 * marked → undo. `touch-action: pan-y` on the sliding surface keeps vertical
 * list scrolling with the browser, so the gesture never fights the scroll.
 *
 * Pointer Events (not touch events) so the same code handles finger, stylus and
 * mouse — the mobile UI is regularly driven in a desktop browser at phone width
 * (demos, screenshots, this project's own reviews), and a touch-only gesture is
 * invisible there. Pointer capture keeps the drag alive even if the finger
 * leaves the row's box mid-swipe.
 */
function ManualRow({
  d, status, present, queued, markedHere, markedAt, busy, canEdit,
  selectMode, selected, onCheckIn, onUndo, onToggleSelect, onSwipeUsed, t,
}) {
  const [dx, setDx] = useState(0);
  const [settling, setSettling] = useState(false);
  const start = useRef(null);
  const axis = useRef(null);
  const captured = useRef(false);

  const canUndo = canEdit && markedHere && !queued;
  const dir = present ? -1 : 1;                       // right to check in, left to undo
  const armed = canEdit && !busy && !selectMode && (present ? canUndo : true);
  const THRESHOLD = 68;
  const MAX = 104;

  // Pointer capture is deliberately NOT taken here on pointerdown — grabbing it
  // for every press (including a plain tap) hijacked two things at once: a tap
  // that lands on the "Check in"/Undo button never reached its own onClick
  // (the row became the pointerup target instead of the button), and a finger
  // that touched down here to scroll the list vertically had its pointer
  // silently claimed by this row before the browser could tell it was a scroll.
  // Capture is now taken only once onPointerMove has confirmed the drag is
  // clearly horizontal, so an ordinary tap or an ordinary scroll never engages
  // it at all.
  function onPointerDown(e) {
    if (!armed || (e.pointerType === "mouse" && e.button !== 0)) return;
    start.current = { x: e.clientX, y: e.clientY };
    axis.current = null;
    captured.current = false;
    setSettling(false);
  }
  function onPointerMove(e) {
    if (!armed || !start.current) return;
    const ddx = e.clientX - start.current.x;
    const ddy = e.clientY - start.current.y;
    if (!axis.current) {
      if (Math.abs(ddx) < 8 && Math.abs(ddy) < 8) return;
      // Bias towards scrolling: only claim the gesture when it's clearly sideways.
      axis.current = Math.abs(ddx) > Math.abs(ddy) * 1.3 ? "x" : "y";
      if (axis.current === "x") {
        try { e.currentTarget.setPointerCapture(e.pointerId); captured.current = true; } catch { /* capture unsupported — the drag still works */ }
      }
    }
    if (axis.current !== "x") return;
    const raw = dir === 1 ? Math.max(0, ddx) : Math.min(0, ddx);
    const mag = Math.abs(raw);
    const eased = mag <= THRESHOLD ? mag : THRESHOLD + (mag - THRESHOLD) * 0.4;  // rubber band
    setDx(dir * Math.min(eased, MAX));
  }
  function onPointerUp(e) {
    const fired = axis.current === "x" && Math.abs(dx) >= THRESHOLD;
    if (captured.current) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    }
    start.current = null;
    axis.current = null;
    captured.current = false;
    setSettling(true);
    setDx(0);
    if (fired) {
      haptic(14);
      onSwipeUsed?.();
      if (present) onUndo(); else onCheckIn();
    }
  }

  const progress = Math.min(1, Math.abs(dx) / THRESHOLD);

  return (
    <div className="mman-row">
      {/* Reveal behind the row — its label commits at full opacity so staff
          can see the gesture has passed the threshold before letting go. */}
      {Math.abs(dx) > 2 && (
        <div className={`mman-swipe-bg ${present ? "undo" : ""}`} style={{ opacity: 0.45 + progress * 0.55 }}>
          {present ? <><span>{t("Undo")}</span><Undo2 size={16} /></> : <><UserCheck size={16} /><span>{t("Check in")}</span></>}
        </div>
      )}
      <div
        className={`mman-swipe${present ? " done" : ""}${selected ? " sel" : ""}`}
        style={{ transform: `translateX(${dx}px)`, transition: settling ? "transform .2s cubic-bezier(.2,.8,.2,1)" : "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={selectMode && !present ? onToggleSelect : undefined}
      >
        {selectMode ? (
          <span className={`mman-tick ${selected ? "on" : ""}`} aria-hidden="true">
            <Check size={15} strokeWidth={3} />
          </span>
        ) : (
          <span
            className="avatar"
            style={{
              width: 38, height: 38, fontSize: 13, flexShrink: 0,
              background: STATUS_BG[status] || "var(--surface-2)",
              color: STATUS_TONE[status] || "var(--ink-3)",
              boxShadow: `inset 0 0 0 1.5px ${STATUS_TONE[status] || "var(--line)"}`,
            }}
          >
            {d.initials || d.name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
          </span>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mman-name">
            {d.name}
            {d.vip && <Crown size={12} style={{ color: "var(--scc-red)", marginLeft: 5, verticalAlign: -1 }} />}
          </div>
          <div className="mman-sub">
            <span style={{ color: STATUS_TONE[status] || "var(--ink-3)", fontWeight: 700, flexShrink: 0 }}>
              {t(STATUS_LABEL[status] || "No status")}
            </span>
            {markedAt && present && <span style={{ color: "var(--ink-3)" }}>· {markedAt}</span>}
            {!markedAt && d.lastSeen && d.lastSeen !== "No status" && (
              <span style={{ color: "var(--ink-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                · {d.lastSeen}
              </span>
            )}
            {queued && (
              <span className="mman-tag" style={{ color: "var(--st-late)", borderColor: "var(--st-late)" }}>
                <WifiOff size={10} /> {t("Queued")}
              </span>
            )}
            {/* Why manual is the right path for this person, straight from the
                roster's own `enrolled` flag — no template, no scan possible. */}
            {!present && d.enrolled === false && (
              <span className="mman-tag"><ScanFace size={10} /> {t("Not enrolled")}</span>
            )}
          </div>
        </div>

        {present ? (
          <div className="row" style={{ gap: 6, flexShrink: 0 }}>
            <span className="badge badge-present">
              <CheckCircle2 size={12} style={{ verticalAlign: -2, marginRight: 3 }} />{t("In")}
            </span>
            {canUndo && !selectMode && (
              <button
                onClick={onUndo}
                disabled={busy}
                aria-label={`${t("Undo")} — ${d.name}`}
                title={t("Undo this check-in")}
                style={{ background: "none", border: "none", padding: 6, display: "flex", color: "var(--ink-3)" }}
              >
                {busy ? "…" : <Undo2 size={16} />}
              </button>
            )}
          </div>
        ) : canEdit && !selectMode ? (
          <button className="mman-cta" onClick={onCheckIn} disabled={busy}>
            {busy ? t("Saving…") : <><UserCheck size={14} /> {t("Check in")}</>}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Why-was-this-manual sheet. Asked once per session (not per person) — at a
 * coach door the reason is almost always the same for everyone in the queue,
 * and a per-person prompt is exactly the friction that makes staff stop
 * recording reasons at all. "Skip" is a first-class option for the same
 * reason: an unlogged check-in beats a blocked one.
 */
function ReasonSheet({ count, suggested, current, onClose, onPick, t }) {
  const [picked, setPicked] = useState(current || suggested || null);
  const [note, setNote] = useState("");
  const downOnBackdrop = useRef(false);
  const needsNote = picked?.key === "OTHER";

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,0.45)", display: "flex", alignItems: "flex-end", zIndex: 60 }}
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="card"
        style={{ width: "100%", borderRadius: "16px 16px 0 0", padding: 18, paddingBottom: 26, maxHeight: "86vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row between" style={{ alignItems: "flex-start" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{t("Why manual?")}</div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
              {count > 1
                ? `${t("Logged once for all")} ${count} · ${t("reused for the rest of this session")}`
                : t("Logged for the audit trail and reused for this session")}
            </div>
          </div>
          <button onClick={onClose} aria-label={t("Close")} style={{ background: "none", border: "none", color: "var(--ink-3)", display: "flex", padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        <div className="mman-reason-grid">
          {REASONS.map((r) => {
            const on = picked?.key === r.key;
            return (
              <button key={r.key} className={`mman-reason ${on ? "on" : ""}`} onClick={() => setPicked(r)} aria-pressed={on}>
                <r.Icon size={16} style={{ color: on ? "var(--scc-red)" : "var(--ink-3)" }} />
                <span>{t(r.label)}</span>
                <small>{t(r.hint)}</small>
              </button>
            );
          })}
        </div>

        {needsNote && (
          <input
            className="input"
            autoFocus
            style={{ marginTop: 10 }}
            maxLength={TYPE_OTHER_MAX}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("Short label, e.g. Late transfer")}
          />
        )}

        <button
          className="btn btn-primary btn-block"
          style={{ marginTop: 14, padding: "13px 0", fontSize: 14.5 }}
          disabled={!picked || (needsNote && !note.trim())}
          onClick={() => onPick(needsNote ? { ...picked, typeOther: note.trim(), note: note.trim() } : picked)}
        >
          <UserCheck size={16} />
          {count > 1 ? `${t("Check in")} ${count}` : count === 1 ? t("Check in") : t("Save reason")}
        </button>
        <button
          className="btn btn-ghost btn-block"
          style={{ marginTop: 8 }}
          onClick={() => onPick(null)}
        >
          {count ? t("Check in without a reason") : t("Stop logging a reason")}
        </button>
      </div>
    </div>
  );
}
