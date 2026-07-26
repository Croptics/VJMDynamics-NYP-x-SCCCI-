// frontend/src/pages/EnrollPage.jsx
// OWNED BY: FaceCheck-Pro (Vimal)
//
// Delegate biometric enrolment. Two surfaces, one component:
//   • PUBLIC  /enroll     — standalone kiosk page, no login (registered outside
//                           Layout/MobileLayout in App.jsx, like /kiosk-scan).
//   • DESKTOP /enrolment  — same flow inside the app shell (`embedded`), so
//                           staff can enrol a delegate at the counter.
//
// Flow: find your record → give PDPA consent → capture face (auto, gated on a
// Singpass-style alignment circle) → optionally record a voiceprint → save.
// Afterwards you can self-test the enrolment and, under PDPA, erase it.
//
// PRIVACY: only the anonymous numeric embedding is ever transmitted. Raw
// camera pixels are zeroed the instant the vector is derived, and the mic is
// read as frequency magnitudes only — never recorded to a file.

import { useEffect, useRef, useState, useCallback } from "react";
import {
  ScanFace, Mic, CheckCircle2, AlertTriangle, Search, Camera, ShieldCheck,
  RefreshCw, ArrowLeft, Trash2, BadgeCheck, Users, Lock, Loader2, X,
} from "lucide-react";
import { apiGet, apiPost } from "../lib/api.js";
import {
  vectorizeFaceLandmarks, vectorizeVoiceprint, captureVoiceEmbedding, isValidBiometricToken,
  faceAlignment, parseFaceVector, averageFaceVectors, sampleConsistency, buildFaceToken, captureFrame, FACE_CROP,
} from "../lib/faceScan.js";

const TICK_MS = 220;
const HOLD_TICKS = 5;      // aligned frames required before capture starts (~1.1s)
const SAMPLES = 5;         // frames vectorized and averaged into the template
const MIN_CONSISTENCY = 0.9; // samples must agree this much or the attempt is binned
const STUCK_TICKS = 45;    // ~10s of failing the gate before offering a manual override

const STEPS = [
  { key: "find", label: "Find you" },
  { key: "enroll", label: "Capture" },
  { key: "done", label: "Done" },
];

