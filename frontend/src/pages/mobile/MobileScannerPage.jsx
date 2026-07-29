// frontend/src/pages/mobile/MobileScannerPage.jsx
// Mobile port of the desktop /scanner (UnifiedScannerPage.jsx) — the same
// three real check-in paths (Face / QR / Manual) that write to the shared
// delegate list, re-laid-out single-column for a phone held at an entrance.
// Routes: /mobile/scan/qr, /mobile/scan/face, /mobile/scan/manual — one per
// mode, each passing `lockMode` (inside MobileLayout, so the mobile topbar +
// tab bar are present). The old combined /mobile/scanner route was removed
// 2026-07-29 once the three standalone routes covered it.
//
// Shares the face vectorizer + validator + error tone with the desktop
// scanner via lib/faceScan.js (one copy, not three), and mounts Jayden's
// QRScannerPanel unmodified — exactly like the desktop page. Manual is the one
// path that is NOT the desktop component any more (see the import below): it's
// MobileManualCheckIn.jsx, a touch-first roster. The other differences are
// layout (single column, portrait viewport) and the face camera facing
// (environment/rear here, since a handheld phone points its back camera at the
// delegate, vs. the desktop's user-facing webcam).

import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  ScanFace, QrCode, PencilLine, AlertTriangle, CheckCircle2, RefreshCw, Camera, SwitchCamera,
  Mic, Moon, Sun, Zap, Turtle, Wifi, WifiOff, Undo2, Users, RotateCcw,
  Flashlight, FlashlightOff, Volume2, VolumeX, ScanEye, Clock, ShieldCheck, History,
} from "lucide-react";
import { apiGet, apiPost } from "../../lib/api.js";
import {
  vectorizeFaceLandmarks, vectorizeVoiceprint, captureVoiceEmbedding, isValidBiometricToken, playErrorTone,
  faceAlignment, parseFaceVector, averageFaceVectors, buildFaceToken, captureFrame, FACE_CROP,
} from "../../lib/faceScan.js";
// Real face recognition (deep embedding + liveness/anti-spoof) — the scan path
// now uses this so check-in matches the delegate's Human enrolment.
import { loadHuman, detectFace, gate as faceGate, averageEmbeddings, buildEmbeddingToken } from "../../lib/humanFace.js";

// Scans average this many vectorized frames, the same way enrollment does, so
// a single blurred frame can't cause a false rejection.
const SCAN_SAMPLES = 3;
import { useLang } from "../../lib/i18n.jsx";
import QRScannerPanel from "../../components/QRScannerPanel.jsx";
// Manual check-in is mobile's OWN screen, not the desktop panel (2026-07-29,
// Vimal). components/ManualTrackingPanel.jsx is `position:absolute; inset:0` —
// built to fill the desktop scanner's fixed camera square — so mounting it in
// this page's height-less "manual" viewport collapsed the roster to zero
// height: the list was invisible on a phone. MobileManualCheckIn is the
// touch-first replacement (swipe to check in, multi-select, session reason,
// undo snackbar). The desktop scanner still uses the original panel.
import MobileManualCheckIn from "./MobileManualCheckIn.jsx";
// Re-applied at integration 2026-07-29: this branch hardcoded
// `const TRIP_ID = "t-1"` at module scope, which silently pins the scanner to
// the base trip and undoes the mobile trip switcher. Read per-render instead so
// switching trips on Home propagates here.
import { getMobileTripId } from "../../lib/mobileTrip.js";

// Offline queue — check-ins captured while the phone has no signal (on a
// highway between venues) are stashed in localStorage and replayed to the
// server the moment connectivity returns, so a dead zone never loses a scan.
const QUEUE_KEY = "musterGo.offlineScans";
function loadQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; } catch { return []; }
}
function saveQueue(q) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* storage full/blocked — queue stays in memory */ }
}
// A network drop (fetch rejects with a TypeError, or the browser reports
// offline) is distinct from a server rejection (which carries .status/.code):
// only the former should queue for retry, the latter is a real "no match".
const isNetworkDown = (e) => !navigator.onLine || (e && e.name === "TypeError" && e.status === undefined);

// Haptic feedback (native-app touch) — a double-tick on a confirmed match, a
// single longer buzz on failure. No-op where the Vibration API is unsupported.
const haptic = (pattern) => { try { navigator.vibrate && navigator.vibrate(pattern); } catch { /* unsupported */ } };

