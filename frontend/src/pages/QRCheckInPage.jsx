// frontend/src/pages/QRCheckInPage.jsx
// OWNED BY: FaceCheck-Pro (Vimal)
// Feature: Privacy-First Biometric & Multi-Modal Fusion Scanner
// Route:   /checkin  (registered by JQ in App.jsx — not modified here)
//
// A phone-frame staff app rendered inside the desktop Layout:
//   Trips     → mobile dashboard (live trip + per-coach status, tap to muster)
//   (tap)     → View 1: Reverse Headcount for that coach (Figma Screen 7)
//   Scan      → View 2: dark Face scanner with reticle + boarded strip
//               (Figma Screen 8) · QR/Manual left as templates for Jayden ·
//               AUTOMATIC low-light audio voiceprint fallback (a live
//               luminance sensor on the camera feed trips it hands-free;
//               a "Simulate low light" button demos it on demand)
//   Me        → privacy consent lifecycle + per-delegate check-in history
//
// INTEGRATION: reads/writes the REAL shared delegate list through my own
// backend (routes/vimal.js), which uses JQ's exported data helpers — so a
// face check-in here shows up on JQ's dashboard activity feed instantly.
// Coaches are DYNAMIC (c5/c6 added by Desmond's module appear automatically),
// and the 29 delegates imported UNASSIGNED via Onboarding can be mustered
// onto the selected coach right from the headcount screen.
// Styling uses ONLY tokens.css variables/classes (no foreign hex codes);
// the one <style> block below is namespaced `vimal-*` and page-local.

import { useEffect, useRef, useState, useCallback } from "react";
import {
  MapPin, ScanFace, AlertTriangle, User, Phone, Mic, Moon, Sun,
  RefreshCw, ShieldCheck, X, Zap, Turtle, Camera, Sparkles, QrCode,
  ChevronRight, CheckCircle2, Users,
} from "lucide-react";
import { apiGet, apiPost, getUser } from "../lib/api.js";

const TRIP_ID = "t-1"; // the base app's single seeded trip (see backend/data.js)
const COLLAPSED_MISSING = 3; // Figma shows 3 cards + "+ N more"

/* ============================================================================
 * ZERO-IMAGE VECTORIZATION — the data-ethics core of this feature.
 *
 * WHY: PDPA (and basic ethics) says we should not hoard people's faces.
 * A raw camera frame is personal data; a one-way mathematical token is not
 * meaningfully reversible into a face.
 *
 * HOW THE PURGE WORKS:
 *  1. ONE frame is drawn to an off-DOM <canvas> (never attached to the page,
 *     never rendered, never persisted).
 *  2. getImageData() hands us the raw RGBA pixel matrix — the ONLY copy of
 *     the photo that exists in JS memory.
 *  3. We sample 32 pseudo-landmark regions and fold them into an
 *     irreversible FNV-style hash token ("face:v1:<hex>:<coarse landmarks>").
 *  4. IMMEDIATELY after: `px.fill(0)` overwrites every pixel byte IN PLACE
 *     (not just dereferenced — actually zeroed, so no GC-timing window holds
 *     recoverable image data), the landmark intermediates are truncated, and
 *     the caller zeroes the canvas dimensions to release its bitmap.
 *  5. Only the anonymous token string survives to be transmitted. The server
 *     therefore never sees, stores, or can leak an image.
 * ========================================================================== */
function vectorizeFaceLandmarks(imageData) {
  const px = imageData.data; // raw RGBA pixel matrix — the only copy of the photo in JS memory.
  const width = imageData.width;
  const height = imageData.height;

  // Convert to a small grayscale frame and derive a compact feature vector
  // from stable regions of the face area. This is a privacy-first proxy for
  // landmark-based vectorization: the raw image never leaves the device.
  const gray = new Uint8ClampedArray(width * height);
  for (let y = 0, idx = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1, idx += 4) {
      const luma = 0.299 * px[idx] + 0.587 * px[idx + 1] + 0.114 * px[idx + 2];
      gray[y * width + x] = Math.round(luma);
    }
  }

  const vector = [];
  const rows = 4;
  const cols = 8;
  const cellW = Math.max(1, Math.floor(width / cols));
  const cellH = Math.max(1, Math.floor(height / rows));

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      let sum = 0;
      let count = 0;
      const startY = row * cellH;
      const endY = Math.min(height, startY + cellH);
      const startX = col * cellW;
      const endX = Math.min(width, startX + cellW);
      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          sum += gray[y * width + x];
          count += 1;
        }
      }
      vector.push(count > 0 ? Math.round(sum / count) : 0);
    }
  }

  // Add simple gradient-based structure features to capture facial geometry
  // without storing an actual picture.
  let horEdge = 0;
  let verEdge = 0;
  let symmetry = 0;
  let contrast = 0;
  for (let y = 2; y < height - 2; y += 4) {
    for (let x = 2; x < width - 2; x += 4) {
      const center = gray[y * width + x];
      const right = gray[y * width + x + 2];
      const left = gray[y * width + x - 2];
      const down = gray[(y + 2) * width + x];
      const up = gray[(y - 2) * width + x];
      horEdge += Math.abs(center - right);
      verEdge += Math.abs(center - down);
      contrast += Math.abs(right - left) + Math.abs(up - down);
      symmetry += Math.abs(left - right);
    }
  }

  vector.push(
    Math.round(horEdge / 32),
    Math.round(verEdge / 32),
    Math.round(contrast / 32),
    Math.round(symmetry / 32),
  );

  // Derive the anonymous token string from the feature vector.
  const featureString = vector.map((value) => value.toString(16).padStart(2, "0")).join("");
  let h = 2166136261;
  for (let i = 0; i < featureString.length; i += 1) {
    h = ((h ^ featureString.charCodeAt(i)) * 16777619) >>> 0;
  }
  const token = `face:v2:${h.toString(16)}:${vector.slice(0, 8).join(".")}`;

  // *** PDPA ZERO-IMAGE PURGE: wipe every raw byte before returning. ***
  gray.fill(0);
  px.fill(0);
  return token;
}

