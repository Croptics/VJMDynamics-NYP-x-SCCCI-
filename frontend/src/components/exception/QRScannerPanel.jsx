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
 *  systems, this scanner now reads that same plain code and resolves it via
 *  qrCheckin() → POST /api/onboarding/checkin — see QR_BADGE_MISMATCH.md for
 *  the history of why this changed. The old JSON badge / qr-test-codes/
 *  images no longer scan successfully; re-print/re-share badges from
 *  "Boarding passes" instead.
 * ============================================================================= */

import { useEffect, useRef, useState, useCallback } from "react";
import jsQR from "jsqr";
import { QrCode, CheckCircle2, AlertTriangle, Keyboard, RotateCcw } from "lucide-react";
import { qrCheckin } from "../../lib/document/claudeParse.js";

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
/* Tap-to-focus ring — pops in at the tap point and shrinks/fades, same
   affordance a native phone camera app gives on tap. Pure visual feedback:
   shown on every tap regardless of whether the hardware actually supports a
   refocus constraint (see handleTapFocus's doc comment). */
@keyframes jayden-focus-ring {
  0%   { transform: translate(-50%, -50%) scale(1.3); opacity: 0; }
  15%  { opacity: 1; }
  100% { transform: translate(-50%, -50%) scale(1); opacity: 0; }
}
.jayden-focus-ring {
  position: absolute; width: 62px; height: 62px; border-radius: 50%;
  border: 2px solid var(--st-present); pointer-events: none; z-index: 2;
  animation: jayden-focus-ring .7s ease-out forwards;
}
@media (prefers-reduced-motion: reduce) {
  .jayden-scan { animation: none; top: 48%; }
  .jayden-pop { animation: none; }
  .jayden-focus-ring { animation: none; opacity: 0; }
}
`;

/**
 * `manualOpen` / `onManualOpenChange` are OPTIONAL controlled-mode props (JQ,
 * 2026-07-29). Pass them and the caller owns the manual-entry toggle, and this
 * panel stops drawing its own keyboard icon over the video — used by
 * MobileScannerPage, which renders a labelled "Enter code manually" button
 * BELOW the viewport instead. Reason: manual entry isn't a camera control, it's
 * the fallback staff reach for when a code won't scan (often under time
 * pressure), so it needs to be a findable labelled action rather than a 32px
 * glass icon competing with the scan-guide corners. This panel is
 * `position: absolute; inset: 0` inside its viewport box, so it physically
 * cannot render anything below it — hence lifting the control to the parent.
 *
 * Omit both props and nothing changes: the panel keeps its own state and its
 * in-video icon, which is what the desktop UnifiedScannerPage still uses.
 */
export default function QRScannerPanel({ tripId, coachId, coachLabel, onCheckedIn, facingMode = "environment", manualOpen, onManualOpenChange }) {
  const [camState, setCamState] = useState("starting"); // starting | live | error
  const [result, setResult] = useState(null);           // { kind, title, sub }
  const [submitting, setSubmitting] = useState(false);
  // Tap-to-focus, same gesture as a native phone camera app (2026-07-30 —
  // "not able to focus and scan qr code... give me to tap on the scanner and
  // it focus on that spot"). `focusSupported` is feature-detected once the
  // stream is live (most webcams are fixed-focus and expose neither
  // pointsOfInterest nor a settable focusDistance — the tap ring still shows
  // for feedback either way, it's the actual hardware refocus that's
  // conditional). `focusRing` is purely the visual feedback: a ring that
  // pops in at the tap point and fades, regardless of whether the
  // constraint call itself is supported — a tap should always feel like it
  // did something, the same way it does on a real camera app.
  const [focusSupported, setFocusSupported] = useState(false);
  const [focusRing, setFocusRing] = useState(null); // { x, y } in CSS px, or null
  const focusRingTimerRef = useRef(null);
  const manualControlled = manualOpen !== undefined;
  const [showManualInternal, setShowManualInternal] = useState(false);
  const showManual = manualControlled ? manualOpen : showManualInternal;
  /* An explicit setter, NOT a bare toggle: this panel needs to FORCE manual
     open when the camera fails, and a toggle would close it if the parent
     already had it open (or fire off a stale captured value from inside the
     camera effect). `setManual(true)` means true in both modes. */
  const setManual = (next) => (manualControlled ? onManualOpenChange?.(next) : setShowManualInternal(next));
  const toggleManual = () => setManual(!showManual);
  const [manualText, setManualText] = useState("");

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  const zoomCanvasRef = useRef(null); // digital-zoom decode fallback — see tick()
  const loopRef = useRef(null);
  const resultTimerRef = useRef(null);
  const lastScanRef = useRef({ value: "", at: 0 });
  const busyRef = useRef(false); // guards against overlapping submits
  // Read via a ref so `register` below doesn't need to depend on THIS
  // identity being stable — see the note at register's deps for why that
  // matters (2026-07-29, "cancel button doesn't work" root cause).
  const onCheckedInRef = useRef(onCheckedIn);
  onCheckedInRef.current = onCheckedIn;

  const clearResultSoon = useCallback(() => {
    clearTimeout(resultTimerRef.current);
    resultTimerRef.current = setTimeout(() => setResult(null), RESULT_MS);
  }, []);

  /* Register a scanned/typed code, or surface a clear failure.
   *
   * `onCheckedIn` deliberately does NOT appear in this callback's deps
   * (2026-07-29 fix — "cancel button doesn't work"). Both callers
   * (MobileScannerPage, UnifiedScannerPage) pass it as an inline arrow
   * function, `() => { fetchCoaches(); fetchCoach(coachId); }` — a NEW
   * function every render. Every render of the PARENT, not just a scan: both
   * pages run a background poll (setInterval) while this panel is mounted,
   * so the parent — and this prop — churns every few seconds regardless of
   * anything happening in the scanner.
   *
   * Depending on it here meant `register` got a new identity on every poll
   * tick, which cascaded: `handleDecoded` (deps [register]) got a new
   * identity too, and THAT is a dependency of the camera-start effect below —
   * so the effect's cleanup ran and getUserMedia was called AGAIN, on every
   * poll tick, while the camera was already live. Restarting a live
   * MediaStream this aggressively is a genuine race: browsers can throw
   * NotReadableError when a new getUserMedia call lands before the previous
   * track has fully released, which the catch block below turns into
   * `setCamState("error"); setManual(true)` — forcibly REOPENING manual entry
   * moments after Cancel closed it. That's what "Cancel doesn't work" actually
   * was: not a broken click handler, but the whole camera pipeline restarting
   * out from under the user on an unrelated timer and shoving the sheet back
   * open. Reading the latest callback through a ref instead means `register`'s
   * identity — and therefore the camera effect's — now only changes when
   * `tripId`/`coachId` actually change, which is the only time restarting the
   * session is actually correct. */
  const register = useCallback(async (badge) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setSubmitting(true);
    const started = Date.now();
    try {
      const res = await qrCheckin({ code: badge.code, tripId, coachId });
      playTone(true);
      setResult({
        kind: "success",
        title: "Attendance registered",
        sub: `${res.delegate?.name || badge.code}${res.alreadyBoarded ? " · already checked in" : " · marked present"}`,
      });
      // Pass the checked-in delegate through (2026-07-30 — "i successfully
      // able to checkin by scanning qr code. but this part not updated" —
      // the caller's "N checked in" hero tally). Previously called with no
      // arguments at all — fine for the caller's OWN fetchCoaches()/
      // fetchCoach() refresh, but MobileScannerPage.jsx's session tally
      // (sessionScans, populated by its OWN submitScan() for Face/Voice)
      // never learned about a QR check-in happening at all, so scanning by
      // QR could never move that counter no matter how many succeeded.
      onCheckedInRef.current?.({
        delegateId: res.delegate?.id, name: res.delegate?.name,
        alreadyBoarded: !!res.alreadyBoarded, elapsedMs: Date.now() - started,
      });
    } catch (e) {
      playTone(false);
      // Log the exact bytes jsQR handed us — invaluable if a real badge is
      // ever mis-scanned (partial read, wrong QR, stale/reprinted code, etc.).
      console.debug("[QRScannerPanel] rejected scan:", JSON.stringify(badge.code));
      // Coach mismatch (409) gets its own distinct title/tone — this is NOT
      // "the badge is bad", it's "you're scanning under the wrong coach", a
      // meaningfully different fix for field staff (switch coach, don't
      // retry the same scan).
      const isMismatch = e.status === 409 && e.code === "COACH_MISMATCH";
      const msg =
        isMismatch ? e.message
        : e.status === 404 ? "That badge isn't recognised. Make sure it's from the Boarding passes tab."
        : e.status === 401 ? "Session expired — sign in again."
        : e.message || "Check-in failed — retry, or use Manual.";
      setResult({ kind: "error", title: isMismatch ? "Coach mismatch" : "QR code invalid", sub: msg });
    } finally {
      setSubmitting(false);
      busyRef.current = false;
      clearResultSoon();
    }
  }, [tripId, coachId, clearResultSoon]);

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
          // Ask for a sharp 720p+ stream. Without an explicit resolution the
          // browser hands back a low default (often 640x480), which — scaled
          // up to fill this tall viewport via objectFit:cover — looks soft/
          // blurry and gives jsQR far fewer pixels to lock a QR onto (the
          // "keeps blurring while scanning" report). `ideal` still gracefully
          // falls back on webcams that can't do 720p.
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;

        // Best-effort: nudge the camera into CONTINUOUS autofocus so a badge
        // held close is kept sharp instead of the sensor hunting in and out.
        // Silently ignored on devices/browsers that don't expose focusMode
        // (most laptop webcams are fixed-focus and need no help anyway).
        try {
          const track = stream.getVideoTracks()[0];
          const caps = track?.getCapabilities?.();
          if (caps && Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) {
            await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
          }
          // Tap-to-focus support check — `pointsOfInterest` is the
          // capability Chrome/Android expose for "refocus/re-expose around
          // this spot"; a bare boolean per the MediaTrackCapabilities spec,
          // not a list of options like focusMode. Most laptop webcams and
          // iOS Safari don't expose it at all — the tap ring still renders
          // for feedback either way (see handleTapFocus below), only the
          // actual hardware refocus call is skipped when this is false.
          setFocusSupported(!!(caps && caps.pointsOfInterest));
        } catch { /* focus control unsupported — the higher resolution still helps */ }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setCamState("live");
        tick();
      } catch {
        if (!cancelled) { setCamState("error"); setManual(true); }
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
        let code = jsQR(img.data, w, h, { inversionAttempts: "attemptBoth" });
        // Digital zoom fallback (2026-07-30 — "zoom in and out doesn't work...
        // 100 tries for 1 success"): a badge held at a natural, comfortable
        // distance often only fills a small fraction of a 720p frame, so its
        // modules can be just a few pixels across — well below what jsQR can
        // reliably resolve, especially on a laptop webcam's lower actual
        // sharpness. Rather than relying on the PERSON finding the exact
        // right physical distance (which the user already tried and reported
        // doesn't help), decode a center-cropped 55%-of-frame region UPSCALED
        // to a fixed 640px square as a second attempt every tick — this is
        // the same "digital zoom" a phone's own QR scanner does automatically.
        // Cheap: only runs when the full-frame attempt already missed.
        if (!code) {
          const zoomCanvas = zoomCanvasRef.current || (zoomCanvasRef.current = document.createElement("canvas"));
          const cropSize = Math.round(Math.min(w, h) * 0.55);
          const cropX = Math.round((w - cropSize) / 2);
          const cropY = Math.round((h - cropSize) / 2);
          const zw = (zoomCanvas.width = 640);
          const zh = (zoomCanvas.height = 640);
          const zctx = zoomCanvas.getContext("2d", { willReadFrequently: true });
          zctx.drawImage(video, cropX, cropY, cropSize, cropSize, 0, 0, zw, zh);
          const zimg = zctx.getImageData(0, 0, zw, zh);
          code = jsQR(zimg.data, zw, zh, { inversionAttempts: "attemptBoth" });
        }
        if (code && code.data) handleDecoded(code.data);
      }, SCAN_INTERVAL_MS);
    }

    start();
    return () => {
      cancelled = true;
      clearInterval(loopRef.current);
      clearTimeout(resultTimerRef.current);
      clearTimeout(focusRingTimerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleDecoded, facingMode]);

  /* Tap-to-focus (2026-07-30 — "not able to focus and scan qr code... give
   * me to tap on the scanner and it focus on that spot, similar to how the
   * phone camera work"). Two independent things happen on every tap:
   *   1. A focus ring pops in at the exact tap point and fades a moment
   *      later — pure visual feedback, always shown, so a tap always feels
   *      like it did something the way it does on a real camera app.
   *   2. IF the hardware exposes it (`focusSupported`, checked once above),
   *      `pointsOfInterest` is pushed as a constraint so the sensor actually
   *      re-focuses/re-exposes around that spot. Coordinates are normalised
   *      to 0–1 against the VIDEO's own rendered box (not the click event's
   *      raw page coords), matching what getUserMedia expects regardless of
   *      how the element is sized/cropped by objectFit:cover.
   * Best-effort by design: unsupported hardware just keeps the visual ring
   * and silently skips the constraint call, exactly like the existing
   * continuous-autofocus/torch feature-detection above and on the Face
   * scanner. */
  const handleTapFocus = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    clearTimeout(focusRingTimerRef.current);
    setFocusRing({ x, y });
    focusRingTimerRef.current = setTimeout(() => setFocusRing(null), 700);

    if (!focusSupported || !streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;
    const relX = Math.min(1, Math.max(0, x / rect.width));
    const relY = Math.min(1, Math.max(0, y / rect.height));
    track.applyConstraints({ advanced: [{ pointsOfInterest: [{ x: relX, y: relY }] }] }).catch(() => { /* device refused mid-stream — the ring still showed */ });
  };

  const submitManual = () => {
    const v = manualText.trim();
    if (!v) return;
    handleDecoded(v);
    setManualText("");
    setManual(false);
  };

  const S = {
    root: { position: "absolute", inset: 0, overflow: "hidden", borderRadius: "inherit" },
    video: { width: "100%", height: "100%", objectFit: "cover", transform: facingMode === "user" ? "scaleX(-1)" : "none" },
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
          <video
            ref={videoRef} autoPlay playsInline muted style={S.video}
            onClick={camState === "live" && !result ? handleTapFocus : undefined}
          />
          {focusRing && (
            <span
              className="jayden-focus-ring"
              style={{ left: focusRing.x, top: focusRing.y }}
              aria-hidden="true"
            />
          )}
          <span className="jayden-corner tl" /><span className="jayden-corner tr" />
          <span className="jayden-corner bl" /><span className="jayden-corner br" />
          {camState === "live" && !result && <span className="jayden-scan" />}

          <span style={S.topTag}><QrCode size={13} /> QR check-in</span>
          {/* Only drawn in UNCONTROLLED mode — when a parent supplies
              `manualOpen` it renders its own labelled trigger outside the
              video, and drawing this too would give two controls for one
              toggle (and put this one back in the corner the flip-camera
              button occupies on mobile). See the component's doc comment. */}
          {!manualControlled && (
            <button type="button" style={S.iconBtn} title="Enter code manually"
                    onClick={toggleManual}>
              <Keyboard size={16} />
            </button>
          )}

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
              <button className="btn btn-ghost" onClick={() => setManual(false)}>Cancel</button>
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
