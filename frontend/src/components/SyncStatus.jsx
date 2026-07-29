/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — offline write queue (UI half of lib/outbox.js)
 * ============================================================================= */
import { useEffect, useState } from "react";
import { CloudOff, RefreshCw, AlertTriangle, X } from "lucide-react";
import { subscribe, snapshot, flush, start, failed, clearFailed } from "../lib/outbox.js";
import { useLang } from "../lib/i18n.jsx";

/**
 * The "you're offline / N changes waiting to sync" pill (2026-07-28).
 *
 * Mounted once from Layout.jsx so it's present on every route — losing signal
 * isn't page-specific. Deliberately bottom-LEFT: the chat bubble owns
 * bottom-right.
 *
 * Three states, in priority order:
 *   1. Something was REJECTED by the server (not a connection problem) — needs
 *      a human to know, because retrying won't fix it.
 *   2. Writes are queued — shows the count and a manual "Sync now".
 *   3. Offline but nothing queued — a quiet reminder that QR/face scan won't
 *      work right now and manual check-in is the way through. This is the
 *      "honest messaging" half of the requirement: staff shouldn't be left
 *      watching a scanner spinner that can never succeed.
 * When online with an empty queue it renders nothing at all.
 */
/* The mobile scanner keeps its OWN offline queue of face/QR scans, under its own
 * localStorage key, and only replays it while a scanner screen is mounted (see
 * MobileScannerPage's online listener). That means scans captured in a dead zone
 * are invisible — and unsent — as soon as you navigate to Home or Ops. This pill
 * is global, so it reports that count too (2026-07-29). It can't flush them from
 * here without lifting his replay logic out of the page, so it says where to go
 * instead of offering a button that wouldn't work. */
const SCAN_QUEUE_KEY = "musterGo.offlineScans";
function queuedScanCount() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(SCAN_QUEUE_KEY) : null;
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0; // unreadable/corrupt — treat as empty rather than breaking the pill
  }
}

