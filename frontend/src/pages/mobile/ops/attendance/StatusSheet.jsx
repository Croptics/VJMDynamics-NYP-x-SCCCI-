/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — mobile Attendance's status-update bottom sheet
 *
 *  Extracted from MobileAttendancePage.jsx (2026-08-02 modularization pass).
 * ============================================================================= */
import { useState, useRef } from "react";
import { X, LocateFixed, CheckCircle2 } from "lucide-react";
import { getCurrentLocationString, geolocationErrorMessage } from "../../../../lib/dashboard/geolocation.js";
import { effectiveStatus } from "../../../../lib/dashboard/delegateStatus.js";
import DelegateLocationMap from "../../../../components/delegate/DelegateLocationMap.jsx";

export const STATUS_OPTIONS = ["ASSIGNED", "MISSING"];

/** Bottom-sheet status picker — the "clear status update" interface, opened
 *  by the per-row "Update status" button. Three big obvious buttons instead
 *  of a cramped inline <select>, same "one clear action per row" spirit as
 *  Manual check-in's own "Mark present" button. */
export function StatusSheet({ delegate, onPick, onClose, t }) {
  const FILTER_LABEL = { UNASSIGNED: "Unassigned", ASSIGNED: "Assigned", ARRIVED: "Arrived", LATE: "Late", MISSING: "Missing" };
  const current = effectiveStatus(delegate);
  // Picking MISSING doesn't save immediately — it switches this sheet to a
  // second step asking for a last known location first (mirrors
  // DashboardPage.jsx's Edit modal, which has always required this on
  // desktop; mobile previously let you mark someone Missing with nothing to
  // actually go find them by). Any other status still saves on tap, same as
  // before.
  const [askingLocation, setAskingLocation] = useState(false);
  const [location, setLocation] = useState(delegate.lastLocation || "");
  // "Use my current location" (2026-07-24) — reads the STAFF device's own
  // GPS as a stand-in for "where I am right now", since this app has no
  // delegate-side live tracking. locating tri-state so the button can show
  // a spinner without a separate loading flag.
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState(null);
  async function useMyLocation() {
    setLocating(true);
    setLocateError(null);
    try {
      const loc = await getCurrentLocationString();
      setLocation(loc);
    } catch (err) {
      setLocateError(geolocationErrorMessage(err));
    } finally {
      setLocating(false);
    }
  }
  // Same second-step pattern as askingLocation/MISSING above, for
  // "Cancelled" — a dedicated field action for "this person isn't coming
  // after all, here's why" (2026-07-24). See changeStatus() in the parent
  // for what actually gets sent (cancelled + cancelReason, not a status).
  const [askingCancelReason, setAskingCancelReason] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  // Only dismiss if the WHOLE click gesture started on the backdrop itself,
  // not wherever the mouse was released after dragging to select text in the
  // "Last known location" field.
  const downOnBackdrop = useRef(false);

  function pick(status) {
    if (status === "MISSING") { setAskingLocation(true); return; }
    if (status === "CANCELLED") { setAskingCancelReason(true); return; }
    onPick(status);
  }

  if (askingLocation) {
    const trimmed = location.trim();
    return (
      <div
        style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,0.45)", display: "flex", alignItems: "flex-end", zIndex: 60 }}
        onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
        onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) onClose(); }}
      >
        <div
          className="card"
          style={{ width: "100%", borderRadius: "16px 16px 0 0", padding: 18, paddingBottom: 28 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="row between" style={{ marginBottom: 4 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{t("Last known location")}</div>
              <div className="muted" style={{ fontSize: 12.5 }}>{delegate.name}</div>
            </div>
            <button onClick={onClose} aria-label={t("Close")} style={{ background: "none", border: "none", color: "var(--ink-3)", display: "flex", padding: 4 }}>
              <X size={18} />
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
            {t("Required before marking a delegate Missing, so they can actually be found.")}
          </p>
          <input
            autoFocus
            className="input"
            style={{ marginTop: 10 }}
            placeholder={t("e.g. Novotel Beijing Sanyuan, Lobby")}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-ghost"
            style={{ marginTop: 8, width: "100%" }}
            onClick={useMyLocation}
            disabled={locating}
          >
            <LocateFixed size={15} /> {locating ? t("Locating…") : t("Use my current location")}
          </button>
          {locateError && (
            <div className="muted" style={{ fontSize: 12, color: "var(--st-missing)", marginTop: 6 }}>{t(locateError)}</div>
          )}
          {trimmed && (
            <div style={{ marginTop: 10 }}>
              <DelegateLocationMap location={trimmed} height={140} />
            </div>
          )}
          <div className="row" style={{ gap: 10, marginTop: 16 }}>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setAskingLocation(false)}>
              {t("Back")}
            </button>
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={!trimmed}
              onClick={() => onPick("MISSING", trimmed)}
            >
              {t("Confirm")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (askingCancelReason) {
    return (
      <div
        style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,0.45)", display: "flex", alignItems: "flex-end", zIndex: 60 }}
        onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
        onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) onClose(); }}
      >
        <div
          className="card"
          style={{ width: "100%", borderRadius: "16px 16px 0 0", padding: 18, paddingBottom: 28 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="row between" style={{ marginBottom: 4 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{t("Mark as cancelled")}</div>
              <div className="muted" style={{ fontSize: 12.5 }}>{delegate.name}</div>
            </div>
            <button onClick={onClose} aria-label={t("Close")} style={{ background: "none", border: "none", color: "var(--ink-3)", display: "flex", padding: 4 }}>
              <X size={18} />
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
            {t("Unassigns them and frees their coach seat.")}
          </p>
          <label className="field-label" style={{ marginTop: 10 }}>{t("What happened?")}</label>
          <textarea
            autoFocus
            className="input"
            rows={3}
            style={{ marginTop: 6, resize: "vertical", fontFamily: "inherit" }}
            placeholder={t("e.g. Flight cancelled, called in sick, no longer travelling with the group…")}
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
          />
          <div className="row" style={{ gap: 10, marginTop: 16 }}>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setAskingCancelReason(false)}>
              {t("Back")}
            </button>
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              onClick={() => onPick("CANCELLED", cancelReason)}
            >
              {t("Confirm")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,0.45)", display: "flex", alignItems: "flex-end", zIndex: 60 }}
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="card"
        style={{ width: "100%", borderRadius: "16px 16px 0 0", padding: 18, paddingBottom: 28 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row between" style={{ marginBottom: 4 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{t("Update status")}</div>
            <div className="muted" style={{ fontSize: 12.5 }}>{delegate.name}</div>
          </div>
          <button onClick={onClose} aria-label={t("Close")} style={{ background: "none", border: "none", color: "var(--ink-3)", display: "flex", padding: 4 }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
          {STATUS_OPTIONS.map((status) => {
            const active = current === status;
            return (
              <button
                key={status}
                onClick={() => pick(status)}
                className="row between"
                style={{
                  padding: "12px 14px", borderRadius: "var(--r-md)", fontSize: 14, fontWeight: 600,
                  border: `1.5px solid ${active ? "var(--scc-red)" : "var(--line)"}`,
                  background: active ? "var(--scc-red-tint)" : "var(--surface)",
                  color: active ? "var(--scc-red-700)" : "var(--ink)",
                }}
              >
                {t(FILTER_LABEL[status])}
                {active && <CheckCircle2 size={16} />}
              </button>
            );
          })}
        </div>

        {/* Visually separated from the 4 operational statuses above — this
            isn't one of them, it's a distinct "drop out" action (2026-07-24,
            "need to have to be able to change the delegate status to
            unassigned, add a textfield that let staff put what happen"). */}
        <div style={{ borderTop: "1px solid var(--line)", marginTop: 14, paddingTop: 10 }}>
          <button
            onClick={() => pick("CANCELLED")}
            className="row between"
            style={{
              width: "100%", padding: "12px 14px", borderRadius: "var(--r-md)", fontSize: 14, fontWeight: 600,
              border: "1.5px solid var(--line)", background: "var(--surface)", color: "var(--ink-2)",
            }}
          >
            {t("Mark as cancelled")}
          </button>
        </div>
      </div>
    </div>
  );
}