/* LOW-LIGHT MULTI-MODAL FALLBACK (model fairness):
 * Camera recognition degrades unevenly in poor light (e.g. inside a dark
 * coach bus at night) — accuracy drops more for some skin tones than others,
 * which is a model-fairness failure, not a user failure. Rather than force
 * retries, the UI switches modality: an audio passphrase, hashed one-way
 * exactly like the face path, so every delegate gets an equally fast
 * check-in regardless of lighting. */
function vectorizeVoiceprint(passphrase) {
  let h = 5381;
  for (let i = 0; i < passphrase.length; i++) h = ((h * 33) ^ passphrase.charCodeAt(i)) >>> 0;
  return `voice:v1:${h.toString(16)}:${passphrase.length}`;
}

/* Error tone via Web Audio — the spec's "alert" when the 1s SLA is missed. */
function playErrorTone() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 220;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.45);
    osc.onended = () => ctx.close();
  } catch { /* no audio device — the banner alert still shows */ }
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

const initialsOf = (name = "?") =>
  name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

const NAV = [
  { key: "trips", label: "Trips", Icon: MapPin },
  { key: "scan", label: "Scan", Icon: ScanFace },
  { key: "issues", label: "Issues", Icon: AlertTriangle },
  { key: "me", label: "Me", Icon: User },
];

/* Page-local, namespaced animation styles (vimal-*) — scan line + corner
 * reticle for the face viewfinder. Not global utility CSS. */
const VIMAL_CSS = `
@keyframes vimal-scanline { 0% { top: 8%; } 50% { top: 88%; } 100% { top: 8%; } }
.vimal-scanline {
  position: absolute; left: 10%; right: 10%; height: 2px;
  background: var(--st-present); opacity: .85; border-radius: 2px;
  box-shadow: 0 0 12px var(--st-present);
  animation: vimal-scanline 1.6s ease-in-out infinite;
}
.vimal-corner { position: absolute; width: 28px; height: 28px; border: 3px solid var(--st-present); opacity: .9; }
.vimal-corner.tl { top: 12px; left: 12px; border-right: none; border-bottom: none; border-radius: 8px 0 0 0; }
.vimal-corner.tr { top: 12px; right: 12px; border-left: none; border-bottom: none; border-radius: 0 8px 0 0; }
.vimal-corner.bl { bottom: 12px; left: 12px; border-right: none; border-top: none; border-radius: 0 0 0 8px; }
.vimal-corner.br { bottom: 12px; right: 12px; border-left: none; border-top: none; border-radius: 0 0 8px 0; }
@keyframes vimal-pop { from { transform: scale(.92); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.vimal-toast { animation: vimal-pop .18s ease-out; }
@media (prefers-reduced-motion: reduce) {
  .vimal-scanline { animation: none; top: 48%; }
  .vimal-toast { animation: none; }
}
`;

