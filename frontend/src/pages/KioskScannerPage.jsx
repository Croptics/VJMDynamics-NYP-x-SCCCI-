/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — passwordless entrance kiosk
 * ============================================================================= */
// frontend/src/pages/KioskScannerPage.jsx
// PASSWORDLESS entrance-kiosk scanner (Face + QR). Route: /kiosk-scan.
//
// Hard-locked sandbox: rendered OUTSIDE Layout/MobileLayout so there is NO
// sidebar, tab bar, or any other navigation — the only way out is the "Back
// to Login" button, which kills the camera and returns to /login. The user
// never authenticates: on mount this page mints a scoped, passwordless kiosk
// token (POST /api/auth/kiosk) that the backend accepts ONLY on the two
// camera check-in endpoints (see auth.js requireKioskOrAuth) — it can do
// nothing else, so even though the page is reachable without a password, the
// token it holds can't read the dashboard, delegates, accounts, etc.
//
// The kiosk token lives in a ref (memory only) — never localStorage — so it
// can't leak into the normal app's auth state (getToken() stays empty, the
// app stays "logged out"). Deliberately Face + QR only (the two CAMERA scans);
// Manual attendance is a staff override that stays behind a real login.

import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import jsQR from "jsqr";
import {
  ScanFace, QrCode, LogOut, CheckCircle2, AlertTriangle, ShieldCheck, Camera, SwitchCamera,
  Mic, Moon, Sun, Zap, Turtle,
} from "lucide-react";
import { vectorizeFaceLandmarks, vectorizeVoiceprint, isValidBiometricToken, playErrorTone } from "../lib/scanner/faceScan.js";

const API_BASE = import.meta.env.VITE_API_URL || "/api";
const TRIP_ID = "t-1";
const SCAN_INTERVAL_MS = 200;
const RESCAN_COOLDOWN_MS = 3500;

const KIOSK_CSS = `
@keyframes k-line { 0% { top: 8%; } 50% { top: 90%; } 100% { top: 8%; } }
.k-line { position: absolute; left: 8%; right: 8%; height: 3px; background: var(--st-present);
  opacity: .85; border-radius: 3px; box-shadow: 0 0 16px var(--st-present); animation: k-line 1.6s ease-in-out infinite; }
.k-corner { position: absolute; width: 40px; height: 40px; border: 4px solid var(--st-present); opacity: .9; }
.k-corner.tl { top: 16px; left: 16px; border-right: none; border-bottom: none; border-radius: 10px 0 0 0; }
.k-corner.tr { top: 16px; right: 16px; border-left: none; border-bottom: none; border-radius: 0 10px 0 0; }
.k-corner.bl { bottom: 16px; left: 16px; border-right: none; border-top: none; border-radius: 0 0 0 10px; }
.k-corner.br { bottom: 16px; right: 16px; border-left: none; border-top: none; border-radius: 0 0 10px 0; }
@keyframes k-pop { from { transform: scale(.94); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.k-pop { animation: k-pop .18s ease-out; }
@keyframes k-focus-ring { 0% { transform: translate(-50%, -50%) scale(1.3); opacity: 1; }
  100% { transform: translate(-50%, -50%) scale(0.85); opacity: 0; } }
.k-focus-ring { position: absolute; width: 64px; height: 64px; border-radius: 50%;
  border: 2px solid var(--st-present); pointer-events: none; animation: k-focus-ring .5s ease-out forwards; }
@media (prefers-reduced-motion: reduce) { .k-line { animation: none; top: 48%; } .k-pop { animation: none; } .k-focus-ring { animation: none; opacity: 0; } }
`;

