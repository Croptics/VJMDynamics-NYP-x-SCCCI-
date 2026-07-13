import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { RefreshCw, AlertTriangle, Crown, Search } from "lucide-react";
import { apiGet, apiPatch, getPermissions } from "../../lib/api.js";
import { useLang } from "../../lib/i18n.jsx";
import StatusBadge from "../../components/StatusBadge.jsx";

const TRIP_ID = "t-1";
const FILTERS = ["ALL", "PRESENT", "MISSING", "UNASSIGNED"];

/**
 * Mobile Attendance sheet — the full delegate roster (GET /api/trips/:id/
 * delegates), searchable/filterable. Takes over the tab slot freed up by
 * folding Missing into Home: this is the "look up any one person, or fix
 * their status" view, where Home is "what's the overall picture right now".
 *
 * The initial status filter can come in via ?status=MISSING (the Home page's
 * KPI tiles link here that way) so tapping "20 missing" lands you straight
 * on the filtered list instead of the unfiltered roster.
 *
 * Status is edited with a <select> (Present/Missing/Unassigned), not a
 * checkbox — it's a 3-state value, not a toggle — gated on manageDelegates
 * same as the desktop Dashboard's delegate table.
 */
export default function MobileAttendancePage() {
  const { t } = useLang();
  const [searchParams] = useSearchParams();
  const canEdit = getPermissions().manageDelegates;
  const [delegates, setDelegates] = useState([]);
  const [coaches, setCoaches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(() => {
    const s = (searchParams.get("status") || "ALL").toUpperCase();
    return FILTERS.includes(s) ? s : "ALL";
  });
  const [rowError, setRowError] = useState(null); // { id, message }
  const [savingId, setSavingId] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [{ delegates: d }, dash] = await Promise.all([
        apiGet(`/trips/${TRIP_ID}/delegates`),
        apiGet(`/trips/${TRIP_ID}/dashboard`),
      ]);
      setDelegates(d || []);
      setCoaches(dash.coaches || []);
    } catch (e) {
      setError(e.message || "Could not reach the backend.");
    } finally {
      setLoading(false);
    }
  }

  const coachName = (id) => {
    const c = coaches.find((x) => x.id === id);
    return c ? [c.name, c.city].filter(Boolean).join(" · ") : t("Unassigned");
  };

  async function changeStatus(d, status) {
    if (status === d.status) return;
    setRowError(null);
    setSavingId(d.id);
    const prev = delegates;
    setDelegates((list) => list.map((x) => (x.id === d.id ? { ...x, status } : x)));
    try {
      await apiPatch(`/delegates/${d.id}`, { status });
    } catch (e) {
      setDelegates(prev); // roll back the optimistic update
      setRowError({ id: d.id, message: e.message || t("Save failed.") });
    } finally {
      setSavingId(null);
    }
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return delegates
      .filter((d) => filter === "ALL" || d.status === filter)
      .filter((d) => !q || (d.name || "").toLowerCase().includes(q))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [delegates, query, filter]);

  const FILTER_LABEL = { ALL: "All statuses", PRESENT: "Present", MISSING: "Missing", UNASSIGNED: "Unassigned" };

  return (
    <div>
      <div className="row between" style={{ alignItems: "flex-start", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-3)" }}>
            {t("Attendance sheet")}
          </div>
          <h1 style={{ fontSize: 22, margin: "4px 0 2px" }}>{delegates.length} {t("delegates")}</h1>
        </div>
        <button className="btn btn-ghost" onClick={load} aria-label={t("Refresh")} style={{ padding: 8 }}>
          <RefreshCw size={16} className={loading ? "spin" : ""} />
        </button>
      </div>

      {error && (
        <div className="mobile-card" style={{ borderColor: "var(--st-missing)", background: "var(--st-missing-bg)" }}>
          <div className="row" style={{ gap: 8, color: "var(--st-missing)", fontWeight: 600, fontSize: 14 }}>
            <AlertTriangle size={16} /> {t("Couldn't reach the backend")}
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t(error)}</p>
        </div>
      )}

      <div style={{ position: "relative", marginBottom: 10 }}>
        <Search size={15} style={{ position: "absolute", left: 10, top: 11, color: "var(--ink-3)" }} />
        <input
          className="input"
          placeholder={t("Search delegates…")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ paddingLeft: 32 }}
        />
      </div>

      <div className="row" style={{ gap: 6, marginBottom: 12, overflowX: "auto", paddingBottom: 2 }}>
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={"badge " + (filter === f ? "badge-present" : "badge-neutral")}
            style={{ flexShrink: 0, border: "none", cursor: "pointer", fontSize: 12.5, padding: "6px 12px" }}
          >
            {t(FILTER_LABEL[f])}
          </button>
        ))}
      </div>

      {loading && delegates.length === 0 && !error && <div className="muted">{t("Loading…")}</div>}

      {!loading && visible.length === 0 && !error && (
        <div className="mobile-card muted" style={{ textAlign: "center" }}>
          {delegates.length === 0 ? t("No delegates yet.") : t("No delegates match your filters.")}
        </div>
      )}

      {visible.map((d) => (
        <div key={d.id} className="mobile-card" style={{ padding: 14 }}>
          <div className="row between">
            <div className="row" style={{ gap: 8, minWidth: 0 }}>
              <span className="avatar">{d.initials}</span>
              <span style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
              {d.vip && <Crown size={14} color="var(--st-review)" style={{ flexShrink: 0 }} />}
            </div>
            {canEdit ? (
              <select
                className="select"
                style={{ width: "auto", padding: "4px 8px", fontSize: 12.5, fontWeight: 600 }}
                value={d.status}
                disabled={savingId === d.id}
                onChange={(e) => changeStatus(d, e.target.value)}
              >
                <option value="PRESENT">{t("Present")}</option>
                <option value="MISSING">{t("Missing")}</option>
                <option value="UNASSIGNED">{t("Unassigned")}</option>
              </select>
            ) : (
              <StatusBadge state={d.status} />
            )}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            {coachName(d.coachId)} · {t("last seen")} {d.lastSeen || "—"}
          </div>
          {rowError?.id === d.id && (
            <div style={{ fontSize: 12, color: "var(--st-missing)", marginTop: 6 }}>{t(rowError.message)}</div>
          )}
        </div>
      ))}

      <style>{`.spin{animation:mg-spin 0.9s linear infinite}@keyframes mg-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