export default function SyncStatus() {
  const { t } = useLang();
  const [s, setS] = useState(() => snapshot());
  const [showFailed, setShowFailed] = useState(false);
  const [scans, setScans] = useState(queuedScanCount);

  useEffect(() => {
    start();                       // idempotent: attaches online/offline + retry timer
    const unsub = subscribe(setS);
    // The scanner's queue isn't observable, so poll it — cheap (one localStorage
    // read) and only needs to be roughly live.
    const id = setInterval(() => setScans(queuedScanCount()), 3000);
    const onStorage = (e) => { if (e.key === SCAN_QUEUE_KEY) setScans(queuedScanCount()); };
    window.addEventListener("storage", onStorage);
    return () => { unsub(); clearInterval(id); window.removeEventListener("storage", onStorage); };
  }, []);

  const hasFailed = s.failed > 0;
  const hasPending = s.pending > 0;
  const hasScans = scans > 0;
  // Unsent scans keep the pill up too — they're just as lost-looking as a queued
  // check-in if nothing on screen mentions them.
  if (!hasFailed && !hasPending && !hasScans && s.online) return null;

  const tone = hasFailed
    ? { bg: "var(--st-missing-bg)", fg: "var(--st-missing)", bd: "var(--st-missing)" }
    : hasPending || hasScans
      ? { bg: "var(--st-unassigned-bg)", fg: "var(--st-unassigned)", bd: "var(--st-unassigned)" }
      : { bg: "var(--surface-2)", fg: "var(--ink-2)", bd: "var(--line)" };

  return (
    <>
      <div className="mg-sync-pill" style={{ ...S.pill, background: tone.bg, color: tone.fg, borderColor: tone.bd }}>
        {hasFailed ? <AlertTriangle size={15} style={{ flexShrink: 0 }} />
          : hasPending ? <RefreshCw size={15} className={s.flushing ? "mg-sync-spin" : undefined} style={{ flexShrink: 0 }} />
            : <CloudOff size={15} style={{ flexShrink: 0 }} />}

        <span style={{ fontWeight: 600 }}>
          {hasFailed
            ? `${s.failed} ${s.failed === 1 ? t("change was rejected") : t("changes were rejected")}`
            : hasPending
              ? (s.flushing
                  ? t("Syncing…")
                  : `${s.pending} ${s.pending === 1 ? t("change waiting to sync") : t("changes waiting to sync")}`)
              : hasScans
                // Only reachable when the check-in queue is empty but scans
                // aren't — say where to sync them, since this pill can't.
                ? `${scans} ${scans === 1 ? t("scan waiting") : t("scans waiting")} — ${t("open a scanner to sync")}`
                : t("Offline — scanning unavailable, use manual check-in")}
          {hasPending && hasScans && (
            <span style={{ fontWeight: 400, opacity: 0.85 }}> {`+ ${scans} ${scans === 1 ? t("scan") : t("scans")}`}</span>
          )}
        </span>

        {hasFailed && (
          <button style={S.link} onClick={() => setShowFailed(true)}>{t("Details")}</button>
        )}
        {!hasFailed && hasPending && s.online && !s.flushing && (
          <button style={S.link} onClick={() => flush()}>{t("Sync now")}</button>
        )}
      </div>

      {showFailed && (
        <div style={S.backdrop} onClick={() => setShowFailed(false)}>
          <div className="card" style={S.modal} onClick={(e) => e.stopPropagation()}>
            <div className="row between" style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
              <strong style={{ fontSize: 14 }}>{t("Changes the server rejected")}</strong>
              <span role="button" onClick={() => setShowFailed(false)} style={{ cursor: "pointer", color: "var(--ink-3)", display: "flex" }}><X size={18} /></span>
            </div>
            <div style={{ padding: 16, maxHeight: 320, overflowY: "auto" }}>
              <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
                {t("These were taken offline but the server refused them — retrying won't help, so please redo them manually if they still apply.")}
              </p>
              {failed().map((f) => (
                <div key={f.id} style={{ padding: "8px 0", borderTop: "1px solid var(--line)", fontSize: 13 }}>
                  <div style={{ fontWeight: 600 }}>{f.meta?.label || f.meta?.delegateId || f.kind}</div>
                  <div className="muted" style={{ fontSize: 11.5 }}>
                    {new Date(f.queuedAt).toLocaleString()} — {f.lastError}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ padding: 12, borderTop: "1px solid var(--line)" }}>
              <button className="btn btn-ghost btn-block" onClick={() => { clearFailed(); setShowFailed(false); }}>
                {t("Dismiss all")}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .mg-sync-spin{animation:mg-sync-rot 0.9s linear infinite}
        @keyframes mg-sync-rot{to{transform:rotate(360deg)}}
        /* On phones the floating tab bar owns the bottom of the screen
           (.mobile-tabbar: fixed, ~62px tall + safe-area inset), so lift the
           pill clear of it and let it span the width instead of hugging the
           left edge. */
        @media (max-width: 640px) {
          .mg-sync-pill {
            left: 12px; right: 12px;
            bottom: calc(88px + env(safe-area-inset-bottom, 0px)) !important;
            justify-content: center;
          }
        }
      `}</style>
    </>
  );
}

const S = {
  pill: {
    position: "fixed", bottom: 24, left: 24, zIndex: 56,
    display: "inline-flex", alignItems: "center", gap: 8,
    padding: "9px 14px", borderRadius: 999, fontSize: 12.5,
    border: "1px solid", boxShadow: "var(--shadow-lg)", maxWidth: "min(92vw, 420px)",
  },
  link: {
    background: "none", border: "none", cursor: "pointer", padding: 0,
    font: "inherit", fontWeight: 700, textDecoration: "underline", color: "inherit", flexShrink: 0,
  },
  backdrop: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", zIndex: 70,
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  modal: { padding: 0, width: 420, maxWidth: "92%", overflow: "hidden" },
};