export default function KioskScannerPage() {
  const navigate = useNavigate();
  const [scanMode, setScanMode] = useState("face"); // face | qr
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null); // { name, sub }
  const [error, setError] = useState("");
  const [camError, setCamError] = useState("");
  const [tokenReady, setTokenReady] = useState(false);
  const [tokenErr, setTokenErr] = useState("");
  // Defaults to the rear/outward-facing camera (2026-08-03) — a kiosk is a
  // fixed device facing approaching people, not a phone someone holds up to
  // their own face, so "user" (selfie) was the wrong default even in Face
  // mode. The flip-camera button still lets staff switch back if the kiosk's
  // actual mounted orientation needs it.
  const [facing, setFacing] = useState("environment"); // user (selfie) | environment (rear)

  // Low-light voice fallback + slow-scan demo — same feature as the
  // desktop/mobile scanners (see UnifiedScannerPage.jsx/MobileScannerPage.jsx),
  // brought here for full parity across all three scanning entry points.
  const [lowLight, setLowLight] = useState(false);
  const [autoLowLight, setAutoLowLight] = useState(false);
  const [simulateSlow, setSimulateSlow] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [voiceFinal, setVoiceFinal] = useState(false);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const kioskTokenRef = useRef(null);
  const busyRef = useRef(false);
  const recognitionRef = useRef(null);
  const voiceTimeoutRef = useRef(null);

  /* ---- mint the passwordless kiosk token (memory only) ------------------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/kiosk`, { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.token) throw new Error("Could not start the kiosk session.");
        if (!cancelled) { kioskTokenRef.current = data.token; setTokenReady(true); }
      } catch (e) {
        if (!cancelled) setTokenErr(e.message || "Could not start the kiosk session.");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const kioskPost = useCallback(async (path, body) => {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(kioskTokenRef.current ? { Authorization: `Bearer ${kioskTokenRef.current}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || "Request failed");
      err.status = res.status; err.code = data.error;
      throw err;
    }
    return data;
  }, []);

  const kioskGet = useCallback(async (path) => {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: kioskTokenRef.current ? { Authorization: `Bearer ${kioskTokenRef.current}` } : {},
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Request failed");
    return data;
  }, []);

  // Multi-day / multi-checkpoint attendance (2026-07-22) — optional second
  // write after a successful scan. The kiosk token only reaches TWO
  // checkpoint endpoints (GET the list, POST a check-in) — see auth.js's
  // requireKioskOrAuth/requireKioskOrPermission; stats and admin CRUD stay
  // off-limits to a passwordless device by design.
  const [checkpoints, setCheckpoints] = useState([]);
  const [activeCheckpointId, setActiveCheckpointId] = useState("");

  // Always tracks whichever checkpoint is "current" — no manual override
  // (2026-08-03, explicit request: "remove the dropdown, always auto-use
  // current"). Polls every 60s rather than fetching once on mount, since a
  // kiosk left running through a whole day needs to auto-advance from one
  // checkpoint to the next as the schedule moves forward, with no one there
  // to pick the next one by hand.
  useEffect(() => {
    if (!tokenReady) return;
    let alive = true;
    const load = () => kioskGet(`/trips/${TRIP_ID}/checkpoints`).then((data) => {
      if (!alive) return;
      const flat = [];
      for (const day of data.days || []) {
        for (const cp of day.checkpoints || []) flat.push({ ...cp, dayNumber: day.dayNumber });
      }
      setCheckpoints(flat);
      setActiveCheckpointId(flat.find((c) => c.timeState === "current")?.id || "");
    }).catch(() => {}); // stays on whatever checkpoint it last knew about
    load();
    const id = setInterval(load, 60000);
    return () => { alive = false; clearInterval(id); };
  }, [tokenReady, kioskGet]);

  function recordCheckpointCheckin(delegateId, method) {
    if (!activeCheckpointId || !delegateId) return;
    kioskPost(`/checkpoints/${activeCheckpointId}/checkins`, { delegateId, status: "ARRIVED", method }).catch(() => {});
  }

  /* ---- speech recognition setup for the low-light voice fallback --------- */
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { setVoiceSupported(false); return undefined; }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-SG";
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map((r) => r[0].transcript).join(" ").trim();
      setPassphrase(transcript);
      setVoiceStatus("Listening…");
      setVoiceFinal(false);
      setVoiceError("");

      if (event.results[event.results.length - 1]?.isFinal) {
        const finalPhrase = transcript.trim();
        setVoiceListening(false);
        clearTimeout(voiceTimeoutRef.current);
        voiceTimeoutRef.current = null;

        if (!finalPhrase) {
          setVoiceStatus("No speech detected.");
          setVoiceError("No speech was captured. Tap Start voice capture again.");
          return;
        }
        if (finalPhrase.length < 4) {
          setVoiceStatus(`Heard: ${finalPhrase}`);
          setVoiceError("Spoken passphrase is too short — speak the full phrase.");
          return;
        }
        setVoiceStatus(`Heard: ${finalPhrase}`);
        setVoiceFinal(true);
        setVoiceError("");
      }
    };
    recognition.onstart = () => {
      setVoiceListening(true);
      setVoiceStatus("Listening…");
      setVoiceError("");
      setVoiceFinal(false);
      clearTimeout(voiceTimeoutRef.current);
      voiceTimeoutRef.current = window.setTimeout(() => {
        if (recognitionRef.current && voiceListening) {
          recognitionRef.current.stop();
          setVoiceError("No speech detected in time. Please tap Start voice capture and try again.");
          setVoiceStatus("");
          setVoiceListening(false);
        }
      }, 8000);
    };
    recognition.onnomatch = () => {
      setVoiceError("Could not recognize speech. Please try again clearly.");
      setVoiceStatus("");
      setVoiceListening(false);
    };
    recognition.onerror = (event) => {
      setVoiceListening(false);
      clearTimeout(voiceTimeoutRef.current);
      voiceTimeoutRef.current = null;
      if (event.error === "not-allowed") setVoiceError("Microphone access was denied. Allow mic access to speak the passphrase.");
      else if (event.error === "no-speech") setVoiceError("No speech heard. Tap Start voice capture and try again.");
      else if (event.error === "audio-capture") setVoiceError("Microphone not available. Check your device settings.");
      else if (event.error !== "aborted") setVoiceError(`Voice capture error: ${event.error}`);
      setVoiceStatus("");
    };
    recognition.onend = () => {
      setVoiceListening(false);
      clearTimeout(voiceTimeoutRef.current);
      voiceTimeoutRef.current = null;
    };

    recognitionRef.current = recognition;
    setVoiceSupported(true);
    return () => { recognition.stop(); recognitionRef.current = null; };
  }, []);

  /* ---- camera (environment/rear, used by both Face and QR) --------------- */
  const stopCamera = useCallback(() => {
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // Tap-to-focus (2026-08-03, QR mode) — a QR code held at an angle or too
  // close/far can sit outside a webcam's continuous-autofocus sweet spot.
  // `pointsOfInterest`/`focusMode` are real MediaTrackConstraints, but only
  // Chrome on Android with camera2 hardware actually honors them — everywhere
  // else this is a silent no-op, same fail-soft pattern as the rest of this
  // codebase's optional hardware/third-party features (AMap, Cloudinary).
  // The focus-ring animation fires regardless, so tapping always FEELS
  // responsive even on hardware that ignores the underlying constraint.
  const [focusPoint, setFocusPoint] = useState(null);
  function tapToFocus(e) {
    const track = streamRef.current?.getVideoTracks?.()[0];
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setFocusPoint({ left: e.clientX - rect.left, top: e.clientY - rect.top });
    if (track && typeof track.getCapabilities === "function") {
      const caps = track.getCapabilities();
      if (caps.pointsOfInterest) {
        const advanced = [{ pointsOfInterest: [{ x, y }] }];
        if (caps.focusMode?.includes("single-shot")) advanced[0].focusMode = "single-shot";
        track.applyConstraints({ advanced }).catch(() => {}); // unsupported on this device — ring still shows
      }
    }
  }

  useEffect(() => {
    if (scanMode === "face" && lowLight) { stopCamera(); return undefined; }
    let cancelled = false;
    (async () => {
      try {
        setCamError("");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}); }
      } catch {
        if (!cancelled) setCamError("Camera unavailable — allow camera access (and open this page over HTTPS).");
      }
    })();
    return () => { cancelled = true; stopCamera(); };
  }, [stopCamera, facing, scanMode, lowLight]);

  /* ---- automatic low-light multi-modal fallback (Face mode only) --------- */
  useEffect(() => {
    if (!(scanMode === "face" && !lowLight)) return undefined;
    let darkStreak = 0;
    const meter = document.createElement("canvas");
    meter.width = 24; meter.height = 18;
    const mctx = meter.getContext("2d", { willReadFrequently: true });

    const id = setInterval(() => {
      const video = videoRef.current;
      if (!video || !video.videoWidth) return;
      mctx.drawImage(video, 0, 0, meter.width, meter.height);
      const sample = mctx.getImageData(0, 0, meter.width, meter.height);
      const px = sample.data;
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      const avgLuma = sum / (px.length / 4);
      px.fill(0); // PDPA purge — the light-meter frame never outlives this tick

      darkStreak = avgLuma < 30 ? darkStreak + 1 : 0;
      if (darkStreak >= 2) {
        setAutoLowLight(true);
        setLowLight(true);
        setError("");
      }
    }, 1200);

    return () => { clearInterval(id); meter.width = 0; meter.height = 0; };
  }, [scanMode, lowLight]);

  /* ---- Face scan -------------------------------------------------------- */
  async function submitFace(token) {
    setScanning(true); setError(""); setResult(null);
    try {
      // Demo hook: proves the ">1s -> error tone" SLA path on command.
      if (simulateSlow) await new Promise((r) => setTimeout(r, 1300));
      const res = await kioskPost("/attendance/scan", { tripId: TRIP_ID, scanData: token, timestamp: new Date().toISOString() });
      setResult({ name: res.name, sub: "checked in" });
      recordCheckpointCheckin(res.delegateId, res.method);
      setTimeout(() => setResult(null), 3000);
    } catch (e) {
      playErrorTone();
      setError(e.status === 404 || e.code === "SCAN_FAILED" ? "No matching missing delegate." : (e.message || "Scan failed."));
      setTimeout(() => setError(""), 3500);
    } finally { setScanning(false); }
  }

  function handleFaceScan() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) { setError("Camera not ready yet — wait a moment."); return; }
    const canvas = document.createElement("canvas");
    canvas.width = 160; canvas.height = 120;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, 160, 120);
    const imageData = ctx.getImageData(0, 0, 160, 120);
    const token = vectorizeFaceLandmarks(imageData);
    canvas.width = 0; canvas.height = 0;
    if (!isValidBiometricToken(token)) { setError("Invalid capture — try again."); return; }
    submitFace(token);
  }

  async function startVoiceCapture() {
    if (!recognitionRef.current) {
      setVoiceError("Speech recognition is not available in this browser. Use the typed passphrase instead or open the app in Chrome/Edge.");
      return;
    }
    if (voiceListening) {
      recognitionRef.current.stop();
      setVoiceListening(false);
      setVoiceStatus("Stopped recording.");
      return;
    }
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setVoiceError("Microphone access is required for spoken check-in. Allow the browser to use your mic.");
      return;
    }
    setError("");
    setVoiceError("");
    setVoiceStatus("Listening…");
    setVoiceFinal(false);
    setPassphrase("");
    recognitionRef.current.start();
  }

  function handleVoiceScan(overridePhrase) {
    const phrase = (overridePhrase ?? passphrase).trim();
    if (phrase.length < 4) {
      setVoiceError("Passphrase too short — ask the delegate to speak the full passphrase.");
      return;
    }
    if (!voiceFinal && recognitionRef.current && !voiceListening) {
      setVoiceError("No confirmed spoken passphrase was captured. Record again or type the phrase manually.");
      return;
    }
    setVoiceError("");
    submitFace(vectorizeVoiceprint(phrase));
    setPassphrase("");
    setVoiceStatus("");
    setVoiceFinal(false);
  }

  /* ---- QR decode loop (only while in QR mode) --------------------------- */
  const registerQR = useCallback(async (raw) => {
    const code = (raw || "").trim();
    if (!code) return;
    setScanning(true); setError("");
    try {
      const res = await kioskPost("/onboarding/checkin", { code, tripId: TRIP_ID });
      setResult({ name: res.delegate?.name || code, sub: res.alreadyBoarded ? "already checked in" : "checked in" });
      recordCheckpointCheckin(res.delegate?.id, "QR");
      setTimeout(() => setResult(null), 3000);
    } catch (e) {
      playErrorTone();
      setError(e.status === 404 ? "Badge not recognised." : (e.message || "Check-in failed."));
      setTimeout(() => setError(""), 3500);
    } finally { setScanning(false); }
  }, [kioskPost]);

  useEffect(() => {
    if (scanMode !== "qr" || camError) return undefined;
    const canvas = document.createElement("canvas");
    const last = { value: "", at: 0 };
    const id = setInterval(() => {
      if (busyRef.current || result) return;
      const video = videoRef.current;
      if (!video || !video.videoWidth) return;
      const w = (canvas.width = video.videoWidth);
      const h = (canvas.height = video.videoHeight);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      const code = jsQR(img.data, w, h, { inversionAttempts: "attemptBoth" });
      if (code && code.data) {
        const now = Date.now();
        if (code.data !== last.value || now - last.at > RESCAN_COOLDOWN_MS) {
          last.value = code.data; last.at = now;
          busyRef.current = true;
          registerQR(code.data).finally(() => { busyRef.current = false; });
        }
      }
    }, SCAN_INTERVAL_MS);
    return () => { clearInterval(id); canvas.width = 0; canvas.height = 0; };
  }, [scanMode, camError, result, registerQR]);

  function backToLogin() {
    stopCamera();
    kioskTokenRef.current = null;
    navigate("/login", { replace: true });
  }

  const S = {
    wrap: {
      minHeight: "100vh", background: "var(--bg)", color: "var(--ink)",
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "16px 16px 28px", boxSizing: "border-box",
    },
    card: { width: "min(460px, 100%)", display: "flex", flexDirection: "column", gap: 12 },
    viewport: {
      position: "relative", borderRadius: "var(--r-lg)", overflow: "hidden",
      background: "#000", width: "100%", aspectRatio: "3 / 4", maxHeight: "62vh",
    },
    overlay: {
      position: "absolute", inset: 0, display: "flex", alignItems: "center",
      justifyContent: "center", padding: 22, textAlign: "center", flexDirection: "column", gap: 10,
    },
    modeBtn: (active) => ({
      flex: 1, padding: "12px 0", borderRadius: 999, fontWeight: 700, fontSize: 14,
      border: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
      background: active ? "var(--scc-red-tint)" : "var(--surface)",
      color: active ? "var(--scc-red)" : "var(--ink-2)", cursor: "pointer",
    }),
  };

  return (
    <div style={S.wrap}>
      <style>{KIOSK_CSS}</style>
      <div style={S.card}>
        <div className="row between" style={{ alignItems: "center" }}>
          <div className="wordmark" style={{ color: "var(--scc-red)", fontSize: 20 }}>
            <ShieldCheck size={20} /> Scanner
          </div>
          <div className="row" style={{ gap: 8 }}>
            {!(scanMode === "face" && lowLight) && (
              <button
                className="btn btn-ghost" style={{ fontSize: 13, padding: 8 }}
                onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
                aria-label="Flip camera" title="Flip camera"
              >
                <SwitchCamera size={16} />
              </button>
            )}
            <button className="btn btn-ghost" onClick={backToLogin} style={{ fontSize: 13 }}>
              <LogOut size={15} /> Back to Login
            </button>
          </div>
        </div>

        <div className="muted" style={{ fontSize: 12.5, marginTop: -4 }}>
          Passwordless entrance kiosk · Face &amp; QR check-in only
        </div>

        {/* Checkpoint status (2026-07-22, dropdown removed 2026-08-03 —
            "remove the dropdown, always auto-use current"). No manual
            override anymore — this is read-only, just confirming which
            checkpoint a scan will record against right now. Kept
            deliberately minimal (no stats shown) — the kiosk token can only
            list checkpoints and record a check-in, not read back live
            counts; see auth.js's requireKioskOrAuth. */}
        {checkpoints.length > 0 && (() => {
          const active = checkpoints.find((c) => c.id === activeCheckpointId);
          return (
            <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
              {active
                ? <>→ Day {active.dayNumber} · {active.scheduledTime ? `${active.scheduledTime} · ` : ""}{active.label}
                    {active.status === "delayed" && active.delayMinutes > 0 ? ` (Delayed +${active.delayMinutes}m)` : ""}
                    {" (Now)"}</>
                : "Not scanning for a checkpoint right now"}
            </div>
          );
        })()}

        <div
          style={{ ...S.viewport, cursor: scanMode === "qr" ? "crosshair" : S.viewport.cursor }}
          onClick={scanMode === "qr" ? tapToFocus : undefined}
        >
          {!(scanMode === "face" && lowLight) && (
            <>
              <video ref={videoRef} autoPlay playsInline muted
                style={{ width: "100%", height: "100%", objectFit: "cover", transform: facing === "user" ? "scaleX(-1)" : "none" }} />
              <span className="k-corner tl" /><span className="k-corner tr" />
              <span className="k-corner bl" /><span className="k-corner br" />
              {scanning && <span className="k-line" />}
              {scanMode === "qr" && focusPoint && (
                <span
                  className="k-focus-ring"
                  style={{ left: focusPoint.left, top: focusPoint.top }}
                  onAnimationEnd={() => setFocusPoint(null)}
                />
              )}
            </>
          )}

          {scanMode === "face" && lowLight && (
            <div style={S.overlay}>
              <Mic size={30} style={{ color: "var(--st-review)" }} />
              <div style={{ fontWeight: 700, color: "#fff" }}>
                {autoLowLight ? "Low light detected — sensor" : "Low light detected"}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--line)", maxWidth: 280 }}>
                {autoLowLight
                  ? "Ambient light dropped below threshold, so the camera switched itself off. "
                  : "Camera paused for fairness — face matching degrades unevenly in the dark. "}
                Please <strong>say your passphrase</strong> instead.
              </div>
              <button className="btn btn-primary" onClick={startVoiceCapture} disabled={scanning}>
                {voiceListening ? "Stop voice capture" : voiceSupported ? "Start voice capture" : "Use text fallback"}
              </button>
              <input
                className="input" placeholder="Or type the passphrase…" value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleVoiceScan(); }}
                style={{ maxWidth: 220, textAlign: "center" }}
              />
              <button className="btn btn-primary" onClick={() => handleVoiceScan()} disabled={scanning || !passphrase.trim()}>
                {scanning ? "Submitting passphrase…" : "Submit passphrase"}
              </button>
              {(voiceStatus || voiceError) && (
                <div style={{ fontSize: 12, color: voiceError ? "#f87171" : "#fff" }}>
                  {voiceError || voiceStatus}
                </div>
              )}
            </div>
          )}

          {camError && (
            <div style={S.overlay}>
              <Camera size={28} color="#fff" />
              <div style={{ fontSize: 14, maxWidth: 300, color: "#fff" }}>{camError}</div>
            </div>
          )}
          {tokenErr && !camError && (
            <div style={S.overlay}>
              <AlertTriangle size={26} color="#fff" />
              <div style={{ fontSize: 14, maxWidth: 300, color: "#fff" }}>{tokenErr}</div>
            </div>
          )}
          {result && (
            <div style={S.overlay}>
              <div className="card k-pop" style={{ padding: "18px 22px", color: "var(--ink)" }}>
                <div className="row" style={{ gap: 12 }}>
                  <CheckCircle2 size={34} style={{ color: "var(--st-present)", flexShrink: 0 }} />
                  <div style={{ textAlign: "left" }}>
                    <div style={{ fontWeight: 700, fontSize: 17 }}>{result.name}</div>
                    <div className="muted" style={{ fontSize: 13 }}>{result.sub} ✓</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Face / QR toggle */}
        <div style={{ display: "flex", gap: 8 }}>
          {[
            { key: "face", label: "Face", Icon: ScanFace },
            { key: "qr", label: "QR", Icon: QrCode },
          ].map(({ key, label, Icon }) => (
            <button key={key} style={S.modeBtn(scanMode === key)} onClick={() => { setScanMode(key); setError(""); }}>
              <Icon size={16} /> {label}
            </button>
          ))}
        </div>

        {scanMode === "face" && !lowLight && !camError && (
          <button
            className="btn btn-primary btn-block" style={{ padding: "14px 0", fontSize: 15 }}
            onClick={handleFaceScan} disabled={scanning || !tokenReady}
          >
            <ScanFace size={18} /> {scanning ? "Processing…" : tokenReady ? "Scan face" : "Starting…"}
          </button>
        )}
        {scanMode === "qr" && !camError && (
          <div className="muted" style={{ fontSize: 13, textAlign: "center" }}>
            {tokenReady ? "Hold a delegate badge inside the frame" : "Starting…"}
          </div>
        )}

        {error && (
          <div style={{
            borderRadius: "var(--r-sm)", padding: 12, fontSize: 14,
            background: "var(--st-missing-bg)", color: "var(--scc-red-700)", border: "1px solid var(--scc-red-tint-2)",
          }}>
            <AlertTriangle size={14} style={{ marginRight: 6, verticalAlign: -2 }} />{error}
          </div>
        )}

        {/* Simulated sensors — for demoing the fairness fallback + the 1s
            SLA, shown regardless of scanMode for parity with the
            desktop/mobile scanners. */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn btn-ghost" style={{ flex: 1, fontSize: 13 }}
            onClick={() => { setAutoLowLight(false); setLowLight((v) => !v); setError(""); }}
          >
            {lowLight ? <Sun size={14} /> : <Moon size={14} />}
            {lowLight ? "Normal light" : "Simulate low light"}
          </button>
          <button
            className="btn btn-ghost" style={{ flex: 1, fontSize: 13 }}
            onClick={() => setSimulateSlow((v) => !v)}
          >
            {simulateSlow ? <Zap size={14} /> : <Turtle size={14} />}
            {simulateSlow ? "Slow demo: ON" : "Slow demo: OFF"}
          </button>
        </div>

        <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5, marginTop: 4 }}>
          <ShieldCheck size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
          Locked kiosk mode — this device can only check delegates in. Zero-Image face mode:
          raw pixels are zeroed in memory the instant the anonymous token is derived.
        </div>
      </div>
    </div>
  );
}
