/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — desktop Face + QR scanner
 * ============================================================================= */
// frontend/src/pages/desktop/UnifiedScannerPage.jsx
// "Face Scan + QR Code Scan" — a desktop-native entrance-kiosk page.
// Route:   /scanner (registered in App.jsx — no permission gate, same as
//          /checkin: any signed-in staff or admin can operate it).
//
// This is NOT a rebuild of the scanning logic — it re-mounts the same real
// check-in paths that already write to the shared delegate list:
//   - Face:   a trimmed copy of Vimal's zero-image vectorizer
//             (was in the now-removed QRCheckInPage.jsx) → POST
//             /attendance/scan → status ARRIVED.
//   - QR:     Jayden's QRScannerPanel.jsx, unmodified, self-contained.
//   - Manual: Jayden's ManualTrackingPanel.jsx, unmodified, self-contained
//             — the fallback for when a face/QR scan just won't register,
//             right on this same page (2026-07-20) instead of a separate
//             screen to switch to.
// Deliberately dropped vs. the old QRCheckInPage.jsx: the Trips/Issues/Me
// tabs (Trips and Me were pure duplicates of the real desktop Trips board
// and /settings/mobile-profile; Issues moved to the mobile Home view — see
// MobileHomePage.jsx), the low-light voice fallback, the "simulate slow
// scan" demo control, and biometric enrollment — this page is a focused
// entrance kiosk, not the full mobile staff app.

import { useEffect, useRef, useState, useCallback } from "react";
import {
  ScanFace, QrCode, PencilLine, AlertTriangle, CheckCircle2, RefreshCw,
  Camera, Users, ShieldCheck, Mic, Moon, Sun, Zap, Turtle,
} from "lucide-react";
import { apiGet, apiPost } from "../../lib/api.js";
import { vectorizeFaceLandmarks, vectorizeVoiceprint, isValidBiometricToken, playErrorTone } from "../../lib/faceScan.js";
import QRScannerPanel from "../../components/QRScannerPanel.jsx";
import ManualTrackingPanel from "../../components/ManualTrackingPanel.jsx";

const DEFAULT_TRIP_ID = "t-1";
// Which trip this scanner is testing check-in against — its own persisted
// choice (2026-07-23), separate from the Dashboard's/Settings' own trip
// pickers, so switching trips here doesn't affect those pages or vice versa.
const SCANNER_TRIP_KEY = "mg_scanner_trip";

/** Flattens the {days:[{...,checkpoints:[...]}]} shape from
 *  GET /trips/:id/checkpoints into one ordered list of options for the
 *  Checkpoint Selector — "Day 1 · 12:00 · Bus Boarding". */
function flattenCheckpoints(days) {
  const out = [];
  for (const day of days || []) {
    for (const cp of day.checkpoints || []) {
      out.push({ ...cp, dayNumber: day.dayNumber, dayLabel: day.label });
    }
  }
  return out;
}

const KIOSK_CSS = `
@keyframes kiosk-scanline { 0% { top: 6%; } 50% { top: 92%; } 100% { top: 6%; } }
.kiosk-scanline {
  position: absolute; left: 8%; right: 8%; height: 3px;
  background: var(--st-present); opacity: .85; border-radius: 3px;
  box-shadow: 0 0 16px var(--st-present);
  animation: kiosk-scanline 1.6s ease-in-out infinite;
}
.kiosk-corner { position: absolute; width: 40px; height: 40px; border: 4px solid var(--st-present); opacity: .9; }
.kiosk-corner.tl { top: 16px; left: 16px; border-right: none; border-bottom: none; border-radius: 10px 0 0 0; }
.kiosk-corner.tr { top: 16px; right: 16px; border-left: none; border-bottom: none; border-radius: 0 10px 0 0; }
.kiosk-corner.bl { bottom: 16px; left: 16px; border-right: none; border-top: none; border-radius: 0 0 0 10px; }
.kiosk-corner.br { bottom: 16px; right: 16px; border-left: none; border-top: none; border-radius: 0 0 10px 0; }
@keyframes kiosk-pop { from { transform: scale(.94); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.kiosk-pop { animation: kiosk-pop .18s ease-out; }
@media (prefers-reduced-motion: reduce) {
  .kiosk-scanline { animation: none; top: 48%; }
  .kiosk-pop { animation: none; }
}
`;

