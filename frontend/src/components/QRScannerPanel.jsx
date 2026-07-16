/* =============================================================================
 *  OWNED BY:  Jayden — Exception Logging, Critical Alerts & QR check-in
 *
 *  A SELF-CONTAINED live QR scanner, dropped into the "QR" slot of the shared
 *  check-in screen (QRCheckInPage.jsx). It is deliberately isolated:
 *
 *   - It opens and closes its OWN camera stream, and is only ever mounted while
 *     scanMode === "qr", so it never runs at the same time as Vimal's face
 *     camera. Nothing in his face / voice / low-light pipeline is touched.
 *   - It decodes with jsQR on an off-DOM canvas (no frame is persisted).
 *   - A scanned badge is registered through Vance's boarding-pass endpoint
 *     (POST /api/onboarding/checkin via qrCheckin()); the delegate flips to
 *     PRESENT so JQ's dashboard head-count and the reverse-headcount agree.
 *   - Styling uses ONLY tokens.css variables; the one <style> block is
 *     namespaced `jayden-*` so it can't collide with Vimal's `vimal-*` rules.
 *
 *  BADGE FORMAT: originally this scanner expected its own JSON payload
 *  ({"sys":"MUSTERGO","typ":"DELEGATE_BADGE","delegateId":"d-1",…}), but
 *  nothing in the app actually printed that shape — the only real badge
 *  source is Vance's "Boarding passes" tab (OnboardingPage.jsx), which
 *  encodes the delegate's plain `qr_code` string (e.g. "MG-86B620A4") from
 *  the shared `delegates` table. Rather than keep two incompatible QR
 *  systems, this scanner now reads that same plain code and resolves it the
 *  same way ScanToBoardView.jsx does — see QR_BADGE_MISMATCH.md for the
 *  history of why this changed. The old JSON badge / qr-test-codes/ images
 *  no longer scan successfully; re-print/re-share badges from "Boarding
 *  passes" instead.
 * ============================================================================= */

import { useEffect, useRef, useState, useCallback } from "react";
import jsQR from "jsqr";
import { QrCode, CheckCircle2, AlertTriangle, Keyboard, RotateCcw } from "lucide-react";
import { qrCheckin } from "../lib/claudeParse.js";

const RESULT_MS = 3200;          // how long a result card stays up
const RESCAN_COOLDOWN_MS = 3500; // ignore the same code re-appearing this soon
const SCAN_INTERVAL_MS = 200;    // decode cadence

/* A "badge" is just the delegate's plain qr_code string (see the file banner
 * above) — trimmed and non-empty is the only client-side shape check;
 * whether it actually matches a delegate is resolved server-side. Kept as a
 * named export (not inlined) so it stays independently testable like before. */
export function parseBadge(raw) {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false };
  return { ok: true, code: raw.trim() };
}

/* Short confirmation / error tone via Web Audio — mirrors the scanner's audio
 * feedback without importing any of Vimal's helpers. */
function playTone(ok) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = ok ? "sine" : "square";
    osc.frequency.value = ok ? 880 : 220;
    gain.gain.value = 0.12;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.16 : 0.4));
    osc.onended = () => ctx.close();
  } catch { /* no audio device — the on-screen card still shows */ }
}

const JAYDEN_CSS = `
@keyframes jayden-scan { 0% { top: 12%; } 50% { top: 84%; } 100% { top: 12%; } }
.jayden-scan {
  position: absolute; left: 12%; right: 12%; height: 2px;
  background: var(--st-present); opacity: .9; border-radius: 2px;
  box-shadow: 0 0 12px var(--st-present);
  animation: jayden-scan 1.8s ease-in-out infinite;
}
.jayden-corner { position: absolute; width: 30px; height: 30px; border: 3px solid var(--surface); opacity: .92; }
.jayden-corner.tl { top: 14px; left: 14px; border-right: none; border-bottom: none; border-radius: 10px 0 0 0; }
.jayden-corner.tr { top: 14px; right: 14px; border-left: none; border-bottom: none; border-radius: 0 10px 0 0; }
.jayden-corner.bl { bottom: 14px; left: 14px; border-right: none; border-top: none; border-radius: 0 0 0 10px; }
.jayden-corner.br { bottom: 14px; right: 14px; border-left: none; border-top: none; border-radius: 0 0 10px 0; }
@keyframes jayden-pop { from { transform: scale(.92); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.jayden-pop { animation: jayden-pop .18s ease-out; }
@media (prefers-reduced-motion: reduce) {
  .jayden-scan { animation: none; top: 48%; }
  .jayden-pop { animation: none; }
}
`;

