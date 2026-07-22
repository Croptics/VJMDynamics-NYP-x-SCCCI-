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
import {
  vectorizeFaceLandmarks, vectorizeVoiceprint, captureVoiceEmbedding, isValidBiometricToken,
  faceAlignment, parseFaceVector, averageFaceVectors, sampleConsistency, buildFaceToken, FACE_CROP,
} from "../lib/faceScan.js";

const TICK_MS = 220;
// Face must stay correctly aligned for this many consecutive checks before
// capture even begins (~1.1s) — stops a half-turned or passing face starting it.
const HOLD_TICKS = 5;
// Number of separate frames vectorized and averaged into the stored template.
const SAMPLES = 5;
// Every pair of samples must agree at least this much, otherwise the subject
// moved (or changed) mid-capture and the whole attempt is thrown away.
const MIN_CONSISTENCY = 0.9;
// Show a manual override only after the gate has failed for a long while, so a
// delegate can never be permanently locked out by a bad detection.
const STUCK_TICKS = 45;

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
  // Live circle-guide feedback: how well framed the face is, and how far
  // through the "hold still" countdown we are.
  const [align, setAlign] = useState({ ready: false, hint: "Fit your face inside the circle", progress: 0, coverage: 0 });
  const [capture, setCapture] = useState({ active: false, done: 0, total: SAMPLES });
  const [captureMsg, setCaptureMsg] = useState("");
  const [quality, setQuality] = useState(null);   // { samples, consistency }
  const [showOverride, setShowOverride] = useState(false);

  const [passphrase, setPassphrase] = useState("");
  const [voiceToken, setVoiceToken] = useState(null);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const [micLevel, setMicLevel] = useState(0); // live input level while recording

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

  /* Two-phase gated capture, the way a passport/Singpass booth works.
   *
   *   ALIGNING  — every TICK_MS, check the live frame against the alignment
   *               gate (face present, filling the circle, centred, in focus,
   *               well exposed). The delegate gets a specific hint for
   *               whatever is wrong. Only after HOLD_TICKS consecutive good
   *               frames does capture begin.
   *   CAPTURING — vectorize SAMPLES separate frames, re-checking alignment
   *               before each one. If they drift out, the attempt is thrown
   *               away and we go back to aligning. At the end the samples must
   *               agree with each other (MIN_CONSISTENCY); only then are they
   *               averaged into the stored template.
   *
   * This is why capture isn't instant: it is 5 real 128-float vectorizations
   * plus pairwise agreement checks, over roughly two seconds. */
  useEffect(() => {
    if (step !== "enroll" || !consent || faceToken || camError) {
      setAlign({ ready: false, hint: "Fit your face inside the circle", progress: 0, coverage: 0 });
      setCapture({ active: false, done: 0, total: SAMPLES });
      return undefined;
    }
    let cancelled = false;
    let phase = "aligning";
    let hold = 0;
    let stuck = 0;
    let samples = [];

    const canvas = document.createElement("canvas");
    canvas.width = 160; canvas.height = 120;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const grab = () => {
      const video = videoRef.current;
      if (!video || !video.videoWidth) return null;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return ctx.getImageData(0, 0, canvas.width, canvas.height);
    };

    const restart = (msg) => {
      phase = "aligning"; hold = 0; samples = [];
      setCapture({ active: false, done: 0, total: SAMPLES });
      if (msg) setCaptureMsg(msg);
    };

    const id = setInterval(() => {
      if (cancelled) return;
      const probe = grab();
      if (!probe) return;
      const a = faceAlignment(probe); // consumes + zeroes the probe frame

      if (phase === "aligning") {
        hold = a.ready ? hold + 1 : 0;
        stuck = a.ready ? 0 : stuck + 1;
        if (stuck >= STUCK_TICKS) setShowOverride(true);
        setAlign({ ...a, progress: Math.min(1, hold / HOLD_TICKS) });
        if (hold >= HOLD_TICKS) {
          phase = "capturing";
          samples = [];
          setCaptureMsg("");
          setCapture({ active: true, done: 0, total: SAMPLES });
        }
        return;
      }

      // --- capturing ---
      if (!a.ready) { restart("Moved out of the circle — starting again."); setAlign({ ...a, progress: 0 }); return; }

      const frame = grab();
      if (!frame) return;
      const vec = parseFaceVector(vectorizeFaceLandmarks(frame));
      if (vec) samples.push(vec);
      setCapture({ active: true, done: samples.length, total: SAMPLES });

      if (samples.length >= SAMPLES) {
        const worst = sampleConsistency(samples);
        if (worst < MIN_CONSISTENCY) {
          restart(`Samples didn't agree (${worst.toFixed(2)}) — hold still and we'll retry.`);
          return;
        }
        const token = buildFaceToken(averageFaceVectors(samples));
        if (!token || !isValidBiometricToken(token)) { restart("Capture failed — trying again."); return; }
        cancelled = true;
        setQuality({ samples: samples.length, consistency: worst });
        setCaptureMsg("");
        setFaceToken(token);
        setCapture({ active: false, done: SAMPLES, total: SAMPLES });
      }
    }, TICK_MS);

    return () => { cancelled = true; clearInterval(id); canvas.width = 0; canvas.height = 0; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, consent, faceToken, camError]);

  /* Manual override (only offered after the gate has struggled for a while).
   * Still takes multiple samples and averages them — it skips the alignment
   * checks, not the vectorization. */
  async function captureFace() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) { setCamError("Camera not ready yet — wait a moment and try again."); return; }
    const canvas = document.createElement("canvas");
    canvas.width = 160; canvas.height = 120;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const samples = [];
    setCapture({ active: true, done: 0, total: SAMPLES });
    for (let i = 0; i < SAMPLES; i += 1) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const vec = parseFaceVector(vectorizeFaceLandmarks(ctx.getImageData(0, 0, canvas.width, canvas.height)));
      if (vec) samples.push(vec);
      setCapture({ active: true, done: samples.length, total: SAMPLES });
      await new Promise((r) => setTimeout(r, TICK_MS));
    }
    canvas.width = 0; canvas.height = 0;
    setCapture({ active: false, done: 0, total: SAMPLES });
    const token = samples.length ? buildFaceToken(averageFaceVectors(samples)) : null;
    if (!token || !isValidBiometricToken(token)) { setCamError("Capture failed — try again in better light."); return; }
    setQuality({ samples: samples.length, consistency: sampleConsistency(samples) });
    setFaceToken(token);
    setCamError("");
  }

  /* ---- Voiceprint: real FFT frequency-spectrum capture ------------------ */
  useEffect(() => {
    const hasWebAudio = !!(window.AudioContext || window.webkitAudioContext) && !!navigator.mediaDevices;
    setVoiceSupported(hasWebAudio);
  }, []);

  async function recordVoiceprint() {
    if (voiceListening) return;
    setVoiceListening(true);
    setVoiceToken(null);
    setVoiceStatus("Recording… keep speaking");
    try {
      // Reads the mic as frequency magnitudes only — no audio is ever recorded
      // to a Blob or file (see captureVoiceEmbedding's own notes).
      const token = await captureVoiceEmbedding(2500, (lvl) => setMicLevel(lvl));
      if (!token) {
        setVoiceStatus("Too quiet — speak clearly and try again.");
        setVoiceToken(null);
      } else {
        setVoiceToken(token);
        setVoiceStatus("Voiceprint captured ✓");
      }
    } catch {
      setVoiceStatus("Microphone unavailable — allow mic access, or use the passphrase fallback below.");
    } finally {
      setVoiceListening(false);
      setMicLevel(0);
    }
  }

  // No-microphone fallback only: hashes the typed WORDS (a shared secret, not
  // a biometric). Used solely when nothing was recorded acoustically.
  useEffect(() => {
    if (voiceToken && voiceToken.startsWith("voice:v2:")) return; // real voiceprint wins
    const p = passphrase.trim();
    setVoiceToken(p.length >= 4 ? vectorizeVoiceprint(p) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setQuality(null);
    setCaptureMsg("");
    setShowOverride(false);
    setCapture({ active: false, done: 0, total: SAMPLES });
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

            {/* One sample per person: the record is keyed by delegate, so a new
                capture REPLACES the old one rather than adding a second. */}
            {(delegate.enrolled?.face || delegate.enrolled?.voice) && (
              <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                {delegate.enrolled.face && <span className="badge badge-present">Face already saved</span>}
                {delegate.enrolled.voice && <span className="badge badge-present">Voice already saved</span>}
                <span className="muted" style={{ fontSize: 12 }}>Re-enrolling replaces it.</span>
              </div>
            )}

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
                        {quality && (
                          <div className="muted" style={{ fontSize: 11.5, marginTop: 4, textAlign: "center" }}>
                            {quality.samples} samples averaged · agreement {quality.consistency.toFixed(2)}
                            <br />128-value template
                          </div>
                        )}
                        <button className="btn btn-ghost" style={{ marginTop: 10 }}
                          onClick={() => { setFaceToken(null); setQuality(null); setShowOverride(false); setCaptureMsg(""); }}>
                          <RefreshCw size={14} /> Redo face scan
                        </button>
                      </div>
                    ) : (
                      <>
                        <video ref={videoRef} autoPlay playsInline muted
                          style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />
                        {/* Circle guide — its diameter matches FACE_CROP, the
                            exact region the vectorizer reads, so lining your
                            face up here is what makes enrol and scan match. */}
                        {!camError && <FaceGuide align={align} />}
                        {camError && (
                          <div style={S.camErr}><Camera size={24} color="#fff" /><div style={{ fontSize: 13, maxWidth: 240 }}>{camError}</div></div>
                        )}
                      </>
                    )}
                  </div>
                  {!faceToken && !camError && (
                    <>
                      {/* Specific, actionable feedback from the alignment gate */}
                      <p style={{
                        fontSize: 13, fontWeight: 600, textAlign: "center", marginTop: 10,
                        color: capture.active ? "var(--st-present)" : align.ready ? "var(--st-present)" : "var(--ink-2)",
                      }}>
                        {capture.active
                          ? `Analysing your face… sample ${capture.done}/${capture.total}`
                          : (align.hint || "Fit your face inside the circle")}
                      </p>

                      {/* Per-sample progress dots — visible proof that several
                          separate frames are being vectorized, not one snapshot */}
                      {capture.active && (
                        <div className="row" style={{ gap: 6, justifyContent: "center", marginTop: 8 }}>
                          {Array.from({ length: capture.total }).map((_, i) => (
                            <span key={i} style={{
                              width: 9, height: 9, borderRadius: 999,
                              background: i < capture.done ? "var(--st-present)" : "var(--line)",
                              transition: "background .2s",
                            }} />
                          ))}
                        </div>
                      )}

                      {captureMsg && (
                        <p style={{ fontSize: 12, textAlign: "center", marginTop: 8, color: "var(--st-review, #b45309)" }}>{captureMsg}</p>
                      )}

                      {showOverride && !capture.active && (
                        <button className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={captureFace}>
                          <ScanFace size={16} /> Trouble detecting? Capture anyway
                        </button>
                      )}
                    </>
                  )}
                </div>

                {/* VOICE */}
                <div style={S.section}>
                  <div style={S.sectionHead}><Mic size={16} style={{ color: "var(--scc-red)" }} /> Voiceprint <span className="muted" style={{ fontWeight: 500 }}>(optional)</span></div>
                  <p className="muted" style={{ fontSize: 12.5, margin: "2px 0 8px" }}>
                    Used when it's too dark for the camera. Say a phrase like <em>“MusterGo check in”</em> for
                    ~2 seconds — we capture the <strong>frequency profile of your voice</strong>, never the audio.
                  </p>

                  {voiceSupported ? (
                    <>
                      <button
                        className={voiceToken?.startsWith("voice:v2:") ? "btn btn-ghost btn-block" : "btn btn-primary btn-block"}
                        onClick={recordVoiceprint} disabled={voiceListening}
                      >
                        <Mic size={15} />
                        {voiceListening ? "Recording…" : voiceToken?.startsWith("voice:v2:") ? "Re-record voiceprint" : "Record my voiceprint"}
                      </button>
                      {/* Live input level so the delegate knows the mic hears them */}
                      {voiceListening && (
                        <div style={{ height: 6, background: "var(--line)", borderRadius: 3, marginTop: 8, overflow: "hidden" }}>
                          <div style={{
                            height: "100%", borderRadius: 3, background: "var(--st-present)",
                            width: `${Math.min(100, Math.round(micLevel * 260))}%`, transition: "width .08s linear",
                          }} />
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="muted" style={{ fontSize: 12.5 }}>
                      This browser has no Web Audio support — use the passphrase fallback below.
                    </p>
                  )}

                  {voiceStatus && (
                    <div style={{ fontSize: 12, marginTop: 8, color: voiceToken ? "var(--st-present)" : "var(--ink-3)" }}>
                      {voiceStatus}
                    </div>
                  )}

                  {/* No-microphone fallback — hashes the typed words (a shared
                      secret), only used if no acoustic voiceprint was captured. */}
                  {!voiceToken?.startsWith("voice:v2:") && (
                    <details style={{ marginTop: 10 }}>
                      <summary className="muted" style={{ fontSize: 12, cursor: "pointer" }}>No microphone? Use a typed passphrase instead</summary>
                      <input
                        className="input" style={{ marginTop: 8 }} placeholder="Type a passphrase…"
                        value={passphrase} onChange={(e) => setPassphrase(e.target.value)}
                      />
                    </details>
                  )}
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

/** Passport-booth style alignment circle. The dashed ring marks the exact
 *  region the vectorizer reads (FACE_CROP of the short edge); it turns green
 *  when the framing is good, and the solid ring sweeps round as the "hold
 *  still" countdown completes, at which point the face auto-saves. */
function FaceGuide({ align }) {
  const R = 46;
  const C = 2 * Math.PI * R;
  const ok = align.ready;
  return (
    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
      <div style={{ height: `${FACE_CROP * 100}%`, aspectRatio: "1", position: "relative" }}>
        <svg viewBox="0 0 100 100" style={{ width: "100%", height: "100%", display: "block" }}>
          <circle
            cx="50" cy="50" r={R} fill="none"
            stroke={ok ? "#22c55e" : "rgba(255,255,255,0.8)"}
            strokeWidth="2.5" strokeDasharray="6 6"
            opacity={ok ? 0.4 : 0.85}
          />
          {align.progress > 0 && (
            <circle
              cx="50" cy="50" r={R} fill="none" stroke="#22c55e" strokeWidth="4.5" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - align.progress)}
              transform="rotate(-90 50 50)"
              style={{ transition: "stroke-dashoffset .18s linear" }}
            />
          )}
        </svg>
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