export default function UnifiedScannerPage() {
  // Trip switcher — lets a shared account test check-in against any trip
  // (not just the default Beijing one), e.g. the "School Field Trip Test"
  // trip used to verify the checkpoint feature.
  const [trips, setTrips] = useState([]);
  const [tripId, setTripId] = useState(() => {
    try { return localStorage.getItem(SCANNER_TRIP_KEY) || DEFAULT_TRIP_ID; } catch { return DEFAULT_TRIP_ID; }
  });
  function pickTrip(id) {
    setTripId(id);
    try { localStorage.setItem(SCANNER_TRIP_KEY, id); } catch { /* ignore */ }
  }
  useEffect(() => {
    // "In progress" only (2026-07-24) — a Planning/Completed trip has no
    // live check-ins to scan against, same restriction the Dashboard/
    // Document-parsing trip pickers already apply.
    apiGet("/all-trips").then((r) => setTrips((r.trips || []).filter((t) => t.status === "In progress"))).catch(() => {});
  }, []);

  const [coaches, setCoaches] = useState([]);
  const [coachId, setCoachId] = useState(null);
  const [coach, setCoach] = useState(null);
  const [loadErr, setLoadErr] = useState("");

  const [scanMode, setScanMode] = useState("face"); // face | qr | manual
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null); // { name, time }
  const [scanError, setScanError] = useState("");
  const [camError, setCamError] = useState("");
  const [resetTick, setResetTick] = useState(0); // bump to force a full scanner re-init

  // Low-light voice fallback + slow-scan demo — brought back from Vimal's
  // original QRCheckInPage.jsx (see faceScan.js's vectorizeVoiceprint for why
  // this exists: face matching degrades unevenly across skin tones in poor
  // light, so switching modality rather than forcing camera retries is a
  // model-fairness fix, not just a convenience).
  const [lowLight, setLowLight] = useState(false);
  const [autoLowLight, setAutoLowLight] = useState(false); // true when the ambient sensor tripped it, not the demo button
  const [simulateSlow, setSimulateSlow] = useState(false); // demo the >1s SLA breach on demand
  const [passphrase, setPassphrase] = useState("");
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [voiceFinal, setVoiceFinal] = useState(false);

  // Multi-day / multi-checkpoint attendance (2026-07-22) — an OPTIONAL
  // second write layered on top of the existing scan flow (see submitScan()
  // below). Face/Voice checkpoint-scoped recording only for now — QR and
  // Manual go through QRScannerPanel.jsx/ManualTrackingPanel.jsx, which call
  // onCheckedIn() with no delegate info, so wiring those in would mean
  // editing those shared components rather than staying in this file.
  const [checkpoints, setCheckpoints] = useState([]); // flattened, see flattenCheckpoints()
  const [activeCheckpointId, setActiveCheckpointId] = useState("");
  const [checkpointStats, setCheckpointStats] = useState(null); // { arrived, missing, late, total }

  const fetchCheckpoints = useCallback(async () => {
    try {
      const data = await apiGet(`/trips/${tripId}/checkpoints`);
      const flat = flattenCheckpoints(data.days);
      setCheckpoints(flat);
      // Auto-focus on whatever checkpoint is actually relevant right now —
      // only on first load (nothing picked yet), never overriding a staff
      // member's own manual choice on a later poll.
      setActiveCheckpointId((prev) => prev || flat.find((c) => c.timeState === "current")?.id || "");
    } catch { /* Checkpoint Selector just stays empty — never blocks scanning */ }
  }, [tripId]);
  useEffect(() => { setActiveCheckpointId(""); }, [tripId]); // a checkpoint from the old trip can't apply to the new one
  useEffect(() => { fetchCheckpoints(); }, [fetchCheckpoints]);

  const fetchCheckpointStats = useCallback(async (checkpointId) => {
    if (!checkpointId) { setCheckpointStats(null); return; }
    try {
      const data = await apiGet(`/checkpoints/${checkpointId}/checkins`);
      setCheckpointStats(data.stats);
    } catch { setCheckpointStats(null); }
  }, []);
  useEffect(() => {
    fetchCheckpointStats(activeCheckpointId);
    if (!activeCheckpointId) return;
    const id = setInterval(() => fetchCheckpointStats(activeCheckpointId), 3000);
    return () => clearInterval(id);
  }, [activeCheckpointId, fetchCheckpointStats]);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recognitionRef = useRef(null);
  const voiceTimeoutRef = useRef(null);

  const fetchCoaches = useCallback(async () => {
    try {
      setLoadErr("");
      const data = await apiGet(`/attendance/coaches?tripId=${tripId}`);
      setCoaches(data.coaches || []);
      setCoachId((prev) => {
        if (prev && (data.coaches || []).some((c) => c.id === prev)) return prev;
        const withPeople = (data.coaches || []).find((c) => c.total > 0);
        return (withPeople || (data.coaches || [])[0] || {}).id || null;
      });
    } catch {
      setLoadErr("Could not load live data. Is the backend running on :4000?");
    }
  }, [tripId]);

  const fetchCoach = useCallback(async (id) => {
    if (!id) { setCoach(null); return; }
    try {
      setCoach(await apiGet(`/attendance/${tripId}/coach/${id}`));
    } catch {
      setCoach(null);
    }
  }, [tripId]);

  // Switching trips invalidates the previously-picked coach (it belongs to
  // the OLD trip) — clear it so fetchCoaches picks a fresh one for the new trip.
  useEffect(() => { setCoachId(null); setCoach(null); }, [tripId]);
  useEffect(() => { fetchCoaches(); }, [fetchCoaches]);
  // 3s poll (2026-07-23) — a status changed elsewhere (e.g. the Dashboard's
  // Edit delegate form) used to only show up here after a scan or manual
  // page refresh, so "Still missing / late" and the KPI cards could sit
  // stale indefinitely. Matches the Dashboard's own live-refresh pattern.
  useEffect(() => {
    fetchCoach(coachId);
    const id = setInterval(() => fetchCoach(coachId), 3000);
    return () => clearInterval(id);
  }, [coachId, fetchCoach]);

  /* Speech recognition setup for the low-light voice fallback — mirrors
   * QRCheckInPage.jsx's own setup verbatim (browser API, not shareable via
   * faceScan.js since it needs live component state via closures). */
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
          setVoiceError("No speech was captured. Tap Record passphrase again.");
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

  /* Face camera lifecycle — same 1280x720-ideal + continuous-autofocus fix
   * already applied to QRScannerPanel.jsx, so this viewfinder is sharp too.
   * Gated on !lowLight so the low-light voice fallback below fully owns the
   * viewport instead of racing the camera for it. */
  useEffect(() => {
    const wantCamera = scanMode === "face" && !lowLight;
    let cancelled = false;

    async function start() {
      try {
        setCamError("");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch {
        if (!cancelled) setCamError("Camera unavailable — allow camera access to use the face scanner.");
      }
    }
    function stop() {
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    }

    if (wantCamera) start(); else stop();
    return () => { cancelled = true; stop(); };
  }, [scanMode, resetTick, lowLight]);

  /* Automatic low-light multi-modal fallback: while the face camera is live,
   * sample a tiny (24x18) frame every ~1.2s, average its luminance, then zero
   * the sample's pixel bytes in place (same Zero-Image purge as the face
   * vectorizer — not even the light meter keeps a photo). Two consecutive
   * dark readings auto-disable the camera and switch to the voice fallback,
   * so delegates keep checking in without any staff action. */
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
        setScanError("");
      }
    }, 1200);

    return () => { clearInterval(id); meter.width = 0; meter.height = 0; };
  }, [scanMode, lowLight]);

  /* Full reset: re-fetches live data, clears any stuck error/result state,
   * and forces BOTH scanner paths to fully re-initialize — restarts the
   * face camera stream (resetTick is in that effect's deps above) and
   * remounts QRScannerPanel from scratch (key={resetTick} below), which
   * tears down and reopens its own camera + decode loop. No hard reload
   * needed for either mode. */
  function resetScanner() {
    setScanError("");
    setScanResult(null);
    setCamError("");
    setResetTick((n) => n + 1);
    fetchCoaches();
    fetchCoach(coachId);
  }

  async function submitScan(token) {
    const started = performance.now();
    setScanning(true);
    setScanError("");
    setScanResult(null);
    try {
      // Demo hook: proves the ">1s -> error tone" SLA path on command.
      if (simulateSlow) await new Promise((r) => setTimeout(r, 1300));
      const res = await apiPost("/attendance/scan", {
        tripId,
        scanData: token,
        timestamp: new Date().toISOString(),
        coachId: coachId || undefined,
      });
      const elapsed = performance.now() - started;
      if (elapsed > 1000) {
        playErrorTone();
        setScanError(`Took ${(elapsed / 1000).toFixed(1)}s (> 1s limit). Retry.`);
        return;
      }
      setScanResult({ name: res.name, time: `${(elapsed / 1000).toFixed(1)}s` });
      fetchCoaches();
      fetchCoach(coachId);
      // Second, separate write — only when a checkpoint is actively
      // selected. Never blocks or fails the actual check-in above: the
      // delegate is already marked ARRIVED regardless of whether this
      // succeeds. "PRESENT" (vimal.js's literal) maps to "ARRIVED" here,
      // same alias the rest of the app already uses.
      if (activeCheckpointId) {
        apiPost(`/checkpoints/${activeCheckpointId}/checkins`, {
          delegateId: res.delegateId,
          status: "ARRIVED",
          method: res.method,
        }).then(() => fetchCheckpointStats(activeCheckpointId)).catch(() => {});
      }
      setTimeout(() => setScanResult(null), 3500);
    } catch (e) {
      playErrorTone();
      setScanError(
        e.code === "COACH_MISMATCH" ? `Coach mismatch — ${e.message}`
        : e.code === "SCAN_FAILED" || e.status === 404
          ? "No missing delegate matched on this coach."
          : e.message || "Scan failed — check the backend connection."
      );
    } finally {
      setScanning(false);
    }
  }

  function handleFaceScan() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setScanError("Camera not ready yet — wait a moment and try again.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 120;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const token = vectorizeFaceLandmarks(imageData);
    canvas.width = 0; canvas.height = 0;
    if (!isValidBiometricToken(token)) {
      setScanError("Camera captured an invalid or placeholder token — try again.");
      return;
    }
    submitScan(token);
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
    setScanError("");
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
    submitScan(vectorizeVoiceprint(phrase));
    setPassphrase("");
    setVoiceStatus("");
    setVoiceFinal(false);
  }

  const boardedPct = coach && coach.expected > 0 ? Math.round((coach.boarded / coach.expected) * 100) : 0;
  // Shows LATE alongside MISSING (2026-07-23 — used to be Missing-only, but
  // a delegate who's Late still needs following up on just as much) sorted
  // Missing-first since that's the more urgent of the two.
  const missingList = coach && coach.delegates
    ? coach.delegates
        .filter((d) => d.status === "MISSING" || d.status === "LATE")
        .sort((a, b) => (a.status === b.status ? 0 : a.status === "MISSING" ? -1 : 1))
    : [];
  // The 3 KPI cards below (Boarded/Late/Missing) prefer the CHECKPOINT-scoped
  // count (matches whatever stop is actively selected) and fall back to the
  // coach's overall counts when no checkpoint is picked — one simplified
  // stat row instead of a separate checkpoint-badges row + a coach-only one.
  const kpi = activeCheckpointId && checkpointStats
    ? { boarded: checkpointStats.arrived, late: checkpointStats.late, missing: checkpointStats.missing }
    : {
        boarded: coach ? coach.boarded : null,
        late: coach && coach.delegates ? coach.delegates.filter((d) => d.status === "LATE").length : null,
        missing: coach ? coach.missing : null,
      };

  const S = {
    layout: { display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" },
    scannerCol: { flex: "2 1 560px", minWidth: 0 },
    sideCol: { flex: "1 1 300px", minWidth: 0 },
    scannerCard: {
      background: "var(--ink)", borderRadius: "var(--r-lg)", padding: 18, color: "var(--surface)",
      minWidth: 0, boxSizing: "border-box",
    },
    viewport: {
      position: "relative", borderRadius: "var(--r-lg)", overflow: "hidden",
      background: "#000", width: "100%", aspectRatio: "16 / 10",
    },
    overlay: {
      position: "absolute", inset: 0, display: "flex", alignItems: "center",
      justifyContent: "center", padding: 24, textAlign: "center", flexDirection: "column", gap: 12,
    },
    modeBtn: (active) => ({
      flex: 1, padding: "12px 0", borderRadius: 999, fontWeight: 700, fontSize: 15,
      border: "1px solid var(--ink-2)", display: "flex", alignItems: "center",
      justifyContent: "center", gap: 8,
      background: active ? "var(--surface)" : "transparent",
      color: active ? "var(--ink)" : "var(--line)",
    }),
    statCard: {
      padding: "14px 16px", borderRadius: "var(--r-md)", border: "1px solid var(--line)",
      background: "var(--surface)",
    },
  };

  return (
    <div className="page">
      <style>{KIOSK_CSS}</style>
      <div className="page-eyebrow">Entrance kiosk</div>
      <h1 className="page-title">Face Scan + QR Code Scan</h1>
      <p className="page-sub" style={{ marginBottom: 24 }}>
        Unified desktop scanner — Face and QR check-in, side by side, sized for an entrance laptop.
      </p>

      {loadErr && (
        <div className="card" style={{
          padding: 12, marginBottom: 16, background: "var(--st-missing-bg)",
          color: "var(--scc-red-700)", fontSize: 13,
        }}>
          {loadErr}
        </div>
      )}

      <div style={S.layout}>
        <div style={S.scannerCol}>
          <div className="card" style={S.scannerCard}>
            <div className="row between" style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>
                Checking in · {coach?.coachLabel || "pick a coach"}
              </div>
              <button
                className="btn btn-ghost"
                onClick={resetScanner}
                style={{ padding: "8px 12px" }}
                title="Reset scanner"
                aria-label="Reset scanner"
              >
                <RefreshCw size={16} />
              </button>
            </div>

            <div style={S.viewport}>
              {scanMode === "face" && !lowLight && (
                <>
                  <video
                    ref={videoRef} autoPlay playsInline muted
                    style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }}
                  />
                  <span className="kiosk-corner tl" /><span className="kiosk-corner tr" />
                  <span className="kiosk-corner bl" /><span className="kiosk-corner br" />
                  {scanning && <span className="kiosk-scanline" />}
                  {camError && (
                    <div style={S.overlay}>
                      <Camera size={28} />
                      <div style={{ fontSize: 15, maxWidth: 320 }}>{camError}</div>
                      <div style={{ fontSize: 13, color: "var(--line)" }}>Switch to QR mode below if no camera is available.</div>
                    </div>
                  )}
                </>
              )}

              {scanMode === "face" && lowLight && (
                <div style={{ ...S.overlay, flexDirection: "column", gap: 10 }}>
                  <Mic size={34} style={{ color: "var(--st-review)" }} />
                  <div style={{ fontWeight: 700 }}>
                    {autoLowLight ? "Low light detected — sensor" : "Low light detected"}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--line)", maxWidth: 300 }}>
                    {autoLowLight
                      ? "Ambient light dropped below threshold, so the camera switched itself off. "
                      : "Camera paused for fairness — face matching degrades unevenly in the dark. "}
                    Ask the delegate to <strong>say their passphrase</strong> instead.
                  </div>
                  <button className="btn btn-primary" onClick={startVoiceCapture} disabled={scanning}>
                    {voiceListening ? "Stop voice capture" : voiceSupported ? "Start voice capture" : "Use text fallback"}
                  </button>
                  <input
                    className="input" placeholder="Or type the passphrase…" value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleVoiceScan(); }}
                    style={{ maxWidth: 240, textAlign: "center" }}
                  />
                  <button className="btn btn-primary" onClick={() => handleVoiceScan()} disabled={scanning || !passphrase.trim()}>
                    {scanning ? "Submitting passphrase…" : "Submit passphrase"}
                  </button>
                  {(voiceStatus || voiceError || scanError) && (
                    <div style={{ fontSize: 12.5, color: voiceError ? "#f87171" : "var(--surface)" }}>
                      {voiceError || voiceStatus || scanError}
                    </div>
                  )}
                </div>
              )}

              {scanMode === "qr" && (
                <QRScannerPanel
                  key={`${resetTick}-${tripId}`}
                  tripId={tripId}
                  coachId={coachId}
                  coachLabel={coach?.coachLabel}
                  onCheckedIn={() => { fetchCoaches(); fetchCoach(coachId); }}
                />
              )}

              {scanMode === "manual" && (
                <ManualTrackingPanel
                  key={`${resetTick}-${tripId}`}
                  coach={coach}
                  coachLabel={coach?.coachLabel}
                  tripId={tripId}
                  onCheckedIn={() => {
                    fetchCoaches(); fetchCoach(coachId);
                    if (activeCheckpointId) fetchCheckpointStats(activeCheckpointId);
                  }}
                />
              )}

              {scanResult && (
                <div style={S.overlay}>
                  <div className="card kiosk-pop" style={{ padding: "20px 24px", color: "var(--ink)" }}>
                    <div className="row" style={{ gap: 14 }}>
                      <CheckCircle2 size={40} style={{ color: "var(--st-present)", flexShrink: 0 }} />
                      <div style={{ textAlign: "left" }}>
                        <div style={{ fontWeight: 700, fontSize: 18 }}>{scanResult.name}</div>
                        <div className="muted" style={{ fontSize: 14 }}>
                          Matched · {scanResult.time} · {coach?.coachLabel || "Coach"} ✓
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              {[
                { key: "face", label: "Face scan", Icon: ScanFace },
                { key: "qr", label: "QR code", Icon: QrCode },
                { key: "manual", label: "Manual", Icon: PencilLine },
              ].map(({ key, label, Icon }) => (
                <button key={key} style={S.modeBtn(scanMode === key)} onClick={() => { setScanMode(key); setScanError(""); }}>
                  <Icon size={18} /> {label}
                </button>
              ))}
            </div>

            {scanMode === "face" && !lowLight && !camError && (
              <button
                className="btn btn-primary btn-block" style={{ marginTop: 14, padding: "14px 0", fontSize: 15 }}
                onClick={handleFaceScan} disabled={scanning}
              >
                <ScanFace size={18} /> {scanning ? "Processing…" : "Scan face"}
              </button>
            )}

            {scanError && (
              <div style={{
                marginTop: 12, borderRadius: "var(--r-sm)", padding: 12, fontSize: 14,
                background: "var(--st-missing-bg)", color: "var(--scc-red-700)",
                border: "1px solid var(--scc-red-tint-2)",
              }}>
                <AlertTriangle size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
                {scanError}
              </div>
            )}

            {/* Compact boarded strip — "X of Y boarded | N missing" + progress,
                same as Vimal's original QRCheckInPage.jsx scanner footer. */}
            <div style={{
              marginTop: 14, borderRadius: 999, padding: "8px 14px",
              background: "rgba(255,255,255,.08)", display: "flex",
              alignItems: "center", justifyContent: "space-between", gap: 10,
            }}>
              <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>
                {coach ? `${coach.boarded} of ${coach.expected} boarded` : "— boarded"}
              </span>
              <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: "var(--scc-red)" }}>
                {coach ? `${coach.missing} missing` : ""}
              </span>
            </div>
            <div style={{ height: 6, background: "rgba(255,255,255,.15)", borderRadius: 3, marginTop: 8, overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 3, background: "var(--st-present)",
                width: `${boardedPct}%`, transition: "width .4s ease",
              }} />
            </div>

            {/* Simulated sensors — for demoing the fairness fallback + the 1s SLA */}
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button
                className="btn btn-ghost" style={{ flex: 1, fontSize: 13 }}
                onClick={() => { setAutoLowLight(false); setLowLight((v) => !v); setScanError(""); }}
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

            <div style={{ fontSize: 12, color: "var(--line)", marginTop: 12, lineHeight: 1.5 }}>
              <ShieldCheck size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
              Zero-Image mode: raw face pixels are zeroed in memory the instant the anonymous
              token is derived. No images stored or transmitted — PDPA compliant.
            </div>
          </div>
        </div>

        <div style={S.sideCol}>
          {/* Trip switcher (2026-07-23) — pick which trip this scanner tests
              check-in against, e.g. a test trip set up to verify the
              checkpoint feature, instead of always the default trip. */}
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 8 }}>
            Trip
          </div>
          <select
            className="input" value={tripId}
            onChange={(e) => pickTrip(e.target.value)}
            style={{ width: "100%", marginBottom: 16 }}
          >
            <option value="t-1">Beijing study mission</option>
            {trips.filter((tr) => tr.id !== "t-1").map((tr) => (
              <option key={tr.id} value={tr.id}>{tr.name}</option>
            ))}
          </select>

          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 8 }}>
            Coach
          </div>
          <select
            className="input" value={coachId || ""}
            onChange={(e) => setCoachId(e.target.value)}
            style={{ width: "100%", marginBottom: 16 }}
          >
            {coaches.length === 0 && <option value="">Loading coaches…</option>}
            {coaches.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label || c.id.toUpperCase()} · {c.name} ({c.boarded}/{c.total})
              </option>
            ))}
          </select>

          {/* Checkpoint Selector (2026-07-22) — optional. Scanning still
              works with none selected; picking one just adds a second,
              checkpoint-scoped attendance record per scan (see submitScan()). */}
          {checkpoints.length > 0 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 8 }}>
                Checkpoint
              </div>
              <select
                className="input" value={activeCheckpointId}
                onChange={(e) => setActiveCheckpointId(e.target.value)}
                style={{ width: "100%", marginBottom: 16 }}
              >
                <option value="">Not scanning for a checkpoint</option>
                {checkpoints.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.timeState === "current" ? "→ " : ""}
                    Day {c.dayNumber} · {c.scheduledTime ? `${c.scheduledTime} · ` : ""}{c.label}
                    {c.status === "delayed" && c.delayMinutes > 0 ? ` (Delayed +${c.delayMinutes}m)` : ""}
                    {c.status === "moved" ? " (Moved)" : ""}
                    {c.timeState === "past" ? " (Done)" : c.timeState === "current" ? " (Now)" : ""}
                  </option>
                ))}
              </select>
            </>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ ...S.statCard, flex: 1 }}>
              <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>Boarded</div>
              <div className="mono" style={{ fontSize: 26, fontWeight: 800, color: "var(--st-present)" }}>
                {kpi.boarded ?? "…"}
              </div>
            </div>
            <div style={{ ...S.statCard, flex: 1 }}>
              <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>Late</div>
              <div className="mono" style={{ fontSize: 26, fontWeight: 800, color: "var(--st-late)" }}>
                {kpi.late ?? "…"}
              </div>
            </div>
            <div style={{ ...S.statCard, flex: 1 }}>
              <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>Missing</div>
              <div className="mono" style={{ fontSize: 26, fontWeight: 800, color: "var(--st-missing)" }}>
                {kpi.missing ?? "…"}
              </div>
            </div>
          </div>

          <div style={{ height: 8, background: "var(--line)", borderRadius: 4, marginTop: 12, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 4, background: "var(--st-present)",
              width: `${boardedPct}%`, transition: "width .4s ease",
            }} />
          </div>

          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-3)", marginTop: 20, marginBottom: 8 }}>
            Still missing / late
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {missingList.slice(0, 8).map((d) => (
              <div key={d.delegateId} className="card row between" style={{ padding: "10px 12px" }}>
                <span style={{ fontWeight: 600, fontSize: 13.5 }}>{d.name}</span>
                <div className="row" style={{ gap: 6 }}>
                  {d.vip && <span className="badge badge-missing">VIP</span>}
                  <span className={d.status === "LATE" ? "badge badge-late" : "badge badge-missing"}>
                    {d.status === "LATE" ? "Late" : "Missing"}
                  </span>
                </div>
              </div>
            ))}
            {missingList.length === 0 && coach && (
              <div className="card" style={{ padding: 14, textAlign: "center" }}>
                <span className="badge badge-present">All in</span>
              </div>
            )}
            {missingList.length > 8 && (
              <div className="muted" style={{ fontSize: 12.5, textAlign: "center" }}>
                + {missingList.length - 8} more
              </div>
            )}
          </div>

          {!coach && (
            <div className="muted" style={{ fontSize: 13, textAlign: "center", padding: 16 }}>
              <Users size={18} style={{ marginBottom: 4 }} /><br />
              Pick a coach to start scanning.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