export default function QRScannerPanel({ tripId, coachId, coachLabel, onCheckedIn }) {
  const [camState, setCamState] = useState("starting"); // starting | live | error
  const [result, setResult] = useState(null);           // { kind, title, sub }
  const [submitting, setSubmitting] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manualText, setManualText] = useState("");

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  const loopRef = useRef(null);
  const resultTimerRef = useRef(null);
  const lastScanRef = useRef({ value: "", at: 0 });
  const busyRef = useRef(false); // guards against overlapping submits

  const clearResultSoon = useCallback(() => {
    clearTimeout(resultTimerRef.current);
    resultTimerRef.current = setTimeout(() => setResult(null), RESULT_MS);
  }, []);

  /* Register a scanned/typed code, or surface a clear failure. */
  const register = useCallback(async (badge) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setSubmitting(true);
    try {
      const res = await qrCheckin({ code: badge.code, tripId, coachId });
      playTone(true);
      setResult({
        kind: "success",
        title: "Attendance registered",
        sub: `${res.delegate?.name || badge.code}${res.alreadyBoarded ? " · already checked in" : " · marked present"}`,
      });
      onCheckedIn?.();
    } catch (e) {
      playTone(false);
      // Log the exact bytes jsQR handed us — invaluable if a real badge is
      // ever mis-scanned (partial read, wrong QR, stale/reprinted code, etc.).
      console.debug("[QRScannerPanel] rejected scan:", JSON.stringify(badge.code));
      const msg =
        e.status === 404 ? "That badge isn't recognised. Make sure it's from the Boarding passes tab."
        : e.status === 401 ? "Session expired — sign in again."
        : e.message || "Check-in failed — retry, or use Manual.";
      setResult({ kind: "error", title: "QR code invalid", sub: msg });
    } finally {
      setSubmitting(false);
      busyRef.current = false;
      clearResultSoon();
    }
  }, [tripId, coachId, onCheckedIn, clearResultSoon]);

  /* Route any decoded / typed string through validation. */
  const handleDecoded = useCallback((raw) => {
    const now = Date.now();
    if (raw === lastScanRef.current.value && now - lastScanRef.current.at < RESCAN_COOLDOWN_MS) return;
    lastScanRef.current = { value: raw, at: now };

    const badge = parseBadge(raw);
    if (!badge.ok) return; // empty scan noise — nothing worth showing an error for
    register(badge);
  }, [register]);

  /* Camera + decode loop. Runs only while this component is mounted (i.e. only
   * in QR mode), and fully tears down on unmount. */
  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } }, audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setCamState("live");
        tick();
      } catch {
        if (!cancelled) { setCamState("error"); setShowManual(true); }
      }
    }

    function tick() {
      loopRef.current = setInterval(() => {
        if (busyRef.current || result) return; // pause while a result card is up
        const video = videoRef.current;
        if (!video || !video.videoWidth) return;
        const canvas = canvasRef.current || (canvasRef.current = document.createElement("canvas"));
        const w = (canvas.width = video.videoWidth);
        const h = (canvas.height = video.videoHeight);
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(video, 0, 0, w, h);
        const img = ctx.getImageData(0, 0, w, h);
        const code = jsQR(img.data, w, h, { inversionAttempts: "attemptBoth" });
        if (code && code.data) handleDecoded(code.data);
      }, SCAN_INTERVAL_MS);
    }

    start();
    return () => {
      cancelled = true;
      clearInterval(loopRef.current);
      clearTimeout(resultTimerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleDecoded]);

  const submitManual = () => {
    const v = manualText.trim();
    if (!v) return;
    handleDecoded(v);
    setManualText("");
    setShowManual(false);
  };

  const S = {
    root: { position: "absolute", inset: 0, overflow: "hidden", borderRadius: "inherit" },
    video: { width: "100%", height: "100%", objectFit: "cover" },
    hint: {
      position: "absolute", left: 0, right: 0, bottom: 0, padding: "26px 14px 14px",
      background: "linear-gradient(transparent, rgba(0,0,0,.62))",
      color: "var(--surface)", fontSize: 12.5, textAlign: "center",
    },
    topTag: {
      position: "absolute", top: 12, left: 12, display: "inline-flex", alignItems: "center",
      gap: 6, background: "rgba(0,0,0,.45)", color: "var(--surface)", fontSize: 12,
      fontWeight: 600, padding: "5px 10px", borderRadius: 999,
    },
    iconBtn: {
      position: "absolute", top: 10, right: 10, background: "rgba(0,0,0,.45)",
      border: "none", color: "var(--surface)", borderRadius: 999, padding: 8,
      display: "inline-flex",
    },
    center: {
      position: "absolute", inset: 0, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 10, padding: 18, textAlign: "center",
    },
    manualWrap: {
      position: "absolute", left: 12, right: 12, bottom: 12,
      background: "var(--surface)", borderRadius: "var(--r-md)", padding: 12,
      boxShadow: "var(--shadow-lg)",
    },
  };

  const resultCard = result && (
    <div style={S.center}>
      <div
        className="card jayden-pop"
        style={{ padding: "16px 18px", maxWidth: 300, borderTop: `4px solid ${result.kind === "success" ? "var(--st-present)" : "var(--st-missing)"}` }}
      >
        <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
          {result.kind === "success"
            ? <CheckCircle2 size={30} style={{ color: "var(--st-present)", flexShrink: 0 }} />
            : <AlertTriangle size={30} style={{ color: "var(--st-missing)", flexShrink: 0 }} />}
          <div style={{ textAlign: "left" }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: "var(--ink)" }}>{result.title}</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{result.sub}</div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div style={S.root}>
      <style>{JAYDEN_CSS}</style>

      {/* Live camera view + framing reticle */}
      {camState !== "error" && (
        <>
          <video ref={videoRef} autoPlay playsInline muted style={S.video} />
          <span className="jayden-corner tl" /><span className="jayden-corner tr" />
          <span className="jayden-corner bl" /><span className="jayden-corner br" />
          {camState === "live" && !result && <span className="jayden-scan" />}

          <span style={S.topTag}><QrCode size={13} /> QR check-in</span>
          <button type="button" style={S.iconBtn} title="Enter code manually"
                  onClick={() => setShowManual((s) => !s)}>
            <Keyboard size={16} />
          </button>

          {!result && !showManual && (
            <div style={S.hint}>
              {camState === "starting"
                ? "Starting camera…"
                : submitting
                  ? "Checking in…"
                  : "Hold a delegate badge inside the frame"}
            </div>
          )}
        </>
      )}

      {/* Camera unavailable → manual entry is the fallback path */}
      {camState === "error" && (
        <div style={{ ...S.center, background: "var(--ink)" }}>
          <QrCode size={40} style={{ color: "var(--line)" }} />
          <div style={{ fontWeight: 700, color: "var(--surface)" }}>Camera unavailable</div>
          <div style={{ fontSize: 12.5, color: "var(--line)", maxWidth: 240 }}>
            Allow camera access to scan, or paste the badge contents below to check a delegate in.
          </div>
        </div>
      )}

      {/* Manual entry (also handy on a laptop with no webcam during a demo) */}
      {(showManual || camState === "error") && !result && (
        <div style={S.manualWrap}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Enter badge contents</div>
          <input
            className="input" autoFocus value={manualText}
            placeholder="e.g. MG-86B620A4"
            onChange={(e) => setManualText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitManual(); }}
          />
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={submitManual} disabled={!manualText.trim() || submitting}>
              Check in
            </button>
            {camState !== "error" && (
              <button className="btn btn-ghost" onClick={() => setShowManual(false)}>Cancel</button>
            )}
          </div>
        </div>
      )}

      {/* Result card (success / invalid / failure) with a manual re-scan escape */}
      {resultCard}
      {result && (
        <button
          className="btn btn-ghost jayden-pop"
          style={{ position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)", background: "var(--surface)" }}
          onClick={() => setResult(null)}
        >
          <RotateCcw size={14} /> Scan next
        </button>
      )}
    </div>
  );
}
