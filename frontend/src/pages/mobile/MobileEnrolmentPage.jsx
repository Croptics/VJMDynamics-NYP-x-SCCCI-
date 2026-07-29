// frontend/src/pages/mobile/MobileEnrolmentPage.jsx
// OWNED BY: FaceCheck-Pro (Vimal)
//
// Staff "who's enrolled" view — enrolment readiness across the roster before a
// trip. Shows overall coverage, and every delegate grouped by coach with their
// face/voice status, so staff can chase up whoever still needs to enrol. Tapping
// a delegate opens the enrolment flow pre-identified to them (great at a desk).
//
// Reuses the public FaceCheck endpoints: GET /enroll/stats (coverage) and
// GET /enroll/lookup (full roster + per-delegate enrolled status).

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, AlertTriangle, ScanFace, Mic, Bus, ChevronRight, CheckCircle2 } from "lucide-react";
import { apiGet } from "../../lib/api.js";
import { useLang } from "../../lib/i18n.jsx";

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
const initials = (name) => (name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

const FILTERS = [
  { key: "all", label: "All" },
  { key: "todo", label: "Not enrolled" },
  { key: "face", label: "Face done" },
  { key: "voice", label: "Voice done" },
];

export default function MobileEnrolmentPage() {
  const { t } = useLang();
  const [stats, setStats] = useState(null);
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [s, r] = await Promise.all([apiGet("/enroll/stats"), apiGet("/enroll/lookup")]);
      setStats(s); setRoster(r.matches || []);
    } catch (e) {
      setError(e.message || "Could not load enrolment data. Is the backend running?");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000); // live: reflects delegates enrolling right now
    return () => clearInterval(id);
  }, [load]);

  const match = (d) =>
    filter === "todo" ? !d.enrolled?.face && !d.enrolled?.voice
    : filter === "face" ? d.enrolled?.face
    : filter === "voice" ? d.enrolled?.voice
    : true;
  const shown = roster.filter(match);

  // group by coach, stable order
  const order = [];
  const byCoach = {};
  for (const d of shown) {
    const k = d.coachLabel || "No coach yet";
    if (!byCoach[k]) { byCoach[k] = []; order.push(k); }
    byCoach[k].push(d);
  }
  // per-coach coverage from the WHOLE roster (not the filtered view)
  const coachCoverage = (label) => {
    const list = roster.filter((d) => (d.coachLabel || "No coach yet") === label);
    const done = list.filter((d) => d.enrolled?.face || d.enrolled?.voice).length;
    return { done, total: list.length };
  };

  const coveragePct = stats ? pct(stats.enrolled, stats.total) : 0;

  return (
    <div className="m-fade-in">
      <div className="row between" style={{ alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <div className="m-eyebrow">{t("FaceCheck")}</div>
          <h1 className="m-page-title">{t("Enrolment")}</h1>
        </div>
        <button className="btn btn-ghost" onClick={load} aria-label={t("Refresh")} style={{ padding: 8 }}>
          <RefreshCw size={16} className={loading ? "spin" : ""} />
        </button>
      </div>

      {error && (
        <div className="mobile-card" style={{ borderColor: "var(--st-missing)", background: "var(--st-missing-bg)" }}>
          <div className="row" style={{ gap: 8, color: "var(--st-missing)", fontWeight: 600, fontSize: 14 }}>
            <AlertTriangle size={16} /> {t(error)}
          </div>
        </div>
      )}

      {/* Coverage hero */}
      {stats && (
        <div className="m-hero">
          <div className="m-hero-glow" />
          <div className="m-hero-eyebrow">{t("Roster coverage")}</div>
          <div className="row" style={{ alignItems: "baseline", gap: 8, position: "relative", marginTop: 4 }}>
            <div className="mono" style={{ fontSize: 34, fontWeight: 800, lineHeight: 1 }}>{coveragePct}%</div>
            <div style={{ fontSize: 13, opacity: 0.92 }}>{stats.enrolled}/{stats.total} {t("enrolled")}</div>
          </div>
          <div style={{ height: 8, background: "rgba(255,255,255,0.25)", borderRadius: 999, overflow: "hidden", marginTop: 10, position: "relative" }}>
            <div style={{ height: "100%", background: "#fff", borderRadius: 999, width: `${coveragePct}%`, transition: "width .4s" }} />
          </div>
          <div className="row" style={{ gap: 14, marginTop: 12, position: "relative", fontSize: 12.5, fontWeight: 600 }}>
            <span className="row" style={{ gap: 5 }}><ScanFace size={14} /> {stats.face} {t("face")}</span>
            <span className="row" style={{ gap: 5 }}><Mic size={14} /> {stats.voice} {t("voice")}</span>
            <span className="row" style={{ gap: 5, opacity: 0.9 }}>{Math.max(0, stats.total - stats.enrolled)} {t("to go")}</span>
          </div>
        </div>
      )}

      {/* Filter chips */}
      <div className="m-chip-row" style={{ marginTop: 14 }}>
        {FILTERS.map((f) => (
          <button key={f.key} className={"m-chip" + (filter === f.key ? " active" : "")} onClick={() => setFilter(f.key)}>
            {t(f.label)}
          </button>
        ))}
      </div>

      {loading && roster.length === 0 && <div className="muted" style={{ marginTop: 14 }}>{t("Loading…")}</div>}

      {!loading && shown.length === 0 && !error && (
        <div className="m-empty">
          <span className="m-empty-ic" style={{ background: "var(--st-present-bg)", color: "var(--st-present)", borderColor: "transparent" }}>
            <CheckCircle2 size={22} />
          </span>
          <div style={{ fontWeight: 700, color: "var(--ink)" }}>
            {filter === "todo" ? t("Everyone's enrolled") : t("No delegates here")}
          </div>
          <div style={{ fontSize: 12.5 }}>{filter === "todo" ? t("Every delegate has a face or voice on file.") : t("Try a different filter.")}</div>
        </div>
      )}

      {/* Roster grouped by coach */}
      {order.map((k) => {
        const cov = coachCoverage(k);
        return (
          <div key={k} className="m-section" style={{ marginTop: 16 }}>
            <div className="m-section-head">
              <span className="m-eyebrow" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Bus size={13} /> {k}</span>
              <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: cov.done === cov.total ? "var(--st-present)" : "var(--ink-3)" }}>
                {cov.done}/{cov.total}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {byCoach[k].map((d) => {
                const done = d.enrolled?.face || d.enrolled?.voice;
                return (
                  <button
                    key={d.delegateId}
                    className="m-row"
                    onClick={() => { window.location.assign(`/enroll?d=${encodeURIComponent(d.delegateId)}`); }}
                    title={t("Enrol this delegate")}
                  >
                    <span className="avatar" style={{ background: done ? "var(--st-present-bg)" : "var(--surface)", color: done ? "var(--st-present)" : "var(--ink-3)", border: done ? "none" : "1px solid var(--line)" }}>
                      {initials(d.name)}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {d.name}
                    </span>
                    <span className="row" style={{ gap: 6, flexShrink: 0 }}>
                      {d.enrolled?.face && <span className="badge badge-present" title={t("Face enrolled")}><ScanFace size={11} /></span>}
                      {d.enrolled?.voice && <span className="badge badge-assigned" title={t("Voice enrolled")}><Mic size={11} /></span>}
                      {!done && <span className="badge badge-missing">{t("To do")}</span>}
                      <ChevronRight size={15} style={{ color: "var(--ink-3)" }} />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
