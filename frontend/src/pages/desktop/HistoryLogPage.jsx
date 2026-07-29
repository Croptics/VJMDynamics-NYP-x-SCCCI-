/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Admin Dashboard, Auth, Accounts & Permissions
 * ============================================================================= */
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, Trash2, ChevronLeft, AlertTriangle, UserPlus, Pencil, CalendarDays, RotateCcw, Search, Siren } from "lucide-react";
import { apiGet, apiPost, apiDelete, getPermissions } from "../../lib/api.js";
import { useLang } from "../../lib/i18n.jsx";

// Human-readable labels for the field-level diff shown under a rollback-
// eligible entry — matches the patch-shape keys updateDelegate() (backend)
// accepts/returns, see data.js's PROFILE_FIELDS + the core CRUD fields.
const FIELD_LABEL = {
  name: "Name", coachId: "Coach", status: "Status", vip: "VIP", cancelled: "Cancelled", cancelReason: "Cancellation reason",
  lastSeen: "Last seen", lastLocation: "Last location",
  company: "Company", role: "Role", industry: "Industry",
  email: "Email", phone: "Phone", website: "Website",
  passportNumber: "Passport number", nationality: "Nationality", passportExpiry: "Passport expiry",
  accessibilityNotes: "Accessibility notes", notes: "Notes",
};
const fmtVal = (v) => (v === null || v === undefined || v === "" ? "—" : String(v));

/**
 * History log — a dedicated, standalone audit page for the activity_log.
 *
 * Same data as the Dashboard's inline "History tracker" card (GET /api/activity),
 * expanded into a per-day vertical timeline with chronological DATE stamping:
 * entries are grouped into a card per calendar day (newest first), each event a
 * node on a connecting line with an action icon, a coloured Added/Updated/Removed
 * tag, and its exact time + actor — so you can see precisely when a change / fix /
 * event happened.
 *
 * Auto-refreshes every 2s (guarded by loadingRef) so another staff member's
 * changes appear without a manual refresh — same pattern as the Dashboard.
 */