export default function EnrollPage({ embedded = false }) {
  const [step, setStep] = useState("find");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState([]);
  const [searching, setSearching] = useState(false);
  const [findErr, setFindErr] = useState("");
  const [stats, setStats] = useState(null);

  const [delegate, setDelegate] = useState(null);
  const [consent, setConsent] = useState(false);

  const [faceToken, setFaceToken] = useState(null);
  const [camError, setCamError] = useState("");
  const [align, setAlign] = useState({ ready: false, hint: "Fit your face inside the circle", progress: 0, coverage: 0 });
  const [capture, setCapture] = useState({ active: false, done: 0, total: SAMPLES });
  const [captureMsg, setCaptureMsg] = useState("");
  const [quality, setQuality] = useState(null);
  const [showOverride, setShowOverride] = useState(false);

  const [passphrase, setPassphrase] = useState("");
  const [voiceToken, setVoiceToken] = useState(null);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const [micLevel, setMicLevel] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState("");
  const [result, setResult] = useState(null);

  // Post-enrolment tools
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // { match, similarity, threshold }
  const [erasing, setErasing] = useState(false);
  const [confirmErase, setConfirmErase] = useState(false);

  const videoRef = useRef(null);
  const streamRef = useRef(null);

  /* ---- Roster coverage (staff-facing progress) ------------------------- */
  const loadStats = useCallback(async () => {
    try { setStats(await apiGet("/enroll/stats")); } catch { /* optional */ }
  }, []);
  useEffect(() => { loadStats(); }, [loadStats]);

  /* ---- Step 1: find your record --------------------------------------- */
  const runSearch = useCallback(async (e) => {
    if (e) e.preventDefault();
    const q = query.trim();
    if (q.length < 2) { setFindErr("Type at least 2 letters of your name."); return; }
    setSearching(true); setFindErr("");
    try {
      const { matches: m } = await apiGet(`/enroll/lookup?name=${encodeURIComponent(q)}`);
      setMatches(m || []);
      if ((m || []).length === 0) setFindErr("No delegate found with that name. Check the spelling or ask staff.");
    } catch (err) {
      setFindErr(err.message || "Could not search. Is the backend running?");
    } finally { setSearching(false); }
  }, [query]);

  function pickDelegate(d) {
    setDelegate(d); setStep("enroll");
    setFaceToken(null); setVoiceToken(null); setPassphrase("");
    setConsent(false); setSubmitErr(""); setQuality(null);
    setTestResult(null); setShowOverride(false); setCaptureMsg("");
  }

  /* ---- Camera lifecycle ------------------------------------------------ */
  useEffect(() => {
    if (step !== "enroll" || !consent) { stopCamera(); return undefined; }
    let cancelled = false;
    (async () => {
      try {
        setCamError("");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "user" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch {
        if (!cancelled) setCamError("Camera unavailable — allow camera access, or enrol with your voice only.");
      }
    })();
    return () => { cancelled = true; stopCamera(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, consent]);

  function stopCamera() {
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  // Single shared capture path (centred square, fixed size) so enrolment and
  // every scanner produce directly comparable frames — see captureFrame().
  const grabber = () => ({
    frame: () => captureFrame(videoRef.current),
    dispose: () => {},
  });

  /* ---- Gated auto-capture (align → multi-sample → average) ------------- */
  useEffect(() => {
    if (step !== "enroll" || !consent || faceToken || camError) {
      setAlign({ ready: false, hint: "Fit your face inside the circle", progress: 0, coverage: 0 });
      setCapture({ active: false, done: 0, total: SAMPLES });
      return undefined;
    }
    let cancelled = false, phase = "aligning", hold = 0, stuck = 0, samples = [];
    const g = grabber();
    const restart = (msg) => {
      phase = "aligning"; hold = 0; samples = [];
      setCapture({ active: false, done: 0, total: SAMPLES });
      if (msg) setCaptureMsg(msg);
    };

    const id = setInterval(() => {
      if (cancelled) return;
      const probe = g.frame();
      if (!probe) return;
      const a = faceAlignment(probe);

      if (phase === "aligning") {
        hold = a.ready ? hold + 1 : 0;
        stuck = a.ready ? 0 : stuck + 1;
        if (stuck >= STUCK_TICKS) setShowOverride(true);
        setAlign({ ...a, progress: Math.min(1, hold / HOLD_TICKS) });
        if (hold >= HOLD_TICKS) {
          phase = "capturing"; samples = []; setCaptureMsg("");
          setCapture({ active: true, done: 0, total: SAMPLES });
        }
        return;
      }
      if (!a.ready) { restart("Moved out of the circle — starting again."); setAlign({ ...a, progress: 0 }); return; }

      const frame = g.frame();
      if (!frame) return;
      const vec = parseFaceVector(vectorizeFaceLandmarks(frame));
      if (vec) samples.push(vec);
      setCapture({ active: true, done: samples.length, total: SAMPLES });

      if (samples.length >= SAMPLES) {
        const worst = sampleConsistency(samples);
        if (worst < MIN_CONSISTENCY) { restart(`Samples didn't agree (${worst.toFixed(2)}) — hold still and we'll retry.`); return; }
        const token = buildFaceToken(averageFaceVectors(samples));
        if (!token || !isValidBiometricToken(token)) { restart("Capture failed — trying again."); return; }
        cancelled = true;
        setQuality({ samples: samples.length, consistency: worst, vector: averageFaceVectors(samples) });
        setCaptureMsg(""); setFaceToken(token);
        setCapture({ active: false, done: SAMPLES, total: SAMPLES });
      }
    }, TICK_MS);

    return () => { cancelled = true; clearInterval(id); g.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, consent, faceToken, camError]);

  /* Manual override — skips the alignment gate, not the vectorization. */
  async function captureFace() {
    const g = grabber();
    if (!g.frame()) { setCamError("Camera not ready yet — wait a moment and try again."); g.dispose(); return; }
    const samples = [];
    setCapture({ active: true, done: 0, total: SAMPLES });
    for (let i = 0; i < SAMPLES; i += 1) {
      const f = g.frame();
      if (f) { const v = parseFaceVector(vectorizeFaceLandmarks(f)); if (v) samples.push(v); }
      setCapture({ active: true, done: samples.length, total: SAMPLES });
      await new Promise((r) => setTimeout(r, TICK_MS));
    }
    g.dispose();
    setCapture({ active: false, done: 0, total: SAMPLES });
    const avg = samples.length ? averageFaceVectors(samples) : null;
    const token = avg ? buildFaceToken(avg) : null;
    if (!token || !isValidBiometricToken(token)) { setCamError("Capture failed — try again in better light."); return; }
    setQuality({ samples: samples.length, consistency: sampleConsistency(samples), vector: avg });
    setFaceToken(token); setCamError("");
  }

  /* ---- Voiceprint ------------------------------------------------------ */
  useEffect(() => {
    setVoiceSupported(!!(window.AudioContext || window.webkitAudioContext) && !!navigator.mediaDevices);
  }, []);

  async function recordVoiceprint() {
    if (voiceListening) return;
    setVoiceListening(true); setVoiceToken(null); setVoiceStatus("Recording… keep speaking");
    try {
      const token = await captureVoiceEmbedding(2500, setMicLevel);
      if (!token) { setVoiceStatus("Too quiet — speak clearly and try again."); }
      else { setVoiceToken(token); setVoiceStatus("Voiceprint captured"); }
    } catch {
      setVoiceStatus("Microphone unavailable — allow mic access, or use the passphrase fallback.");
    } finally { setVoiceListening(false); setMicLevel(0); }
  }

  useEffect(() => {
    if (voiceToken && voiceToken.startsWith("voice:v2:")) return;
    const p = passphrase.trim();
    setVoiceToken(p.length >= 4 ? vectorizeVoiceprint(p) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passphrase]);

  /* ---- Submit / test / erase ------------------------------------------ */
  async function submit() {
    if (!delegate) return;
    if (!faceToken && !voiceToken) { setSubmitErr("Capture your face or record a voiceprint first."); return; }
    setSubmitting(true); setSubmitErr("");
    try {
      const res = await apiPost("/enroll", {
        delegateId: delegate.delegateId,
        faceToken: faceToken || undefined,
        voiceToken: voiceToken || undefined,
      });
      stopCamera(); setResult(res); setStep("done"); loadStats();
    } catch (err) {
      setSubmitErr(err.message || "Enrolment failed — please try again.");
    } finally { setSubmitting(false); }
  }

  /* Self-test: capture a FRESH face and score it against what was stored,
   * without touching attendance. Confirms the scanner will recognise them. */
  async function testEnrolment() {
    if (!delegate) return;
    setTesting(true); setTestResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "user" } }, audio: false });
      const v = document.createElement("video");
      v.srcObject = stream; v.muted = true; v.playsInline = true;
      await v.play();
      await new Promise((r) => setTimeout(r, 700)); // let exposure settle
      const samples = [];
      for (let i = 0; i < 3; i += 1) {
        const f = captureFrame(v);
        if (f) { const vec = parseFaceVector(vectorizeFaceLandmarks(f)); if (vec) samples.push(vec); }
        await new Promise((r) => setTimeout(r, 150));
      }
      stream.getTracks().forEach((t) => t.stop());
      const token = samples.length ? buildFaceToken(averageFaceVectors(samples)) : null;
      if (!token) { setTestResult({ error: "Couldn't capture a test frame." }); return; }
      setTestResult(await apiPost("/enroll/verify", { delegateId: delegate.delegateId, faceToken: token }));
    } catch (e) {
      setTestResult({ error: e.message || "Test failed — allow camera access and retry." });
    } finally { setTesting(false); }
  }

  async function eraseData() {
    if (!delegate) return;
    setErasing(true);
    try {
      await apiPost("/enroll/revoke", { delegateId: delegate.delegateId });
      setConfirmErase(false); setResult(null); setTestResult(null);
      setFaceToken(null); setVoiceToken(null); setQuality(null);
      setStep("find"); setMatches([]); setQuery(""); setDelegate(null);
      loadStats();
    } catch (e) {
      setSubmitErr(e.message || "Could not erase — try again.");
    } finally { setErasing(false); }
  }

  function reset() {
    stopCamera();
    setStep("find"); setQuery(""); setMatches([]); setDelegate(null);
    setFaceToken(null); setVoiceToken(null); setPassphrase("");
    setConsent(false); setResult(null); setSubmitErr(""); setFindErr("");
    setQuality(null); setCaptureMsg(""); setShowOverride(false);
    setTestResult(null); setCapture({ active: false, done: 0, total: SAMPLES });
  }

  const canSubmit = consent && (faceToken || voiceToken) && !submitting;
  const stepIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <div style={embedded ? S.shellEmbedded : S.shell}>
      <style>{CSS}</style>
      <div className="enr-wrap">

        {!embedded && (
          <div style={S.brand}>
            <ShieldCheck size={20} style={{ color: "var(--scc-red)" }} />
            <span>MusterGo · <strong>Delegate Enrolment</strong></span>
          </div>
        )}

        {/* Step rail */}
        <ol className="enr-steps" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s.key} className={"enr-step" + (i === stepIndex ? " on" : i < stepIndex ? " done" : "")}>
              <span className="enr-step-dot">{i < stepIndex ? <CheckCircle2 size={13} /> : i + 1}</span>
              <span className="enr-step-label">{s.label}</span>
            </li>
          ))}
        </ol>

        {/* ================= STEP 1 — FIND ================= */}
        {step === "find" && (
          <div className="enr-grid">
            <section className="enr-card">
              <h2 className="enr-h2">Enrol your face &amp; voice</h2>
              <p className="enr-sub">
                Do this once before your trip so staff can check you in with a quick scan at the coach.
                Find your name to begin.
              </p>
              <form onSubmit={runSearch} className="enr-search">
                <Search size={16} className="enr-search-icon" />
                <input className="input" placeholder="Your full name…" value={query} autoFocus
                  onChange={(e) => setQuery(e.target.value)} style={{ paddingLeft: 38 }} />
                <button className="btn btn-primary btn-block" style={{ marginTop: 10 }} disabled={searching}>
                  {searching ? <><Loader2 size={15} className="enr-spin" /> Searching…</> : "Find me"}
                </button>
              </form>

              {findErr && <div className="enr-alert enr-alert-err"><AlertTriangle size={14} /><span>{findErr}</span></div>}

              {matches.length > 0 && (
                <ul className="enr-matches">
                  {matches.map((m) => (
                    <li key={m.delegateId}>
                      <button className="enr-match" onClick={() => pickDelegate(m)}>
                        <span className="enr-avatar">{initials(m.name)}</span>
                        <span className="enr-match-text">
                          <strong>{m.name}</strong>
                          <small>{m.coachLabel || "No coach yet"}</small>
                        </span>
                        <span className="enr-match-tags">
                          {m.enrolled.face && <em className="enr-tag ok">Face</em>}
                          {m.enrolled.voice && <em className="enr-tag ok">Voice</em>}
                          {!m.enrolled.face && !m.enrolled.voice && <em className="enr-tag">Not enrolled</em>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <aside className="enr-side">
              {stats && (
                <div className="enr-card enr-stat">
                  <div className="enr-side-head"><Users size={15} /> Roster coverage</div>
                  <div className="enr-bignum">{stats.enrolled}<span> / {stats.total}</span></div>
                  <div className="enr-bar"><div style={{ width: `${pct(stats.enrolled, stats.total)}%` }} /></div>
                  <div className="enr-substat">
                    <span><ScanFace size={13} /> {stats.face} face</span>
                    <span><Mic size={13} /> {stats.voice} voice</span>
                  </div>
                </div>
              )}
              <div className="enr-card enr-privacy">
                <div className="enr-side-head"><Lock size={15} /> Your privacy</div>
                <ul>
                  <li>No photo or audio is ever stored or uploaded.</li>
                  <li>Only an anonymous list of numbers is saved.</li>
                  <li>Camera pixels are wiped the instant it's made.</li>
                  <li>You can erase it at any time.</li>
                </ul>
              </div>
            </aside>
          </div>
        )}

        {/* ================= STEP 2 — CAPTURE ================= */}
        {step === "enroll" && delegate && (
          <>
            <button onClick={() => { stopCamera(); setStep("find"); }} className="enr-back">
              <ArrowLeft size={15} /> Not you? Search again
            </button>

            <div className="enr-person">
              <span className="enr-avatar lg">{initials(delegate.name)}</span>
              <div>
                <h2 className="enr-h2" style={{ margin: 0 }}>{delegate.name}</h2>
                <p className="enr-sub" style={{ margin: "2px 0 0" }}>{delegate.coachLabel || "No coach yet"}</p>
              </div>
              {(delegate.enrolled?.face || delegate.enrolled?.voice) && (
                <span className="enr-tag ok" style={{ marginLeft: "auto" }}>Already enrolled · recapturing replaces it</span>
              )}
            </div>

            <label className="enr-consent">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>
                I consent to MusterGo processing my face and/or voice for trip check-in (PDPA). Only an
                irreversible mathematical vector is stored — <strong>no photo or audio is kept</strong> — and I can erase it at any time.
              </span>
            </label>

            {!consent ? (
              <p className="enr-sub" style={{ textAlign: "center", padding: "18px 0" }}>
                Tick the box above to switch on your camera and microphone.
              </p>
            ) : (
              <div className="enr-grid">
                {/* ---- FACE ---- */}
                <section className="enr-card">
                  <div className="enr-card-head"><ScanFace size={16} /> Face sample</div>

                  <div className="enr-view">
                    {faceToken ? (
                      <div className="enr-captured">
                        <CheckCircle2 size={44} style={{ color: "var(--st-present)" }} />
                        <strong>Face captured</strong>
                        {quality && (
                          <>
                            <small>{quality.samples} samples averaged · agreement {quality.consistency.toFixed(2)}</small>
                            <VectorBars vector={quality.vector} />
                            <small className="muted">128-value template</small>
                          </>
                        )}
                        <button className="btn btn-ghost" style={{ marginTop: 12 }}
                          onClick={() => { setFaceToken(null); setQuality(null); setShowOverride(false); setCaptureMsg(""); setTestResult(null); }}>
                          <RefreshCw size={14} /> Redo face scan
                        </button>
                      </div>
                    ) : (
                      <>
                        <video ref={videoRef} autoPlay playsInline muted className="enr-video" />
                        {!camError && <FaceGuide align={align} capturing={capture.active} />}
                        {camError && (
                          <div className="enr-camerr"><Camera size={24} /><span>{camError}</span></div>
                        )}
                      </>
                    )}
                  </div>

                  {!faceToken && !camError && (
                    <>
                      <p className={"enr-hint" + (capture.active || align.ready ? " ok" : "")}>
                        {capture.active
                          ? `Analysing… sample ${capture.done}/${capture.total}`
                          : (align.hint || "Fit your face inside the circle")}
                      </p>
                      {capture.active && (
                        <div className="enr-dots">
                          {Array.from({ length: capture.total }).map((_, i) => (
                            <span key={i} className={i < capture.done ? "on" : ""} />
                          ))}
                        </div>
                      )}
                      {captureMsg && <p className="enr-hint warn">{captureMsg}</p>}
                      {showOverride && !capture.active && (
                        <button className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={captureFace}>
                          <ScanFace size={15} /> Trouble detecting? Capture anyway
                        </button>
                      )}
                    </>
                  )}
                </section>

                {/* ---- VOICE ---- */}
                <section className="enr-card">
                  <div className="enr-card-head">
                    <Mic size={16} /> Voiceprint <span className="enr-optional">optional</span>
                  </div>
                  <p className="enr-sub" style={{ marginTop: 0 }}>
                    Used when it's too dark for the camera. Say a phrase like <em>“MusterGo check in”</em> for
                    about two seconds — we capture the <strong>frequency profile of your voice</strong>, never the audio.
                  </p>

                  {voiceSupported ? (
                    <>
                      <button
                        className={voiceToken?.startsWith("voice:v2:") ? "btn btn-ghost btn-block" : "btn btn-primary btn-block"}
                        onClick={recordVoiceprint} disabled={voiceListening}
                      >
                        {voiceListening ? <Loader2 size={15} className="enr-spin" /> : <Mic size={15} />}
                        {voiceListening ? "Recording…" : voiceToken?.startsWith("voice:v2:") ? "Re-record voiceprint" : "Record my voiceprint"}
                      </button>
                      {voiceListening && (
                        <div className="enr-level"><div style={{ width: `${Math.min(100, Math.round(micLevel * 260))}%` }} /></div>
                      )}
                    </>
                  ) : (
                    <p className="enr-sub">This browser has no Web Audio support — use the passphrase fallback below.</p>
                  )}

                  {voiceStatus && (
                    <p className={"enr-hint" + (voiceToken ? " ok" : "")}>
                      {voiceToken && <CheckCircle2 size={13} style={{ verticalAlign: -2, marginRight: 4 }} />}
                      {voiceStatus}
                    </p>
                  )}

                  {!voiceToken?.startsWith("voice:v2:") && (
                    <details className="enr-details">
                      <summary>No microphone? Use a typed passphrase</summary>
                      <input className="input" style={{ marginTop: 8 }} placeholder="Type a passphrase…"
                        value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
                      <small className="muted">A shared secret, not a biometric — say these exact words at the coach.</small>
                    </details>
                  )}
                </section>
              </div>
            )}

            {consent && (
              <div className="enr-submit">
                {submitErr && <div className="enr-alert enr-alert-err"><AlertTriangle size={14} /><span>{submitErr}</span></div>}
                <div className="enr-ready">
                  <span className={faceToken ? "on" : ""}>{faceToken ? <CheckCircle2 size={14} /> : <X size={14} />} Face</span>
                  <span className={voiceToken ? "on" : ""}>{voiceToken ? <CheckCircle2 size={14} /> : <X size={14} />} Voice</span>
                </div>
                <button className="btn btn-primary btn-block enr-cta" disabled={!canSubmit} onClick={submit}>
                  {submitting ? <><Loader2 size={16} className="enr-spin" /> Saving…</> : "Complete enrolment"}
                </button>
                <p className="enr-fine">
                  Zero-Image: raw pixels are wiped the instant your vector is made. No image or audio leaves this device.
                </p>
              </div>
            )}
          </>
        )}

        {/* ================= STEP 3 — DONE ================= */}
        {step === "done" && result && (
          <div className="enr-grid">
            <section className="enr-card enr-done">
              <CheckCircle2 size={56} style={{ color: "var(--st-present)" }} />
              <h2 className="enr-h2">You're enrolled</h2>
              <p className="enr-sub">{result.name} — staff can now check you in at the coach.</p>
              <div className="enr-chips">
                {result.enrolled.face && <span className="enr-tag ok"><ScanFace size={12} /> Face</span>}
                {result.enrolled.voice && (
                  <span className="enr-tag ok"><Mic size={12} /> Voice {result.enrolled.voiceType === "acoustic" ? "(acoustic)" : "(passphrase)"}</span>
                )}
              </div>
              <button className="btn btn-ghost" style={{ marginTop: 20 }} onClick={reset}>Enrol another delegate</button>
            </section>

            <aside className="enr-side">
              {/* Self-test */}
              <div className="enr-card">
                <div className="enr-side-head"><BadgeCheck size={15} /> Check it works</div>
                <p className="enr-sub" style={{ marginTop: 0 }}>
                  Take a fresh look at the camera and we'll score it against what we just saved — without
                  checking you in.
                </p>
                <button className="btn btn-ghost btn-block" onClick={testEnrolment} disabled={testing}>
                  {testing ? <><Loader2 size={15} className="enr-spin" /> Testing…</> : <><ScanFace size={15} /> Test my enrolment</>}
                </button>
                {testResult && (
                  testResult.error ? (
                    <div className="enr-alert enr-alert-err"><AlertTriangle size={14} /><span>{testResult.error}</span></div>
                  ) : (
                    <div className={"enr-test " + (testResult.match ? "ok" : "bad")}>
                      <strong>{testResult.match ? "Recognised ✓" : "Not recognised"}</strong>
                      <div className="enr-bar"><div style={{ width: `${Math.max(0, Math.min(100, testResult.similarity * 100))}%` }} /></div>
                      <small>similarity {testResult.similarity.toFixed(3)} · needs ≥ {testResult.threshold}</small>
                      {!testResult.match && <small>Try re-enrolling in the same lighting you'll be scanned in.</small>}
                    </div>
                  )
                )}
              </div>

              {/* PDPA erasure */}
              <div className="enr-card">
                <div className="enr-side-head"><Lock size={15} /> Your data</div>
                {!confirmErase ? (
                  <>
                    <p className="enr-sub" style={{ marginTop: 0 }}>
                      You can remove your face and voice data at any time. Staff can still check you in manually or by QR.
                    </p>
                    <button className="btn btn-ghost btn-block enr-danger" onClick={() => setConfirmErase(true)}>
                      <Trash2 size={15} /> Erase my biometric data
                    </button>
                  </>
                ) : (
                  <>
                    <p className="enr-sub" style={{ marginTop: 0 }}>
                      <strong>Erase everything for {result.name}?</strong> This permanently deletes the stored
                      face and voice vectors. You'd need to enrol again to be scanned.
                    </p>
                    <div className="row" style={{ gap: 8 }}>
                      <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setConfirmErase(false)} disabled={erasing}>Cancel</button>
                      <button className="btn btn-primary enr-danger-solid" style={{ flex: 1 }} onClick={eraseData} disabled={erasing}>
                        {erasing ? "Erasing…" : "Erase"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- small pieces ---------- */

function initials(name) {
  return (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

/** Passport-booth alignment circle: dashed while framing, green + sweeping
 *  progress ring once aligned, solid while the samples are being taken. */
function FaceGuide({ align, capturing }) {
  const R = 46, C = 2 * Math.PI * R;
  const ok = align.ready || capturing;
  return (
    <div className="enr-guide">
      <div style={{ height: `${FACE_CROP * 100}%`, aspectRatio: "1" }}>
        <svg viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={R} fill="none" strokeWidth="2.5"
            stroke={ok ? "#22c55e" : "rgba(255,255,255,0.85)"}
            strokeDasharray={ok ? "none" : "6 6"} opacity={ok ? 0.45 : 0.9} />
          {(align.progress > 0 || capturing) && (
            <circle cx="50" cy="50" r={R} fill="none" stroke="#22c55e" strokeWidth="4.5" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - (capturing ? 1 : align.progress))}
              transform="rotate(-90 50 50)" style={{ transition: "stroke-dashoffset .18s linear" }} />
          )}
        </svg>
      </div>
    </div>
  );
}

/** Tiny visualisation of the stored template — makes the abstract "128 numbers"
 *  concrete, and gives an at-a-glance sense that two captures differ. */
function VectorBars({ vector }) {
  if (!Array.isArray(vector) || !vector.length) return null;
  const slice = vector.slice(0, 64);
  const min = Math.min(...slice), max = Math.max(...slice), span = max - min || 1;
  return (
    <div className="enr-vec" title="Your face template (first 64 of 128 values)">
      {slice.map((v, i) => <span key={i} style={{ height: `${8 + ((v - min) / span) * 92}%` }} />)}
    </div>
  );
}

const S = {
  shell: { minHeight: "100vh", background: "var(--bg)", padding: "28px 16px" },
  shellEmbedded: { padding: 0 },
  brand: {
    display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--font-display)",
    color: "var(--scc-red)", fontSize: 16, marginBottom: 18,
  },
};

const CSS = `
.enr-wrap { width: 100%; max-width: 940px; margin: 0 auto; }

/* step rail */
.enr-steps { display:flex; gap:8px; list-style:none; padding:0; margin:0 0 20px; }
.enr-step { flex:1; display:flex; align-items:center; gap:8px; font-size:12.5px; font-weight:600;
  color:var(--ink-3); padding:8px 12px; border-radius:999px; background:var(--surface-2);
  border:1px solid var(--line); min-width:0; }
.enr-step-dot { width:20px; height:20px; border-radius:999px; flex-shrink:0; display:grid; place-items:center;
  background:var(--line); color:var(--ink-3); font-size:11px; font-weight:800; }
.enr-step.on { color:var(--scc-red); background:var(--scc-red-tint); border-color:var(--scc-red-tint-2); }
.enr-step.on .enr-step-dot { background:var(--scc-red); color:#fff; }
.enr-step.done { color:var(--st-present); }
.enr-step.done .enr-step-dot { background:var(--st-present); color:#fff; }
.enr-step-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

/* layout */
.enr-grid { display:grid; grid-template-columns:1fr; gap:14px; align-items:start; }
@media (min-width:780px){ .enr-grid { grid-template-columns:1.35fr 1fr; } }
.enr-side { display:flex; flex-direction:column; gap:14px; }
.enr-card { background:var(--surface); border:1px solid var(--line); border-radius:var(--r-lg);
  box-shadow:var(--shadow-sm); padding:18px; }
.enr-card-head, .enr-side-head { display:flex; align-items:center; gap:8px; font-weight:700; font-size:14px; margin-bottom:10px; }
.enr-card-head svg, .enr-side-head svg { color:var(--scc-red); }
.enr-optional { font-weight:500; font-size:12px; color:var(--ink-3); }
.enr-h2 { font-size:20px; margin:0 0 4px; }
.enr-sub { color:var(--ink-3); font-size:13.5px; line-height:1.55; margin:0 0 12px; }

/* search + matches */
.enr-search { position:relative; }
.enr-search-icon { position:absolute; left:13px; top:13px; color:var(--ink-3); }
.enr-matches { list-style:none; padding:0; margin:14px 0 0; display:flex; flex-direction:column; gap:8px; }
.enr-match { width:100%; display:flex; align-items:center; gap:12px; text-align:left; cursor:pointer;
  background:var(--surface); border:1px solid var(--line); border-radius:var(--r-md); padding:11px 13px;
  color:inherit; font:inherit; transition:border-color .15s, background .15s; }
.enr-match:hover { border-color:var(--scc-red); background:var(--surface-2); }
.enr-match-text { display:flex; flex-direction:column; min-width:0; flex:1; }
.enr-match-text small { color:var(--ink-3); font-size:12px; }
.enr-match-tags { display:flex; gap:5px; flex-shrink:0; }
.enr-avatar { width:36px; height:36px; border-radius:999px; flex-shrink:0; display:grid; place-items:center;
  background:var(--scc-red-tint); color:var(--scc-red); font-weight:800; font-size:13px; }
.enr-avatar.lg { width:46px; height:46px; font-size:15px; }
.enr-tag { font-style:normal; font-size:10.5px; font-weight:800; padding:3px 8px; border-radius:999px;
  background:var(--st-neutral-bg); color:var(--st-neutral); display:inline-flex; align-items:center; gap:4px; white-space:nowrap; }
.enr-tag.ok { background:var(--st-present-bg); color:var(--st-present); }

/* person header + consent */
.enr-back { display:inline-flex; align-items:center; gap:6px; background:none; border:none; padding:0;
  color:var(--ink-3); font-size:12.5px; font-weight:600; cursor:pointer; margin-bottom:12px; }
.enr-back:hover { color:var(--scc-red); }
.enr-person { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:14px; }
.enr-consent { display:flex; gap:11px; align-items:flex-start; background:var(--surface-2);
  border:1px solid var(--line); border-radius:var(--r-md); padding:14px; cursor:pointer;
  font-size:13px; line-height:1.55; margin-bottom:14px; }
.enr-consent input { margin-top:3px; flex-shrink:0; }

/* camera */
.enr-view { position:relative; width:100%; aspect-ratio:1; border-radius:var(--r-md); overflow:hidden;
  background:#000; display:grid; place-items:center; }
.enr-video { width:100%; height:100%; object-fit:cover; transform:scaleX(-1); }
.enr-guide { position:absolute; inset:0; display:grid; place-items:center; pointer-events:none; }
.enr-guide svg { width:100%; height:100%; display:block; }
.enr-camerr { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center;
  justify-content:center; gap:8px; color:#fff; text-align:center; padding:18px; font-size:13px; }
.enr-captured { width:100%; height:100%; background:var(--surface); display:flex; flex-direction:column;
  align-items:center; justify-content:center; gap:5px; text-align:center; padding:14px; }
.enr-captured small { color:var(--ink-3); font-size:11.5px; }
.enr-hint { text-align:center; font-size:13px; font-weight:600; color:var(--ink-2); margin:10px 0 0; }
.enr-hint.ok { color:var(--st-present); }
.enr-hint.warn { color:var(--st-review); font-weight:500; font-size:12px; }
.enr-dots { display:flex; gap:6px; justify-content:center; margin-top:8px; }
.enr-dots span { width:9px; height:9px; border-radius:999px; background:var(--line); transition:background .2s; }
.enr-dots span.on { background:var(--st-present); }

/* vector viz */
.enr-vec { display:flex; align-items:flex-end; gap:1px; height:30px; width:min(210px,90%); margin:8px 0 2px; }
.enr-vec span { flex:1; background:linear-gradient(180deg,var(--scc-red),var(--scc-red-600)); border-radius:1px; opacity:.85; }

/* voice */
.enr-level { height:6px; background:var(--line); border-radius:3px; margin-top:9px; overflow:hidden; }
.enr-level div { height:100%; background:var(--st-present); border-radius:3px; transition:width .08s linear; }
.enr-details { margin-top:12px; }
.enr-details summary { font-size:12.5px; color:var(--ink-3); cursor:pointer; }
.enr-details small { display:block; margin-top:6px; font-size:11.5px; }

/* submit */
.enr-submit { margin-top:16px; }
.enr-ready { display:flex; gap:16px; justify-content:center; margin-bottom:10px; font-size:12.5px; font-weight:700; color:var(--ink-3); }
.enr-ready span { display:inline-flex; align-items:center; gap:5px; }
.enr-ready span.on { color:var(--st-present); }
.enr-cta { padding:14px 0; font-size:15px; }
.enr-fine { font-size:11.5px; color:var(--ink-3); text-align:center; margin-top:10px; line-height:1.5; }

/* alerts */
.enr-alert { display:flex; align-items:center; gap:8px; font-size:13px; border-radius:var(--r-sm);
  padding:10px 12px; margin-top:12px; }
.enr-alert-err { background:var(--st-missing-bg); color:var(--st-missing); border:1px solid var(--st-missing); }

/* stats + done */
.enr-bignum { font-size:30px; font-weight:800; line-height:1; }
.enr-bignum span { font-size:15px; font-weight:600; color:var(--ink-3); }
.enr-bar { height:7px; background:var(--line); border-radius:4px; overflow:hidden; margin:9px 0 8px; }
.enr-bar div { height:100%; background:var(--st-present); border-radius:4px; transition:width .4s ease; }
.enr-substat { display:flex; gap:14px; font-size:12px; color:var(--ink-3); font-weight:600; }
.enr-substat span { display:inline-flex; align-items:center; gap:5px; }
.enr-privacy ul { margin:0; padding-left:18px; font-size:12.5px; color:var(--ink-3); line-height:1.7; }
.enr-done { text-align:center; display:flex; flex-direction:column; align-items:center; padding:30px 20px; }
.enr-chips { display:flex; gap:8px; justify-content:center; flex-wrap:wrap; margin-top:10px; }
.enr-test { margin-top:12px; padding:12px; border-radius:var(--r-sm); font-size:12.5px; }
.enr-test.ok { background:var(--st-present-bg); color:var(--st-present); }
.enr-test.bad { background:var(--st-missing-bg); color:var(--st-missing); }
.enr-test strong { display:block; margin-bottom:6px; font-size:13.5px; }
.enr-test small { display:block; opacity:.85; }
.enr-danger { color:var(--st-missing); border-color:var(--st-missing); }
.enr-danger-solid { background:var(--st-missing); }

.enr-spin { animation:enr-spin .9s linear infinite; }
@keyframes enr-spin { to { transform:rotate(360deg); } }
@media (prefers-reduced-motion: reduce){ .enr-spin { animation:none; } }
`;
