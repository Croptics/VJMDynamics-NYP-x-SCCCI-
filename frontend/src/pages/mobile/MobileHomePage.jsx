import { useEffect, useState } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { apiGet } from "../../lib/api.js";
import { useLang } from "../../lib/i18n.jsx";

const TRIP_ID = "t-1";

/**
 * Mobile Home — pulls the same live summary as the desktop Dashboard
 * (GET /api/trips/:id/dashboard), condensed for a phone screen.
 */
export default function MobileHomePage() {
  const { t } = useLang();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await apiGet(`/trips/${TRIP_ID}/dashboard`));
    } catch (e) {
      setError(e.message || "Could not reach the backend.");
    } finally {
      setLoading(false);
    }
  }

  const trip = data?.trip;
  const k = data?.kpis;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-3)" }}>
            {t("Home")}
          </div>
          <h1 style={{ fontSize: 22, margin: "4px 0 2px" }}>{trip ? trip.name : "MusterGo"}</h1>
          {trip && <p className="muted" style={{ fontSize: 13, margin: 0 }}>Day {trip.dayOf} of {trip.totalDays} · {trip.localTime}</p>}
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
          <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>{error}</p>
        </div>
      )}

      {loading && !data && <div className="muted">{t("Loading…")}</div>}

      {k && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          <Stat label={t("Missing")} value={k.missing} tone="missing" />
          <Stat label={t("Present")} value={k.present} tone="present" />
          <Stat label={t("Unassigned")} value={k.unassigned} tone="unassigned" />
          <Stat label={t("Total")} value={k.total} tone="neutral" />
        </div>
      )}

      {data?.coaches && (
        <div className="mobile-card">
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>{t("Coach status")}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.coaches.map((c) => (
              <div key={c.id} className="row between" style={{ fontSize: 13 }}>
                <span>{c.name} · {c.city}</span>
                <span className={c.missing > 0 ? "badge badge-missing" : "badge badge-present"}>
                  {c.missing > 0 ? `${c.missing} ${t("missing")}` : t("All in")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{`.spin{animation:mg-spin 0.9s linear infinite}@keyframes mg-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className="mobile-card" style={{ margin: 0, textAlign: "center" }}>
      <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div className="mono" style={{ fontSize: 26, fontWeight: 700, color: `var(--st-${tone})`, lineHeight: 1.3 }}>{value}</div>
    </div>
  );
}
