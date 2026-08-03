// frontend/src/pages/mobile/MobileOpsPage.jsx
// OWNED BY: FaceCheck-Pro (Vimal) — mobile UI shell work
//
// The combined "Trips + Attendance + Exceptions" tab. Instead of separate
// bottom-nav destinations, this is ONE operations screen:
//
//   [ live summary strip — trip context, KPIs, latest updates ]
//   [ Delegates | Exceptions | Trips ]  <- segmented switch
//   [ the full existing page for whichever is selected            ]
//
// IMPORTANT — this COMPOSES the teammates' pages, it does not replace or edit
// them. MobileAttendancePage (roster, search, filters, status sheet, call
// buttons), MobileExceptionsPage (Jayden's exception inbox — see below), and
// MobileTripsPage (trip list, itinerary, coach assignments) are rendered
// here verbatim, so every feature they own keeps working exactly as before
// and stays their code to maintain. All this file adds is the summary strip
// above them and the switch between them.
//
// 2026-07-30 ("jayden mobile have this exception, pls add it to main
// project") — MobileExceptionsPage.jsx already existed, fully built, with
// its OWN doc comment describing exactly this 3-way switch — it just was
// never actually wired in here; this segment was missing entirely (only
// "delegates"/"trips" existed). Wiring it in is the whole fix; the component
// itself needed no changes.
//
// Deep links still work: /mobile/operations?status=MISSING opens with the
// Delegates view active, and MobileAttendancePage reads that query param
// itself, exactly as it always did. (Renamed from /mobile/attendance
// 2026-07-30 — the old path still redirects here, preserving the query.)

import { useEffect, useState, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { Users, Bus, AlertTriangle, RefreshCw } from "lucide-react";
import { apiGet } from "../../../lib/api.js";
import { useLang } from "../../../lib/i18n.jsx";
import MobileAttendancePage from "./MobileAttendancePage.jsx";
import MobileExceptionsPage from "./MobileExceptionsPage.jsx";
import MobileTripsPage from "./MobileTripsPage.jsx";

// Trip id comes from the mobile trip switcher, not a hardcoded base trip
// (re-applied 2026-07-29 after taking Vimal's UI, which hardcoded "t-1").
import { getMobileTripId } from "../../../lib/mobileTrip.js";
import { useVisiblePolling } from "../../../lib/useVisiblePolling.js";
const TRIP_ID_FALLBACK = "t-1";

export default function MobileOpsPage({ defaultView = "delegates" }) {
  const { t } = useLang();
  const [searchParams] = useSearchParams();
  // A ?status= deep link is always about the roster, so honour it over the
  // route's own default view.
  const [view, setView] = useState(() => (searchParams.get("status") ? "delegates" : defaultView));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);

  // Pauses while backgrounded (2026-07-29, JQ) — see lib/useVisiblePolling.js.
  // Needed here as well as on the Attendance page this screen wraps: pausing
  // one but not the other would leave a backgrounded phone still polling the
  // dashboard endpoint every 5s for a KPI strip nobody can see.
  useVisiblePolling(load, 5000);

  async function load() {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      setData(await apiGet(`/trips/${getMobileTripId() || TRIP_ID_FALLBACK}/dashboard`));
    } catch { /* summary is best-effort; the pages below show their own errors */ }
    finally { setLoading(false); busy.current = false; }
  }

  const k = data?.kpis;

  // BUG FIX (2026-07-31 — "fix color"): the old tone() treated EVERY metric
  // as "bad if > 0" unless explicitly marked "good" — so Total (never marked
  // good) rendered in the Missing/red colour just for having a nonzero
  // headcount, same as an actual missing delegate. Each stat below now picks
  // its own colour by what it actually means, not a shared >0-is-red default.
  const statStyle = (color) => ({ fontWeight: 800, fontSize: 18, lineHeight: 1.1, color });

  return (
    <div>
      {/* ---- Live summary strip ---------------------------------------- */}
      <div className="mobile-card" style={{ padding: 14 }}>
        <div className="row between" style={{ alignItems: "flex-start" }}>
          {/* Trip name is already in the sticky topbar chip — no need to
              repeat it here. This header just anchors the Ops screen. */}
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: 19, margin: 0 }}>{t("Operations")}</h1>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{t("Live headcount")}</div>
          </div>
          <button className="btn btn-ghost" onClick={load} aria-label={t("Refresh")} style={{ padding: 8, flexShrink: 0 }}>
            <RefreshCw size={15} className={loading ? "ops-spin" : ""} />
          </button>
        </div>

        {/* Merged Total+Arrived into one "X/Y Checked in" stat (2026-07-31 —
            "merge total and arrive so it like 0/5, name it checked in") and
            added Cancelled (backend now surfaces it — see db/dashboard.js's
            getDashboard()) so this card covers every status a delegate can
            actually be in: Checked in / Missing / Late / Cancelled. */}
        {k && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginTop: 12 }}>
            <Kpi label={t("Checked in")} value={`${k.arrived ?? k.present ?? 0}/${k.total ?? 0}`} style={statStyle("var(--st-present)")} />
            <Kpi label={t("Missing")} value={k.missing ?? 0} style={statStyle((k.missing ?? 0) > 0 ? "var(--st-missing)" : "var(--ink)")} />
            <Kpi label={t("Late")} value={k.late ?? 0} style={statStyle((k.late ?? 0) > 0 ? "var(--st-late)" : "var(--ink)")} />
            <Kpi label={t("Cancelled")} value={k.cancelled ?? 0} style={statStyle("var(--ink-3)")} />
          </div>
        )}
      </div>

      {/* ---- Delegates / Trips switch ----------------------------------- */}
      {/* Bottom margin widened 4px -> 16px (2026-07-29, "add some space between
          delegate and search bar") — the switch and the search/coach row right
          below it in MobileAttendancePage read as one cramped block at 4px. */}
      <div style={{ display: "flex", gap: 8, margin: "14px 0 16px" }}>
        {[
          { key: "delegates", label: "Delegates", Icon: Users },
          { key: "exceptions", label: "Exceptions", Icon: AlertTriangle },
          { key: "trips", label: "Trips", Icon: Bus },
        ].map(({ key, label, Icon }) => {
          const active = view === key;
          return (
            <button
              key={key}
              onClick={() => setView(key)}
              style={{
                flex: 1, padding: "10px 0", borderRadius: 999, fontWeight: 700, fontSize: 13,
                border: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                background: active ? "var(--scc-red-tint)" : "var(--surface)",
                color: active ? "var(--scc-red)" : "var(--ink-2)",
              }}
            >
              <Icon size={15} /> {t(label)}
            </button>
          );
        })}
      </div>

      {/* The teammates' own pages, rendered unmodified. */}
      {view === "delegates" ? <MobileAttendancePage />
        : view === "exceptions" ? <MobileExceptionsPage />
        : <MobileTripsPage />}

      <style>{`.ops-spin{animation:ops-spin .9s linear infinite}@keyframes ops-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function Kpi({ label, value, style }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={style}>{value ?? "—"}</div>
      <div className="muted" style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
    </div>
  );
}
