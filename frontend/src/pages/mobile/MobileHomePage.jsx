import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw, AlertTriangle, ChevronRight, ScanFace } from "lucide-react";
import { apiGet, getUser, getPermissions } from "../../lib/api.js";
import { useLang } from "../../lib/i18n.jsx";
import { getCriticalOpenCount } from "../../lib/exceptionsApi.js";

const TRIP_ID = "t-1";

/** "Good morning" / "Good afternoon" / "Good evening", by local hour. */
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/**
 * Mobile Home — pulls the same live summary as the desktop Dashboard
 * (GET /api/trips/:id/dashboard), condensed for a phone screen: a
 * personalized greeting header, a live Active Trip panel, a glanceable KPI
 * strip, an expandable Issues section (below), and a Coach status card.
 *   - The KPI strip is Missing/Present/Late (3 cards) — Unassigned stays
 *     reachable via the Attendance page's own filter chips, and Late gets
 *     the dedicated tile instead since it's the higher-risk operational
 *     number during a live trip. Total isn't a card here at all — it's a
 *     small text line under the page title instead, keeping the main tile
 *     row dedicated to actionable/at-risk statuses rather than a plain count.
 *   - The whole "Coach status" card is ONE tap target that jumps straight to
 *     the Attendance page pre-filtered to Missing. Each KPI tile is its own
 *     shortcut into Attendance, pre-filtered to that status.
 *   - Issues: an actionable card under the metric cards links to the
 *     dedicated /mobile/issues page (MobileIssuesPage.jsx). Was briefly an
 *     inline expandable accordion right here (2026-07-20, "Mobile UI
 *     Consolidation" Option A); moved to its own route the same day — the
 *     full log-a-ticket form + open-tickets list reads better as its own
 *     screen than squeezed into an accordion on a small viewport. This card
 *     just fetches the open-critical count for its badge and navigates.
 */
export default function MobileHomePage() {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Issues card badge — open-critical count only; the form/list themselves
  // live on the dedicated /mobile/issues page now.
  const [openIssueCount, setOpenIssueCount] = useState(0);

  useEffect(() => {
    getCriticalOpenCount().then(setOpenIssueCount).catch(() => {});
    const id = setInterval(() => { getCriticalOpenCount().then(setOpenIssueCount).catch(() => {}); }, 2000);
    return () => clearInterval(id);
  }, []);

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
          <h1 style={{ fontSize: 22, margin: "2px 0 4px" }}>{staffName}</h1>
          {/* Total moved here (small subheader under the page title) — it's
              no longer one of the main KPI cards, which now surface Late
              instead so the actionable statuses keep the prime real estate. */}
          {k && <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>{t("Total delegates")}: {k.total}</div>}
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

      {/* Glanceable metrics — Missing / Late / Present, each a shortcut into
          the Attendance page pre-filtered to that status. Total moved out of
          this row (see the subheader under the page title above) so these 3
          stay dedicated to actionable, at-risk statuses. Order: the two
          "needs attention" statuses (Missing, Late) lead together, ahead of
          the calmer Present count — mirrors desktop DashboardPage.jsx's KPI
          tile order. */}
      {k && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 14 }}>
          <Stat label={t("Missing")} value={k.missing} tone="missing" onClick={() => goToAttendance("MISSING")} />
          <Stat label={t("Late")} value={k.late ?? 0} tone="late" onClick={() => goToAttendance("LATE")} />
          <Stat label={t("Present")} value={k.present} tone="present" onClick={() => goToAttendance("ARRIVED")} />
        </div>
      )}

      {/* Scanner — quick shortcut into the mobile Face/QR/Manual scanner for
          a staff member already signed into the app. Gated behind
          viewMobileScanner so an admin can hide it per-account, same as
          every other mobile tile. */}
      {getPermissions().viewMobileScanner && (
        <button
          className="mobile-card row between"
          onClick={() => navigate("/mobile/scanner")}
          style={{ width: "100%", marginTop: 14, border: "1px solid var(--line)", background: "var(--surface)", cursor: "pointer", textAlign: "left" }}
        >
          <div className="row" style={{ gap: 10 }}>
            <span className="avatar" style={{ background: "var(--scc-red-tint)", color: "var(--scc-red)" }}>
              <ScanFace size={16} />
            </span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{t("Scanner")}</div>
              <div className="muted" style={{ fontSize: 12 }}>{t("Face + QR scan")}</div>
            </div>
          </div>
          <ChevronRight size={16} style={{ color: "var(--ink-3)", flexShrink: 0 }} />
        </button>
      )}

      {/* Issues — actionable card under the metric cards; navigates to the
          dedicated /mobile/issues page rather than expanding inline. Gated
          behind viewMobileIssues so an admin can hide it per-account. */}
      {getPermissions().viewMobileIssues && (
        <button
          className="mobile-card row between"
          onClick={() => navigate("/mobile/issues")}
          style={{ width: "100%", marginTop: 14, border: "1px solid var(--line)", background: "var(--surface)", cursor: "pointer", textAlign: "left" }}
        >
          <div className="row" style={{ gap: 10 }}>
            <span className="avatar" style={{ background: "var(--st-missing-bg)", color: "var(--st-missing)" }}>
              <AlertTriangle size={16} />
            </span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{t("Issues")}</div>
              <div className="muted" style={{ fontSize: 12 }}>{t("Report or view exceptions")}</div>
            </div>
          </div>
          <div className="row" style={{ gap: 8, flexShrink: 0 }}>
            {openIssueCount > 0 && <span className="badge badge-missing">{openIssueCount}</span>}
            <ChevronRight size={16} style={{ color: "var(--ink-3)" }} />
          </div>
        </button>
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
                // Badge now counts MISSING+LATE combined, and Attendance has
                // no single-status filter for that pair — land on the coach's
                // full roster (ALL) instead of a status that could be empty.
                onClick={() => goToAttendance("ALL", c.id)}
                className="row between"
                style={{
                  width: "100%", background: "none", border: "none", padding: "8px 4px",
                  borderRadius: "var(--r-sm)", cursor: "pointer", textAlign: "left",
                  color: "inherit", font: "inherit", fontSize: 13,
                }}
              >
                <span>{[c.name, c.city].filter(Boolean).join(" · ")}</span>
                {/* Simplified two-state badge (mirrors desktop CoachBar):
                    Late folds into Missing, no separate Late badge here. */}
                <span className={(c.missing || 0) + (c.late || 0) > 0 ? "badge badge-missing" : "badge badge-present"}>
                  {(c.missing || 0) + (c.late || 0) > 0 ? `${(c.missing || 0) + (c.late || 0)} ${t("missing")}` : t("Arrived")}
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
