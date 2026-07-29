import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw, AlertTriangle, ChevronRight, Clock, Bus, Megaphone, Mail } from "lucide-react";
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
    <div className="m-fade-in">
      {/* Greeting header */}
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div className="muted" style={{ fontSize: 13 }}>{t(greeting())}</div>
          <h1 className="m-page-title">{staffName}</h1>
          <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: "wrap" }}>
            <span className="badge badge-present">● {t("Online · synced")}</span>
            {k && <span className="muted" style={{ fontSize: 12.5 }}>{t("Total delegates")}: {k.total}</span>}
          </div>
        </div>
        <button className="btn btn-ghost" onClick={load} aria-label={t("Refresh")} style={{ padding: 8, flexShrink: 0 }}>
          <RefreshCw size={16} className={loading ? "spin" : ""} />
        </button>
      </div>

      {error && (
        <div className="mobile-card" style={{ borderColor: "var(--st-missing)", background: "var(--st-missing-bg)", marginTop: 16 }}>
          <div className="row" style={{ gap: 8, color: "var(--st-missing)", fontWeight: 600, fontSize: 14 }}>
            <AlertTriangle size={16} /> {t("Couldn't reach the backend")}
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t(error)}</p>
        </div>
      )}

      {loading && !data && <div className="muted" style={{ marginTop: 16 }}>{t("Loading…")}</div>}

      {/* Active trip — signature red hero. */}
      {trip && (
        <div className="m-hero" style={{ marginTop: 18 }}>
          <div className="m-hero-glow" />
          <div className="m-hero-eyebrow">{t("Active trip")}</div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 19, marginTop: 4, position: "relative" }}>{trip.name}</div>
          <div style={{ opacity: 0.9, fontSize: 13, marginTop: 2, position: "relative" }}>
            {lang === "zh"
              ? `第 ${trip.dayOf}/${trip.totalDays} 天 · 当地时间 ${trip.localTime}`
              : `Day ${trip.dayOf} of ${trip.totalDays} · ${trip.localTime} local`}
          </div>
          {trip.departsIn && (
            <span className="m-hero-pill" style={{ marginTop: 12 }}>
              <Clock size={13} /> {t("Departure in")} {trip.departsIn}
            </span>
          )}
        </div>
      )}

      {/* Quick actions — the at-a-glance KPI numbers live on the Ops page, so
          Home stays focused on the trip hero, jump-ins, and coach status. */}
      <div className="m-section">
        <div className="m-section-head"><span className="m-eyebrow">{t("Quick actions")}</span></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button className="m-tile" onClick={() => navigate("/mobile/announcements")}>
            <span className="m-tile-ic"><Megaphone size={18} /></span>
            <div className="m-tile-body">
              <div className="m-tile-title">{t("Announcements")}</div>
              <div className="m-tile-sub">{t("Trip updates for staff")}</div>
            </div>
            <ChevronRight size={16} style={{ color: "var(--ink-3)", flexShrink: 0 }} />
          </button>
          <button className="m-tile" onClick={() => navigate("/mobile/enrolment")}>
            <span className="m-tile-ic"><Mail size={18} /></span>
            <div className="m-tile-body">
              <div className="m-tile-title">{t("Enrolment invites")}</div>
              <div className="m-tile-sub">{t("Email delegates their enrol link")}</div>
            </div>
            <ChevronRight size={16} style={{ color: "var(--ink-3)", flexShrink: 0 }} />
          </button>
          {getPermissions().viewMobileIssues && (
            <button className="m-tile" onClick={() => navigate("/mobile/issues")}>
              <span className="m-tile-ic" style={{ background: "var(--st-missing-bg)", color: "var(--st-missing)" }}>
                <AlertTriangle size={18} />
              </span>
              <div className="m-tile-body">
                <div className="m-tile-title">{t("Issues")}</div>
                <div className="m-tile-sub">{t("Report or view exceptions")}</div>
              </div>
              <div className="row" style={{ gap: 8, flexShrink: 0 }}>
                {openIssueCount > 0 && <span className="badge badge-missing">{openIssueCount}</span>}
                <ChevronRight size={16} style={{ color: "var(--ink-3)" }} />
              </div>
            </button>
          )}
        </div>
      </div>

      {/* Coach status — header links to all-missing; each row jumps to that
          coach's roster. */}
      {data?.coaches && (
        <div className="m-section">
          <div className="m-section-head">
            <span className="m-eyebrow">{t("Coach status")}</span>
            <button
              onClick={() => goToAttendance("MISSING")}
              className="row" style={{ gap: 3, background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--scc-red)", fontSize: 12.5, fontWeight: 700 }}
            >
              {t("See all missing")} <ChevronRight size={14} />
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {data.coaches.map((c) => {
              const attn = (c.missing || 0) + (c.late || 0);
              return (
                <button key={c.id} className="m-row" onClick={() => goToAttendance("ALL", c.id)}>
                  <span className="avatar" style={{ background: attn > 0 ? "var(--st-missing-bg)" : "var(--st-present-bg)", color: attn > 0 ? "var(--st-missing)" : "var(--st-present)" }}>
                    <Bus size={15} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {[c.name, c.city].filter(Boolean).join(" · ")}
                  </span>
                  <span className={attn > 0 ? "badge badge-missing" : "badge badge-present"}>
                    {attn > 0 ? `${attn} ${t("missing")}` : t("Arrived")}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