// Two-letter monogram for the recent-check-ins avatars.
const initials = (name) => (name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

const SCAN_CSS = `
@keyframes mscan-line { 0% { top: 6%; } 50% { top: 92%; } 100% { top: 6%; } }
.mscan-line {
  position: absolute; left: 8%; right: 8%; height: 3px;
  background: var(--st-present); opacity: .85; border-radius: 3px;
  box-shadow: 0 0 16px var(--st-present);
  animation: mscan-line 1.6s ease-in-out infinite;
}
.mscan-corner { position: absolute; width: 34px; height: 34px; border: 4px solid var(--st-present); opacity: .9; z-index: 2; }
.mscan-corner.tl { top: 14px; left: 14px; border-right: none; border-bottom: none; border-radius: 10px 0 0 0; }
.mscan-corner.tr { top: 14px; right: 14px; border-left: none; border-bottom: none; border-radius: 0 10px 0 0; }
.mscan-corner.bl { bottom: 14px; left: 14px; border-right: none; border-top: none; border-radius: 0 0 0 10px; }
.mscan-corner.br { bottom: 14px; right: 14px; border-left: none; border-top: none; border-radius: 0 0 10px 0; }
@keyframes mscan-pop { from { transform: scale(.94); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.mscan-pop { animation: mscan-pop .18s ease-out; }

/* Brand hero — same red gradient language as the Home "Active trip" card. */
.mscan-hero {
  position: relative; overflow: hidden; border-radius: var(--r-lg);
  padding: 16px 18px; color: #fff;
  background: linear-gradient(135deg, var(--scc-red) 0%, var(--scc-red-700) 100%);
  box-shadow: var(--shadow-md);
  /* Owns its own bottom gap (2026-07-29 — "pls add some gap"). It used to
     inherit separation from the Reset/sync toolbar row that sat beneath it;
     that row is now conditional (it only renders when there's a sync problem),
     so with Reset moved into this card the hero was left sitting flush against
     the "CHECKING IN TO" label whenever everything was fine. */
  margin-bottom: 14px;
}
.mscan-hero-glow {
  position: absolute; top: -45%; right: -12%; width: 220px; height: 220px;
  border-radius: 50%; pointer-events: none;
  background: radial-gradient(circle, rgba(255,255,255,0.24), transparent 70%);
}

/* Legibility gradient behind the overlaid viewfinder chips. */
.mscan-vignette {
  position: absolute; inset: 0; pointer-events: none; z-index: 1;
  background: linear-gradient(to bottom, rgba(0,0,0,0.30), transparent 20%, transparent 80%, rgba(0,0,0,0.30));
}

/* Frosted floating controls over the camera (flip / torch). */
.mscan-glass {
  display: inline-flex; align-items: center; justify-content: center;
  width: 38px; height: 38px; border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.35); background: rgba(16,24,40,0.42);
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
  color: #fff; transition: background .15s, transform .05s;
}
.mscan-glass:active { transform: scale(0.92); }
.mscan-glass.on { background: var(--st-review); border-color: transparent; }

/* iOS-style segmented control for Face / QR / Manual. */
.mscan-seg {
  position: relative; display: grid; grid-template-columns: repeat(3, 1fr);
  padding: 4px; background: var(--surface-2); border: 1px solid var(--line); border-radius: 999px;
}
.mscan-seg-ind {
  position: absolute; top: 4px; bottom: 4px; left: 4px; width: calc((100% - 8px) / 3);
  border-radius: 999px; background: var(--surface); box-shadow: var(--shadow-sm);
  border: 1px solid var(--line);
  transition: transform .25s cubic-bezier(.4, 0, .2, 1);
}
.mscan-seg-btn {
  position: relative; z-index: 1; display: inline-flex; align-items: center; justify-content: center;
  gap: 6px; padding: 9px 0; border: none; background: none; border-radius: 999px;
  font-size: 13px; font-weight: 700; color: var(--ink-3); transition: color .2s;
}
.mscan-seg-btn.active { color: var(--scc-red); }

/* Hands-free auto-scan toggle row + switch. */
.mscan-toggle {
  width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 11px 14px; border-radius: var(--r-md);
  border: 1px solid var(--line); background: var(--surface); color: var(--ink);
}
.mscan-toggle.on { border-color: color-mix(in srgb, var(--st-present) 45%, var(--line)); background: var(--st-present-bg); }
.mscan-switch { flex-shrink: 0; width: 42px; height: 24px; border-radius: 999px; background: var(--line); position: relative; transition: background .2s; }
.mscan-switch.on { background: var(--st-present); }
.mscan-switch > span { position: absolute; top: 2px; left: 2px; width: 20px; height: 20px; border-radius: 50%; background: #fff; box-shadow: var(--shadow-sm); transition: transform .2s; }
.mscan-switch.on > span { transform: translateX(18px); }

/* Compact utility chips (sound / light / slow demo). */
.mscan-chip {
  flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 9px 6px; border-radius: var(--r-sm); border: 1px solid var(--line);
  background: var(--surface); color: var(--ink-2); font-size: 12.5px; font-weight: 600;
}
.mscan-chip.on { border-color: var(--scc-red-tint-2); background: var(--scc-red-tint); color: var(--scc-red); }

/* Recent check-in pills (horizontal scroller). */
.mscan-recent {
  flex-shrink: 0; display: flex; align-items: center; gap: 8px;
  padding: 8px 14px 8px 8px; border-radius: 999px;
  border: 1px solid var(--line); background: var(--surface);
}

@media (prefers-reduced-motion: reduce) {
  .mscan-line { animation: none; top: 48%; } .mscan-pop { animation: none; }
  .mscan-seg-ind, .mscan-switch, .mscan-switch > span, .mscan-glass { transition: none; }
}
`;

/**
 * `lockMode` ("face" | "qr" | "manual") pins this page to a single scanner and
 * swaps the in-page mode toggle for links to the OTHER two modes — that's what
 * lets each scanner be its own destination rather than three states of one
 * screen. Every live route now passes it (see App.jsx), so the undefined case
 * — the original combined toggle — is no longer reachable; the branches are
 * left in place because they're harmless and re-adding a combined route would
 * otherwise mean rebuilding them.
 */
export default function MobileScannerPage({ lockMode }) {
  const { t } = useLang();
  const navigate = useNavigate();
  // Per-render so the Home trip switcher propagates (see the import note above).
  const TRIP_ID = getMobileTripId();
  const [coaches, setCoaches] = useState([]);
  const [coachId, setCoachId] = useState(null);
  const [coach, setCoach] = useState(null);
  const [loadErr, setLoadErr] = useState("");

  const [scanMode, setScanMode] = useState(lockMode || "face"); // face | qr | manual
  // Keep the mode pinned if the route changes between the Face and QR tabs.
  useEffect(() => { if (lockMode) setScanMode(lockMode); }, [lockMode]);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null); // { name, time }
  const [scanError, setScanError] = useState("");
  const [camError, setCamError] = useState("");
  const [resetTick, setResetTick] = useState(0);
  const [facing, setFacing] = useState("user"); // user (selfie) | environment (rear)
  // Owns QRScannerPanel's manual-entry toggle in controlled mode (2026-07-29 —
  // see the component's doc comment for why: manual entry is rendered as a
  // labelled button BELOW the viewport here, not the in-video icon it draws by
  // default). Reset alongside the camera whenever the mode/reset key changes,
  // so switching away from QR and back doesn't reopen a stale sheet.
  const [qrManualOpen, setQrManualOpen] = useState(false);
  useEffect(() => { setQrManualOpen(false); }, [scanMode, resetTick]);

  // Low-light voice fallback + slow-scan demo — same feature as Vimal's
  // original QRCheckInPage.jsx "Me tab" scanner, brought to this page too.
  const [lowLight, setLowLight] = useState(false);
  const [autoLowLight, setAutoLowLight] = useState(false); // true when the ambient sensor tripped it, not the demo button
  const [luxEstimate, setLuxEstimate] = useState(null); // live ambient reading shown in the viewfinder banner

  // Live-sync + offline queue (Live Sync Badge feature).
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [pending, setPending] = useState(loadQueue);

  const [queuedNotice, setQueuedNotice] = useState(""); // brief "saved offline" toast

  // Individual + group reset (multi-leg headcount).
  const [resetBusy, setResetBusy] = useState(false);
  const [confirmCoachReset, setConfirmCoachReset] = useState(false);
  const [simulateSlow, setSimulateSlow] = useState(false); // demo the >1s SLA breach on demand
  const [passphrase, setPassphrase] = useState("");
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [voiceFinal, setVoiceFinal] = useState(false);
  const [micLevel, setMicLevel] = useState(0); // live input level while recording
  const [scanAlign, setScanAlign] = useState({ ready: false, hint: "" }); // live circle feedback

  // Scanner ergonomics — all client-side, no backend changes.
  const [soundOn, setSoundOn] = useState(true);          // audible chime on a confirmed match
  const [autoScan, setAutoScan] = useState(false);       // hands-free: fire the moment a face aligns
  const [torchOn, setTorchOn] = useState(false);         // rear-camera flashlight (night entrances)
  const [torchSupported, setTorchSupported] = useState(false);
  const [sessionScans, setSessionScans] = useState([]);  // this shift's confirmed check-ins (most recent first)

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const autoScanRef = useRef(0);   // timestamp of the last auto-fired scan (cooldown)
  const faceBusyRef = useRef(false); // serializes Human inference (live gate vs a scan)
  const recognitionRef = useRef(null);
  const voiceTimeoutRef = useRef(null);

  const fetchCoaches = useCallback(async () => {
    try {
      setLoadErr("");
      const data = await apiGet("/attendance/coaches");
      setCoaches(data.coaches || []);
      setCoachId((prev) => {
        if (prev && (data.coaches || []).some((c) => c.id === prev)) return prev;
        const withPeople = (data.coaches || []).find((c) => c.total > 0);
        return (withPeople || (data.coaches || [])[0] || {}).id || null;
      });
    } catch {
      setLoadErr("Could not load live data. Is the backend running on :4000?");
    }
  }, []);

  const fetchCoach = useCallback(async (id) => {
    if (!id) { setCoach(null); return; }
    try {
      setCoach(await apiGet(`/attendance/${TRIP_ID}/coach/${id}`));
    } catch {
      setCoach(null);
    }
  }, []);

  useEffect(() => { fetchCoaches(); }, [fetchCoaches]);
  useEffect(() => { fetchCoach(coachId); }, [coachId, fetchCoach]);

  /* Drain the offline queue: replay each stashed scan in order. A server
   * rejection (has .status/.code — e.g. that delegate is already boarded)
   * drops the item since a retry won't change it; a still-down network stops
   * the drain and leaves the remainder queued for the next reconnect. */
  const flushQueue = useCallback(async () => {
    if (!navigator.onLine || loadQueue().length === 0) return;
    let remaining = loadQueue();
    for (const item of [...remaining]) {
      try {
        await apiPost("/attendance/scan", {
          tripId: item.tripId, scanData: item.token, timestamp: item.timestamp, coachId: item.coachId,
        });
      } catch (e) {
        if (isNetworkDown(e)) break; // still offline — keep the rest queued
        // else: server rejected it — fall through and drop it
      }
      remaining = remaining.slice(1);
      saveQueue(remaining);
      setPending(remaining);
    }
    fetchCoaches();
    fetchCoach(coachId);
  }, [coachId, fetchCoaches, fetchCoach]);

  /* Reflect real connectivity and auto-sync the queue on reconnect. Also
   * attempt one flush on mount in case scans were left queued last session. */
  useEffect(() => {
    const goOnline = () => { setOnline(true); flushQueue(); };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    if (navigator.onLine) flushQueue();
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [flushQueue]);

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

  /* Face camera lifecycle — defaults to the front (selfie) camera so the
   * person holding the phone can scan their own face; the flip button below
   * switches to the rear camera for scanning someone else. Same
   * 1280x720-ideal request as QRScannerPanel so the preview is sharp. Gated
   * on !lowLight so the voice fallback fully owns the viewport. */
  useEffect(() => {
    const wantCamera = scanMode === "face" && !lowLight;
    let cancelled = false;

    async function start() {
      try {
        setCamError("");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((tr) => tr.stop()); return; }
        streamRef.current = stream;
        // Detect a controllable torch (rear cameras on most phones) so the
        // flashlight button only appears where it can actually do something.
        try {
          const track = stream.getVideoTracks()[0];
          const caps = track && track.getCapabilities ? track.getCapabilities() : {};
          setTorchSupported(!!caps.torch);
        } catch { setTorchSupported(false); }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch {
        if (!cancelled) setCamError("Camera unavailable — allow camera access to use the face scanner.");
      }
    }
    function stop() {
      if (streamRef.current) streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      setTorchSupported(false);
      setTorchOn(false);
    }

    if (wantCamera) start(); else stop();
    return () => { cancelled = true; stop(); };
  }, [scanMode, resetTick, facing, lowLight]);

  /* Automatic low-light multi-modal fallback: while the face camera is live,
   * sample a tiny (24x18) frame every ~1.2s, average its luminance, then zero
   * the sample's pixel bytes in place (same Zero-Image purge as the face
   * vectorizer). Two consecutive dark readings auto-disable the camera and
   * switch to the voice fallback, so delegates keep checking in hands-free. */
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

      // Map 0–255 luminance onto an approximate Lux scale so the viewfinder
      // banner can show a real number and the "< 10 Lux" threshold from the
      // spec lines up with a visibly dark frame (luma ~30 ≈ 10 Lux).
      const lux = Math.max(0, Math.round(avgLuma / 3));
      setLuxEstimate(lux);

      darkStreak = lux < 10 ? darkStreak + 1 : 0;
      if (darkStreak >= 2) {
        setAutoLowLight(true);
        setLowLight(true);
        setScanError("");
      }
    }, 1200);

    return () => { clearInterval(id); meter.width = 0; meter.height = 0; setLuxEstimate(null); };
  }, [scanMode, lowLight]);

  /* Warm the face model as soon as the face scanner opens, so the first scan
   * isn't stalled behind a ~10MB model load. */
  useEffect(() => {
    if (scanMode === "face" && !lowLight) loadHuman().catch(() => {});
  }, [scanMode, lowLight]);

  /* Live gate feedback (real Human detection) while the face camera is up, so
   * staff see the circle go green — including liveness/anti-spoof — before
   * tapping Scan. A recursive loop with a busy guard avoids overlapping the
   * ~200ms inferences and pauses itself during an actual scan. */
  useEffect(() => {
    if (!(scanMode === "face" && !lowLight) || camError) { setScanAlign({ ready: false, hint: "" }); return undefined; }
    let cancelled = false;
    async function loop() {
      if (cancelled) return;
      if (!faceBusyRef.current && !scanning && videoRef.current && videoRef.current.videoWidth) {
        faceBusyRef.current = true;
        try {
          const det = await detectFace(videoRef.current);
          const g = faceGate(det);
          if (!cancelled) setScanAlign({ ready: g.ready, hint: g.hint });
        } finally { faceBusyRef.current = false; }
      }
      if (!cancelled) setTimeout(loop, 400);
    }
    loop();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanMode, lowLight, camError, resetTick, scanning]);

  /* Hands-free auto-scan: when enabled, fire a scan the instant the face is
   * aligned in the circle, with a cooldown so one delegate isn't scanned over
   * and over. Lets a phone sit in a stand at the coach door and check people in
   * as they step up — no tap required. Same alignment gate as a manual scan. */
  useEffect(() => {
    if (!(autoScan && scanMode === "face" && !lowLight) || camError) return undefined;
    const id = setInterval(() => {
      if (scanning || scanResult || !scanAlign.ready) return;
      const now = Date.now();
      if (now - autoScanRef.current < 2500) return; // cooldown between people
      autoScanRef.current = now;
      handleFaceScan();
    }, 500);
    return () => clearInterval(id);
  }, [autoScan, scanMode, lowLight, camError, scanning, scanResult, scanAlign.ready]);

  function resetScanner() {
    setScanError("");
    setScanResult(null);
    setCamError("");
    setResetTick((n) => n + 1);
    fetchCoaches();
    fetchCoach(coachId);
  }

  // Pleasant rising two-note chime on a confirmed match — a second confirmation
  // channel alongside the haptic, so staff can keep their eyes on the queue.
  function successTone() {
    if (!soundOn) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const t0 = ctx.currentTime;
      [[784, 0], [1046.5, 0.08]].forEach(([freq, at]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0 + at);
        gain.gain.exponentialRampToValueAtTime(0.18, t0 + at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.2);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(t0 + at); osc.stop(t0 + at + 0.22);
      });
      setTimeout(() => ctx.close().catch(() => {}), 600);
    } catch { /* audio blocked — the haptic already fired */ }
  }

  // Rear-camera flashlight for dark entrances. Feature-detected in the camera
  // effect; applyConstraints is the only cross-browser way to drive it.
  async function toggleTorch() {
    const track = streamRef.current && streamRef.current.getVideoTracks
      ? streamRef.current.getVideoTracks()[0] : null;
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
    }
  }

  // Undo the most recent confirmed check-in (flip them back to Missing) —
  // e.g. a mis-scan, or the wrong delegate stepped forward.
  async function undoLastScan() {
    const last = sessionScans[0];
    if (!last || !last.delegateId) return;
    await resetDelegate(last.delegateId);
    setSessionScans((prev) => prev.slice(1));
  }

  // Stash a scan for later replay and surface a brief confirmation. Used both
  // when the phone is offline at capture time and when a live send fails on a
  // dropped connection.
  function enqueueScan(token) {
    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      token, tripId: TRIP_ID, coachId: coachId || undefined,
      timestamp: new Date().toISOString(),
    };
    const next = [...loadQueue(), item];
    saveQueue(next);
    setPending(next);
    setQueuedNotice("No signal — saved offline. It'll sync automatically.");
    setTimeout(() => setQueuedNotice(""), 3500);
  }

  async function submitScan(token) {
    // Captured with no signal: queue immediately rather than failing the scan.
    if (!navigator.onLine) {
      enqueueScan(token);
      return;
    }
    const started = performance.now();
    setScanning(true);
    setScanError("");
    setScanResult(null);
    setQueuedNotice("");
    try {
      // Demo hook: proves the ">1s -> error tone" SLA path on command.
      if (simulateSlow) await new Promise((r) => setTimeout(r, 1300));
      const res = await apiPost("/attendance/scan", {
        tripId: TRIP_ID,
        scanData: token,
        timestamp: new Date().toISOString(),
        coachId: coachId || undefined,
      });
      const elapsed = performance.now() - started;
      if (elapsed > 1000) {
        playErrorTone();
        haptic(140); // single long buzz on failure
        setScanError(`Took ${(elapsed / 1000).toFixed(1)}s (> 1s limit). Retry.`);
        return;
      }
      haptic([18, 40, 18]); // confirmed-match double-tick
      successTone();        // audible confirmation for eyes-on-the-queue scanning
      const time = `${(elapsed / 1000).toFixed(1)}s`;
      setScanResult({ name: res.name, time });
      // Session tally + recents strip (client-side only — this shift's log).
      setSessionScans((prev) => [
        { delegateId: res.delegateId, name: res.name, time, at: Date.now() },
        ...prev,
      ].slice(0, 12));
      fetchCoaches();
      fetchCoach(coachId);
      setTimeout(() => setScanResult(null), 3500);
    } catch (e) {
      // Connection dropped mid-send: queue it instead of reporting a failure.
      if (isNetworkDown(e)) {
        enqueueScan(token);
        return;
      }
      playErrorTone();
      haptic(140); // single long buzz on failure
      setScanError(
        e.code === "COACH_MISMATCH" ? `Coach mismatch — ${e.message}`
        : e.code === "ALREADY_BOARDED" ? e.message
        : e.code === "SCAN_FAILED" || e.status === 404
          ? (e.message || "Not recognised — has this delegate enrolled at /enroll?")
          : e.message || "Scan failed — check the backend connection."
      );
    } finally {
      setScanning(false);
    }
  }

  async function resetDelegate(delegateId) {
    setResetBusy(true);
    setScanError("");
    try {
      await apiPost("/attendance/reset", { delegateId });
      fetchCoaches();
      fetchCoach(coachId);
    } catch (e) {
      setScanError(e.message || "Could not reset that delegate.");
    } finally {
      setResetBusy(false);
    }
  }

  async function resetCoach() {
    if (!coachId) return;
    setResetBusy(true);
    setScanError("");
    try {
      await apiPost("/attendance/reset-coach", { coachId });
      setConfirmCoachReset(false);
      fetchCoaches();
      fetchCoach(coachId);
    } catch (e) {
      setConfirmCoachReset(false);
      setScanError(
        e.code === "NOTHING_TO_RESET" ? e.message : e.message || "Could not reset this coach."
      );
    } finally {
      setResetBusy(false);
    }
  }

  /* Gated scan (real recognition): the delegate's face must pass the same
   * liveness + anti-spoof + quality gate enrolment uses before anything is
   * sent. Then SCAN_SAMPLES deep embeddings are captured and averaged, exactly
   * like the enrolled template, so the backend can match them directly. */
  async function handleFaceScan() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setScanError("Camera not ready yet — wait a moment and try again.");
      return;
    }

    // 1) Live gate — refuse a spoof / poorly-framed / non-live face up front
    // with a specific reason, rather than sending something the matcher rejects.
    const first = await detectFace(video);
    const g = faceGate(first);
    if (!g.ready) { setScanError(g.hint); return; }

    // 2) Multi-sample real embeddings
    setScanning(true);
    faceBusyRef.current = true;
    const samples = [];
    for (let i = 0; i < SCAN_SAMPLES; i += 1) {
      const det = await detectFace(video);
      if (det.ok && det.embedding && faceGate(det).ready) samples.push(det.embedding);
      if (i < SCAN_SAMPLES - 1) await new Promise((r) => setTimeout(r, 120));
    }
    faceBusyRef.current = false;
    setScanning(false);

    const token = samples.length ? buildEmbeddingToken(averageEmbeddings(samples)) : null;
    if (!token) {
      setScanError("Couldn't read a clear face — try again in better light.");
      return;
    }
    submitScan(token);
  }

  /* Acoustic voiceprint check-in: records ~2s of the delegate's voice through
   * the Web Audio FFT and matches it against their ENROLLED voiceprint (the
   * same 64-band spectrum captured at /enroll). No audio is recorded to a file
   * — only frequency magnitudes. Falls back to the typed passphrase below for
   * browsers with no Web Audio support. */
  async function startVoiceCapture() {
    if (voiceListening) return;
    if (!(window.AudioContext || window.webkitAudioContext) || !navigator.mediaDevices) {
      setVoiceError("This browser can't record audio — type the passphrase instead.");
      return;
    }
    setScanError("");
    setVoiceError("");
    setVoiceStatus("Listening… ask them to speak now");
    setVoiceListening(true);
    try {
      const token = await captureVoiceEmbedding(2500, (lvl) => setMicLevel(lvl));
      if (!token) {
        setVoiceError("Too quiet to match — ask them to speak up and try again.");
        setVoiceStatus("");
        return;
      }
      setVoiceStatus("Matching voiceprint…");
      await submitScan(token);
      setVoiceStatus("");
    } catch {
      setVoiceError("Microphone access is required for spoken check-in. Allow the browser to use your mic.");
      setVoiceStatus("");
    } finally {
      setVoiceListening(false);
      setMicLevel(0);
    }
  }

  function handleVoiceScan(overridePhrase) {
    const phrase = (overridePhrase ?? passphrase).trim();
    if (phrase.length < 4) {
      setVoiceError("Passphrase too short — ask the delegate for the full passphrase.");
      return;
    }
    // No speech-recognition guard any more: the typed passphrase is now an
    // explicit no-microphone fallback, not a transcript of a recording.
    setVoiceError("");
    submitScan(vectorizeVoiceprint(phrase));
    setPassphrase("");
    setVoiceStatus("");
    setVoiceFinal(false);
  }

  const boardedPct = coach && coach.expected > 0 ? Math.round((coach.boarded / coach.expected) * 100) : 0;
  // Delegates already on this coach — the reset targets. Both ARRIVED (current)
  // and PRESENT (legacy) count as boarded, matching the backend.
  const boardedList = (coach?.delegates || []).filter((d) => d.status === "PRESENT" || d.status === "ARRIVED");

  const modeIndex = ["face", "qr", "manual"].indexOf(scanMode);
  const sessionCount = sessionScans.length;
  const avgSeconds = sessionCount
    ? sessionScans.reduce((s, r) => s + (parseFloat(r.time) || 0), 0) / sessionCount
    : 0;

  const S = {
    // Camera viewport only. Manual check-in is no longer squeezed in here — it
    // renders as its own full-width card below (MobileManualCheckIn), because a
    // roster needs to grow with its content, not sit in a square camera crop.
    viewport: {
      position: "relative", borderRadius: "var(--r-lg)", overflow: "hidden",
      background: "#000", width: "100%", aspectRatio: "1", maxHeight: "58vh",
      boxShadow: "var(--shadow-md)",
    },
    overlay: {
      position: "absolute", inset: 0, display: "flex", alignItems: "center",
      justifyContent: "center", padding: 20, textAlign: "center", flexDirection: "column", gap: 10, zIndex: 4,
    },
  };

  return (
    <div>
      <style>{SCAN_CSS}</style>

      {/* Brand hero with a live session tally */}
      <div className="mscan-hero">
        <div className="mscan-hero-glow" />
        <div className="row between" style={{ alignItems: "flex-start", position: "relative" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.85 }}>
              {t("Entrance scanner")}
            </div>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: 24, margin: "3px 0 0", color: "#fff", lineHeight: 1.15 }}>
              {lockMode === "face" ? t("Face scan")
                : lockMode === "qr" ? t("QR scan")
                : lockMode === "manual" ? t("Manual check-in")
                : t("Face + QR scan")}
            </h1>
          </div>
          {/* Reset lives IN the hero now (2026-07-29 — "i think the reset icon
              put in the red kpi section"), which removes the orphaned toolbar
              row it used to sit in entirely. It belongs here on two counts:
              it's a page-level action rather than a scanning one, and what it
              actually resets is this card's session tally — so pairing it with
              the number it clears is self-explanatory. Icon-only with an
              aria-label/title, since a text button would compete with the
              tally for the eye. */}
          <div className="row" style={{ flexShrink: 0, gap: 8, alignItems: "stretch" }}>
            {/* Manual mode counts the COACH, not this session's matches
                (2026-07-29, Vimal): there's no match timing to average, and
                the number staff care about while working a roster by hand is
                "how many are on board", not "how many I personally scanned". */}
            <div style={{ textAlign: "center", background: "rgba(255,255,255,0.16)", borderRadius: 14, padding: "8px 14px", minWidth: 76 }}>
              <div className="mono" style={{ fontSize: 26, fontWeight: 800, lineHeight: 1 }}>
                {scanMode === "manual" ? (coach ? coach.boarded : 0) : sessionCount}
              </div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", opacity: 0.85, marginTop: 3 }}>
                {scanMode === "manual" ? `${t("of")} ${coach ? coach.expected : 0} ${t("on board")}` : t("checked in")}
              </div>
            </div>
            <button
              onClick={resetScanner}
              aria-label={t("Reset scanner")}
              title={t("Reset scanner")}
              style={{
                flexShrink: 0, width: 40, borderRadius: 14, cursor: "pointer",
                background: "rgba(255,255,255,0.16)", border: "none", color: "#fff",
                display: "grid", placeItems: "center",
              }}
            >
              <RefreshCw size={17} />
            </button>
          </div>
        </div>
        {scanMode !== "manual" && sessionCount > 0 && (
          <div className="row" style={{ gap: 6, marginTop: 10, position: "relative", fontSize: 12, fontWeight: 600, opacity: 0.92 }}>
            <Clock size={13} /> {t("Avg match")} {avgSeconds.toFixed(1)}s · {t("this session")}
          </div>
        )}
      </div>

      {/* Sync status. Reset moved into the hero above, so this row now exists
          ONLY for the offline/pending badge — and it's rendered conditionally
          rather than always: an empty flex row still costs its 24px of margin,
          which is what left a dead gap above the coach picker once the badge
          learned to hide itself in the all-clear state (entry 161). The same
          condition lives in SyncBadge as a safety net; this one keeps the
          WRAPPER from taking space. */}
      {(!online || pending.length > 0) && (
        <div className="row" style={{ marginTop: 12, marginBottom: 12 }}>
          <SyncBadge online={online} pending={pending.length} onFlush={flushQueue} t={t} />
        </div>
      )}

      {loadErr && (
        <div className="mobile-card" style={{ borderColor: "var(--st-missing)", background: "var(--st-missing-bg)" }}>
          <div className="row" style={{ gap: 8, color: "var(--st-missing)", fontWeight: 600, fontSize: 13 }}>
            <AlertTriangle size={15} /> {t(loadErr)}
          </div>
        </div>
      )}

      {/* Coach picker */}
      <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--ink-3)", display: "block", marginBottom: 6 }}>
        {t("Checking in to")}
      </label>
      <select
        className="select"
        value={coachId || ""}
        onChange={(e) => setCoachId(e.target.value)}
        style={{ width: "100%", marginBottom: 12 }}
      >
        {coaches.length === 0 && <option value="">{t("Loading coaches…")}</option>}
        {coaches.map((c) => (
          <option key={c.id} value={c.id}>
            {(c.label || c.id.toUpperCase())} · {c.name} ({c.boarded}/{c.total})
          </option>
        ))}
      </select>

      {/* Manual check-in owns the whole width as its own card — a roster, not a
          camera feed. Everything camera-shaped below is skipped in this mode. */}
      {scanMode === "manual" && (
        <>
          <MobileManualCheckIn
            key={resetTick}
            coach={coach}
            coachLabel={coach?.coachLabel}
            coachId={coachId}
            tripId={TRIP_ID}
            onCheckedIn={() => { fetchCoaches(); fetchCoach(coachId); }}
          />
          {/* Manual's own single reset action, since the shared boarded-roster
              card (with its own per-row + group reset) is hidden in this mode —
              see the guard on that card below for why. */}
          {boardedList.length > 0 && (
            <button
              className="btn btn-ghost btn-block"
              style={{ marginTop: 10, color: "var(--scc-red)" }}
              onClick={() => setConfirmCoachReset(true)}
              disabled={resetBusy}
            >
              <RotateCcw size={15} /> {t("Reset headcount for the next leg")}
            </button>
          )}
        </>
      )}

      {/* Scanner viewport (face / QR) */}
      {scanMode !== "manual" && (
      <div style={S.viewport}>
        {scanMode === "face" && !lowLight && (
          <>
            <video
              ref={videoRef} autoPlay playsInline muted
              style={{ width: "100%", height: "100%", objectFit: "cover", transform: facing === "user" ? "scaleX(-1)" : "none" }}
            />
            <div className="mscan-vignette" />
            <span className="mscan-corner tl" /><span className="mscan-corner tr" />
            <span className="mscan-corner bl" /><span className="mscan-corner br" />
            {/* Floating glass controls — flip camera + torch. */}
            {!camError && (
              <div style={{ position: "absolute", top: 12, right: 12, display: "flex", flexDirection: "column", gap: 8, zIndex: 3 }}>
                <button
                  className="mscan-glass" onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
                  aria-label="Flip camera" title="Flip camera"
                >
                  <SwitchCamera size={17} />
                </button>
                {torchSupported && (
                  <button
                    className={`mscan-glass ${torchOn ? "on" : ""}`} onClick={toggleTorch}
                    aria-label={torchOn ? "Torch off" : "Torch on"} title={torchOn ? "Torch off" : "Torch on"}
                  >
                    {torchOn ? <Flashlight size={17} /> : <FlashlightOff size={17} />}
                  </button>
                )}
              </div>
            )}
            {/* Alignment circle — marks the exact region the vectorizer reads.
                The delegate's face must sit here for the scan to match the
                sample they enrolled with. */}
            {!camError && (
              <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
                <div style={{
                  height: `${FACE_CROP * 100}%`, aspectRatio: "1", borderRadius: "50%",
                  border: `2.5px ${scanAlign.ready ? "solid" : "dashed"} ${scanAlign.ready ? "#22c55e" : "rgba(255,255,255,0.8)"}`,
                  transition: "border-color .2s",
                }} />
                {scanAlign.hint && (
                  <div style={{
                    position: "absolute", bottom: 14, left: "50%", transform: "translateX(-50%)",
                    padding: "5px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap",
                    background: scanAlign.ready ? "rgba(22,163,74,0.92)" : "rgba(16,24,40,0.72)", color: "#fff",
                  }}>
                    {scanAlign.ready ? "Aligned — ready to scan" : scanAlign.hint}
                  </div>
                )}
              </div>
            )}
            {scanning && <span className="mscan-line" />}
            {!camError && luxEstimate != null && (
              <div
                style={{
                  position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)",
                  display: "flex", alignItems: "center", gap: 6, padding: "5px 11px",
                  borderRadius: 999, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap",
                  background: luxEstimate < 20 ? "rgba(180,83,9,0.92)" : "rgba(16,24,40,0.6)",
                  color: "#fff", backdropFilter: "blur(4px)",
                }}
              >
                {luxEstimate < 20 ? <Moon size={13} /> : <Sun size={13} />}
                {luxEstimate} {t("Lux")}
                {luxEstimate < 20 && <span style={{ fontWeight: 600, opacity: 0.9 }}>· {t("voice fallback ready")}</span>}
              </div>
            )}
            {camError && (
              <div style={S.overlay}>
                <Camera size={26} color="#fff" />
                <div style={{ fontSize: 14, maxWidth: 260, color: "#fff" }}>{t(camError)}</div>
                <div style={{ fontSize: 12.5, color: "var(--line)" }}>{t("Switch to QR or Manual below.")}</div>
              </div>
            )}
          </>
        )}

        {scanMode === "face" && lowLight && (
          <div style={{ ...S.overlay, background: "var(--ink)" }}>
            <Mic size={30} style={{ color: "var(--st-review)" }} />
            <div style={{ fontWeight: 700, color: "#fff" }}>
              {autoLowLight ? "Low light detected — sensor" : "Low light detected"}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--line)", maxWidth: 260 }}>
              {autoLowLight
                ? "Ambient light dropped below threshold, so the camera switched itself off. "
                : "Camera paused for fairness — face matching degrades unevenly in the dark. "}
              Ask the delegate to <strong>say their passphrase</strong> instead.
            </div>
            <button className="btn btn-primary" onClick={startVoiceCapture} disabled={scanning || voiceListening}>
              <Mic size={15} /> {voiceListening ? "Listening…" : "Scan voiceprint"}
            </button>
            {/* Live mic level so staff can see it's actually hearing them */}
            {voiceListening && (
              <div style={{ width: 200, height: 6, background: "rgba(255,255,255,0.25)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: 3, background: "var(--st-present)",
                  width: `${Math.min(100, Math.round(micLevel * 260))}%`, transition: "width .08s linear",
                }} />
              </div>
            )}
            <details style={{ width: "100%", maxWidth: 240 }}>
              <summary style={{ fontSize: 11.5, color: "var(--line)", cursor: "pointer" }}>No mic? Type the passphrase</summary>
              <input
                className="input" placeholder="Passphrase…" value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleVoiceScan(); }}
                style={{ textAlign: "center", marginTop: 8 }}
              />
              <button className="btn btn-primary btn-block" style={{ marginTop: 8 }} onClick={() => handleVoiceScan()} disabled={scanning || !passphrase.trim()}>
                {scanning ? "Submitting…" : "Submit passphrase"}
              </button>
            </details>
            {(voiceStatus || voiceError || scanError) && (
              <div style={{ fontSize: 12, color: voiceError ? "#f87171" : "#fff" }}>
                {voiceError || voiceStatus || scanError}
              </div>
            )}
          </div>
        )}

        {scanMode === "qr" && (
          <>
            <QRScannerPanel
              key={resetTick}
              tripId={TRIP_ID}
              coachId={coachId}
              coachLabel={coach?.coachLabel}
              facingMode={facing}
              manualOpen={qrManualOpen}
              onManualOpenChange={setQrManualOpen}
              onCheckedIn={(info) => {
                fetchCoaches(); fetchCoach(coachId);
                // Session tally + recents strip (2026-07-30 — "i successfully
                // able to checkin by scanning qr code. but this part not
                // updated"): the hero's "N checked in" count only ever grew
                // from THIS page's OWN submitScan() (Face/Voice) — a QR scan,
                // handled entirely inside QRScannerPanel, never told this
                // page it happened at all. Re-scanning an already-boarded
                // badge doesn't add a new tally entry (matches the Face path,
                // which also only counts a genuinely NEW confirmed match).
                if (info?.delegateId && !info.alreadyBoarded) {
                  setSessionScans((prev) => [
                    { delegateId: info.delegateId, name: info.name, time: `${(info.elapsedMs / 1000).toFixed(1)}s`, at: Date.now() },
                    ...prev,
                  ].slice(0, 12));
                }
              }}
            />
            {/* Back at top:12/right:12 (2026-07-29) — the collision this was
                offset for is gone now that QRScannerPanel is passed
                `manualOpen`/`onManualOpenChange`: in controlled mode it draws
                NO in-video icon of its own (see its doc comment), so this
                corner is free again. The manual-entry trigger moved to a
                labelled button below the viewport instead — see there for why. */}
            {!lowLight && (
              <button
                className="mscan-glass" onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
                aria-label="Flip camera" title="Flip camera"
                style={{ position: "absolute", top: 12, right: 12, zIndex: 3 }}
              >
                <SwitchCamera size={17} />
              </button>
            )}
          </>
        )}

        {scanResult && (
          <div style={S.overlay}>
            <div className="mobile-card mscan-pop" style={{ padding: "16px 18px", margin: 0, maxWidth: 280 }}>
              <div className="row" style={{ gap: 12 }}>
                <CheckCircle2 size={34} style={{ color: "var(--st-present)", flexShrink: 0 }} />
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{scanResult.name}</div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {t("Matched")} · {scanResult.time} · {coach?.coachLabel || t("Coach")} ✓
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      )}

      {/* Manual-entry trigger for QR, moved OFF the video (2026-07-29 —
          layout advice given, then implemented on request). It isn't a camera
          control — it's the fallback staff reach for when a code won't scan,
          often under time pressure — so it's a findable labelled button here
          rather than a 32px glass icon competing with the scan-guide corners.
          QRScannerPanel is `position:absolute; inset:0` inside the viewport
          box above, so it can't render anything below itself; that's why this
          lives in the parent instead, wired through the `manualOpen`/
          `onManualOpenChange` controlled-mode props. */}
      {scanMode === "qr" && !qrManualOpen && (
        <button
          className="btn btn-ghost btn-block"
          style={{ marginTop: 10 }}
          onClick={() => setQrManualOpen(true)}
        >
          <PencilLine size={15} /> {t("Enter code manually")}
        </button>
      )}

      {/* Locked to one mode (the Face / QR / Manual routes) — offer the other
          two as a compact switcher, so Manual check-in is always one tap away
          when a scan won't cooperate. */}
      {lockMode && (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          {[
            { key: "face", label: "Face", Icon: ScanFace, to: "/mobile/scan/face" },
            { key: "qr", label: "QR", Icon: QrCode, to: "/mobile/scan/qr" },
            { key: "manual", label: "Manual", Icon: PencilLine, to: "/mobile/scan/manual" },
          ]
            .filter((m) => m.key !== lockMode)
            .map(({ key, label, Icon, to }) => (
              <button key={key} className="mscan-chip" onClick={() => navigate(to)}>
                <Icon size={14} /> {t(label)}
              </button>
            ))}
        </div>
      )}

      {/* Mode segmented control — hidden when the route pins this page to one
          scanner (the separate Face / QR bottom-nav tabs). */}
      {!lockMode && (
        <div className="mscan-seg" style={{ marginTop: 12 }}>
          <span className="mscan-seg-ind" style={{ transform: `translateX(${modeIndex * 100}%)` }} />
          {[
            { key: "face", label: "Face", Icon: ScanFace },
            { key: "qr", label: "QR", Icon: QrCode },
            { key: "manual", label: "Manual", Icon: PencilLine },
          ].map(({ key, label, Icon }) => (
            <button
              key={key}
              className={`mscan-seg-btn ${scanMode === key ? "active" : ""}`}
              onClick={() => { setScanMode(key); setScanError(""); }}
            >
              <Icon size={16} /> {t(label)}
            </button>
          ))}
        </div>
      )}

      {scanMode === "face" && !lowLight && !camError && (
        <>
          <button
            className="btn btn-primary btn-block" style={{ marginTop: 12, padding: "14px 0", fontSize: 15 }}
            onClick={handleFaceScan} disabled={scanning}
          >
            <ScanFace size={18} /> {scanning ? t("Processing…") : t("Scan face")}
          </button>
          {/* Hands-free auto-scan — fires the instant a face aligns. */}
          <button
            className={`mscan-toggle ${autoScan ? "on" : ""}`} onClick={() => setAutoScan((v) => !v)}
            style={{ marginTop: 8 }} aria-pressed={autoScan}
          >
            <span className="row" style={{ gap: 10 }}>
              <ScanEye size={17} style={{ color: autoScan ? "var(--st-present)" : "var(--ink-3)", flexShrink: 0 }} />
              <span style={{ display: "flex", flexDirection: "column", textAlign: "left" }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{t("Hands-free auto-scan")}</span>
                <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                  {autoScan ? t("Fires the moment a face aligns") : t("Scan without pressing the button")}
                </span>
              </span>
            </span>
            <span className={`mscan-switch ${autoScan ? "on" : ""}`}><span /></span>
          </button>
        </>
      )}

      {scanError && (
        <div style={{
          marginTop: 12, borderRadius: "var(--r-sm)", padding: 12, fontSize: 13.5,
          background: "var(--st-missing-bg)", color: "var(--scc-red-700)",
          border: "1px solid var(--scc-red-tint-2)",
        }}>
          <AlertTriangle size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
          {t(scanError)}
        </div>
      )}

      {queuedNotice && (
        <div style={{
          marginTop: 12, borderRadius: "var(--r-sm)", padding: 12, fontSize: 13.5,
          background: "var(--st-review-bg, rgba(180,83,9,0.1))", color: "var(--st-review, #b45309)",
          border: "1px solid var(--st-review, #b45309)",
        }}>
          <WifiOff size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
          {t(queuedNotice)}
        </div>
      )}

      {/* Sound + simulated sensors — the confirmation chime, plus the demo
          toggles for the fairness fallback and the 1s SLA. Camera-only, so
          hidden for Manual (2026-07-29, Vimal): none of the three apply to a
          hand-typed roster — there's no chime timing, no light sensor, no
          scan SLA to simulate. */}
      {scanMode !== "manual" && (
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            className={`mscan-chip ${soundOn ? "on" : ""}`}
            onClick={() => setSoundOn((v) => !v)}
            aria-pressed={soundOn} title={soundOn ? "Mute confirmation chime" : "Play confirmation chime"}
          >
            {soundOn ? <Volume2 size={14} /> : <VolumeX size={14} />}
            {soundOn ? t("Sound on") : t("Sound off")}
          </button>
          <button
            className={`mscan-chip ${lowLight ? "on" : ""}`}
            onClick={() => { setAutoLowLight(false); setLowLight((v) => !v); setScanError(""); }}
          >
            {lowLight ? <Sun size={14} /> : <Moon size={14} />}
            {lowLight ? t("Normal light") : t("Low light")}
          </button>
          <button
            className={`mscan-chip ${simulateSlow ? "on" : ""}`}
            onClick={() => setSimulateSlow((v) => !v)}
          >
            {simulateSlow ? <Zap size={14} /> : <Turtle size={14} />}
            {simulateSlow ? t("Slow: on") : t("Slow demo")}
          </button>
      </div>
      )}

      {/* Recent check-ins — this shift's confirmed matches, newest first, with
          a one-tap undo of the most recent (client-side session log). Camera
          modes only — Manual has its own on-the-spot undo per row inside
          MobileManualCheckIn, so this list would just duplicate it. */}
      {scanMode !== "manual" && sessionScans.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="row between" style={{ marginBottom: 8 }}>
            <span className="row" style={{ gap: 6, fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--ink-3)" }}>
              <History size={13} /> {t("Recent check-ins")}
            </span>
            {sessionScans[0]?.delegateId && (
              <button
                className="btn btn-ghost" style={{ padding: "5px 10px", fontSize: 12, color: "var(--scc-red)" }}
                onClick={undoLastScan} disabled={resetBusy}
              >
                <Undo2 size={13} /> {t("Undo last")}
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
            {sessionScans.slice(0, 8).map((r) => (
              <div key={`${r.delegateId}-${r.at}`} className="mscan-recent">
                <span className="avatar" style={{ background: "var(--st-present-bg)", color: "var(--st-present)" }}>
                  {initials(r.name)}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 116 }}>
                    {r.name}
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>{r.time}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live count + boarded roster for the selected coach, with reset controls.
          Hidden for Manual (2026-07-29, Vimal): MobileManualCheckIn already
          renders its own boarded/to-check-in split with the same delegates —
          this card would just be a second, redundant roster below it. Manual
          gets its own single "Reset headcount" action instead, right below. */}
      {scanMode !== "manual" && coach && (
        <div className="mobile-card" style={{ marginTop: 16, padding: 16 }}>
          <div className="row between" style={{ alignItems: "baseline" }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{coach.coachLabel}</span>
            <span className="mono" style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
              {coach.boarded}/{coach.expected} {t("boarded")} · {coach.missing} {t("missing")}
            </span>
          </div>
          <div className="row between" style={{ marginTop: 12, marginBottom: 6 }}>
            <span className="muted" style={{ fontSize: 12 }}>{t("Boarding progress")}</span>
            <span className="mono" style={{ fontSize: 13, fontWeight: 800, color: "var(--st-present)" }}>{boardedPct}%</span>
          </div>
          <div style={{ height: 9, background: "var(--line)", borderRadius: 999, overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 999, background: "linear-gradient(90deg, var(--st-present), #34d399)", width: `${boardedPct}%`, transition: "width .4s ease" }} />
          </div>

          {/* Boarded roster — each row can be individually reset to Missing
              (e.g. a delegate who got off at a rest stop). */}
          <div className="row between" style={{ marginTop: 14, alignItems: "center" }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--ink-3)" }}>
              {t("Boarded")} · {boardedList.length}
            </span>
            {boardedList.length > 0 && (
              <button
                className="btn btn-ghost"
                style={{ padding: "6px 10px", fontSize: 12, color: "var(--scc-red)" }}
                onClick={() => setConfirmCoachReset(true)}
                disabled={resetBusy}
              >
                <RotateCcw size={13} /> {t("Reset coach")}
              </button>
            )}
          </div>

          {boardedList.length === 0 ? (
            <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
              {t("No one boarded yet — scan a face or QR to start the headcount.")}
            </div>
          ) : (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              {boardedList.map((d) => (
                <div
                  key={d.delegateId}
                  className="row between"
                  style={{ padding: "8px 10px", borderRadius: "var(--r-sm)", background: "var(--st-present-bg, rgba(16,185,129,0.08))" }}
                >
                  <div className="row" style={{ gap: 8, minWidth: 0 }}>
                    <CheckCircle2 size={15} style={{ color: "var(--st-present)", flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {d.name}
                    </span>
                  </div>
                  <button
                    onClick={() => resetDelegate(d.delegateId)}
                    disabled={resetBusy}
                    aria-label={`${t("Reset")} ${d.name}`}
                    title={`${t("Reset to missing")} — ${d.name}`}
                    style={{ background: "none", border: "none", padding: 5, display: "flex", flexShrink: 0, color: "var(--ink-3)" }}
                  >
                    <Undo2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Group reset confirmation */}
      {confirmCoachReset && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,0.45)", display: "flex", alignItems: "flex-end", zIndex: 60 }}
          onClick={() => !resetBusy && setConfirmCoachReset(false)}
        >
          <div
            className="card"
            style={{ width: "100%", borderRadius: "16px 16px 0 0", padding: 18, paddingBottom: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="row" style={{ gap: 10, marginBottom: 6 }}>
              <Users size={20} style={{ color: "var(--scc-red)" }} />
              <div style={{ fontWeight: 700, fontSize: 15 }}>{t("Reset entire coach headcount?")}</div>
            </div>
            <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              {t("This flips all")} {boardedList.length} {t("boarded delegates on")} {coach?.coachLabel} {t("back to Missing, for a fresh headcount at the next venue.")}
            </p>
            <div className="row" style={{ gap: 10, marginTop: 18 }}>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setConfirmCoachReset(false)} disabled={resetBusy}>
                {t("Cancel")}
              </button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={resetCoach} disabled={resetBusy}>
                <RotateCcw size={15} /> {resetBusy ? t("Resetting…") : t("Reset all")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="row" style={{ gap: 8, alignItems: "flex-start", marginTop: 16, padding: "0 2px" }}>
        <ShieldCheck size={15} style={{ color: "var(--st-present)", flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
          {scanMode === "manual"
            ? t("Every manual check-in is logged with who did it, when, and the reason given — the head-count and the audit trail stay in step with a scanned one.")
            : t("Zero-Image mode: raw face pixels are zeroed in memory the instant the anonymous token is derived. No images stored or transmitted — PDPA compliant.")}
        </div>
      </div>
    </div>
  );
}

/** Live-sync status pill under the page title. Green when everything's synced,
 *  amber when scans are queued offline (tap to force a sync once back online),
 *  red when the phone reports no connection at all.
 *
 *  Renders NOTHING in the all-clear state (2026-07-29 — "what are the different
 *  for live synce and synced in mobile page / if both work remove the live
 *  synce"). The two indicators are NOT equivalent, so this one isn't deleted:
 *
 *    · MobileLayout's topbar "Synced" chip is `navigator.onLine` ONLY — a
 *      browser connectivity flag. It knows nothing about scan data, and it
 *      shows on every mobile page.
 *    · This badge additionally tracks `musterGo.offlineScans` — how many scans
 *      are captured but NOT yet sent — and in that state it's a BUTTON that
 *      force-flushes the queue. That's the only place in the app that can.
 *
 *  What was genuinely redundant is the idle case: both went green and both said
 *  a variant of "synced", stacked a few pixels apart. So the badge now stays
 *  silent unless it has something the topbar can't tell you — queued scans, or
 *  no connection — which is also the moment it becomes actionable. Nothing is
 *  lost, and the all-clear screen loses a duplicated green pill. */
function SyncBadge({ online, pending, onFlush, t }) {
  const hasPending = pending > 0;
  if (online && !hasPending) return null;
  let bg, color, Icon, label;
  if (!online) {
    bg = "var(--st-missing-bg)"; color = "var(--st-missing)"; Icon = WifiOff;
    label = hasPending ? `${t("Offline")} · ${pending} ${t("pending")}` : t("Offline");
  } else if (hasPending) {
    bg = "var(--st-review-bg, rgba(180,83,9,0.1))"; color = "var(--st-review, #b45309)"; Icon = WifiOff;
    label = `${pending} ${t("pending offline")}`;
  } else {
    bg = "var(--st-present-bg, rgba(16,185,129,0.1))"; color = "var(--st-present)"; Icon = Wifi;
    label = t("Live synced");
  }
  const tappable = hasPending && online;
  return (
    <button
      onClick={tappable ? onFlush : undefined}
      disabled={!tappable}
      title={tappable ? t("Tap to sync now") : undefined}
      style={{
        marginTop: 6, display: "inline-flex", alignItems: "center", gap: 6,
        padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700,
        background: bg, color, border: "none",
        cursor: tappable ? "pointer" : "default",
      }}
    >
      <Icon size={13} /> {label}
    </button>
  );
}
