import { useEffect, useState } from "react";
import { Crown, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
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
    <div className="m-fade-in">
      <div className="row between" style={{ marginBottom: 16 }}>
        <div>
          <div className="m-eyebrow">{t("Missing")}</div>
          <h1 className="m-page-title">{missing.length} {t("right now")}</h1>
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

      {loading && missing.length === 0 && !error && <div className="muted">{t("Loading…")}</div>}

      {!loading && missing.length === 0 && !error && (
        <div className="m-empty">
          <span className="m-empty-ic" style={{ background: "var(--st-present-bg)", color: "var(--st-present)", borderColor: "transparent" }}>
            <CheckCircle2 size={22} />
          </span>
          <div style={{ fontWeight: 700, color: "var(--ink)" }}>{t("Everyone's accounted for")}</div>
          <div style={{ fontSize: 12.5 }}>{t("No missing delegates right now.")}</div>
        </div>
      )}

      {missing.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {missing.map((m) => (
            <div key={m.id} className="m-row" style={{ alignItems: "flex-start" }}>
              <span className="avatar" style={{ background: "var(--st-missing-bg)", color: "var(--st-missing)" }}>{m.initials}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</span>
                  {m.vip && <Crown size={13} color="var(--st-review)" style={{ flexShrink: 0 }} />}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{m.coach} · {t("last seen")} {m.lastSeen || "—"}</div>
              </div>
              <span className="badge badge-missing" style={{ flexShrink: 0 }}>{t("Missing")}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
