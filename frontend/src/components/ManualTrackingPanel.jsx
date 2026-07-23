/* =============================================================================
 *  OWNED BY:  Jayden — Exception Logging, Critical Alerts & QR check-in
 *
 *  Manual attendance tracking — the "Manual" mode of the check-in scanner.
 *  When a delegate can't be scanned (lost badge, dead phone, camera down), a
 *  staff member marks them present by hand here. It writes a MANUAL row through
 *  Jayden's own data layer (manualOverride → POST /api/checkins/manual) and
 *  flips the delegate to PRESENT, so JQ's dashboard head-count agrees.
 *
 *  Self-contained and isolated: it reads the roster from the `coach` prop that
 *  the shared page already loads (no new fetch of Vimal's data), renders inside
 *  the scanner viewport, and touches no face/voice code.
 *
 *  Manual overrides require the `manageExceptions` permission (permissions.js);
 *  without it the panel is read-only.
 * ============================================================================= */

import { useState, useMemo, useRef } from "react";
import { Search, CheckCircle2, UserCheck, ShieldAlert, PencilLine, Undo2 } from "lucide-react";
import { getPermissions } from "../lib/api.js";
import { manualOverride, undoManualOverride } from "../lib/exceptionsApi.js";

const initialsOf = (name = "?") =>
  name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

// Same 5-status vocabulary the desktop Dashboard shows (ARRIVED shown as
// "Arrived", PRESENT is its legacy alias). The subtitle used to fall back to
// the backend's "No status" lastSeen placeholder, which hid the delegate's
// REAL status — a delegate ASSIGNED to this coach but not yet checked in read
// "No status" here while the Dashboard correctly called them "Assigned". Now
// the row mirrors the delegate's actual status straight from d.status.
const STATUS_LABEL = {
  ARRIVED: "Arrived",
  PRESENT: "Arrived",
  ASSIGNED: "Assigned",
  LATE: "Late",
  MISSING: "Missing",
  UNASSIGNED: "Unassigned",
};
// Colour token per status, matching the Dashboard's badge palette so the two
// surfaces read the same at a glance.
const STATUS_TONE = {
  ARRIVED: "var(--st-present)",
  PRESENT: "var(--st-present)",
  ASSIGNED: "var(--st-assigned)",
  LATE: "var(--st-late)",
  MISSING: "var(--st-missing)",
  UNASSIGNED: "var(--st-unassigned)",
};

