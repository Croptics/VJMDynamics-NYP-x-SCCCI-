import { useEffect, useState } from "react";
import { Crown, RefreshCw, AlertTriangle } from "lucide-react";
import { apiGet } from "../../lib/api.js";
import { useLang } from "../../lib/i18n.jsx";

const TRIP_ID = "t-1";

/**
 * Mobile Missing list — card view of the same reverse-headcount data shown
 * on the desktop Dashboard (GET /api/trips/:id/missing).
 */
export default function MobileMissingPage() {
  const { t } = useLang();
  const [missing, setMissing] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { missing: m } = await apiGet(`/trips/${TRIP_ID}/missing`);
      setMissing(m || []);
    } catch (e) {
      setError(e.message || "Could not reach the backend.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="row between" style={{ marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-3)" }}>
            {t("Missing")}
          </div>
          <h1 style={{ fontSize: 22, margin: "4px 0 0" }}>{missing.length} {t("right now")}</h1>
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

      {loading && missing.length === 0 && !error && <div className="muted">{t("Loading…")}</div>}

      {!loading && missing.length === 0 && !error && (
        <div className="mobile-card muted" style={{ textAlign: "center" }}>{t("Everyone's accounted for. 🎉")}</div>
      )}

      {missing.map((m) => (
        <div key={m.id} className="mobile-card" style={{ padding: 14 }}>
          <div className="row between">
            <div className="row" style={{ gap: 8 }}>
              <span className="avatar" style={{ background: "var(--st-missing-bg)", color: "var(--st-missing)" }}>{m.initials}</span>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{m.name}</span>
              {m.vip && <Crown size={14} color="var(--st-review)" />}
            </div>
            <span className="badge badge-missing">{t("Missing")}</span>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{m.coach} · last seen {m.lastSeen || "—"}</div>
        </div>
      ))}

      <style>{`.spin{animation:mg-spin 0.9s linear infinite}@keyframes mg-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
