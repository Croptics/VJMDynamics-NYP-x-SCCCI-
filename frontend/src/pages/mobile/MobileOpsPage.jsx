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
import { Users, Bus, Activity, RefreshCw } from "lucide-react";
import { apiGet } from "../../lib/api.js";
import { useLang } from "../../lib/i18n.jsx";
import MobileAttendancePage from "./MobileAttendancePage.jsx";
import MobileTripsPage from "./MobileTripsPage.jsx";

const TRIP_ID = "t-1";

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
      setData(await apiGet(`/trips/${TRIP_ID}/dashboard`));
    } catch { /* summary is best-effort; the pages below show their own errors */ }
    finally { setLoading(false); busy.current = false; }
  }

  const k = data?.kpis;
  const trip = data?.trip;
  const activity = data?.activity || [];

  const tone = (v, good) => ({
    fontWeight: 800, fontSize: 18, lineHeight: 1.1,
    color: v > 0 && !good ? "var(--st-missing)" : good ? "var(--st-present)" : "var(--ink)",
  });

  return (
    <div>
      {/* ---- Live summary strip ---------------------------------------- */}
      <div className="mobile-card" style={{ padding: 14 }}>
        <div className="row between" style={{ alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-3)" }}>
              {t("Operations")}
            </div>
            <h1 style={{ fontSize: 19, margin: "3px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {trip?.name || t("Loading…")}
            </h1>
            {trip && (
              <div className="muted" style={{ fontSize: 12 }}>
                {trip.dayOf ? `${t("Day")} ${trip.dayOf}${trip.totalDays ? `/${trip.totalDays}` : ""}` : null}
                {trip.departsIn ? ` · ${t("departs in")} ${trip.departsIn}` : null}
              </div>
            )}
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

      {/* ---- Latest updates (recent delegate activity) ------------------ */}
      {activity.length > 0 && (
        <div className="mobile-card" style={{ padding: 14 }}>
          <div className="row" style={{ gap: 7, marginBottom: 8 }}>
            <Activity size={14} style={{ color: "var(--scc-red)" }} />
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--ink-3)" }}>
              {t("Latest updates")}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {activity.slice(0, 4).map((a) => (
              <div key={a.id} className="row between" style={{ gap: 10 }}>
                <div className="row" style={{ gap: 8, minWidth: 0 }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: 999, flexShrink: 0,
                    background: a.kind === "checkin" ? "var(--st-present)" : a.kind === "reassign" ? "var(--st-assigned)" : "var(--ink-3)",
                  }} />
                  <span style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.text}</span>
                </div>
                <span className="mono muted" style={{ fontSize: 11.5, flexShrink: 0 }}>{a.time}</span>
              </div>
            ))}
          </div>
        </div>
      )}

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
