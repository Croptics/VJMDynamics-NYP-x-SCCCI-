import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { RefreshCw, AlertTriangle, Crown, Search, MapPin, X, Phone, PencilLine, CheckCircle2 } from "lucide-react";
import { apiGet, apiPatch, getPermissions } from "../../lib/api.js";
import { useLang } from "../../lib/i18n.jsx";
import DelegateAvatar from "../../components/DelegateAvatar.jsx";
import DelegateLocationMap from "../../components/DelegateLocationMap.jsx";

const TRIP_ID = "t-1";
const FILTERS = ["ALL", "PRESENT", "MISSING", "UNASSIGNED"];
const STATUS_OPTIONS = ["PRESENT", "MISSING", "UNASSIGNED"];

/**
 * Mobile Attendance sheet — the full delegate roster (GET /api/trips/:id/
 * delegates), searchable/filterable. Takes over the tab slot freed up by
 * folding Missing into Home: this is the "look up any one person, or fix
 * their status" view, where Home is "what's the overall picture right now".
 *
 * The initial status filter can come in via ?status=MISSING (the Home page's
 * KPI tiles and Coach status card both link here that way) so tapping
 * "20 missing" lands you straight on the filtered list instead of the
 * unfiltered roster.
 *
 * Row layout mirrors the "card row between" pattern already used by
 * QRCheckInPage.jsx's Manual check-in and "Me" tabs — avatar + name/subtitle
 * on the left, a clear action button on the right — instead of the old
 * cramped inline <select>. Status is changed via a bottom-sheet picker
 * (StatusSheet below) triggered by an explicit "Update status" button, same
 * spirit as Manual check-in's obvious "Mark present" button per row. A
 * MISSING delegate with a phone on file also gets a one-tap `tel:` call
 * button — delegates.phone already exists (added by Vance's onboarding
 * parser), so this needed no new backend column.
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
  const [mapDelegate, setMapDelegate] = useState(null);
  const [statusSheetFor, setStatusSheetFor] = useState(null); // the delegate being re-statused, or null

  // Guards a poll tick against (a) overlapping with a still-in-flight
  // previous poll, and (b) landing while a row's status edit is mid-save —
  // savingId is read via a ref since the interval's closure is set up once
  // and wouldn't otherwise see later state updates.
  const loadingRef = useRef(false);
  const savingIdRef = useRef(null);
  useEffect(() => { savingIdRef.current = savingId; }, [savingId]);

  useEffect(() => {
    load();
    // 2s auto-refresh so a status change made by another signed-in staff
    // member shows up here without needing to tap the manual Refresh button.
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, []);

  async function load() {
    if (loadingRef.current || savingIdRef.current) return;
    loadingRef.current = true;
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
      loadingRef.current = false;
    }
  }

  const coachName = (id) => {
    const c = coaches.find((x) => x.id === id);
    return c ? [c.name, c.city].filter(Boolean).join(" · ") : t("Unassigned");
  };

  async function changeStatus(d, status) {
    setStatusSheetFor(null);
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

      {visible.map((d) => {
        const missing = d.status === "MISSING";
        return (
          <div key={d.id} className="mobile-card" style={{ padding: 14 }}>
            <div className="row" style={{ gap: 10, minWidth: 0 }}>
              <DelegateAvatar delegate={d} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 6 }}>
                  <span style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
                  {d.vip && <Crown size={14} color="var(--st-review)" style={{ flexShrink: 0 }} />}
                </div>
                <div className="muted" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {coachName(d.coachId)}
                  {missing && <> · {t("last seen")} {d.lastSeen || "—"}</>}
                </div>
              </div>
              {missing && d.phone && (
                <a
                  href={`tel:${d.phone}`}
                  aria-label={`${t("Call")} ${d.name}`}
                  title={`${t("Call")} ${d.name}`}
                  style={{
                    background: "none", border: "none", padding: 6, flexShrink: 0,
                    color: "var(--st-missing)", display: "flex", textDecoration: "none",
                  }}
                >
                  <Phone size={18} />
                </a>
              )}
              <button
                onClick={() => d.status === "MISSING" && setMapDelegate(d)}
                disabled={d.status !== "MISSING"}
                aria-label={`${t("View location")} — ${d.name}`}
                style={{
                  background: "none", border: "none", padding: 6, display: "flex", flexShrink: 0,
                  color: d.status === "MISSING" ? "var(--st-missing)" : "var(--ink-3)",
                  opacity: d.status === "MISSING" ? 1 : 0.35,
                  cursor: d.status === "MISSING" ? "pointer" : "not-allowed",
                }}
              >
                <MapPin size={18} />
              </button>
            </div>

            <div className="row between" style={{ marginTop: 10, gap: 8 }}>
              <span className={"badge " + (d.status === "PRESENT" ? "badge-present" : d.status === "MISSING" ? "badge-missing" : "badge-unassigned")}>
                {savingId === d.id ? t("Saving…") : t(FILTER_LABEL[d.status] || d.status)}
              </span>
              {canEdit && (
                <button
                  className="btn btn-dark"
                  style={{ padding: "7px 12px", fontSize: 12.5 }}
                  disabled={savingId === d.id}
                  onClick={() => setStatusSheetFor(d)}
                >
                  <PencilLine size={13} /> {t("Update status")}
                </button>
              )}
            </div>

            {rowError?.id === d.id && (
              <div style={{ fontSize: 12, color: "var(--st-missing)", marginTop: 6 }}>{t(rowError.message)}</div>
            )}
          </div>
        );
      })}

      {mapDelegate && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,0.45)", display: "grid", placeItems: "center", padding: 20, zIndex: 50 }} onClick={() => setMapDelegate(null)}>
          <div className="card" style={{ width: "min(420px, 100%)", padding: 18, background: "var(--surface)" }} onClick={(e) => e.stopPropagation()}>
            <div className="row between" style={{ marginBottom: 12 }}>
              <div>
                <h2 style={{ fontSize: 15 }}>{mapDelegate.name}</h2>
                <p className="muted" style={{ fontSize: 12, marginTop: 2 }}>{mapDelegate.lastLocation}</p>
              </div>
              <button onClick={() => setMapDelegate(null)} aria-label={t("Close")} style={{ background: "none", border: "none", color: "var(--ink-3)", display: "flex", padding: 4 }}>
                <X size={18} />
              </button>
            </div>
            {mapDelegate.lastLocation ? (
              <DelegateLocationMap location={mapDelegate.lastLocation} height={220} />
            ) : (
              <div className="muted" style={{ fontSize: 13, padding: "12px 0" }}>
                {t("No location has been recorded for this delegate yet.")}
              </div>
            )}
          </div>
        </div>
      )}

      {statusSheetFor && (
        <StatusSheet
          delegate={statusSheetFor}
          onPick={(status) => changeStatus(statusSheetFor, status)}
          onClose={() => setStatusSheetFor(null)}
          t={t}
        />
      )}

      <style>{`.spin{animation:mg-spin 0.9s linear infinite}@keyframes mg-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

/** Bottom-sheet status picker — the "clear status update" interface, opened
 *  by the per-row "Update status" button. Three big obvious buttons instead
 *  of a cramped inline <select>, same "one clear action per row" spirit as
 *  Manual check-in's own "Mark present" button. */
