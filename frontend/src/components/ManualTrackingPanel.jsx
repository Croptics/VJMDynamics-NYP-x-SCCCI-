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
import { Search, CheckCircle2, UserCheck, ShieldAlert, PencilLine } from "lucide-react";
import { getPermissions } from "../lib/api.js";
import { manualOverride } from "../lib/exceptionsApi.js";

const initialsOf = (name = "?") =>
  name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

export default function ManualTrackingPanel({ coach, coachLabel, onCheckedIn }) {
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

  const filtered = useMemo(() => {
    const qq = query.trim().toLowerCase();
    const list = qq ? roster.filter((d) => d.name.toLowerCase().includes(qq)) : roster;
    // Missing first (the ones needing action), then present.
    return [...list].sort((a, b) => (statusOf(a) === "MISSING" ? 0 : 1) - (statusOf(b) === "MISSING" ? 0 : 1));
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
      await manualOverride(d.delegateId);
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
                <div className="muted" style={{ fontSize: 11.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {present ? "Present" : (d.lastSeen || "Missing")}
                </div>
              </div>
              {present ? (
                <span className="badge badge-present" style={{ flexShrink: 0 }}>
                  <CheckCircle2 size={13} style={{ verticalAlign: -2, marginRight: 3 }} />In
                </span>
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
