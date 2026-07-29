/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — Admin Dashboard, Auth, Accounts & Permissions
 * ============================================================================= */
/**
 * Delegate Timeline — the chronological, cross-checkpoint history for ONE
 * delegate (GET /delegates/:id/checkpoint-timeline). Presentational only, no
 * chrome of its own (no modal overlay, no close button) so it can be dropped
 * into a desktop modal (DashboardPage.jsx) and a mobile bottom sheet
 * (MobileAttendancePage.jsx) with each page's own surrounding chrome.
 *
 * Shows every checkpoint check-in across every day, newest first — separate
 * from and additive to the delegate's single live `status` shown everywhere
 * else in the app.
 */
import { useEffect, useState } from "react";
import { Clock, ScanFace, QrCode, PencilLine, Mic } from "lucide-react";
import { apiGet } from "../lib/api.js";
import { useLang } from "../lib/i18n.jsx";

const METHOD_ICON = { FACE: ScanFace, QR: QrCode, VOICE: Mic, MANUAL: PencilLine };
const STATUS_TONE = { ARRIVED: "present", LATE: "late", MISSING: "missing" };
// checkpoint_checkins.status is stored uppercase (ARRIVED/LATE/MISSING) to
// match the DB enum, but i18n.jsx's dictionary keys are Title Case (same
// convention as every other status label in the app) — map before t().
const STATUS_LABEL = { ARRIVED: "Arrived", LATE: "Late", MISSING: "Missing" };

/**
 * `defaultVisible` (optional, 2026-07-25) — when set, only this many entries
 * show initially, with a "Show N more" button to reveal the rest — for a
 * context like mobile's delegate detail sheet where the timeline is one of
 * several sections and a long history shouldn't push everything else below
 * it off-screen. Omit it (as the desktop profile panel still does) for the
 * original "always show everything" behaviour.
 */
export default function DelegateTimeline({ delegateId, defaultVisible }) {
  const { t } = useLang();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError("");
    setExpanded(false);
    apiGet(`/delegates/${delegateId}/checkpoint-timeline`)
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setError(e.message || "Could not load timeline."); });
    return () => { alive = false; };
  }, [delegateId]);

  if (error) {
    return <div className="muted" style={{ fontSize: 13, padding: "12px 0", color: "var(--st-missing)" }}>{t(error)}</div>;
  }
  if (!data) {
    return <div className="muted" style={{ fontSize: 13, padding: "12px 0" }}>{t("Loading…")}</div>;
  }
  if (data.timeline.length === 0) {
    return (
      <div className="muted" style={{ fontSize: 13, padding: "12px 0" }}>
        {t("No checkpoint scans recorded for this delegate yet.")}
      </div>
    );
  }

  const showLimit = defaultVisible && !expanded ? defaultVisible : data.timeline.length;
  const visible = data.timeline.slice(0, showLimit);
  const remaining = data.timeline.length - visible.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {visible.map((entry) => {
        const Icon = METHOD_ICON[entry.method] || Clock;
        const tone = STATUS_TONE[entry.status] || "neutral";
        return (
          <div
            key={entry.id}
            className="row"
            style={{ gap: 10, alignItems: "flex-start", padding: "10px 12px", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}
          >
            <span style={{
              width: 30, height: 30, borderRadius: "50%", flexShrink: 0, display: "flex",
              alignItems: "center", justifyContent: "center",
              background: `var(--st-${tone}-bg)`, color: `var(--st-${tone})`,
            }}>
              <Icon size={15} />
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="row between" style={{ gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 13.5 }}>
                  {t("Day")} {entry.dayNumber}{entry.scheduledTime ? ` · ${entry.scheduledTime}` : ""} · {entry.checkpointLabel}
                </span>
                <span className={`badge badge-${tone}`} style={{ flexShrink: 0 }}>{t(STATUS_LABEL[entry.status] || entry.status)}</span>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                {new Date(entry.updatedAt).toLocaleString()} · {t("by")} {entry.scannedBy || t("system")}
              </div>
            </div>
          </div>
        );
      })}
      {remaining > 0 && (
        <button className="btn btn-ghost" style={{ alignSelf: "flex-start", fontSize: 12.5 }} onClick={() => setExpanded(true)}>
          {t("Show")} {remaining} {t("more")}
        </button>
      )}
    </div>
  );
}
