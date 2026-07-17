import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw, AlertTriangle, ChevronRight } from "lucide-react";
import { apiGet, getUser } from "../../lib/api.js";
import { useLang } from "../../lib/i18n.jsx";

const TRIP_ID = "t-1";

/** "Good morning" / "Good afternoon" / "Good evening", by local hour. */
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/**
 * Mobile Home — pulls the same live summary as the desktop Dashboard
 * (GET /api/trips/:id/dashboard), condensed for a phone screen.
 *
 * Layout mirrors the Check-in screen's own "Trips" home tab
 * (QRCheckInPage.jsx's HomeView) so both mobile surfaces feel like the same
 * app: a personalized greeting header, a live Active Trip panel, a
 * glanceable KPI strip, and a Coach status card. Two differences from that
 * reference, both deliberate:
 *   - The KPI strip here is Missing/Present/Total (3 cards) per spec, not
 *     Check-in's Missing/Present/Unassigned (Unassigned stays reachable via
 *     the Attendance page's own filter chips).
 *   - The whole "Coach status" card is ONE tap target that jumps straight to
 *     the Attendance page pre-filtered to Missing — Check-in's version lets
 *     you tap into any one coach's own headcount view instead. Each KPI tile
 *     is still its own shortcut into Attendance, pre-filtered to that status.
 */
export default function MobileHomePage() {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Guards against overlapping polls (a slow response still in flight when
  // the next tick fires) — same pattern as the desktop Dashboard.
  const loadingRef = useRef(false);

  useEffect(() => {
    load();
    // 2s auto-refresh so a change made by another signed-in staff member
    // shows up here without needing to tap the manual Refresh button.
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, []);

  async function load() {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      setData(await apiGet(`/trips/${TRIP_ID}/dashboard`));
    } catch (e) {
      setError(e.message || "Could not reach the backend.");
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }

  const trip = data?.trip;
  const k = data?.kpis;
  const staffName = getUser()?.name || getUser()?.staffId || t("Staff");
  const goToAttendance = (status, coachId) =>
    navigate(`/mobile/attendance?status=${status}` + (coachId ? `&coach=${coachId}` : ""));

  return (
    <div>
      <div className="row between" style={{ alignItems: "flex-start", marginBottom: 4 }}>
        <div>
          <div className="muted" style={{ fontSize: 13 }}>{t(greeting())}</div>
          <h1 style={{ fontSize: 22, margin: "2px 0 8px" }}>{staffName}</h1>
          <span className="badge badge-present">● {t("Online · synced")}</span>
        </div>
        <button className="btn btn-ghost" onClick={load} aria-label={t("Refresh")} style={{ padding: 8 }}>
          <RefreshCw size={16} className={loading ? "spin" : ""} />
        </button>
      </div>

      {error && (
        <div className="mobile-card" style={{ borderColor: "var(--st-missing)", background: "var(--st-missing-bg)", marginTop: 14 }}>
          <div className="row" style={{ gap: 8, color: "var(--st-missing)", fontWeight: 600, fontSize: 14 }}>
            <AlertTriangle size={16} /> {t("Couldn't reach the backend")}
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t(error)}</p>
        </div>
      )}

      {loading && !data && <div className="muted" style={{ marginTop: 14 }}>{t("Loading…")}</div>}

      {/* Active trip — live tracking panel, same visual language as the
          Check-in screen's own trip card. */}
      {trip && (
        <div
          style={{
            background: "var(--scc-red)", color: "#fff",
            borderRadius: "var(--r-lg)", padding: 16, marginTop: 18,
            boxShadow: "var(--shadow-md)",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.85 }}>
            {t("Active trip")}
          </div>
          <div style={{ fontWeight: 700, fontSize: 17, marginTop: 4 }}>{trip.name}</div>
          <div style={{ opacity: 0.9, fontSize: 13, marginTop: 2 }}>
            {lang === "zh"
              ? `第 ${trip.dayOf}/${trip.totalDays} 天 · 当地时间 ${trip.localTime}`
              : `Day ${trip.dayOf} of ${trip.totalDays} · ${trip.localTime} local`}
          </div>
          {trip.departsIn && (
            <span className="badge" style={{ background: "rgba(255,255,255,.22)", color: "#fff", marginTop: 10, display: "inline-block" }}>
              {t("Departure in")} {trip.departsIn}
            </span>
          )}
        </div>
      )}

      {/* Glanceable metrics — Missing / Present / Total, each a shortcut into
          the Attendance page pre-filtered to that status. */}
      {k && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 14 }}>
          <Stat label={t("Missing")} value={k.missing} tone="missing" onClick={() => goToAttendance("MISSING")} />
          <Stat label={t("Present")} value={k.present} tone="present" onClick={() => goToAttendance("ARRIVED")} />
          <Stat label={t("Total")} value={k.total} tone="neutral" onClick={() => goToAttendance("ALL")} />
        </div>
      )}

      {/* Coach status — header links to the full missing list across every
          coach; each per-coach row is its OWN link, straight to that coach's
          missing delegates only (was previously one whole-card tap target
          that always went to the generic all-coaches list regardless of
          which row you tapped). */}
      {data?.coaches && (
        <div className="mobile-card" style={{ border: "1px solid var(--line)", background: "var(--surface)", marginTop: 18 }}>
          <button
            onClick={() => goToAttendance("MISSING")}
            className="row between"
            style={{ width: "100%", background: "none", border: "none", padding: 0, marginBottom: 12, cursor: "pointer", textAlign: "left", color: "inherit", font: "inherit" }}
          >
            <div style={{ fontWeight: 600, fontSize: 14 }}>{t("Coach status")}</div>
            <ChevronRight size={16} style={{ color: "var(--ink-3)", flexShrink: 0 }} />
          </button>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {data.coaches.map((c) => (
              <button
                key={c.id}
                onClick={() => goToAttendance("MISSING", c.id)}
                className="row between"
                style={{
                  width: "100%", background: "none", border: "none", padding: "8px 4px",
                  borderRadius: "var(--r-sm)", cursor: "pointer", textAlign: "left",
                  color: "inherit", font: "inherit", fontSize: 13,
                }}
              >
                <span>{[c.name, c.city].filter(Boolean).join(" · ")}</span>
                <span className={c.missing > 0 ? "badge badge-missing" : "badge badge-present"}>
                  {c.missing > 0 ? `${c.missing} ${t("missing")}` : t("All in")}
                </span>
              </button>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 10, textAlign: "center" }}>
            {t("Tap a coach to see who's missing")}
          </div>
        </div>
      )}

      <style>{`.spin{animation:mg-spin 0.9s linear infinite}@keyframes mg-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function Stat({ label, value, tone, onClick }) {
  return (
    <button
      className="mobile-card"
      onClick={onClick}
      style={{ margin: 0, textAlign: "center", cursor: "pointer", border: "1px solid var(--line)" }}
    >
      <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div className="mono" style={{ fontSize: 26, fontWeight: 700, color: `var(--st-${tone})`, lineHeight: 1.3 }}>{value}</div>
    </button>
  );
}