function StatusSheet({ delegate, onPick, onClose, t }) {
  const FILTER_LABEL = { PRESENT: "Present", MISSING: "Missing", UNASSIGNED: "Unassigned" };
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,0.45)", display: "flex", alignItems: "flex-end", zIndex: 60 }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: "100%", borderRadius: "16px 16px 0 0", padding: 18, paddingBottom: 28 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row between" style={{ marginBottom: 4 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{t("Update status")}</div>
            <div className="muted" style={{ fontSize: 12.5 }}>{delegate.name}</div>
          </div>
          <button onClick={onClose} aria-label={t("Close")} style={{ background: "none", border: "none", color: "var(--ink-3)", display: "flex", padding: 4 }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
          {STATUS_OPTIONS.map((status) => {
            const active = delegate.status === status;
            return (
              <button
                key={status}
                onClick={() => onPick(status)}
                className="row between"
                style={{
                  padding: "12px 14px", borderRadius: "var(--r-md)", fontSize: 14, fontWeight: 600,
                  border: `1.5px solid ${active ? "var(--scc-red)" : "var(--line)"}`,
                  background: active ? "var(--scc-red-tint)" : "var(--surface)",
                  color: active ? "var(--scc-red-700)" : "var(--ink)",
                }}
              >
                {t(FILTER_LABEL[status])}
                {active && <CheckCircle2 size={16} />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
