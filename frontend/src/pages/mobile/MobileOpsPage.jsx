// frontend/src/pages/mobile/MobileOpsPage.jsx
// OWNED BY: FaceCheck-Pro (Vimal) — mobile UI shell work
//
// The combined "Trips + Attendance" tab. Instead of two separate bottom-nav
// destinations, this is ONE operations screen:
//
//   [ live summary strip — trip context, KPIs, latest updates ]
//   [ Delegates | Trips ]  <- segmented switch
//   [ the full existing page for whichever is selected            ]
//
// IMPORTANT — this COMPOSES the teammates' pages, it does not replace or edit
// them. MobileAttendancePage (roster, search, filters, status sheet, call
// buttons) and MobileTripsPage (trip list, itinerary, coach assignments) are
// rendered here verbatim, so every feature they own keeps working exactly as
// before and stays their code to maintain. All this file adds is the summary
// strip above them and the switch between them.
//
// Deep links still work: /mobile/attendance?status=MISSING opens with the
// Delegates view active, and MobileAttendancePage reads that query param
// itself, exactly as it always did.

import { useEffect, useState, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { Users, Bus, RefreshCw } from "lucide-react";
import { apiGet } from "../../lib/api.js";
import { useLang } from "../../lib/i18n.jsx";
import MobileAttendancePage from "./MobileAttendancePage.jsx";
import MobileTripsPage from "./MobileTripsPage.jsx";

// Trip id comes from the mobile trip switcher, not a hardcoded base trip
// (re-applied 2026-07-29 after taking Vimal's UI, which hardcoded "t-1").
import { getMobileTripId } from "../../lib/mobileTrip.js";
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

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const tone = (v, good) => ({
    fontWeight: 800, fontSize: 18, lineHeight: 1.1,
    color: v > 0 && !good ? "var(--st-missing)" : good ? "var(--st-present)" : "var(--ink)",
  });

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

        {k && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginTop: 12 }}>
            <Kpi label={t("Total")} value={k.total} style={tone(k.total)} />
            <Kpi label={t("Arrived")} value={k.arrived ?? k.present ?? 0} style={tone(k.arrived ?? k.present ?? 0, true)} />
            <Kpi label={t("Missing")} value={k.missing} style={tone(k.missing)} />
            <Kpi label={t("Late")} value={k.late ?? 0} style={tone(k.late ?? 0)} />
          </div>
        )}
      </div>

      {/* ---- Delegates / Trips switch ----------------------------------- */}
      <div style={{ display: "flex", gap: 8, margin: "14px 0 4px" }}>
        {[
          { key: "delegates", label: "Delegates", Icon: Users },
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
      {view === "delegates" ? <MobileAttendancePage /> : <MobileTripsPage />}

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
