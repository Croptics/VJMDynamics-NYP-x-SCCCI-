import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw, AlertTriangle, ChevronRight, Clock, Bus, Megaphone, Mail, ClipboardList } from "lucide-react";
import { apiGet, getUser, getPermissions } from "../../lib/api.js";
import { useLang } from "../../lib/i18n.jsx";
import { getCriticalOpenCount } from "../../lib/exceptionsApi.js";

// Trip id comes from the mobile trip switcher, not a hardcoded base trip
// (re-applied 2026-07-29 after taking Vimal's UI, which hardcoded "t-1").
import { getMobileTripId } from "../../lib/mobileTrip.js";
const TRIP_ID_FALLBACK = "t-1";

// trip.departsIn ("04:53") is a COUNTDOWN duration, not a clock time —
// reformatted as "4h 53m" rather than run through a 12h clock formatter,
// which would print the nonsensical "4:53 AM" (2026-07-30 — "do the same for
// these", re the itinerary's 12h-format fix; departsIn needed a different fix
// since it isn't a time of day at all).
function fmtDepartsIn(hhmm) {
  if (!hhmm) return hhmm;
  const [h, m] = String(hhmm).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}
// Genuine live countdown (2026-07-30 — "i see this one nvr change, is it
// static?"). trip.departureAt is a real absolute instant computed
// server-side (getTrip(), db/dashboard.js) from startDate + totalDays + the
// new departureTime field. Computed at render time, not stored in state — it
// piggybacks on this page's existing nowClock 15s re-render tick. Returns
// null once departure has passed, so the pill disappears rather than
// counting into negative numbers.
function liveDepartsIn(departureAtIso) {
  if (!departureAtIso) return null;
  const diffMs = new Date(departureAtIso).getTime() - Date.now();
  if (!(diffMs > 0)) return null;
  const totalMin = Math.round(diffMs / 60000);
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

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

  // Live wall clock for the "Active trip" hero (2026-07-29 — "can you fix this
  // for time 14:26 to show the current time"). It was rendering `trip.localTime`,
  // a HARDCODED SEED STRING ("14:26" in backend/db/constants.js) written once
  // and never updated — same root cause as the desktop Dashboard's identical
  // frozen-clock bug fixed a few entries earlier, just a second, separate card
  // that also read the same stale field. Ticks every 15s, not every second —
  // the display is HH:MM, so a per-second interval would re-render this page
  // 60x/min to change nothing. `hour12: true` forced explicitly (2026-07-30 —
  // "fix to 12 hr format"): left locale-driven, this read as 24h here.
  const [nowClock, setNowClock] = useState(() =>
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true })
  );
  useEffect(() => {
    const id = setInterval(
      () => setNowClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true })),
      15000
    );
    return () => clearInterval(id);
  }, []);

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
      setData(await apiGet(`/trips/${getMobileTripId() || TRIP_ID_FALLBACK}/dashboard`));
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
          {/* The "Online · synced" badge that used to sit here is gone
              (2026-07-29 — "hide all the unnecessary sync part, cause already
              have on top of the mobile top bar"). Worth noting it was worse
              than just redundant: it was a STATIC string with no logic behind
              it at all — not wired to `navigator.onLine` or anything else — so
              it would have kept claiming "Online · synced" even while
              genuinely offline. MobileLayout's topbar chip is the real,
              actually-wired connectivity indicator. */}
          {k && (
            <div style={{ marginTop: 6 }}>
              <span className="muted" style={{ fontSize: 12.5 }}>{t("Total delegates")}: {k.total}</span>
            </div>
          )}
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
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 19, marginTop: 4, position: "relative" }}>
            {trip.name}{trip.countryTo ? ` (${trip.countryTo})` : ""}
          </div>
          {/* Shows the REAL clock (`nowClock`), ticking — not `trip.localTime`,
              which was a frozen seed value (see the state comment above). Says
              plainly "current time", not "local", for the same reason as the
              desktop fix: `trips` has no timezone column, so there's nothing to
              convert against — this is the viewer's own device clock. */}
          <div style={{ opacity: 0.9, fontSize: 13, marginTop: 2, position: "relative" }}>
            {lang === "zh"
              ? `第 ${trip.dayOf}/${trip.totalDays} 天 · 当前时间 ${nowClock}`
              : `Day ${trip.dayOf} of ${trip.totalDays} · ${nowClock} now`}
          </div>
          {(() => {
            const live = liveDepartsIn(trip.departureAt);
            const d = live ?? (trip.departsIn ? fmtDepartsIn(trip.departsIn) : null);
            // 2026-07-30 — "say departure back to [country] in [x] hour":
            // names WHERE the delegation is heading back to (trip.countryFrom
            // — editable per trip, defaults to Singapore) instead of a bare
            // duration with no destination context.
            return d ? (
              <span className="m-hero-pill" style={{ marginTop: 12 }}>
                <Clock size={13} /> {t("Departure back to")} {trip.countryFrom || "Singapore"} {t("in")} {d}
              </span>
            ) : null;
          })()}
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
                <div className="m-tile-title">{t("Report an issue")}</div>
                <div className="m-tile-sub">{t("Log a new exception for your coach")}</div>
              </div>
              <div className="row" style={{ gap: 8, flexShrink: 0 }}>
                {openIssueCount > 0 && <span className="badge badge-missing">{openIssueCount}</span>}
                <ChevronRight size={16} style={{ color: "var(--ink-3)" }} />
              </div>
            </button>
          )}
          {/* Jayden's mobile exception inbox (2026-07-29 integration) — his new
              page arrived with no route AND nothing linking to it, so it was
              doubly unreachable. This tile is the way in. The tile above it was
              relabelled at the same time: both used to be reachable only as
              "Issues", and two tiles with near-identical names would be
              indistinguishable — so that one now says what it's for (logging a
              ticket) and this one says what it is (the inbox of everything
              raised, with actions). */}
          {getPermissions().viewMobileIssues && (
            <button className="m-tile" onClick={() => navigate("/mobile/exceptions")}>
              <span className="m-tile-ic" style={{ background: "var(--st-review-bg)", color: "var(--st-review)" }}>
                <ClipboardList size={18} />
              </span>
              <div className="m-tile-body">
                <div className="m-tile-title">{t("Exception inbox")}</div>
                <div className="m-tile-sub">{t("Resolve, override or re-prioritise tickets")}</div>
              </div>
              <ChevronRight size={16} style={{ color: "var(--ink-3)", flexShrink: 0 }} />
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
              onClick={() => goToAttendance("ALL")}
              className="row" style={{ gap: 3, background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--scc-red)", fontSize: 12.5, fontWeight: 700 }}
            >
              {t("See all")} <ChevronRight size={14} />
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {data.coaches.map((c) => {
              const missing = c.missing || 0;
              const late = c.late || 0;
              const attn = missing + late;
              // Two bugs fixed here (2026-07-29 — "why when i click coach 1 it
              // show me this filter instead of just one delegate who is
              // missing / i think the coach status for this mobile page not
              // updated"):
              //
              // 1. The tap hardcoded status "ALL", so a row reading "1 missing"
              //    opened that coach's ENTIRE roster with no status filter —
              //    all 5 delegates, leaving you to find the one that needed
              //    attention yourself. It now opens the status the badge is
              //    actually reporting.
              // 2. The badge counted missing + late but LABELLED it all
              //    "missing" — `late` is its own separate count from the
              //    backend (see the coach rows in db/dashboard.js), so a coach
              //    with 0 missing and 2 late read as "2 missing", which is
              //    simply untrue and sends staff looking for the wrong people.
              //    Each is now named, and both show when both exist.
              const focus = missing > 0 ? "MISSING" : late > 0 ? "LATE" : "ALL";
              // "Arrived" was reachable with missing=0 AND late=0 alone
              // (2026-07-30 — "it should not show this arrived until every
              // delegate is arrived... same for mobile"): those two backend
              // counts don't cover plain ASSIGNED — a delegate simply not
              // scanned yet, not late enough to be flagged LATE. A coach of
              // 5 people all still "Assigned" showed missing=0/late=0 and
              // read as fully arrived. `toBoard` (total - boarded) is the
              // same "still needs to board" figure the desktop Coach status
              // card already uses — "Arrived" now requires that to be 0 too.
              const toBoard = Math.max(0, (c.total || 0) - (c.boarded || 0));
              const label = missing && late
                ? `${missing} ${t("missing")} · ${late} ${t("late")}`
                : missing ? `${missing} ${t("missing")}`
                : late ? `${late} ${t("late")}`
                : toBoard ? `${toBoard} ${t("to board")}`
                : t("Arrived");
              const tone = missing > 0 ? "missing" : late > 0 ? "late" : toBoard ? "assigned" : "present";
              return (
                <button
                  key={c.id}
                  className="m-row"
                  onClick={() => goToAttendance(focus, c.id)}
                  // Says what the tap will do — with both counts present it
                  // opens the missing ones first, which isn't guessable.
                  title={attn > 0 ? `${t("Show")} ${t(focus === "MISSING" ? "missing" : "late")} — ${[c.name, c.city].filter(Boolean).join(" · ")}` : undefined}
                >
                  <span className="avatar" style={{ background: `var(--st-${tone}-bg)`, color: `var(--st-${tone})` }}>
                    <Bus size={15} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {[c.name, c.city].filter(Boolean).join(" · ")}
                  </span>
                  <span className={`badge badge-${tone}`}>
                    {label}
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
