// frontend/src/pages/EnrollPage.jsx
// OWNED BY: FaceCheck-Pro (Vimal)
//
// Standalone, PUBLIC delegate self-enrollment app (route: /enroll, registered
// outside Layout/MobileLayout in App.jsx exactly like the passwordless
// /kiosk-scan surface). A delegate opens this before the trip, finds their own
// record by name, gives PDPA consent, captures a face sample and/or records a
// voice passphrase, and submits. Only the irreversible vector/checksum is sent
// to POST /api/enroll — the raw camera pixels are zeroed the instant the token
// is derived (same Zero-Image guarantee as the scanner), and no audio is ever
// uploaded.
//
// This is what makes the scanner REAL: until a delegate enrolls here, the
// scanner has nothing to match them against and correctly reports "not
// recognised" instead of the old random-pick behaviour.

import { useEffect, useRef, useState, useCallback } from "react";
import {
  ScanFace, Mic, CheckCircle2, AlertTriangle, Search, Camera, ShieldCheck, RefreshCw, ArrowLeft,
} from "lucide-react";
import { apiGet, apiPost } from "../lib/api.js";
import { vectorizeFaceLandmarks, vectorizeVoiceprint, isValidBiometricToken } from "../lib/faceScan.js";

export default function EnrollPage() {
  const [step, setStep] = useState("find"); // find | enroll | done
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState([]);
  const [searching, setSearching] = useState(false);
  const [findErr, setFindErr] = useState("");

  const [delegate, setDelegate] = useState(null); // { delegateId, name, coachLabel, enrolled }
  const [consent, setConsent] = useState(false);

  const [faceToken, setFaceToken] = useState(null);
  const [camError, setCamError] = useState("");

  const [passphrase, setPassphrase] = useState("");
  const [voiceToken, setVoiceToken] = useState(null);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState("");
  const [result, setResult] = useState(null); // { name, enrolled }

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recognitionRef = useRef(null);

  /* ---- Step 1: find your record ---------------------------------------- */
  const runSearch = useCallback(async (e) => {
    if (e) e.preventDefault();
    const q = query.trim();
    if (q.length < 2) { setFindErr("Type at least 2 letters of your name."); return; }
    setSearching(true);
    setFindErr("");
    try {
      const { matches: m } = await apiGet(`/enroll/lookup?name=${encodeURIComponent(q)}`);
      setMatches(m || []);
      if ((m || []).length === 0) setFindErr("No delegate found with that name. Check the spelling or ask staff.");
    } catch (err) {
      setFindErr(err.message || "Could not search. Is the backend running?");
    } finally {
      setSearching(false);
    }
  }, [query]);

  function pickDelegate(d) {
    setDelegate(d);
    setStep("enroll");
    setFaceToken(null);
    setVoiceToken(null);
    setPassphrase("");
    setConsent(false);
    setSubmitErr("");
  }

  /* ---- Face camera lifecycle (front / selfie) -------------------------- */
  useEffect(() => {
    if (step !== "enroll" || !consent) { stopCamera(); return undefined; }
    let cancelled = false;
    async function start() {
      try {
        setCamError("");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "user" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((tr) => tr.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch {
        if (!cancelled) setCamError("Camera unavailable — allow camera access, or enroll with your voice passphrase only.");
      }
    }
    function noop() {}
    start();
    return () => { cancelled = true; stopCamera(); noop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, consent]);

  function stopCamera() {
    if (streamRef.current) streamRef.current.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  function captureFace() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) { setCamError("Camera not ready yet — wait a moment and try again."); return; }
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 120;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const token = vectorizeFaceLandmarks(imageData); // zeroes the pixels in place
    canvas.width = 0; canvas.height = 0;
    if (!isValidBiometricToken(token)) { setCamError("Capture failed — try again in better light."); return; }
    setFaceToken(token);
    setCamError("");
  }

  /* ---- Voice passphrase (optional) ------------------------------------- */
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setVoiceSupported(false); return undefined; }
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = "en-SG";
    rec.onresult = (event) => {
      const transcript = Array.from(event.results).map((r) => r[0].transcript).join(" ").trim();
      setPassphrase(transcript);
      if (event.results[event.results.length - 1]?.isFinal) {
        setVoiceListening(false);
        setVoiceStatus(transcript ? `Heard: ${transcript}` : "No speech detected — try again or type it.");
      } else {
        setVoiceStatus("Listening…");
      }
    };
    rec.onerror = () => { setVoiceListening(false); setVoiceStatus("Couldn't capture speech — type the passphrase instead."); };
    rec.onend = () => setVoiceListening(false);
    recognitionRef.current = rec;
    setVoiceSupported(true);
    return () => { try { rec.stop(); } catch { /* ignore */ } recognitionRef.current = null; };
  }, []);

  async function recordVoice() {
    if (!recognitionRef.current) return;
    if (voiceListening) { recognitionRef.current.stop(); return; }
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setVoiceStatus("Microphone blocked — allow mic access, or type the passphrase.");
      return;
    }
    setPassphrase("");
    setVoiceStatus("Listening…");
    setVoiceListening(true);
    recognitionRef.current.start();
  }

  // Turn the current passphrase into a voice token as the delegate edits it.
  useEffect(() => {
    const p = passphrase.trim();
    setVoiceToken(p.length >= 4 ? vectorizeVoiceprint(p) : null);
  }, [passphrase]);

  /* ---- Submit ---------------------------------------------------------- */
  async function submit() {
    if (!delegate) return;
    if (!faceToken && !voiceToken) { setSubmitErr("Capture your face or record a passphrase first."); return; }
    setSubmitting(true);
    setSubmitErr("");
    try {
      const res = await apiPost("/enroll", {
        delegateId: delegate.delegateId,
        faceToken: faceToken || undefined,
        voiceToken: voiceToken || undefined,
      });
      stopCamera();
      setResult(res);
      setStep("done");
    } catch (err) {
      setSubmitErr(err.message || "Enrollment failed — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    stopCamera();
    setStep("find");
    setQuery("");
    setMatches([]);
    setDelegate(null);
    setFaceToken(null);
    setVoiceToken(null);
    setPassphrase("");
    setConsent(false);
    setResult(null);
    setSubmitErr("");
    setFindErr("");
  }

  const canSubmit = consent && (faceToken || voiceToken) && !submitting;

  return (
    <div style={S.shell}>
      <div style={S.card}>
        <div style={S.brand}>
          <ShieldCheck size={20} style={{ color: "var(--scc-red)" }} />
          <span>MusterGo · <strong>Delegate Enrolment</strong></span>
        </div>

        {/* STEP 1 — FIND */}
        {step === "find" && (
          <>
            <h1 style={S.h1}>Enrol your face &amp; voice</h1>
            <p style={S.sub}>
              Do this once before your trip so staff can check you in with a quick face scan on the coach.
              Find your name to begin.
            </p>
            <form onSubmit={runSearch} style={{ position: "relative", marginTop: 16 }}>
              <Search size={16} style={{ position: "absolute", left: 12, top: 13, color: "var(--ink-3)" }} />
              <input
                className="input" placeholder="Your full name…" value={query} autoFocus
                onChange={(e) => setQuery(e.target.value)} style={{ paddingLeft: 36 }}
              />
              <button className="btn btn-primary btn-block" style={{ marginTop: 10 }} disabled={searching}>
                {searching ? "Searching…" : "Find me"}
              </button>
            </form>

            {findErr && <div style={S.err}><AlertTriangle size={14} /> {findErr}</div>}

            {matches.length > 0 && (
              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                {matches.map((m) => (
                  <button key={m.delegateId} onClick={() => pickDelegate(m)} className="mobile-card" style={S.matchRow}>
                    <div style={{ textAlign: "left" }}>
                      <div style={{ fontWeight: 600 }}>{m.name}</div>
                      <div className="muted" style={{ fontSize: 12.5 }}>{m.coachLabel || "No coach yet"}</div>
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      {m.enrolled.face && <span className="badge badge-present" style={{ fontSize: 10 }}>Face ✓</span>}
                      {m.enrolled.voice && <span className="badge badge-present" style={{ fontSize: 10 }}>Voice ✓</span>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* STEP 2 — ENROLL */}
        {step === "enroll" && delegate && (
          <>
            <button onClick={() => { stopCamera(); setStep("find"); }} style={S.back}>
              <ArrowLeft size={15} /> Not you? Search again
            </button>
            <h1 style={S.h1}>{delegate.name}</h1>
            <p style={S.sub}>{delegate.coachLabel || "No coach yet"}</p>

            {/* Consent gate */}
            <label style={S.consent}>
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
              <span style={{ fontSize: 13, lineHeight: 1.5 }}>
                I consent to MusterGo processing my face and/or voice for trip check-in (PDPA). Only an
                irreversible mathematical vector is stored — <strong>no photo or audio is kept</strong>, and I can ask staff to delete it anytime.
              </span>
            </label>

            {!consent && <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>Tick the box above to turn on your camera and microphone.</p>}

            {consent && (
              <>
                {/* FACE */}
                <div style={S.section}>
                  <div style={S.sectionHead}><ScanFace size={16} style={{ color: "var(--scc-red)" }} /> Face sample</div>
                  <div style={S.viewport}>
                    {faceToken ? (
                      <div style={S.captured}>
                        <CheckCircle2 size={40} style={{ color: "var(--st-present)" }} />
                        <div style={{ fontWeight: 700, marginTop: 6 }}>Face captured</div>
                        <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => setFaceToken(null)}>
                          <RefreshCw size={14} /> Retake
                        </button>
                      </div>
                    ) : (
                      <>
                        <video ref={videoRef} autoPlay playsInline muted
                          style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />
                        {camError && (
                          <div style={S.camErr}><Camera size={24} color="#fff" /><div style={{ fontSize: 13, maxWidth: 240 }}>{camError}</div></div>
                        )}
                      </>
                    )}
                  </div>
                  {!faceToken && !camError && (
                    <button className="btn btn-primary btn-block" style={{ marginTop: 10 }} onClick={captureFace}>
                      <ScanFace size={16} /> Capture my face
                    </button>
                  )}
                </div>

                {/* VOICE */}
                <div style={S.section}>
                  <div style={S.sectionHead}><Mic size={16} style={{ color: "var(--scc-red)" }} /> Voice passphrase <span className="muted" style={{ fontWeight: 500 }}>(optional)</span></div>
                  <p className="muted" style={{ fontSize: 12.5, margin: "2px 0 8px" }}>
                    Say or type a short phrase (e.g. “MusterGo check in”). Use the same words at the coach.
                  </p>
                  <input className="input" placeholder="Your passphrase…" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
                  <div className="row" style={{ gap: 8, marginTop: 8 }}>
                    {voiceSupported && (
                      <button className="btn btn-ghost" style={{ flex: 1 }} onClick={recordVoice}>
                        <Mic size={14} /> {voiceListening ? "Stop" : "Record"}
                      </button>
                    )}
                    {voiceToken && <span className="badge badge-present" style={{ alignSelf: "center" }}>Ready ✓</span>}
                  </div>
                  {voiceStatus && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{voiceStatus}</div>}
                </div>

                {submitErr && <div style={S.err}><AlertTriangle size={14} /> {submitErr}</div>}

                <button className="btn btn-primary btn-block" style={{ marginTop: 16, padding: "13px 0", fontSize: 15 }} disabled={!canSubmit} onClick={submit}>
                  {submitting ? "Saving…" : "Complete enrolment"}
                </button>
                <p className="muted" style={{ fontSize: 11.5, textAlign: "center", marginTop: 10, lineHeight: 1.5 }}>
                  Zero-Image: raw pixels are wiped the instant your vector is made. No image or audio leaves this device.
                </p>
              </>
            )}
          </>
        )}

        {/* STEP 3 — DONE */}
        {step === "done" && result && (
          <div style={{ textAlign: "center", padding: "12px 0" }}>
            <CheckCircle2 size={56} style={{ color: "var(--st-present)" }} />
            <h1 style={{ ...S.h1, marginTop: 12 }}>You're enrolled</h1>
            <p style={S.sub}>{result.name} — staff can now check you in on the coach.</p>
            <div className="row" style={{ gap: 8, justifyContent: "center", marginTop: 12 }}>
              {result.enrolled.face && <span className="badge badge-present">Face ✓</span>}
              {result.enrolled.voice && <span className="badge badge-present">Voice ✓</span>}
            </div>
            <button className="btn btn-ghost" style={{ marginTop: 22 }} onClick={reset}>Enrol another delegate</button>
          </div>
        )}
      </div>
    </div>
  );
}

const S = {
  shell: { minHeight: "100vh", background: "var(--bg)", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "24px 16px" },
  card: { width: "min(460px, 100%)", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-md)", padding: 22 },
  brand: { display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--font-display)", color: "var(--scc-red)", fontSize: 15, paddingBottom: 16, borderBottom: "1px solid var(--line)", marginBottom: 18 },
  h1: { fontSize: 22, margin: 0 },
  sub: { color: "var(--ink-3)", fontSize: 13.5, marginTop: 4 },
  err: { marginTop: 12, display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--st-missing)", background: "var(--st-missing-bg)", border: "1px solid var(--st-missing)", borderRadius: "var(--r-sm)", padding: "9px 11px" },
  matchRow: { display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", marginBottom: 0 },
  back: { display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: "none", color: "var(--ink-3)", fontSize: 12.5, fontWeight: 600, padding: 0, marginBottom: 10 },
  consent: { display: "flex", gap: 10, alignItems: "flex-start", marginTop: 16, background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", padding: 12, cursor: "pointer" },
  section: { marginTop: 18 },
  sectionHead: { display: "flex", alignItems: "center", gap: 7, fontWeight: 700, fontSize: 14, marginBottom: 8 },
  viewport: { position: "relative", borderRadius: "var(--r-md)", overflow: "hidden", background: "#000", width: "100%", aspectRatio: "4 / 3", display: "grid", placeItems: "center" },
  captured: { textAlign: "center", color: "var(--ink)", background: "var(--surface)", width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" },
  camErr: { position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "#fff", textAlign: "center", padding: 16 },
};
