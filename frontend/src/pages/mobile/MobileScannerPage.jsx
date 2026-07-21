// frontend/src/pages/mobile/MobileScannerPage.jsx
// Mobile port of the desktop /scanner (UnifiedScannerPage.jsx) — the same
// three real check-in paths (Face / QR / Manual) that write to the shared
// delegate list, re-laid-out single-column for a phone held at an entrance.
// Route: /mobile/scanner (inside MobileLayout — has the mobile topbar + tab
// bar). Reached primarily from the Login page's "Quick Scanner Access"
// shortcut (see LoginPage.jsx / App.jsx handleSignIn).
//
// Shares the face vectorizer + validator + error tone with the desktop
// scanner via lib/faceScan.js (one copy, not three), and mounts Jayden's
// QRScannerPanel/ManualTrackingPanel unmodified — exactly like the desktop
// page. The only differences are layout (single column, portrait viewport)
// and the face camera facing (environment/rear here, since a handheld phone
// points its back camera at the delegate, vs. the desktop's user-facing
// webcam).

import { useEffect, useRef, useState, useCallback } from "react";
import {
  ScanFace, QrCode, PencilLine, AlertTriangle, CheckCircle2, RefreshCw, Camera, SwitchCamera,
  Mic, Moon, Sun, Zap, Turtle,
} from "lucide-react";
import { apiGet, apiPost } from "../../lib/api.js";
import { vectorizeFaceLandmarks, vectorizeVoiceprint, isValidBiometricToken, playErrorTone } from "../../lib/faceScan.js";
import { useLang } from "../../lib/i18n.jsx";
import QRScannerPanel from "../../components/QRScannerPanel.jsx";
import ManualTrackingPanel from "../../components/ManualTrackingPanel.jsx";

const TRIP_ID = "t-1";

const SCAN_CSS = `
@keyframes mscan-line { 0% { top: 6%; } 50% { top: 92%; } 100% { top: 6%; } }
.mscan-line {
  position: absolute; left: 8%; right: 8%; height: 3px;
  background: var(--st-present); opacity: .85; border-radius: 3px;
  box-shadow: 0 0 16px var(--st-present);
  animation: mscan-line 1.6s ease-in-out infinite;
}
.mscan-corner { position: absolute; width: 34px; height: 34px; border: 4px solid var(--st-present); opacity: .9; }
.mscan-corner.tl { top: 14px; left: 14px; border-right: none; border-bottom: none; border-radius: 10px 0 0 0; }
.mscan-corner.tr { top: 14px; right: 14px; border-left: none; border-bottom: none; border-radius: 0 10px 0 0; }
.mscan-corner.bl { bottom: 14px; left: 14px; border-right: none; border-top: none; border-radius: 0 0 0 10px; }
.mscan-corner.br { bottom: 14px; right: 14px; border-left: none; border-top: none; border-radius: 0 0 10px 0; }
@keyframes mscan-pop { from { transform: scale(.94); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.mscan-pop { animation: mscan-pop .18s ease-out; }
@media (prefers-reduced-motion: reduce) { .mscan-line { animation: none; top: 48%; } .mscan-pop { animation: none; } }
`;