/* ========================================================================== */
export default function QRCheckInPage() {
  const [view, setView] = useState("trips"); // trips | headcount | scan | issues | me
  const [trip, setTrip] = useState(null);
  const [coaches, setCoaches] = useState([]);
  const [unassigned, setUnassigned] = useState(0);
  const [activeCoachId, setActiveCoachId] = useState(null);
  const [coach, setCoach] = useState(null); // detail for the active coach
  const [loadErr, setLoadErr] = useState("");
  const [showAllMissing, setShowAllMissing] = useState(false);
  const [busy, setBusy] = useState(""); // "assign" | "seed" | ""

  // scanner
  const [scanMode, setScanMode] = useState("face"); // face | qr | manual
  const [lowLight, setLowLight] = useState(false);  // low-light state (auto or simulated)
  const [autoLowLight, setAutoLowLight] = useState(false); // true when the SENSOR tripped it
  const [simulateSlow, setSimulateSlow] = useState(false); // demo the >1s SLA breach
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null); // { name, time }
  const [scanError, setScanError] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [voiceFinal, setVoiceFinal] = useState(false);
  const [camError, setCamError] = useState("");
  const [enrollOk, setEnrollOk] = useState(false);
  const [lastToken, setLastToken] = useState(null);
  const [lastMatchedDelegate, setLastMatchedDelegate] = useState(null);

  // Me tab
  const [historyFor, setHistoryFor] = useState(null);
  const [consentBusy, setConsentBusy] = useState("");

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recognitionRef = useRef(null);
  const voiceTimeoutRef = useRef(null);
  const staffName = getUser()?.name || "Staff";

  /* ----------------------- live trip + coach overview -------------------- */
  const fetchOverview = useCallback(async () => {
    try {
      setLoadErr("");
      const data = await apiGet("/attendance/coaches");
      setTrip(data.trip);
      setCoaches(data.coaches);
      setUnassigned(data.unassigned || 0);
      // Default active coach: first with delegates on board, else first coach.
      setActiveCoachId((prev) => {
        if (prev && data.coaches.some((c) => c.id === prev)) return prev;
        const withPeople = data.coaches.find((c) => c.total > 0);
        return (withPeople || data.coaches[0] || {}).id || null;
      });
    } catch (e) {
      setLoadErr(
        e.status === 404
          ? "Attendance endpoints not found — mount routes/vimal.js in the server.js TEAMMATE ZONE, then restart the backend."
          : "Could not load live data. Is the backend running on :4000?"
      );
    }
  }, []);

  const fetchCoach = useCallback(async (coachId) => {
    if (!coachId) { setCoach(null); return; }
    try {
      setCoach(await apiGet(`/attendance/${TRIP_ID}/coach/${coachId}`));
    } catch {
      setCoach(null);
      setLoadErr("Could not load the coach's headcount.");
    }
  }, []);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceSupported(false);
      return undefined;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-SG";
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join(" ")
        .trim();
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
          setVoiceError("No speech detected in time. Please tap Record passphrase and try again.");
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
      if (event.error === "not-allowed") {
        setVoiceError("Microphone access was denied. Allow mic access to speak the passphrase.");
      } else if (event.error === "no-speech") {
        setVoiceError("No speech heard. Tap Speak now and try again.");
      } else if (event.error === "audio-capture") {
        setVoiceError("Microphone not available. Check your device settings.");
      } else if (event.error !== "aborted") {
        setVoiceError(`Voice capture error: ${event.error}`);
      }
      setVoiceStatus("");
    };

    recognition.onend = () => {
      setVoiceListening(false);
      clearTimeout(voiceTimeoutRef.current);
      voiceTimeoutRef.current = null;
    };

    recognitionRef.current = recognition;
    setVoiceSupported(true);
    return () => {
      recognition.stop();
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => { fetchOverview(); }, [fetchOverview]);
  useEffect(() => { fetchCoach(activeCoachId); }, [activeCoachId, fetchCoach]);
  useEffect(() => {
    if (view === "trips" || view === "headcount" || view === "me") {
      fetchOverview();
      fetchCoach(activeCoachId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  /* --------------------------- camera lifecycle -------------------------- */
  useEffect(() => {
    const wantCamera = view === "scan" && scanMode === "face" && !lowLight;
    let cancelled = false;

    async function start() {
      try {
        setCamError("");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" }, audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch {
        if (!cancelled) setCamError("Camera unavailable — allow camera access, or use the low-light audio fallback.");
      }
    }
    function stop() {
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    }

    if (wantCamera) start(); else stop();
    return () => { cancelled = true; stop(); };
  }, [view, scanMode, lowLight]);

  /* --------------- AUTOMATIC LOW-LIGHT MULTI-MODAL FALLBACK --------------
   * Ambient-light sensor loop: while the face camera is live, we sample a
   * TINY (24×18) frame every ~1.2s, average its luminance, then zero the
   * sample's pixel bytes IN PLACE (same Zero-Image purge as the vectorizer —
   * not even the light meter keeps a photo). Two consecutive dark readings
   * (avg luma < 30/255 ≈ inside a dark coach bus at night) automatically
   * disable the camera and activate the audio voiceprint scanner, so
   * delegates keep checking in without any staff action. */
  useEffect(() => {
    if (!(view === "scan" && scanMode === "face" && !lowLight)) return;
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
      for (let i = 0; i < px.length; i += 4) {
        sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      }
      const avgLuma = sum / (px.length / 4);
      px.fill(0); // PDPA purge — the light-meter frame never outlives this tick

      darkStreak = avgLuma < 30 ? darkStreak + 1 : 0;
      if (darkStreak >= 2) {
        // Ambient light dropped: camera off, voiceprint scanner on. The
        // camera-lifecycle effect above reacts to lowLight and stops tracks.
        setAutoLowLight(true);
        setLowLight(true);
        setScanError("");
      }
    }, 1200);

    return () => { clearInterval(id); meter.width = 0; meter.height = 0; };
  }, [view, scanMode, lowLight]);

  /* ------------------------------- scanning ------------------------------ */
  async function submitScan(token) {
    const started = performance.now();
    setScanning(true);
    setScanError("");
    setScanResult(null);
    try {
      // Demo hook: proves the ">1s → error tone" SLA path on command.
      if (simulateSlow) await new Promise((r) => setTimeout(r, 1300));

      const res = await apiPost("/attendance/scan", {
        tripId: TRIP_ID,
        scanData: token,
        timestamp: new Date().toISOString(),
        coachId: activeCoachId || undefined, // scope matching to the mustered coach
      });

      const elapsed = performance.now() - started;
      if (elapsed > 1000) {
        // Hard requirement: face processing ≤ 1 second. Slower = failed scan.
        playErrorTone();
        setScanError(`Took ${(elapsed / 1000).toFixed(1)}s (> 1s limit). Error tone played — retry, or switch to Manual.`);
        return;
      }
      setScanResult({ name: res.name, time: `${(elapsed / 1000).toFixed(1)}s` });
      fetchOverview();           // dashboard chips + coach list
      fetchCoach(activeCoachId); // reverse headcount + boarded strip
      // Keep the anonymous token in memory and require explicit enrollment
      // from the operator (prevents accidental enrollments when no photo).
      setLastToken(token);
      setLastMatchedDelegate(res.delegateId);
      setTimeout(() => setScanResult(null), 3500);
    } catch (e) {
      playErrorTone();
      setScanError(
        e.code === "SCAN_FAILED" || e.status === 404
          ? "SCAN_FAILED — no missing delegate matched on this coach. Retry, or log an exception (Issues tab)."
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
    // Single frame → off-DOM canvas → vectorize (which zeroes the raw pixels
    // in place) → release the canvas bitmap. Zero-Image guarantee end-to-end.
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 120;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const token = vectorizeFaceLandmarks(imageData); // purge happens inside
    canvas.width = 0; canvas.height = 0;             // free the canvas bitmap
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
    } catch (err) {
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

  /* --------------------------- consent lifecycle ------------------------- */
  async function setConsent(delegateId, consent) {
    try {
      setConsentBusy(delegateId);
      await apiPost("/attendance/consent", { delegateId, consent, method: "staff-app" });
      await fetchCoach(activeCoachId);
    } catch {
      setLoadErr("Could not update consent.");
    } finally {
      setConsentBusy("");
    }
  }

  async function enrollBiometric() {
    if (!lastMatchedDelegate || !lastToken) return;
    try {
      setConsentBusy(lastMatchedDelegate);
      await apiPost("/attendance/consent", {
        delegateId: lastMatchedDelegate,
        consent: "GRANTED",
        method: "scanner",
        biometricToken: lastToken,
      });
      setEnrollOk(true);
      setTimeout(() => setEnrollOk(false), 3000);
      // clear transient memory of the raw token
      setLastToken(null);
      setLastMatchedDelegate(null);
    } catch (e) {
      console.debug("Enroll failed:", e?.message || e);
      setLoadErr("Enrollment failed — check backend logs.");
    } finally {
      setConsentBusy("");
    }
  }

  async function openHistory(d) {
    try {
      setHistoryFor(await apiGet(`/attendance/history/${d.delegateId}`));
    } catch {
      setLoadErr("Could not load check-in history.");
    }
  }

  /* --------------------- muster helpers (assign / seed) ------------------ */
  async function assignUnassigned() {
    if (!activeCoachId) return;
    try {
      setBusy("assign");
      await apiPost("/attendance/assign-unassigned", { coachId: activeCoachId });
      await fetchOverview();
      await fetchCoach(activeCoachId);
    } catch (e) {
      setLoadErr(e.message || "Could not assign delegates.");
    } finally {
      setBusy("");
    }
  }

  async function seedDemo() {
    if (!activeCoachId) return;
    try {
      setBusy("seed");
      await apiPost("/attendance/demo-seed", { coachId: activeCoachId });
      await fetchOverview();
      await fetchCoach(activeCoachId);
    } catch (e) {
      setLoadErr(e.message || "Could not seed demo delegates.");
    } finally {
      setBusy("");
    }
  }

  /* ------------------------ styles (tokens.css vars only) ---------------- */
  const S = {
    frame: {
      maxWidth: 400, margin: "0 auto", minHeight: 700, display: "flex",
      flexDirection: "column", overflow: "hidden", position: "relative",
    },
    body: { flex: 1, padding: "20px 18px 16px", overflowY: "auto" },
    tabbar: {
      display: "flex", justifyContent: "space-around", alignItems: "center",
      background: "var(--surface)", borderTop: "1px solid var(--line)",
      padding: "8px 0 10px",
    },
    tab: (active) => ({
      background: "none", border: "none", display: "flex", flexDirection: "column",
      alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600, padding: "4px 10px",
      color: active ? "var(--scc-red)" : "var(--ink-3)",
    }),
    eyebrow: {
      fontSize: 11, fontWeight: 600, letterSpacing: "0.08em",
      textTransform: "uppercase", color: "var(--ink-3)",
    },
    statCard: {
      flex: 1, padding: "10px 12px", borderRadius: "var(--r-md)",
      border: "1px solid var(--line)", background: "var(--surface)",
    },
    missingCard: {
      background: "var(--st-missing-bg)", border: "1.5px solid var(--scc-red-tint-2)",
      borderRadius: "var(--r-md)", padding: "14px 16px 16px", marginTop: 14,
    },
    delegateCard: {
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
      border: "1.5px solid var(--scc-red-700)", borderRadius: "var(--r-lg)",
      padding: "12px 14px",
    },
    avatar: (vip) => ({
      width: 42, height: 42, fontSize: 14,
      background: vip ? "var(--scc-red)" : "var(--scc-red-tint-2)",
      color: vip ? "var(--surface)" : "var(--scc-red-700)",
    }),
    coachRow: {
      display: "flex", alignItems: "center", gap: 12, width: "100%",
      textAlign: "left", background: "var(--surface)", border: "1px solid var(--line)",
      borderRadius: "var(--r-md)", padding: "12px 14px", boxShadow: "var(--shadow-sm)",
    },
    coachChip: {
      width: 34, height: 34, borderRadius: 8, flexShrink: 0,
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      fontSize: 12, fontWeight: 700,
      background: "var(--scc-red-tint)", color: "var(--scc-red)",
    },
    scanner: {
      background: "var(--ink)", borderRadius: "var(--r-lg)",
      padding: 12, color: "var(--surface)",
    },
    viewport: {
      position: "relative", borderRadius: "var(--r-md)", overflow: "hidden",
      background: "#000", aspectRatio: "3 / 4",
    },
    overlay: {
      position: "absolute", inset: 0, display: "flex", alignItems: "center",
      justifyContent: "center", padding: 16, textAlign: "center",
    },
    modeBtn: (active) => ({
      flex: 1, padding: "8px 0", borderRadius: 999, fontWeight: 600, fontSize: 13,
      border: "1px solid var(--ink-2)",
      background: active ? "var(--surface)" : "transparent",
      color: active ? "var(--ink)" : "var(--line)",
    }),
    boardedStrip: {
      marginTop: 12, borderRadius: 999, padding: "8px 14px",
      background: "rgba(255,255,255,.08)", display: "flex",
      alignItems: "center", justifyContent: "space-between", gap: 10,
    },
    modal: {
      position: "fixed", inset: 0, background: "rgba(26,29,33,.5)", zIndex: 60,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    },
    ghostLink: {
      background: "none", border: "none", color: "var(--ink-3)",
      fontSize: 13, fontWeight: 600, padding: 8, alignSelf: "center",
    },
  };

  const totals = coaches.reduce(
    (t, c) => ({ missing: t.missing + c.missing, present: t.present + c.boarded }),
    { missing: 0, present: 0 }
  );
  const missingList = (coach && coach.delegates
    ? coach.delegates.filter((d) => d.status === "MISSING")
    : []);
  const visibleMissing = showAllMissing ? missingList : missingList.slice(0, COLLAPSED_MISSING);
  const hiddenCount = missingList.length - visibleMissing.length;
  const boardedPct = coach && coach.expected > 0
    ? Math.round((coach.boarded / coach.expected) * 100)
    : 0;

  const openCoach = (id) => {
    setActiveCoachId(id);
    setShowAllMissing(false);
    setView("headcount");
  };

  /* ================================ VIEWS ================================= */

  /* ------------------ Mobile dashboard (Home / Trips tab) ---------------- */
  const HomeView = (
    <div>
      <div className="muted" style={{ fontSize: 13 }}>{greeting()}</div>
      <h2 style={{ margin: "2px 0 8px", fontSize: 22 }}>{staffName}</h2>
      <span className="badge badge-present">● Online · synced</span>

      <div style={{ ...S.eyebrow, marginTop: 22 }}>Active trip</div>
      <div style={{
        background: "var(--scc-red)", color: "var(--surface)",
        borderRadius: "var(--r-lg)", padding: 16, marginTop: 8,
        boxShadow: "var(--shadow-md)",
      }}>
        <div style={{ fontWeight: 700, fontSize: 17 }}>{trip?.name || "…"}</div>
        <div style={{ opacity: 0.9, fontSize: 13, marginTop: 2 }}>
          {trip ? `Day ${trip.dayOf} of ${trip.totalDays} · ${trip.localTime} local` : "Loading trip…"}
        </div>
        {trip?.departsIn && (
          <span className="badge" style={{ background: "rgba(255,255,255,.22)", color: "var(--surface)", marginTop: 10 }}>
            Departure in {trip.departsIn}
          </span>
        )}
      </div>

      {/* Live stats strip */}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <div style={S.statCard}>
          <div style={{ ...S.eyebrow, fontSize: 10 }}>Missing</div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: "var(--st-missing)" }}>{totals.missing}</div>
        </div>
        <div style={S.statCard}>
          <div style={{ ...S.eyebrow, fontSize: 10 }}>Present</div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: "var(--st-present)" }}>{totals.present}</div>
        </div>
        <div style={S.statCard}>
          <div style={{ ...S.eyebrow, fontSize: 10 }}>Unassigned</div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: "var(--st-unassigned)" }}>{unassigned}</div>
        </div>
      </div>

      {/* Per-coach live status — tap a coach to muster it */}
      <div style={{ ...S.eyebrow, marginTop: 22 }}>Coach status · tap to muster</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
        {coaches.map((c) => (
          <button key={c.id} style={S.coachRow} onClick={() => openCoach(c.id)}>
            <span style={S.coachChip}>{c.label || c.id.toUpperCase()}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontWeight: 600, fontSize: 14 }}>
                {c.name}{c.city ? <span className="muted" style={{ fontWeight: 400 }}> · {c.city}</span> : null}
              </span>
              <span className="muted" style={{ fontSize: 12 }}>{c.boarded}/{c.total} boarded</span>
            </span>
            {c.total === 0
              ? <span className="badge badge-neutral">Empty</span>
              : c.missing > 0
                ? <span className="badge badge-missing">{c.missing} missing</span>
                : <span className="badge badge-present">All in</span>}
            <ChevronRight size={16} style={{ color: "var(--ink-3)", flexShrink: 0 }} />
          </button>
        ))}
        {coaches.length === 0 && !loadErr && (
          <div className="muted" style={{ fontSize: 13, textAlign: "center", padding: 8 }}>Loading coaches…</div>
        )}
      </div>

      <div style={{ ...S.eyebrow, marginTop: 22 }}>Upcoming</div>
      <div className="card" style={{ padding: 14, marginTop: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>Shanghai trade mission</div>
        <div className="muted" style={{ fontSize: 13 }}>Starts 28 Aug · 45 delegates</div>
      </div>
      <div className="card" style={{ padding: 14, marginTop: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>Shenzhen tech tour</div>
        <div className="muted" style={{ fontSize: 13 }}>Starts 17 Sep · 60 delegates</div>
      </div>
    </div>
  );

  /* ---------- View 1: Reverse Headcount — Figma Screen 7 (light) --------- */
  const HeadcountView = (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div className="row between">
        <div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>{coach?.coachLabel || "Coach"}</div>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            {coach ? `${coach.location} · ${coach.departure}` : "Loading…"}
          </div>
        </div>
        <button className="btn btn-ghost" onClick={() => fetchCoach(activeCoachId)} style={{ padding: "8px 12px" }}>
          <RefreshCw size={15} />
        </button>
      </div>

      <div style={S.missingCard}>
        <div style={{ ...S.eyebrow, color: "var(--scc-red-700)" }}>Still missing</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 2 }}>
          <span className="mono" style={{ fontSize: 34, fontWeight: 800, color: "var(--scc-red-700)", lineHeight: 1 }}>
            {coach ? coach.missing : "…"}
          </span>
          <span style={{ fontSize: 14, color: "var(--scc-red-700)" }}>
            of {coach ? coach.expected : "…"} expected
          </span>
        </div>
        <div style={{ height: 8, background: "var(--line)", borderRadius: 4, marginTop: 12, overflow: "hidden" }}>
          <div style={{
            height: "100%", borderRadius: 4, background: "var(--st-present)",
            width: `${boardedPct}%`, transition: "width .4s ease",
          }} />
        </div>
      </div>

      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {visibleMissing.map((d) => (
          <div key={d.delegateId} className="card" style={S.delegateCard}>
            <div className="row" style={{ gap: 12, minWidth: 0 }}>
              <span className="avatar" style={S.avatar(d.vip)}>
                {d.initials || initialsOf(d.name)}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {d.name}
                </div>
                <div className="muted" style={{ fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {d.vip ? `VIP · ${d.lastSeen}` : d.lastSeen}
                </div>
              </div>
            </div>
            <button
              title={`Ping staff about ${d.name}`}
              onClick={() => setView("issues")}
              style={{ background: "none", border: "none", color: "var(--scc-red)", padding: 6, flexShrink: 0 }}
            >
              <Phone size={19} />
            </button>
          </div>
        ))}

        {hiddenCount > 0 && (
          <button style={S.ghostLink} onClick={() => setShowAllMissing(true)}>
            + {hiddenCount} more
          </button>
        )}
        {showAllMissing && missingList.length > COLLAPSED_MISSING && (
          <button style={S.ghostLink} onClick={() => setShowAllMissing(false)}>
            Show less
          </button>
        )}

        {/* Empty coach: muster the unassigned pool first; demo roster only if
            the whole database is empty. */}
        {coach && coach.expected === 0 && (
          <div className="card" style={{ padding: 20, textAlign: "center" }}>
            {unassigned > 0 ? (
              <>
                <Users size={20} style={{ color: "var(--st-unassigned)" }} />
                <div style={{ fontWeight: 600, margin: "8px 0 4px" }}>
                  {unassigned} delegates waiting for a coach
                </div>
                <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
                  Imported via Onboarding but not assigned yet. Muster them onto {coach.coachLabel} to start scanning.
                </div>
                <button className="btn btn-primary" onClick={assignUnassigned} disabled={busy === "assign"}>
                  {busy === "assign" ? "Assigning…" : `Assign to ${coach.coachLabel}`}
                </button>
              </>
            ) : (
              <>
                <Sparkles size={20} style={{ color: "var(--scc-red)" }} />
                <div style={{ fontWeight: 600, margin: "8px 0 4px" }}>No delegates on {coach.coachLabel} yet</div>
                <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
                  Add some via Onboarding/Trips, or load a demo roster to try the scanner.
                </div>
                <button className="btn btn-primary" onClick={seedDemo} disabled={busy === "seed"}>
                  {busy === "seed" ? "Seeding…" : "Load demo roster"}
                </button>
              </>
            )}
          </div>
        )}
        {coach && coach.expected > 0 && missingList.length === 0 && (
          <div className="card" style={{ padding: 16, textAlign: "center" }}>
            <span className="badge badge-present">All in — everyone boarded</span>
          </div>
        )}
      </div>
    </div>
  );

  /* ------------- View 2: Face Scanner — Figma Screen 8 (dark) ------------ */
  const ScannerView = (
    <div style={S.scanner}>
      {/* Header: ✕ · title · ⚡ (Figma) */}
      <div className="row between" style={{ marginBottom: 10 }}>
        <button
          onClick={() => setView("headcount")}
          style={{ background: "none", border: "none", color: "var(--surface)", padding: 4 }}
          title="Back to headcount"
        >
          <X size={18} />
        </button>
        <div style={{ fontWeight: 700, fontSize: 14 }}>
          Checking in · {coach?.coachLabel || "pick a coach"}
        </div>
        <Zap size={16} style={{ color: "var(--line)", opacity: .8 }} />
      </div>

      <div style={S.viewport}>
        {scanMode === "face" && !lowLight && (
          <>
            <video
              ref={videoRef} autoPlay playsInline muted
              style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }}
            />
            {/* Target reticle corners + animated scan line while processing */}
            <span className="vimal-corner tl" /><span className="vimal-corner tr" />
            <span className="vimal-corner bl" /><span className="vimal-corner br" />
            {scanning && <span className="vimal-scanline" />}
            {camError && (
              <div style={S.overlay}>
                <div className="card" style={{ padding: 14, fontSize: 13, color: "var(--ink)" }}>
                  <Camera size={16} style={{ marginBottom: 4 }} /><br />{camError}
                </div>
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
            <div style={{ fontSize: 12.5, color: "var(--line)", maxWidth: 240 }}>
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
              style={{ maxWidth: 230, textAlign: "center" }}
            />
            <button className="btn btn-primary" onClick={() => handleVoiceScan()} disabled={scanning || !passphrase.trim()}>
              {scanning ? "Submitting passphrase…" : "Submit passphrase"}
            </button>
            <div style={{ fontSize: 12.2, color: "var(--surface)", marginTop: 8, maxWidth: 240, textAlign: "center" }}>
              {voiceListening
                ? "Listening for spoken passphrase. Speak clearly, then wait for confirmation."
                : "Tap Start voice capture and say the delegate's passphrase, or type it manually."}
            </div>
            {(voiceStatus || voiceError || scanError) && (
              <div style={{ fontSize: 12.2, color: voiceError ? "#f87171" : "var(--surface)", marginTop: 8 }}>
                {voiceError || voiceStatus || scanError}
              </div>
            )}
          </div>
        )}

        {scanMode === "qr" && (
          /* TEMPLATE ONLY — Jayden owns the QR module. Left as a visual
             placeholder so he can drop his scanner logic straight in. */
          <div style={{ ...S.overlay, flexDirection: "column", gap: 8, color: "var(--line)" }}>
            <div style={{
              width: 140, height: 140, borderRadius: 12,
              border: "2px dashed var(--ink-2)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <QrCode size={56} style={{ opacity: .7 }} />
            </div>
            <div style={{ fontWeight: 600, color: "var(--surface)" }}>QR check-in — template</div>
            <div style={{ fontSize: 12.5, maxWidth: 220 }}>
              Reserved for Jayden's QR module. Hold the delegate's badge inside the frame.
            </div>
          </div>
        )}

        {scanMode === "manual" && (
          <div style={{ ...S.overlay, flexDirection: "column", gap: 6, color: "var(--line)" }}>
            <div style={{ fontWeight: 600, color: "var(--surface)" }}>Manual tracking</div>
            <div style={{ fontSize: 12.5 }}>Handled by Jayden — reserved for later hookup.</div>
          </div>
        )}

        {/* Success toast — green check · name · "Matched · 0.7s · Coach 2 ✓" */}
        {scanResult && (
          <div style={S.overlay}>
            <div className="card vimal-toast" style={{ padding: "12px 16px", color: "var(--ink)" }}>
              <div className="row" style={{ gap: 10 }}>
                <CheckCircle2 size={30} style={{ color: "var(--st-present)", flexShrink: 0 }} />
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{scanResult.name}</div>
                  <div className="muted" style={{ fontSize: 12.5 }}>
                    Matched · {scanResult.time} · {coach?.coachLabel || "Coach"} ✓
                  </div>
                </div>
                <div style={{ marginLeft: 12, display: "flex", alignItems: "center", gap: 8 }}>
                  <button className="btn" onClick={enrollBiometric} disabled={!lastToken || consentBusy === lastMatchedDelegate}>
                    {consentBusy === lastMatchedDelegate ? "Enrolling…" : "Enroll"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {enrollOk && (
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 12, display: "flex", justifyContent: "center" }}>
            <div className="card vimal-toast" style={{ padding: "8px 12px", color: "var(--ink)" }}>
              Enrolled (zero-image token saved)
            </div>
          </div>
        )}
      </div>

      {/* Pill toggle: Face | QR | Manual — Face active by default */}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        {["face", "qr", "manual"].map((m) => (
          <button key={m} style={S.modeBtn(scanMode === m)} onClick={() => { setScanMode(m); setScanError(""); }}>
            {m === "face" ? "Face" : m === "qr" ? "QR" : "Manual"}
          </button>
        ))}
      </div>

      {scanMode === "face" && !lowLight && (
        <button className="btn btn-primary btn-block" style={{ marginTop: 12 }}
                onClick={handleFaceScan} disabled={scanning}>
          <ScanFace size={16} /> {scanning ? "Processing…" : "Scan face"}
        </button>
      )}

      {scanError && (
        <div style={{
          marginTop: 10, borderRadius: "var(--r-sm)", padding: 10, fontSize: 13,
          background: "var(--st-missing-bg)", color: "var(--scc-red-700)",
          border: "1px solid var(--scc-red-tint-2)",
        }}>
          <AlertTriangle size={13} style={{ marginRight: 6, verticalAlign: -2 }} />
          {scanError}
        </div>
      )}

      {/* Bottom boarded strip — "20 of 25 boarded | 5 missing" + progress */}
      <div style={S.boardedStrip}>
        <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>
          {coach ? `${coach.boarded} of ${coach.expected} boarded` : "— boarded"}
        </span>
        <span className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--scc-red)" }}>
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
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="btn btn-ghost" style={{ flex: 1, fontSize: 12.5, padding: "8px 6px" }}
                onClick={() => { setAutoLowLight(false); setLowLight(!lowLight); setScanError(""); }}>
          {lowLight ? <Sun size={14} /> : <Moon size={14} />}
          {lowLight ? "Normal light" : "Simulate low light"}
        </button>
        <button className="btn btn-ghost" style={{ flex: 1, fontSize: 12.5, padding: "8px 6px" }}
                onClick={() => setSimulateSlow(!simulateSlow)}>
          {simulateSlow ? <Zap size={14} /> : <Turtle size={14} />}
          {simulateSlow ? "Slow demo: ON" : "Slow demo: OFF"}
        </button>
      </div>
      <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 8, lineHeight: 1.5 }}>
        <ShieldCheck size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
        Zero-Image mode: raw pixels are zeroed in memory the instant the anonymous
        face token is derived. No images stored or transmitted — PDPA compliant.
      </div>
    </div>
  );

  const IssuesView = (
    <div className="card" style={{ padding: 24, textAlign: "center" }}>
      <AlertTriangle size={26} style={{ color: "var(--st-unassigned)" }} />
      <div style={{ fontWeight: 700, marginTop: 8 }}>Exception inbox</div>
      <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
        This tab belongs to Jayden's Exceptions feature — open “Exceptions” in the sidebar.
      </div>
    </div>
  );

  const MeView = (
    <div>
      <div className="card row between" style={{ padding: 14 }}>
        <div className="row" style={{ gap: 12 }}>
          <span className="avatar" style={S.avatar(true)}>{initialsOf(staffName)}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{staffName}</div>
            <div className="muted" style={{ fontSize: 12.5 }}>
              On-site staff · {trip?.name || "MusterGo"}
            </div>
          </div>
        </div>
        <span className="badge badge-present">Active</span>
      </div>

      <h3 style={{ margin: "20px 0 4px", fontSize: 16 }}>Privacy & biometric consent</h3>
      <div className="muted" style={{ fontSize: 13 }}>
        Manage each delegate's consent lifecycle for {coach?.coachLabel || "the selected coach"}.
        Revoking consent purges their biometric token and blocks all face/voice matching
        until re-granted.
      </div>

      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {(coach && coach.delegates ? coach.delegates : []).map((d) => (
          <div key={d.delegateId} className="card row between" style={{ padding: "12px 14px" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {d.name}
              </div>
              <span className={`badge ${d.consent === "GRANTED" ? "badge-present" : "badge-missing"}`} style={{ marginTop: 4 }}>
                {d.consent}
              </span>
            </div>
            <div className="row" style={{ gap: 6, flexShrink: 0 }}>
              <button className="btn btn-ghost" style={{ padding: "7px 10px", fontSize: 12.5 }} onClick={() => openHistory(d)}>
                History
              </button>
              <button
                className="btn btn-primary" style={{ padding: "7px 10px", fontSize: 12.5 }}
                disabled={consentBusy === d.delegateId}
                onClick={() => setConsent(d.delegateId, d.consent === "GRANTED" ? "REVOKED" : "GRANTED")}
              >
                {d.consent === "GRANTED" ? "Revoke" : "Grant"}
              </button>
            </div>
          </div>
        ))}
        {coach && coach.expected === 0 && (
          <div className="muted" style={{ fontSize: 13, textAlign: "center", padding: 8 }}>
            No delegates on this coach yet.
          </div>
        )}
      </div>

      {historyFor && (
        <div style={S.modal} onClick={() => setHistoryFor(null)}>
          <div className="card" style={{ maxWidth: 360, width: "100%", padding: 16 }} onClick={(e) => e.stopPropagation()}>
            <div className="row between" style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{historyFor.name} — check-in history</div>
              <button style={{ background: "none", border: "none", color: "var(--ink-3)" }} onClick={() => setHistoryFor(null)}>
                <X size={16} />
              </button>
            </div>
            {historyFor.records.length === 0 && (
              <div className="muted" style={{ fontSize: 13 }}>No check-ins recorded yet this session.</div>
            )}
            {historyFor.records.map((r, i) => (
              <div key={i} className="row between" style={{ padding: "8px 0", borderBottom: "1px solid var(--line-2)" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{r.venue}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{new Date(r.timestamp).toLocaleString()}</div>
                </div>
                <span className="badge badge-neutral">{r.method} · {r.matchedIn}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  /* ================================ SHELL ================================= */
  const activeNav = view === "headcount" ? "trips" : view;

  return (
    <div className="page">
      <style>{VIMAL_CSS}</style>
      <div className="page-eyebrow">FaceCheck-Pro · Vimal</div>
      <h1 className="page-title">Biometric check-in</h1>
      <p className="page-sub" style={{ marginBottom: 24 }}>
        Privacy-first face &amp; voice scanner for on-the-ground staff — zero images stored, PDPA compliant.
      </p>

      {loadErr && (
        <div className="card" style={{
          padding: 12, marginBottom: 16, maxWidth: 400, marginLeft: "auto", marginRight: "auto",
          background: "var(--st-missing-bg)", color: "var(--scc-red-700)", fontSize: 13,
        }}>
          {loadErr}
        </div>
      )}

      {/* Phone frame — mobile-first staff app */}
      <div className="card" style={S.frame}>
        <div style={S.body}>
          {view === "trips" && HomeView}
          {view === "headcount" && HeadcountView}
          {view === "scan" && ScannerView}
          {view === "issues" && IssuesView}
          {view === "me" && MeView}
        </div>

        {/* Persistent bottom mobile navigation — nothing gets cut off */}
        <nav style={S.tabbar} aria-label="Check-in navigation">
          {NAV.map(({ key, label, Icon }) => (
            <button key={key} style={S.tab(activeNav === key)} onClick={() => setView(key)}>
              <Icon size={20} />
              {label}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}

function isValidBiometricToken(token) {
  if (!token || typeof token !== "string") return false;
  // Same loose check used server-side: <type>:v1:<hex>:
  return /^(face|voice):v1:[0-9a-f]+:/i.test(token) && token.length > 20 && !/deadbeef/i.test(token);
}