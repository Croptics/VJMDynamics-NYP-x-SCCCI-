import { useEffect, useRef, useState } from "react";
import { MapPin, Clock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { getTripPulse } from "../lib/claudeParse.js";
import { useLang } from "../lib/i18n.jsx";

/**
 * Trip Pulse — a compact, live status widget for my page headers (Vance).
 *
 * Two modes, each showing what's specific to MY feature (not a generic KPI
 * strip — the raw attendance dashboard is JQ's):
 *   - mode="onboarding": onboarding progress through my QR lifecycle
 *     (passes issued → boarded → still to board).
 *   - mode="assistant": a ranked "what to watch" list from my computeRisk
 *     (missing VIPs, critical exceptions, the coach furthest from boarded).
 *
 * Polls `/api/assistant/pulse` (reuses the assistant's cached snapshot) every
 * 15s and fails quietly — renders nothing on error, so it can't break its host.
 */
export default function TripPulse({ mode = "assistant", data: dataOverride, tripId }) {
  const { t } = useLang();
  const [data, setData] = useState(null);
  const timer = useRef(null);

  useEffect(() => {
    if (dataOverride) return; // caller is feeding its own live data — skip the assistant poll
    let alive = true;
    const load = () => getTripPulse(tripId).then((d) => alive && setData(d)).catch(() => {});
    load();
    timer.current = setInterval(load, 15000); // refresh every 15s
    return () => { alive = false; clearInterval(timer.current); };
  }, [dataOverride, tripId]);

  const d = dataOverride || data;
  if (!d || !d.kpis) return null;
  const { trip, kpis, risk = [] } = d;

  const header = (
    <div className="row" style={{ gap: 6, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
      <MapPin size={14} style={{ color: "var(--ink-3)", flexShrink: 0 }} />
      <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {trip?.name || t("Trip")}
      </span>
      {trip?.dayOf != null && <span style={{ fontSize: 12, color: "var(--ink-3)" }}>· {t("day")} {trip.dayOf}</span>}
      {trip?.departsIn && (
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-2)", display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <Clock size={13} /> {trip.departsIn}
        </span>
      )}
    </div>
  );

  /* ---- Onboarding: progress through the QR boarding lifecycle ------------ */
  if (mode === "onboarding") {
    const issued = kpis.total ?? 0;
    const boarded = kpis.present ?? 0;
    const toBoard = Math.max(0, issued - boarded);
    const Stat = ({ value, label, color }) => (
      <div style={{ background: "var(--surface-2)", borderRadius: 8, padding: "6px 4px", textAlign: "center" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: color || "var(--ink)" }}>{value}</div>
        <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{label}</div>
      </div>
    );
    return (
      <div className="card" style={{ padding: 12, minWidth: 290, maxWidth: 360, flex: "0 1 360px" }}>
        {header}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          <Stat value={issued} label={t("passes issued")} />
          <Stat value={boarded} label={t("boarded")} color="var(--st-present)" />
          <Stat value={toBoard} label={t("to board")} color="var(--st-review)" />
        </div>
      </div>
    );
  }

  /* ---- Assistant: "what to watch" — my ranked risk list ------------------ */
  const levelColor = { critical: "var(--st-missing)", high: "var(--st-review)", medium: "var(--ink-3)" };
  return (
    <div className="card" style={{ padding: 12, minWidth: 290, maxWidth: 360, flex: "0 1 360px" }}>
      {header}
      <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 6 }}>
        {t("What to watch")}
      </div>
      {risk.length === 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--ink-2)" }}>
          <CheckCircle2 size={15} style={{ color: "var(--st-present)", flexShrink: 0 }} />
          {t("Nothing urgent — no missing VIPs or critical exceptions.")}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {risk.map((r, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, lineHeight: 1.35 }}>
              <AlertTriangle size={14} style={{ color: levelColor[r.level] || "var(--ink-3)", flexShrink: 0, marginTop: 1 }} />
              <span style={{ color: "var(--ink-2)" }}>{r.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