export default function MobileScannerPage() {
  const { t } = useLang();
  const [coaches, setCoaches] = useState([]);
  const [coachId, setCoachId] = useState(null);
  const [coach, setCoach] = useState(null);
  const [loadErr, setLoadErr] = useState("");

  const [scanMode, setScanMode] = useState("face"); // face | qr | manual
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null); // { name, time }
  const [scanError, setScanError] = useState("");
  const [camError, setCamError] = useState("");
  const [resetTick, setResetTick] = useState(0);
  const [facing, setFacing] = useState("user"); // user (selfie) | environment (rear)

  // Low-light voice fallback + slow-scan demo — same feature as Vimal's
  // original QRCheckInPage.jsx "Me tab" scanner, brought to this page too.
  const [lowLight, setLowLight] = useState(false);
  const [autoLowLight, setAutoLowLight] = useState(false); // true when the ambient sensor tripped it, not the demo button
  const [simulateSlow, setSimulateSlow] = useState(false); // demo the >1s SLA breach on demand
  const [passphrase, setPassphrase] = useState("");
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [voiceFinal, setVoiceFinal] = useState(false);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
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

      darkStreak = avgLuma < 30 ? darkStreak + 1 : 0;
      if (darkStreak >= 2) {
        setAutoLowLight(true);
        setLowLight(true);
        setScanError("");
      }
    }, 1200);

    return () => { clearInterval(id); meter.width = 0; meter.height = 0; };
  }, [scanMode, lowLight]);

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
        tripId: TRIP_ID,
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

  const S = {
    viewport: {
      position: "relative", borderRadius: "var(--r-lg)", overflow: "hidden",
      background: "#000", width: "100%", aspectRatio: "3 / 4", maxHeight: "58vh",
    },
    overlay: {
      position: "absolute", inset: 0, display: "flex", alignItems: "center",
      justifyContent: "center", padding: 20, textAlign: "center", flexDirection: "column", gap: 10,
    },
    modeBtn: (active) => ({
      flex: 1, padding: "11px 0", borderRadius: 999, fontWeight: 700, fontSize: 13,
      border: "1px solid var(--line)", display: "flex", alignItems: "center",
      justifyContent: "center", gap: 6,
      background: active ? "var(--scc-red-tint)" : "var(--surface)",
      color: active ? "var(--scc-red)" : "var(--ink-2)",
    }),
  };

  return (
    <div>
      <style>{SCAN_CSS}</style>
      <div className="row between" style={{ alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-3)" }}>
            {t("Entrance scanner")}
          </div>
          <h1 style={{ fontSize: 22, margin: "4px 0 0" }}>{t("Face + QR scan")}</h1>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {(scanMode === "face" || scanMode === "qr") && !lowLight && (
            <button
              className="btn btn-ghost" onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
              aria-label="Flip camera" title="Flip camera" style={{ padding: 8 }}
            >
              <SwitchCamera size={16} />
            </button>
          )}
          <button className="btn btn-ghost" onClick={resetScanner} aria-label={t("Reset scanner")} title={t("Reset scanner")} style={{ padding: 8 }}>
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {loadErr && (
        <div className="mobile-card" style={{ borderColor: "var(--st-missing)", background: "var(--st-missing-bg)" }}>
          <div className="row" style={{ gap: 8, color: "var(--st-missing)", fontWeight: 600, fontSize: 13 }}>
            <AlertTriangle size={15} /> {t(loadErr)}
          </div>
        </div>
      )}

      {/* Coach picker */}
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

      {/* Scanner viewport */}
      <div style={S.viewport}>
        {scanMode === "face" && !lowLight && (
          <>
            <video
              ref={videoRef} autoPlay playsInline muted
              style={{ width: "100%", height: "100%", objectFit: "cover", transform: facing === "user" ? "scaleX(-1)" : "none" }}
            />
            <span className="mscan-corner tl" /><span className="mscan-corner tr" />
            <span className="mscan-corner bl" /><span className="mscan-corner br" />
            {scanning && <span className="mscan-line" />}
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
            {(voiceStatus || voiceError || scanError) && (
              <div style={{ fontSize: 12, color: voiceError ? "#f87171" : "#fff" }}>
                {voiceError || voiceStatus || scanError}
              </div>
            )}
          </div>
        )}

        {scanMode === "qr" && (
          <QRScannerPanel
            key={resetTick}
            tripId={TRIP_ID}
            coachId={coachId}
            coachLabel={coach?.coachLabel}
            facingMode={facing}
            onCheckedIn={() => { fetchCoaches(); fetchCoach(coachId); }}
          />
        )}

        {scanMode === "manual" && (
          <ManualTrackingPanel
            key={resetTick}
            coach={coach}
            coachLabel={coach?.coachLabel}
            onCheckedIn={() => { fetchCoaches(); fetchCoach(coachId); }}
          />
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

      {/* Mode toggle */}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        {[
          { key: "face", label: "Face", Icon: ScanFace },
          { key: "qr", label: "QR", Icon: QrCode },
          { key: "manual", label: "Manual", Icon: PencilLine },
        ].map(({ key, label, Icon }) => (
          <button key={key} style={S.modeBtn(scanMode === key)} onClick={() => { setScanMode(key); setScanError(""); }}>
            <Icon size={16} /> {t(label)}
          </button>
        ))}
      </div>

      {scanMode === "face" && !lowLight && !camError && (
        <button
          className="btn btn-primary btn-block" style={{ marginTop: 12, padding: "13px 0", fontSize: 15 }}
          onClick={handleFaceScan} disabled={scanning}
        >
          <ScanFace size={18} /> {scanning ? t("Processing…") : t("Scan face")}
        </button>
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

      {/* Simulated sensors — for demoing the fairness fallback + the 1s SLA.
          Shown regardless of scanMode (matches UnifiedScannerPage.jsx) —
          switching to QR/Manual no longer hides these controls. */}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            className="btn btn-ghost" style={{ flex: 1, fontSize: 12.5, padding: "8px 6px" }}
            onClick={() => { setAutoLowLight(false); setLowLight((v) => !v); setScanError(""); }}
          >
            {lowLight ? <Sun size={14} /> : <Moon size={14} />}
            {lowLight ? "Normal light" : "Simulate low light"}
          </button>
          <button
            className="btn btn-ghost" style={{ flex: 1, fontSize: 12.5, padding: "8px 6px" }}
            onClick={() => setSimulateSlow((v) => !v)}
          >
            {simulateSlow ? <Zap size={14} /> : <Turtle size={14} />}
            {simulateSlow ? "Slow demo: ON" : "Slow demo: OFF"}
          </button>
      </div>

      {/* Compact live count for the selected coach */}
      {coach && (
        <div className="mobile-card" style={{ marginTop: 14, padding: 14 }}>
          <div className="row between" style={{ alignItems: "baseline" }}>
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>{coach.coachLabel}</span>
            <span className="mono" style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
              {coach.boarded}/{coach.expected} {t("boarded")} · {coach.missing} {t("missing")}
            </span>
          </div>
          <div style={{ height: 7, background: "var(--line)", borderRadius: 4, marginTop: 10, overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 4, background: "var(--st-present)", width: `${boardedPct}%`, transition: "width .4s ease" }} />
          </div>
        </div>
      )}

      <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 12, lineHeight: 1.5 }}>
        Zero-Image mode: raw face pixels are zeroed in memory the instant the anonymous
        token is derived. No images stored or transmitted — PDPA compliant.
      </div>
    </div>
  );
}