export default function ManualTrackingPanel({ coach, coachLabel, onCheckedIn, tripId }) {
  const canEdit = getPermissions().manageExceptions;
  const [query, setQuery] = useState("");
  const [justMarked, setJustMarked] = useState(() => new Set()); // optimistic PRESENT
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);

  const flash = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2200);
  };

  const roster = (coach && coach.delegates) ? coach.delegates : [];
  // ARRIVED is the current 5-status value (PRESENT was the legacy name); accept
  // both so already-arrived delegates loaded from the API still show correctly.
  const statusOf = (d) => (justMarked.has(d.delegateId) ? "ARRIVED" : d.status);
  const isPresent = (s) => s === "ARRIVED" || s === "PRESENT";

  // Sort order mirrors the Dashboard's sense of urgency: still-missing first,
  // then late, then assigned/unassigned (on a coach but not checked in), and
  // finally the already-present at the bottom — so the people a staff member
  // still needs to act on stay at the top of the list.
  const SORT_RANK = { MISSING: 0, LATE: 1, ASSIGNED: 2, UNASSIGNED: 3, ARRIVED: 4, PRESENT: 4 };
  const filtered = useMemo(() => {
    const qq = query.trim().toLowerCase();
    const list = qq ? roster.filter((d) => d.name.toLowerCase().includes(qq)) : roster;
    return [...list].sort((a, b) => (SORT_RANK[statusOf(a)] ?? 3) - (SORT_RANK[statusOf(b)] ?? 3));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster, query, justMarked]);

  const presentCount = roster.filter((d) => isPresent(statusOf(d))).length;

  async function markPresent(d) {
    if (!canEdit) return;
    setBusyId(d.delegateId);
    setError("");
    // optimistic
    setJustMarked((prev) => new Set(prev).add(d.delegateId));
    try {
      await manualOverride(d.delegateId, tripId);
      flash(`${d.name} marked present`);
      onCheckedIn?.();
    } catch (e) {
      // roll back the optimistic flip
      setJustMarked((prev) => { const n = new Set(prev); n.delete(d.delegateId); return n; });
      setError(
        e.status === 403
          ? "You need the ‘Manage exceptions’ permission for manual overrides."
          : e.message || "Could not mark present. Try again."
      );
    } finally {
      setBusyId(null);
    }
  }

  // Only offered right next to a delegate THIS panel just marked present —
  // the accidental-click case, not a general "un-arrive anyone" control.
  // Reverts to whatever status they actually had before (e.g. Late), not a
  // blanket ASSIGNED — see undoManualOverride()'s own comment. Removes the
  // log row markPresent() just wrote.
  async function undoPresent(d) {
    if (!canEdit) return;
    setBusyId(d.delegateId);
    setError("");
    try {
      await undoManualOverride(d.delegateId, tripId);
      setJustMarked((prev) => { const n = new Set(prev); n.delete(d.delegateId); return n; });
      flash(`${d.name} reverted`);
      onCheckedIn?.();
    } catch (e) {
      setError(e.message || "Could not undo — try again.");
    } finally {
      setBusyId(null);
    }
  }

  const S = {
    root: {
      position: "absolute", inset: 0, background: "var(--surface)",
      borderRadius: "inherit", display: "flex", flexDirection: "column",
      color: "var(--ink)", overflow: "hidden",
    },
    head: { padding: "14px 14px 10px", borderBottom: "1px solid var(--line)" },
    searchWrap: { position: "relative", marginTop: 10 },
    search: {
      width: "100%", padding: "10px 12px 10px 34px", borderRadius: 999,
      border: "1px solid var(--line)", fontSize: 13.5, fontFamily: "inherit",
    },
    list: { flex: 1, overflowY: "auto", padding: "8px 12px 12px" },
    row: {
      display: "flex", alignItems: "center", gap: 10, padding: "10px 4px",
      borderBottom: "1px solid var(--line-2)",
    },
    avatar: (vip) => ({
      width: 36, height: 36, borderRadius: "50%", flexShrink: 0, fontSize: 12.5, fontWeight: 700,
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      background: vip ? "var(--scc-red)" : "var(--scc-red-tint-2)",
      color: vip ? "var(--surface)" : "var(--scc-red-700)",
    }),
  };

  return (
    <div style={S.root}>
      <div style={S.head}>
        <div className="row between" style={{ alignItems: "baseline" }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Manual attendance</div>
          <span className="mono" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-3)" }}>
            {presentCount}/{roster.length} present
          </span>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
          {coachLabel ? `${coachLabel} · tap to mark present when a scan isn't possible` : "Pick a coach on the Trips tab first"}
        </div>
        <div style={S.searchWrap}>
          <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)" }} />
          <input style={S.search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search delegate…" />
        </div>
      </div>

      {!canEdit && (
        <div style={{
          margin: "10px 12px 0", padding: "8px 10px", borderRadius: "var(--r-sm)", fontSize: 12,
          background: "var(--st-unassigned-bg)", color: "var(--st-unassigned)", border: "1px solid var(--st-unassigned)",
        }}>
          <ShieldAlert size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
          Read-only — needs the “Manage exceptions” permission.
        </div>
      )}

      {error && (
        <div style={{ margin: "10px 12px 0", fontSize: 12.5, color: "var(--scc-red-700)" }}>{error}</div>
      )}

      <div style={S.list}>
        {filtered.map((d) => {
          const status = statusOf(d);
          const present = isPresent(status);
          return (
            <div key={d.delegateId} style={S.row}>
              <span style={S.avatar(d.vip)}>{d.initials || initialsOf(d.name)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {d.name}{d.vip ? " · VIP" : ""}
                </div>
                {/* Real delegate status (from d.status), colour-matched to
                    the Dashboard's badge palette — replaces the old "No
                    status" placeholder that ignored the actual status. When
                    there's a real lastSeen note (e.g. "QR check-in · 21:36")
                    it's appended after the status label for extra context. */}
                <div style={{ fontSize: 11.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  <span style={{ color: STATUS_TONE[status] || "var(--ink-3)", fontWeight: 600 }}>
                    {STATUS_LABEL[status] || "No status"}
                  </span>
                  {d.lastSeen && d.lastSeen !== "No status" && (
                    <span className="muted"> · {d.lastSeen}</span>
                  )}
                </div>
              </div>
              {present ? (
                <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                  <span className="badge badge-present">
                    <CheckCircle2 size={13} style={{ verticalAlign: -2, marginRight: 3 }} />In
                  </span>
                  {/* Undo — only next to a delegate THIS panel just marked
                      present (justMarked), for the accidental-click case;
                      delegates already ARRIVED from an earlier session/scan
                      don't get one (nothing to "undo" here). */}
                  {justMarked.has(d.delegateId) && (
                    <button
                      className="btn btn-ghost" style={{ padding: "6px 10px", fontSize: 12 }}
                      onClick={() => undoPresent(d)} disabled={!canEdit || busyId === d.delegateId}
                      title="Undo — revert to Assigned"
                    >
                      {busyId === d.delegateId ? "…" : (<><Undo2 size={13} /> Undo</>)}
                    </button>
                  )}
                </div>
              ) : (
                <button
                  className="btn btn-dark" style={{ padding: "7px 12px", fontSize: 12.5, flexShrink: 0 }}
                  onClick={() => markPresent(d)} disabled={!canEdit || busyId === d.delegateId}
                >
                  {busyId === d.delegateId ? "…" : (<><UserCheck size={14} /> Mark present</>)}
                </button>
              )}
            </div>
          );
        })}

        {roster.length === 0 && (
          <div style={{ textAlign: "center", padding: "28px 16px", color: "var(--ink-3)" }}>
            <PencilLine size={22} />
            <div style={{ fontWeight: 600, marginTop: 8, color: "var(--ink)" }}>No delegates to track</div>
            <div style={{ fontSize: 12.5, marginTop: 2 }}>
              Open the Trips tab, pick a coach (and Load demo roster if empty), then come back to mark attendance by hand.
            </div>
          </div>
        )}
        {roster.length > 0 && filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: 20, color: "var(--ink-3)", fontSize: 13 }}>
            No delegate matches “{query}”.
          </div>
        )}
      </div>

      {toast && (
        <div className="card vimal-toast" style={{
          position: "absolute", left: 12, right: 12, bottom: 12, padding: "10px 12px",
          display: "flex", alignItems: "center", gap: 8,
          background: "var(--st-present-bg)", color: "var(--st-present)", border: "1px solid var(--st-present)",
        }}>
          <CheckCircle2 size={16} /> {toast}
        </div>
      )}
    </div>
  );
}