export default function HistoryLogPage() {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const perms = getPermissions();
  const [history, setHistory] = useState([]);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [rollingBack, setRollingBack] = useState(null); // activity id currently being rolled back
  const loadingRef = useRef(false);

  // Search / filter for this page's mixed-everything feed (2026-07-24) — with
  // 200+ entries across every trip and coach, finding one specific change
  // meant scrolling through the whole timeline. Options for the trip/coach
  // dropdowns are derived straight from whatever's actually in `history`
  // (same "no separate lookup" approach as other filters in this app, e.g.
  // Account Control's Access-role filter) rather than a dedicated endpoint.
  const [hlSearch, setHlSearch] = useState("");
  const [hlTripFilter, setHlTripFilter] = useState("ALL");
  const [hlCoachFilter, setHlCoachFilter] = useState("ALL");

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const res = await apiGet("/activity?limit=1000");
      setHistory(res.activity || []);
      setError(null);
    } catch (e) {
      setError(e.message || "Could not reach the backend.");
    } finally {
      setLoaded(true);
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, [load]);

  async function removeEntry(id) {
    try {
      await apiDelete(`/activity/${id}`);
      setHistory((h) => h.filter((a) => a.id !== id));
    } catch (e) {
      setError(e.message || "Delete failed.");
    }
  }

  async function rollback(a) {
    const changeList = Object.entries(a.changes || {})
      .map(([field, { from, to }]) => `${t(FIELD_LABEL[field] || field)}: ${fmtVal(to)} → ${fmtVal(from)}`)
      .join("\n");
    const msg = lang === "zh"
      ? `撤销此更改？\n\n${changeList}`
      : `Roll back this change?\n\n${changeList}`;
    if (!window.confirm(msg)) return;
    setRollingBack(a.id);
    setError(null);
    try {
      await apiPost(`/activity/${a.id}/rollback`, {});
      await load(); // the rollback itself logs a new entry — refresh to show it
    } catch (e) {
      setError(e.message || "Rollback failed.");
    } finally {
      setRollingBack(null);
    }
  }

  async function clearAll() {
    if (!window.confirm(t("Clear the entire history log? This can't be undone."))) return;
    try {
      await apiDelete("/activity");
      setHistory([]);
    } catch (e) {
      setError(e.message || "Clear failed.");
    }
  }

  // Distinct trip/coach names actually present in the loaded history, for
  // the two filter dropdowns — sorted for a stable, predictable order.
  const tripOptions = useMemo(() => {
    const names = new Set(history.map((a) => a.tripName).filter(Boolean));
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [history]);
  const coachOptions = useMemo(() => {
    const names = new Set(history.map((a) => a.coachName).filter(Boolean));
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [history]);

  // Search matches the entry's subject/actor text (case-insensitive
  // substring) — covers delegate name, "All delegates removed", and who
  // made the change all in one box, rather than separate fields for each.
  const filteredHistory = useMemo(() => {
    const q = hlSearch.trim().toLowerCase();
    return history.filter((a) => {
      if (hlTripFilter !== "ALL" && a.tripName !== hlTripFilter) return false;
      if (hlCoachFilter !== "ALL" && a.coachName !== hlCoachFilter) return false;
      if (q) {
        const hay = `${a.text || ""} ${a.via || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [history, hlSearch, hlTripFilter, hlCoachFilter]);

  const filtersActive = hlSearch.trim() !== "" || hlTripFilter !== "ALL" || hlCoachFilter !== "ALL";
  function clearHlFilters() {
    setHlSearch("");
    setHlTripFilter("ALL");
    setHlCoachFilter("ALL");
  }

  // Group entries into calendar days (newest first). Each entry already carries
  // a full `createdAt` timestamp from the backend (rowToActivity in data.js).
  const groups = useMemo(() => {
    const locale = lang === "zh" ? "zh-CN" : "en-GB";
    const byDay = new Map();
    for (const a of filteredHistory) {
      const d = a.createdAt ? new Date(a.createdAt) : null;
      const key = d && !isNaN(d) ? d.toDateString() : "unknown";
      if (!byDay.has(key)) byDay.set(key, { date: d, items: [] });
      byDay.get(key).items.push(a);
    }
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    return [...byDay.entries()].map(([key, g]) => {
      let label, sub = null;
      if (key === today) { label = t("Today"); sub = g.date?.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" }); }
      else if (key === yesterday) { label = t("Yesterday"); sub = g.date?.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" }); }
      else if (g.date) label = g.date.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
      else label = t("Unknown date");
      return { key, label, sub, items: g.items };
    });
  }, [filteredHistory, lang, t]);

  const totalCount = history.length;
  const filteredCount = filteredHistory.length;

  return (
    <div className="page">
      <button className="btn btn-ghost" onClick={() => navigate("/dashboard")} style={{ marginBottom: 16 }}>
        <ChevronLeft size={16} /> {t("Back to dashboard")}
      </button>

      <div className="row between" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div className="row" style={{ gap: 14, alignItems: "center" }}>
          <span style={{ width: 44, height: 44, borderRadius: 12, background: "var(--scc-red-tint)", color: "var(--scc-red)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Activity size={22} />
          </span>
          <div>
            <div className="page-eyebrow">{t("Audit log")}</div>
            <h1 className="page-title" style={{ margin: 0 }}>{t("History log")}</h1>
          </div>
        </div>
        {perms.manageDelegates && totalCount > 0 && (
          <button className="btn btn-ghost" style={{ color: "var(--st-missing)", borderColor: "var(--scc-red-tint-2)" }} onClick={clearAll}>
            <Trash2 size={16} /> {t("Clear all")}
          </button>
        )}
      </div>
      <p className="page-sub" style={{ marginTop: 10 }}>
        {t("Every change, fix, and event — grouped by date, newest first.")}
        {totalCount > 0 && <> · <strong>{totalCount}</strong> {totalCount === 1 ? t("entry") : t("entries")}</>}
      </p>

      {totalCount > 0 && (
        <div className="row" style={{ gap: 10, marginTop: 16, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ position: "relative", maxWidth: 260, flex: "1 1 200px" }}>
            <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)" }} />
            <input
              className="input"
              style={{ paddingLeft: 32 }}
              placeholder={t("Search name or actor…")}
              value={hlSearch}
              onChange={(e) => setHlSearch(e.target.value)}
            />
          </div>
          {tripOptions.length > 1 && (
            <select className="select" style={{ maxWidth: 200 }} value={hlTripFilter} onChange={(e) => setHlTripFilter(e.target.value)}>
              <option value="ALL">{t("All trips")}</option>
              {tripOptions.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          )}
          {coachOptions.length > 0 && (
            <select className="select" style={{ maxWidth: 200 }} value={hlCoachFilter} onChange={(e) => setHlCoachFilter(e.target.value)}>
              <option value="ALL">{t("All coaches")}</option>
              {coachOptions.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          )}
          {filtersActive && (
            <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: "6px 12px" }} onClick={clearHlFilters}>
              {t("Clear filters")}
            </button>
          )}
          {filtersActive && (
            <span className="muted" style={{ fontSize: 12.5 }}>
              {filteredCount} {t("of")} {totalCount}
            </span>
          )}
        </div>
      )}

      {error && (
        <div className="card" style={{ marginTop: 16, padding: 16, borderColor: "var(--st-missing)", background: "var(--st-missing-bg)" }}>
          <div className="row" style={{ gap: 10, color: "var(--st-missing)", fontWeight: 600 }}>
            <AlertTriangle size={18} /> {t(error)}
          </div>
        </div>
      )}

      {loaded && totalCount === 0 && !error && (
        <div className="card" style={{ marginTop: 20, padding: "40px 24px", textAlign: "center" }}>
          <CalendarDays size={30} color="var(--ink-3)" style={{ marginBottom: 10 }} />
          <div className="muted" style={{ fontSize: 14 }}>
            {t("No activity yet. Add or update a delegate to see events here.")}
          </div>
        </div>
      )}

      {loaded && totalCount > 0 && filteredCount === 0 && !error && (
        <div className="card" style={{ marginTop: 20, padding: "40px 24px", textAlign: "center" }}>
          <Search size={30} color="var(--ink-3)" style={{ marginBottom: 10 }} />
          <div className="muted" style={{ fontSize: 14 }}>
            {t("No entries match your filters.")}
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 20 }}>
        {groups.map((g) => (
          <div key={g.key} className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="row between" style={{ padding: "14px 20px", borderBottom: "1px solid var(--line)", background: "var(--surface-2)" }}>
              <div className="row" style={{ gap: 10 }}>
                <CalendarDays size={16} color="var(--ink-3)" />
                <h2 style={{ fontSize: 15, margin: 0 }}>{g.label}</h2>
                {g.sub && <span className="muted" style={{ fontSize: 12.5 }}>· {g.sub}</span>}
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-3)", background: "var(--st-neutral-bg)", padding: "3px 10px", borderRadius: 999 }}>
                {g.items.length} {g.items.length === 1 ? t("entry") : t("entries")}
              </span>
            </div>

            <div style={{ position: "relative", padding: "10px 16px 12px" }}>
              {/* connecting timeline line behind the nodes */}
              {g.items.length > 1 && (
                <div style={{ position: "absolute", left: 16 + 14, top: 30, bottom: 30, width: 2, background: "var(--line)" }} />
              )}
              {g.items.map((a) => {
                const m = activityMeta(a.text, a.kind, t);
                const canRollback = perms.manageDelegates && a.delegateId && a.changes && Object.keys(a.changes).length > 0;
                return (
                  <div key={a.id} className="hist-row">
                    <span style={{ width: 28, height: 28, borderRadius: "50%", background: m.bg, color: m.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, zIndex: 1, boxShadow: "0 0 0 3px var(--surface)" }}>
                      <m.Icon size={14} />
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 14, fontWeight: 500 }}>{m.subject}</span>
                        {m.label && (
                          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: m.color, background: m.bg, padding: "2px 7px", borderRadius: 5 }}>
                            {m.label}
                          </span>
                        )}
                        {/* This page always shows every trip mixed together (unlike
                            the Dashboard's own History tracker, which is already
                            scoped to one trip) — a name tag next to each entry is
                            the only way to tell which trip it belongs to (2026-07-24). */}
                        {a.tripName && (
                          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)", background: "var(--surface-2)", border: "1px solid var(--line)", padding: "2px 8px", borderRadius: 999 }}>
                            {a.tripName}
                          </span>
                        )}
                        {/* Which coach the affected delegate is CURRENTLY on
                            (2026-07-27, "show the coach assigned") — same
                            data the "All coaches" filter dropdown already
                            reads (a.coachName), just also shown inline per
                            entry so it's visible without having to filter. */}
                        {a.coachName && (
                          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)", background: "var(--surface-2)", border: "1px solid var(--line)", padding: "2px 8px", borderRadius: 999 }}>
                            {a.coachName}
                          </span>
                        )}
                      </div>
                      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{a.time} · {a.via === "you" ? t("you") : a.via}</div>
                      {canRollback && (
                        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 2 }}>
                          {Object.entries(a.changes).map(([field, { from, to }]) => (
                            <div key={field} className="muted" style={{ fontSize: 11.5 }}>
                              <strong>{t(FIELD_LABEL[field] || field)}:</strong> {fmtVal(from)} → {fmtVal(to)}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {canRollback && (
                      <button
                        className="hist-del"
                        style={{ opacity: 1, color: "var(--scc-red)" }}
                        onClick={() => rollback(a)}
                        disabled={rollingBack === a.id}
                        aria-label={t("Roll back this change")}
                        title={t("Roll back this change")}
                      >
                        <RotateCcw size={14} />
                      </button>
                    )}
                    {perms.manageDelegates && (
                      <button className="hist-del" onClick={() => removeEntry(a.id)} aria-label={t("Delete")} title={t("Delete")}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <style>{`
        .hist-row {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 9px 10px;
          border-radius: var(--r-md);
          transition: background 0.12s ease;
        }
        .hist-row:hover { background: var(--surface-2); }
        .hist-del {
          background: none; border: none; cursor: pointer;
          color: var(--ink-3);
          display: flex; padding: 6px; border-radius: 7px;
          opacity: 0; transition: opacity 0.12s ease, color 0.12s ease, background 0.12s ease;
          align-self: center;
        }
        .hist-row:hover .hist-del { opacity: 1; }
        .hist-del:hover { color: var(--st-missing); background: var(--st-missing-bg); }
        @media (hover: none) { .hist-del { opacity: 0.5; } }
      `}</style>
    </div>
  );
}

/* Parse an activity line into a subject + action tag + icon/colour. The text
 * is shaped like "<name> added|updated|removed" or "All delegates removed (N)"
 * (see logActivity in data.js); we split the trailing verb off so it can be
 * rendered as a coloured tag separate from the subject. */
function activityMeta(text, kind, t) {
  const allMatch = text.match(/^All delegates removed \((\d+)\)$/);
  if (allMatch) {
    return { subject: `${t("All delegates removed")} (${allMatch[1]})`, label: t("removed"), ...VERB_STYLE.removed };
  }
  const verbMatch = text.match(/^(.*) (added|updated|removed)$/);
  if (verbMatch) {
    const verb = verbMatch[2];
    return { subject: verbMatch[1], label: t(verb), ...(VERB_STYLE[verb] || VERB_STYLE.default) };
  }
  return { subject: text, label: null, ...styleForKind(kind) };
}

const VERB_STYLE = {
  added:   { color: "var(--st-present)",    bg: "var(--st-present-bg)",    Icon: UserPlus },
  updated: { color: "var(--st-unassigned)", bg: "var(--st-unassigned-bg)", Icon: Pencil },
  removed: { color: "var(--st-missing)",    bg: "var(--st-missing-bg)",    Icon: Trash2 },
  default: { color: "var(--st-neutral)",    bg: "var(--st-neutral-bg)",    Icon: Activity },
};

function styleForKind(kind) {
  if (kind === "exception") return { color: "var(--st-missing)", bg: "var(--st-missing-bg)", Icon: AlertTriangle };
  if (kind === "reassign") return { color: "var(--st-unassigned)", bg: "var(--st-unassigned-bg)", Icon: Pencil };
  if (kind === "checkin") return { color: "var(--st-present)", bg: "var(--st-present-bg)", Icon: UserPlus };
  // 2026-07-27 — escalations (create/acknowledge/resolve) now log to the
  // History Log too; own colour/icon so they read as distinct from a
  // routine delegate edit.
  if (kind === "escalation") return { color: "var(--st-missing)", bg: "var(--st-missing-bg)", Icon: Siren };
  return VERB_STYLE.default;
}
