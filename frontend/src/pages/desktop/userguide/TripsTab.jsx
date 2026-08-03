/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — User Guide's "Trips & Checkpoints" tab
 *
 *  Extracted from UserGuidePage.jsx (2026-08-02 modularization pass).
 * ============================================================================= */
import { UserCheck2, LogIn, Clock, ArrowRight, QrCode, PencilLine, History, Bus, Check, RotateCcw } from "lucide-react";
import { FlowRow, FlowStep, FlowArrow, Tip } from "./FlowChart.jsx";

export function TripsTab({ t }) {
  return (
    <>
      <div className="card" style={{ marginTop: 16, padding: 22 }}>
        <h2 style={{ fontSize: 16, marginBottom: 4 }}>{t("Trips board & itinerary")}</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Tip icon={Bus} title={t("The Trips board")}>
            {t("Drag a delegate card onto a coach to assign them (this sets Assigned, not Arrived — that only happens on an actual check-in). The journey timeline shows today's itinerary with a moving marker for where the group currently is.")}
          </Tip>
          <Tip icon={QrCode} title={t("The Check-in screen")}>
            {t("A phone-frame staff app with Face, QR, and Manual check-in modes side by side, plus a live per-coach reverse headcount. Functionally the same paths as the dedicated Scanner page — this one's laid out for a smaller screen.")}
          </Tip>
          <Tip icon={PencilLine} title={t("Manual attendance override")}>
            {t("When a scan just won't work, mark someone present by hand from the Manual tab or the Trip board's Attendance modal. Every manual change is also logged to the per-stop history — nothing about it skips the audit trail.")}
          </Tip>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16, padding: 22 }}>
        <h2 style={{ fontSize: 16, marginBottom: 4 }}>{t("Multi-checkpoint attendance")}</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 18 }}>
          {t("Instead of ONE status for the whole day, a delegate gets tracked independently at EVERY scheduled itinerary stop — \"Arrived at Lunch\" and \"Missing at the 4pm Assembly\" can both be true for the same person.")}
        </p>

        <div style={{ padding: "16px", background: "var(--surface-2)", borderRadius: "var(--r-md)", marginBottom: 18 }}>
          <div className="muted" style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 12 }}>
            {t("Flowchart — one itinerary stop's lifecycle")}
          </div>
          <FlowRow>
            <FlowStep tone="assigned" icon={UserCheck2} label={t("Assigned")} sub={t("waiting for this stop")} />
            <FlowArrow label={t("scan / manual check-in")} />
            <FlowStep tone="present" icon={LogIn} label={t("Arrived")} sub={t("checked in for THIS stop")} />
          </FlowRow>
          <FlowRow style={{ marginTop: 10 }}>
            <FlowStep tone="assigned" icon={UserCheck2} label={t("Assigned")} sub={t("waiting for this stop")} />
            <FlowArrow label={t("stop's cutoff passes, no scan")} tone="late" />
            <FlowStep tone="late" icon={Clock} label={t("Late")} sub={t("for THIS stop only")} />
          </FlowRow>
          <div className="row" style={{ gap: 8, alignItems: "center", marginTop: 14, flexWrap: "wrap" }}>
            <FlowStep tone="present" icon={LogIn} label={t("Arrived")} small />
            <span className="muted" style={{ fontSize: 12 }}>{t("or")}</span>
            <FlowStep tone="late" icon={Clock} label={t("Late")} small />
            <ArrowRight size={14} color="var(--ink-3)" />
            <RotateCcw size={14} color="var(--ink-3)" />
            <span className="muted" style={{ fontSize: 12.5 }}>
              {t("resets to")} <b style={{ color: "var(--st-assigned)" }}>{t("Assigned")}</b> {t("within the trip's reset window (default 5 min) before the NEXT stop starts — so they can be freshly scanned in again")}
            </span>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            {t("Safety rail: a delegate who's already scanned in early for the upcoming stop is never bounced back — only ones with no check-in yet for it get reset.")}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Tip icon={QrCode} title={t("Every scan/edit is per-stop")}>
            {t("Whichever stop is currently \"live\" (based on wall-clock time vs. the itinerary) is what a scan or manual check-in gets recorded against. The Dashboard's \"Now: ...\" chip always shows which one that is.")}
          </Tip>
          <Tip icon={Clock} title={t("Reset window is per-trip, adjustable")}>
            {t("Settings → \"Checkpoint reset window\" lets an admin dial this from 1–120 minutes per trip — shorter for testing, longer (e.g. 30 min) for a real trip.")}
          </Tip>
          <Tip icon={History} title={t("Checkpoint timeline")}>
            {t("A delegate's profile shows their full cross-checkpoint history — every stop, every day, newest first — separate from their single current status shown everywhere else.")}
          </Tip>
        </div>
      </div>
    </>
  );
}
