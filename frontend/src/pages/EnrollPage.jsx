// frontend/src/pages/EnrollPage.jsx
// OWNED BY: FaceCheck-Pro (Vimal)
//
// Delegate biometric self-enrolment — a standalone, phone-first app delegates
// open from a pre-trip notification link (public /enroll, no login), also
// embeddable at the staff desk (`embedded`).
//
// REAL face recognition: capture now runs on @vladmandic/human (see
// lib/humanFace.js) — a genuine deep face embedding plus liveness + anti-spoof,
// the same class of tech as phone face-unlock. Voice stays as the acoustic
// voiceprint / passphrase second factor (lib/faceScan.js).
//
// Reorganised flow (one thing at a time, easy on a phone):
//   Identify → Face → Voice (skippable) → Done (self-test + PDPA erase)
//
// PRIVACY / PDPA (unchanged): ZERO-IMAGE. Only the numeric embedding is ever
// transmitted; raw camera pixels never leave the <video>, the mic is read as a
// frequency profile only, and the delegate can erase everything at any time.

import { useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ScanFace, Mic, CheckCircle2, AlertTriangle, Search, Camera, ShieldCheck,
  RefreshCw, ArrowLeft, Trash2, BadgeCheck, Lock, Loader2, X, Bus, Sparkles, ChevronRight,
} from "lucide-react";
import { apiGet, apiPost } from "../lib/api.js";
import { captureVoiceEmbedding, vectorizeVoiceprint } from "../lib/faceScan.js";
import {
  loadHuman, detectFace, gate, averageEmbeddings, sampleConsistency, buildEmbeddingToken, MATCH_THRESHOLD,
} from "../lib/humanFace.js";

const TICK_MS = 350;       // live-gate cadence
const HOLD_TICKS = 4;      // aligned+live frames before capture starts (~1.4s)
const SAMPLES = 5;         // embeddings averaged into the template
const MIN_CONSISTENCY = 0.85; // sample agreement floor (cosine)

// Guided small head movements. Capturing a few slightly-different angles makes
// the averaged template more robust to how the delegate faces the scanner —
// the same idea as a phone's "move your head" face-unlock enrolment. Kept small
// so the embeddings stay close enough to average cleanly.
const POSES = [
  "Look straight at the camera",
  "Turn your head a little to the left",
  "Now a little to the right",
  "Lift your chin up slightly",
  "Back to the centre",
];
// Multi-angle embeddings vary more than same-pose ones, so the agreement floor
// is looser — it only needs to reject a clearly different person / garbage.
const MULTI_ANGLE_MIN_CONSISTENCY = 0.6;

const STEPS = [
  { key: "identify", label: "You" },
  { key: "face", label: "Face" },
  { key: "voice", label: "Voice" },
  { key: "done", label: "Done" },
];

const initials = (name) => (name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default function EnrollPage({ embedded = false }) {
  const [params] = useSearchParams();
  const [step, setStep] = useState("identify");

  // identify
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState([]);   // the full roster, filtered client-side
  const [rosterLoading, setRosterLoading] = useState(true);
  const [findErr, setFindErr] = useState("");
  const [coachFilter, setCoachFilter] = useState(null); // null = all coaches
  const [stats, setStats] = useState(null);
  const [delegate, setDelegate] = useState(null);

  // consent + face
  const [consent, setConsent] = useState(false);
  const [modelState, setModelState] = useState("idle"); // idle | loading | ready | error
  const [camError, setCamError] = useState("");
  const [live, setLive] = useState({ ready: false, hint: "Fit your face in the circle", score: 0, liveness: null, real: null });
  const [progress, setProgress] = useState(0);
  const [capture, setCapture] = useState({ active: false, done: 0, total: POSES.length });
  const [poseIdx, setPoseIdx] = useState(-1); // current guided-pose index during capture
  const [captureMsg, setCaptureMsg] = useState("");
  const [faceToken, setFaceToken] = useState(null);
  const [quality, setQuality] = useState(null);

  // voice
  const [passphrase, setPassphrase] = useState("");
  const [voiceToken, setVoiceToken] = useState(null);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const [micLevel, setMicLevel] = useState(0);

  // submit / done
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState("");
  const [result, setResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [erasing, setErasing] = useState(false);
  const [confirmErase, setConfirmErase] = useState(false);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const busyRef = useRef(false); // guards overlapping async detections

  /* ---- roster coverage (nice on the desk view) ---- */
  const loadStats = useCallback(async () => {
    try { setStats(await apiGet("/enroll/stats")); } catch { /* optional */ }
  }, []);
  useEffect(() => { loadStats(); }, [loadStats]);

  /* Load the whole roster once so the identify step is a browsable picker
   * (everyone + their coach), not a blind search. Filtered client-side. */
  useEffect(() => {
    (async () => {
      try { const { matches: m } = await apiGet("/enroll/lookup"); setMatches(m || []); }
      catch (e) { setFindErr(e.message || "Could not load the delegate list. Is the backend running?"); }
      finally { setRosterLoading(false); }
    })();
  }, []);

  /* ---- deep-link pre-identify: /enroll?d=<delegateId> from the notification ---- */
  useEffect(() => {
    const id = params.get("d") || params.get("delegate");
    if (!id) return;
    (async () => {
      try {
        const { matches: m } = await apiGet(`/enroll/lookup?id=${encodeURIComponent(id)}`);
        if (m && m[0]) pickDelegate(m[0]);
      } catch { /* fall back to manual search */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- identify: filter the already-loaded roster client-side ---- */
  function pickDelegate(d) {
    setDelegate(d);
    setStep("face");
    setConsent(false); setFaceToken(null); setVoiceToken(null); setPassphrase("");
    setQuality(null); setCaptureMsg(""); setSubmitErr(""); setTestResult(null);
    setProgress(0); setCapture({ active: false, done: 0, total: SAMPLES });
  }

  /* ---- warm the face model as soon as consent is given ---- */
  useEffect(() => {
    if (step !== "face" || !consent || modelState === "ready" || modelState === "loading") return;
    setModelState("loading");
    loadHuman().then(() => setModelState("ready")).catch(() => setModelState("error"));
  }, [step, consent, modelState]);

  /* ---- camera lifecycle ---- */
  useEffect(() => {
    const want = (step === "face") && consent && !faceToken;
    let cancelled = false;
    async function start() {
      try {
        setCamError("");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "user" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}); }
      } catch {
        if (!cancelled) setCamError("Camera unavailable — allow camera access, or skip to voice-only enrolment.");
      }
    }
    if (want) start(); else stopCamera();
    return () => { cancelled = true; stopCamera(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, consent, faceToken]);

  function stopCamera() {
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  /* ---- live gate + auto-capture (real embeddings via Human) ---- */
  useEffect(() => {
    if (step !== "face" || !consent || faceToken || camError || modelState !== "ready") {
      setProgress(0);
      return undefined;
    }
    let cancelled = false, hold = 0;
    async function loop() {
      if (cancelled) return;
      if (!busyRef.current && videoRef.current && videoRef.current.videoWidth) {
        busyRef.current = true;
        try {
          const det = await detectFace(videoRef.current);
          const g = gate(det);
          setLive({ ready: g.ready, hint: g.hint, score: det.faceScore || 0, liveness: det.live, real: det.real });
          hold = g.ready ? hold + 1 : 0;
          setProgress(Math.min(1, hold / HOLD_TICKS));
          if (hold >= HOLD_TICKS) { await runCapture(); hold = 0; }
        } finally { busyRef.current = false; }
      }
      if (!cancelled) setTimeout(loop, TICK_MS);
    }
    loop();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, consent, faceToken, camError, modelState]);

  async function runCapture() {
    setCapture({ active: true, done: 0, total: POSES.length });
    setCaptureMsg("");
    const samples = [];
    for (let i = 0; i < POSES.length; i += 1) {
      setPoseIdx(i);
      await sleep(650); // give them a moment to move into the pose
      // grab one good, gated embedding for this angle (a few attempts)
      let got = null;
      for (let a = 0; a < 5 && !got; a += 1) {
        const det = await detectFace(videoRef.current);
        if (det.ok && det.embedding && gate(det).ready) got = det.embedding;
        else await sleep(120);
      }
      if (got) samples.push(got);
      setCapture({ active: true, done: samples.length, total: POSES.length });
    }
    setPoseIdx(-1);
    const cons = sampleConsistency(samples);
    if (samples.length < 3 || cons < MULTI_ANGLE_MIN_CONSISTENCY) {
      setCapture({ active: false, done: 0, total: POSES.length });
      setCaptureMsg(samples.length < 3
        ? "Couldn't capture enough angles — keep your face in the circle and move slowly."
        : `Those didn't look like the same face (${cons.toFixed(2)}) — let's try again.`);
      return;
    }
    const avg = averageEmbeddings(samples);
    const token = buildEmbeddingToken(avg);
    if (!token) { setCapture({ active: false, done: 0, total: POSES.length }); setCaptureMsg("Capture failed — try again in better light."); return; }
    setQuality({ samples: samples.length, consistency: cons, liveness: live.liveness, real: live.real });
    setFaceToken(token);
    setCapture({ active: false, done: POSES.length, total: POSES.length });
  }

  /* ---- voice ---- */
  useEffect(() => {
    setVoiceSupported(!!(window.AudioContext || window.webkitAudioContext) && !!navigator.mediaDevices);
  }, []);
  async function recordVoiceprint() {
    if (voiceListening) return;
    setVoiceListening(true); setVoiceToken(null); setVoiceStatus("Recording… keep speaking");
    try {
      const token = await captureVoiceEmbedding(2500, setMicLevel);
      if (!token) setVoiceStatus("Too quiet — speak clearly and try again.");
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

  /* ---- submit / self-test / erase ---- */
  async function submit() {
    if (!delegate) return;
    if (!faceToken && !voiceToken) { setSubmitErr("Capture your face (or record a voiceprint) first."); return; }
    setSubmitting(true); setSubmitErr("");
    try {
      const res = await apiPost("/enroll", {
        delegateId: delegate.delegateId, faceToken: faceToken || undefined, voiceToken: voiceToken || undefined,
      });
      stopCamera(); setResult(res); setStep("done"); loadStats();
    } catch (err) {
      setSubmitErr(err.message || "Enrolment failed — please try again.");
    } finally { setSubmitting(false); }
  }

  async function testEnrolment() {
    if (!delegate) return;
    setTesting(true); setTestResult(null);
    try {
      await loadHuman();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "user" } }, audio: false });
      const v = document.createElement("video");
      v.srcObject = stream; v.muted = true; v.playsInline = true;
      await v.play();
      await sleep(700);
      const samples = [];
      for (let i = 0; i < 4; i += 1) {
        const det = await detectFace(v);
        if (det.ok && det.embedding) samples.push(det.embedding);
        await sleep(150);
      }
      stream.getTracks().forEach((t) => t.stop());
      const token = samples.length ? buildEmbeddingToken(averageEmbeddings(samples)) : null;
      if (!token) { setTestResult({ error: "Couldn't capture a test frame — face the camera and retry." }); return; }
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
      reset(); loadStats();
    } catch (e) { setSubmitErr(e.message || "Could not erase — try again."); }
    finally { setErasing(false); }
  }

  function reset() {
    stopCamera();
    setStep("identify"); setQuery(""); setMatches([]); setDelegate(null);
    setConsent(false); setFaceToken(null); setVoiceToken(null); setPassphrase("");
    setResult(null); setSubmitErr(""); setFindErr(""); setQuality(null);
    setCaptureMsg(""); setTestResult(null); setConfirmErase(false);
    setCapture({ active: false, done: 0, total: SAMPLES }); setProgress(0);
  }

  const stepIndex = STEPS.findIndex((s) => s.key === step);
  const voiceOn = !!voiceToken;

  return (
    <div className={embedded ? "enr enr-embedded" : "enr"}>
      <style>{CSS}</style>
      <div className="enr-wrap">
        {!embedded && (
          <div className="enr-brand">
            <ShieldCheck size={18} style={{ color: "var(--scc-red)" }} />
            <span>MusterGo · <strong>Delegate enrolment</strong></span>
          </div>
        )}

        {/* progress rail */}
        <ol className="enr-rail" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s.key} className={"enr-rail-step" + (i === stepIndex ? " on" : i < stepIndex ? " done" : "")}>
              <span className="enr-rail-dot">{i < stepIndex ? <CheckCircle2 size={13} /> : i + 1}</span>
              <span className="enr-rail-label">{s.label}</span>
            </li>
          ))}
        </ol>

        {/* ============ IDENTIFY ============ */}
        {step === "identify" && (
          <div className="enr-stack">
            <section className="enr-hero">
              <div className="enr-hero-glow" />
              <div className="enr-hero-eyebrow">Before your trip</div>
              <h1 className="enr-hero-title">Set up face check-in</h1>
              <p className="enr-hero-sub">Enrol your face once now, and staff can check you in with a quick scan at the coach — no queue, no paperwork.</p>
            </section>

            <section className="enr-card">
              <div className="enr-search">
                <Search size={16} className="enr-search-icon" />
                <input className="input" placeholder="Find your name…" value={query} autoFocus
                  onChange={(e) => setQuery(e.target.value)} style={{ paddingLeft: 38 }} />
              </div>

              {rosterLoading ? (
                <p className="enr-sub" style={{ textAlign: "center", padding: "16px 0" }}>
                  <Loader2 size={15} className="enr-spin" style={{ verticalAlign: -3, marginRight: 6 }} /> Loading delegates…
                </p>
              ) : findErr ? (
                <div className="enr-alert err"><AlertTriangle size={14} /><span>{findErr}</span></div>
              ) : (() => {
                const q = query.trim().toLowerCase();
                // Coaches present in the roster (stable order) for the filter chips.
                const coachOrder = [];
                const seenCoach = {};
                for (const m of matches) { const k = m.coachLabel || "No coach yet"; if (!seenCoach[k]) { seenCoach[k] = true; coachOrder.push(k); } }
                const shown = matches.filter((m) =>
                  (!q || (m.name || "").toLowerCase().includes(q)) &&
                  (!coachFilter || (m.coachLabel || "No coach yet") === coachFilter));
                const order = [];
                const byCoach = {};
                for (const m of shown) {
                  const k = m.coachLabel || "No coach yet";
                  if (!byCoach[k]) { byCoach[k] = []; order.push(k); }
                  byCoach[k].push(m);
                }
                return (
                  <>
                    {coachOrder.length > 1 && (
                      <div className="enr-chips-row">
                        <button className={"enr-chip" + (!coachFilter ? " on" : "")} onClick={() => setCoachFilter(null)}>All</button>
                        {coachOrder.map((k) => (
                          <button key={k} className={"enr-chip" + (coachFilter === k ? " on" : "")}
                            onClick={() => setCoachFilter((cur) => (cur === k ? null : k))}>
                            {k}
                          </button>
                        ))}
                      </div>
                    )}
                    {shown.length === 0 ? (
                      <p className="enr-sub" style={{ textAlign: "center", padding: "16px 0" }}>No delegate matches — clear the filter or check the spelling.</p>
                    ) : (
                      <div className="enr-roster">
                        <div className="enr-roster-hint">{shown.length} {shown.length === 1 ? "delegate" : "delegates"} · tap your name</div>
                        {order.map((k) => (
                          <div key={k} className="enr-group">
                            {!coachFilter && <div className="enr-group-head"><Bus size={12} /> {k} <span>{byCoach[k].length}</span></div>}
                            <ul className="enr-matches">
                              {byCoach[k].map((m) => (
                                <li key={m.delegateId}>
                                  <button className="enr-match" onClick={() => pickDelegate(m)}>
                                    <span className="enr-avatar">{initials(m.name)}</span>
                                    <span className="enr-match-text"><strong>{m.name}</strong><small>{m.coachLabel || "No coach yet"}</small></span>
                                    <span className="enr-match-tags">
                                      {m.enrolled?.face && <em className="enr-tag ok">Face</em>}
                                      {m.enrolled?.voice && <em className="enr-tag ok">Voice</em>}
                                      {!m.enrolled?.face && !m.enrolled?.voice && <em className="enr-tag">Not enrolled</em>}
                                    </span>
                                    <ChevronRight size={16} className="enr-match-chev" />
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </section>

            <section className="enr-card enr-privacy">
              <div className="enr-card-head"><Lock size={15} /> Your privacy, guaranteed</div>
              <ul>
                <li>No photo or audio is ever stored or uploaded.</li>
                <li>Only an anonymous math signature is saved — it can't be turned back into your face.</li>
                <li>A liveness + anti-spoof check means a photo of you can't be used.</li>
                <li>You can erase it yourself at any time.</li>
              </ul>
              {stats && (
                <div className="enr-coverage">
                  <div className="enr-coverage-bar"><div style={{ width: `${pct(stats.enrolled, stats.total)}%` }} /></div>
                  <span>{stats.enrolled}/{stats.total} delegates enrolled</span>
                </div>
              )}
            </section>
          </div>
        )}

        {/* ============ FACE ============ */}
        {step === "face" && delegate && (
          <div className="enr-stack">
            <button className="enr-back" onClick={() => { stopCamera(); setStep("identify"); }}>
              <ArrowLeft size={15} /> Not you? Search again
            </button>

            <div className="enr-person">
              <span className="enr-avatar lg">{initials(delegate.name)}</span>
              <div style={{ minWidth: 0 }}>
                <div className="enr-person-name">{delegate.name}</div>
                <div className="enr-person-sub">{delegate.coachLabel || "No coach yet"}</div>
              </div>
              {(delegate.enrolled?.face || delegate.enrolled?.voice) && <span className="enr-tag ok" style={{ marginLeft: "auto" }}>Re-enrolling</span>}
            </div>

            {!consent ? (
              <section className="enr-card enr-consent-card">
                <div className="enr-card-head"><ShieldCheck size={16} /> Consent</div>
                <label className="enr-consent">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  <span>I consent to MusterGo processing my face (and optionally voice) for trip check-in under the PDPA. Only an irreversible mathematical vector is stored — <strong>no photo or audio is kept</strong> — and I can erase it any time.</span>
                </label>
                <p className="enr-fine" style={{ textAlign: "center" }}>Tick to switch on your camera.</p>
              </section>
            ) : (
              <section className="enr-card">
                <div className="enr-card-head"><ScanFace size={16} /> Face scan</div>

                <div className="enr-view">
                  {faceToken ? (
                    <div className="enr-captured">
                      <CheckCircle2 size={44} style={{ color: "var(--st-present)" }} />
                      <strong>Face captured</strong>
                      {quality && <small className="muted">{quality.samples} samples · agreement {quality.consistency.toFixed(2)}{quality.real != null ? ` · real ${(quality.real * 100).toFixed(0)}%` : ""}</small>}
                      <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => { setFaceToken(null); setQuality(null); setCaptureMsg(""); setTestResult(null); }}>
                        <RefreshCw size={14} /> Redo face scan
                      </button>
                    </div>
                  ) : (
                    <>
                      <video ref={videoRef} autoPlay playsInline muted className="enr-video" />
                      {modelState !== "ready" && !camError && (
                        <div className="enr-overlay"><Loader2 size={26} className="enr-spin" /><span>{modelState === "error" ? "Face model failed to load" : "Preparing face recognition…"}</span></div>
                      )}
                      {camError && <div className="enr-overlay"><Camera size={24} /><span>{camError}</span></div>}
                      {modelState === "ready" && !camError && (
                        <div className="enr-ring-wrap">
                          <svg className="enr-ring" viewBox="0 0 100 100">
                            <circle className="enr-ring-bg" cx="50" cy="50" r="46" />
                            <circle className={"enr-ring-fg" + (live.ready ? " ready" : "")} cx="50" cy="50" r="46"
                              style={{ strokeDashoffset: 289 - 289 * (capture.active ? capture.done / capture.total : progress) }} />
                          </svg>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {!faceToken && !camError && modelState === "ready" && (
                  <>
                    <p className={"enr-hint" + (live.ready || capture.active ? " ok" : "")}>
                      {capture.active
                        ? (poseIdx >= 0 ? `${POSES[poseIdx]} · ${capture.done}/${capture.total}` : `Capturing… ${capture.done}/${capture.total}`)
                        : live.hint}
                    </p>
                    {/* live signal meters */}
                    <div className="enr-meters">
                      <Meter label="Quality" value={live.score} />
                      <Meter label="Live" value={live.liveness} tone="present" />
                      <Meter label="Real" value={live.real} tone="present" />
                    </div>
                    {captureMsg && <p className="enr-hint warn">{captureMsg}</p>}
                  </>
                )}

                {camError && (
                  <button className="btn btn-ghost btn-block" style={{ marginTop: 12 }} onClick={() => setStep("voice")}>
                    Skip — enrol with voice only <ChevronRight size={15} />
                  </button>
                )}
              </section>
            )}

            {consent && (
              <div className="enr-actions">
                <button className="btn btn-ghost" onClick={() => setStep("voice")} disabled={!faceToken}>
                  Skip voice — I'm done <ChevronRight size={15} />
                </button>
                <button className="btn btn-primary" disabled={!faceToken} onClick={() => setStep("voice")}>
                  Next: add voice <ChevronRight size={15} />
                </button>
              </div>
            )}
          </div>
        )}

        {/* ============ VOICE ============ */}
        {step === "voice" && delegate && (
          <div className="enr-stack">
            <button className="enr-back" onClick={() => setStep("face")}><ArrowLeft size={15} /> Back to face</button>
            <section className="enr-card">
              <div className="enr-card-head"><Mic size={16} /> Voiceprint <span className="enr-optional">optional backup</span></div>
              <p className="enr-sub" style={{ marginTop: 0 }}>
                A backup for when it's too dark for the camera. Say <em>“MusterGo check in”</em> for ~2 seconds — we keep the <strong>frequency profile of your voice</strong>, never the audio.
              </p>
              {voiceSupported ? (
                <>
                  <button className={voiceToken?.startsWith("voice:v2:") ? "btn btn-ghost btn-block" : "btn btn-primary btn-block"} onClick={recordVoiceprint} disabled={voiceListening}>
                    {voiceListening ? <Loader2 size={15} className="enr-spin" /> : <Mic size={15} />}
                    {voiceListening ? "Recording…" : voiceToken?.startsWith("voice:v2:") ? "Re-record voiceprint" : "Record my voiceprint"}
                  </button>
                  {voiceListening && <div className="enr-level"><div style={{ width: `${Math.min(100, Math.round(micLevel * 260))}%` }} /></div>}
                </>
              ) : <p className="enr-sub">This browser has no Web Audio support — use the passphrase fallback below.</p>}
              {voiceStatus && <p className={"enr-hint" + (voiceToken ? " ok" : "")}>{voiceToken && <CheckCircle2 size={13} style={{ verticalAlign: -2, marginRight: 4 }} />}{voiceStatus}</p>}
              {!voiceToken?.startsWith("voice:v2:") && (
                <details className="enr-details">
                  <summary>No microphone? Use a typed passphrase</summary>
                  <input className="input" style={{ marginTop: 8 }} placeholder="Type a passphrase…" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
                  <small className="muted">A shared secret, not a biometric — say these exact words at the coach.</small>
                </details>
              )}
            </section>

            {submitErr && <div className="enr-alert err"><AlertTriangle size={14} /><span>{submitErr}</span></div>}
            <div className="enr-ready">
              <span className={faceToken ? "on" : ""}>{faceToken ? <CheckCircle2 size={14} /> : <X size={14} />} Face</span>
              <span className={voiceOn ? "on" : ""}>{voiceOn ? <CheckCircle2 size={14} /> : <X size={14} />} Voice</span>
            </div>
            <button className="btn btn-primary btn-block enr-cta" disabled={(!faceToken && !voiceToken) || submitting} onClick={submit}>
              {submitting ? <><Loader2 size={16} className="enr-spin" /> Saving…</> : <><Sparkles size={16} /> Complete enrolment</>}
            </button>
            <p className="enr-fine">Zero-Image: raw pixels are wiped the instant your vector is made. No image or audio leaves this device.</p>
          </div>
        )}

        {/* ============ DONE ============ */}
        {step === "done" && result && (
          <div className="enr-stack">
            <section className="enr-card enr-done">
              <CheckCircle2 size={54} style={{ color: "var(--st-present)" }} />
              <h2 className="enr-h2">You're all set</h2>
              <p className="enr-sub">{result.name} — staff can now check you in with a face scan at the coach.</p>
              <div className="enr-chips">
                {result.enrolled?.face && <span className="enr-tag ok"><ScanFace size={12} /> Face</span>}
                {result.enrolled?.voice && <span className="enr-tag ok"><Mic size={12} /> Voice {result.enrolled.voiceType === "acoustic" ? "(acoustic)" : "(passphrase)"}</span>}
              </div>
            </section>

            <section className="enr-card">
              <div className="enr-card-head"><BadgeCheck size={15} /> Check it works</div>
              <p className="enr-sub" style={{ marginTop: 0 }}>Look at the camera again and we'll score it against what we saved — without checking you in.</p>
              <button className="btn btn-ghost btn-block" onClick={testEnrolment} disabled={testing}>
                {testing ? <><Loader2 size={15} className="enr-spin" /> Testing…</> : <><ScanFace size={15} /> Test my enrolment</>}
              </button>
              {testResult && (testResult.error ? (
                <div className="enr-alert err"><AlertTriangle size={14} /><span>{testResult.error}</span></div>
              ) : (
                <div className={"enr-test " + (testResult.match ? "ok" : "bad")}>
                  <strong>{testResult.match ? "Recognised ✓" : "Not recognised"}</strong>
                  <div className="enr-coverage-bar"><div style={{ width: `${Math.max(0, Math.min(100, (testResult.similarity || 0) * 100))}%` }} /></div>
                  <small>similarity {(testResult.similarity || 0).toFixed(3)} · needs ≥ {testResult.threshold ?? MATCH_THRESHOLD}</small>
                  {!testResult.match && <small>Try re-enrolling in the lighting you'll be scanned in.</small>}
                </div>
              ))}
            </section>

            <section className="enr-card">
              <div className="enr-card-head"><Lock size={15} /> Your data</div>
              {!confirmErase ? (
                <>
                  <p className="enr-sub" style={{ marginTop: 0 }}>Remove your face and voice data at any time. Staff can still check you in manually or by QR.</p>
                  <button className="btn btn-ghost btn-block enr-danger" onClick={() => setConfirmErase(true)}><Trash2 size={15} /> Erase my biometric data</button>
                </>
              ) : (
                <>
                  <p className="enr-sub" style={{ marginTop: 0 }}><strong>Erase everything for {result.name}?</strong> This permanently deletes your stored vectors. You'd need to enrol again to be scanned.</p>
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setConfirmErase(false)} disabled={erasing}>Cancel</button>
                    <button className="btn btn-primary enr-danger-solid" style={{ flex: 1 }} onClick={eraseData} disabled={erasing}>{erasing ? "Erasing…" : "Erase"}</button>
                  </div>
                </>
              )}
            </section>

            <button className="btn btn-ghost btn-block" onClick={reset}>Enrol another delegate</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Meter({ label, value, tone = "assigned" }) {
  const v = value == null ? 0 : Math.max(0, Math.min(1, value));
  const na = value == null;
  return (
    <div className="enr-meter">
      <div className="enr-meter-track"><div className="enr-meter-fill" style={{ width: `${v * 100}%`, background: na ? "var(--line)" : `var(--st-${tone})` }} /></div>
      <span className="enr-meter-label">{label}{na ? "" : ` ${Math.round(v * 100)}%`}</span>
    </div>
  );
}

const CSS = `
.enr { min-height: 100%; background: var(--bg); color: var(--ink); padding: 20px 16px; }
.enr-embedded { padding: 0; background: transparent; min-height: 0; }
.enr-wrap { max-width: 460px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }
.enr-brand { display: flex; align-items: center; gap: 8px; font-family: var(--font-display); color: var(--scc-red); font-weight: 700; font-size: 17px; }
.enr-brand strong { font-weight: 700; }
.enr-spin { animation: enr-spin .9s linear infinite; } @keyframes enr-spin { to { transform: rotate(360deg); } }
.enr-stack { display: flex; flex-direction: column; gap: 14px; animation: enr-in .28s ease both; }
@keyframes enr-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

.enr-rail { list-style: none; display: flex; gap: 6px; padding: 0; margin: 0; }
.enr-rail-step { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 5px; font-size: 11px; font-weight: 700; color: var(--ink-3); }
.enr-rail-dot { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: var(--surface-2); border: 1px solid var(--line); font-size: 12px; }
.enr-rail-step.on { color: var(--scc-red); } .enr-rail-step.on .enr-rail-dot { background: var(--scc-red-tint); border-color: var(--scc-red-tint-2); color: var(--scc-red); }
.enr-rail-step.done { color: var(--st-present); } .enr-rail-step.done .enr-rail-dot { background: var(--st-present-bg); border-color: transparent; color: var(--st-present); }

.enr-hero { position: relative; overflow: hidden; border-radius: var(--r-lg); padding: 20px; color: #fff; background: linear-gradient(135deg, var(--scc-red), var(--scc-red-700)); box-shadow: var(--shadow-md); }
.enr-hero-glow { position: absolute; top: -45%; right: -12%; width: 220px; height: 220px; border-radius: 50%; background: radial-gradient(circle, rgba(255,255,255,.24), transparent 70%); }
.enr-hero-eyebrow { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; opacity: .85; position: relative; }
.enr-hero-title { font-family: var(--font-display); font-size: 25px; margin: 4px 0 0; position: relative; }
.enr-hero-sub { font-size: 13.5px; line-height: 1.5; margin: 8px 0 0; opacity: .95; position: relative; }

.enr-card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md); box-shadow: var(--shadow-sm); padding: 16px; }
.enr-card-head { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 14px; margin-bottom: 10px; }
.enr-optional { font-size: 11px; font-weight: 700; color: var(--ink-3); background: var(--surface-2); border: 1px solid var(--line); padding: 2px 8px; border-radius: 999px; }
.enr-h2 { font-family: var(--font-display); font-size: 20px; margin: 6px 0 2px; }
.enr-sub { color: var(--ink-3); font-size: 13px; line-height: 1.55; }
.enr-fine { color: var(--ink-3); font-size: 11.5px; line-height: 1.5; margin: 10px 0 0; }

.enr-search { position: relative; } .enr-search-icon { position: absolute; left: 12px; top: 12px; color: var(--ink-3); }
.enr-alert { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; padding: 10px 12px; border-radius: var(--r-sm); margin-top: 10px; }
.enr-alert.err { color: var(--scc-red-700); background: var(--st-missing-bg); border: 1px solid var(--scc-red-tint-2); }
.enr-matches { list-style: none; padding: 0; margin: 12px 0 0; display: flex; flex-direction: column; gap: 8px; }
.enr-match { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 12px; border-radius: var(--r-sm); border: 1px solid var(--line); background: var(--surface-2); text-align: left; color: inherit; font: inherit; }
.enr-match:active { transform: scale(.99); }
.enr-avatar { width: 34px; height: 34px; border-radius: 50%; background: var(--scc-red-tint); color: var(--scc-red); font-weight: 700; font-size: 12px; display: grid; place-items: center; flex-shrink: 0; }
.enr-avatar.lg { width: 44px; height: 44px; font-size: 15px; }
.enr-match-text { display: flex; flex-direction: column; min-width: 0; } .enr-match-text strong { font-size: 14px; } .enr-match-text small { color: var(--ink-3); font-size: 12px; }
.enr-match-tags { margin-left: auto; display: flex; gap: 4px; flex-shrink: 0; } .enr-match-chev { color: var(--ink-3); flex-shrink: 0; }
.enr-tag { font-style: normal; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 999px; background: var(--surface-2); color: var(--ink-3); border: 1px solid var(--line); display: inline-flex; align-items: center; gap: 4px; }
.enr-tag.ok { background: var(--st-present-bg); color: var(--st-present); border-color: transparent; }

.enr-chips-row { display: flex; gap: 8px; overflow-x: auto; padding: 12px 2px 2px; -webkit-overflow-scrolling: touch; }
.enr-chip { flex-shrink: 0; padding: 7px 14px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--ink-2); font-size: 12.5px; font-weight: 700; white-space: nowrap; }
.enr-chip.on { background: var(--scc-red-tint); color: var(--scc-red); border-color: var(--scc-red-tint-2); }
.enr-roster { margin-top: 12px; max-height: 46vh; overflow-y: auto; }
.enr-roster-hint { font-size: 11.5px; color: var(--ink-3); font-weight: 600; margin: 0 2px 8px; }
.enr-group { margin-bottom: 12px; }
.enr-group-head { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--ink-3); margin: 0 2px 6px; }
.enr-group-head span { margin-left: auto; background: var(--surface-2); border: 1px solid var(--line); border-radius: 999px; padding: 1px 8px; }
.enr-privacy ul { margin: 0; padding-left: 18px; color: var(--ink-3); font-size: 12.5px; line-height: 1.7; }
.enr-coverage { margin-top: 12px; } .enr-coverage span { font-size: 11.5px; color: var(--ink-3); }
.enr-coverage-bar { height: 8px; background: var(--line); border-radius: 999px; overflow: hidden; margin: 8px 0 4px; }
.enr-coverage-bar > div { height: 100%; background: linear-gradient(90deg, var(--st-present), #34d399); border-radius: 999px; transition: width .4s; }

.enr-back { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; background: none; border: none; color: var(--ink-3); font-size: 13px; font-weight: 600; padding: 2px; }
.enr-person { display: flex; align-items: center; gap: 12px; }
.enr-person-name { font-family: var(--font-display); font-weight: 700; font-size: 17px; } .enr-person-sub { color: var(--ink-3); font-size: 12.5px; }

.enr-consent { display: flex; gap: 10px; font-size: 13px; line-height: 1.5; color: var(--ink-2); cursor: pointer; }
.enr-consent input { margin-top: 3px; width: 18px; height: 18px; flex-shrink: 0; accent-color: var(--scc-red); }

.enr-view { position: relative; width: 100%; aspect-ratio: 1; border-radius: var(--r-md); overflow: hidden; background: #000; }
.enr-video { width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); }
.enr-overlay { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: #fff; text-align: center; padding: 20px; font-size: 13px; background: rgba(16,24,40,.55); }
.enr-ring-wrap { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; }
.enr-ring { width: 78%; height: 78%; transform: rotate(-90deg); }
.enr-ring-bg { fill: none; stroke: rgba(255,255,255,.35); stroke-width: 3; }
.enr-ring-fg { fill: none; stroke: #fff; stroke-width: 4; stroke-linecap: round; stroke-dasharray: 289; transition: stroke-dashoffset .25s ease, stroke .2s; }
.enr-ring-fg.ready { stroke: #22c55e; }
.enr-captured { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; background: var(--surface); text-align: center; padding: 20px; }
.enr-captured strong { font-size: 16px; }

.enr-hint { text-align: center; font-size: 13px; font-weight: 600; color: var(--ink-3); margin: 12px 0 0; }
.enr-hint.ok { color: var(--st-present); } .enr-hint.warn { color: var(--st-late); }
.enr-meters { display: flex; gap: 10px; margin-top: 12px; }
.enr-meter { flex: 1; } .enr-meter-track { height: 6px; background: var(--line); border-radius: 999px; overflow: hidden; }
.enr-meter-fill { height: 100%; border-radius: 999px; transition: width .25s, background .25s; }
.enr-meter-label { display: block; font-size: 10.5px; font-weight: 700; color: var(--ink-3); margin-top: 4px; text-align: center; text-transform: uppercase; letter-spacing: .03em; }

.enr-level { height: 6px; background: var(--line); border-radius: 999px; overflow: hidden; margin-top: 8px; } .enr-level > div { height: 100%; background: var(--st-present); transition: width .08s; }
.enr-details { margin-top: 10px; } .enr-details summary { font-size: 12px; color: var(--ink-3); cursor: pointer; }

.enr-actions { display: flex; gap: 8px; } .enr-actions .btn { flex: 1; }
.enr-ready { display: flex; gap: 10px; justify-content: center; }
.enr-ready span { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 700; color: var(--ink-3); }
.enr-ready span.on { color: var(--st-present); }
.enr-cta { padding: 14px 0; font-size: 15px; }
.enr-done { text-align: center; display: flex; flex-direction: column; align-items: center; }
.enr-chips { display: flex; gap: 8px; justify-content: center; margin-top: 10px; }
.enr-test { margin-top: 12px; padding: 12px; border-radius: var(--r-sm); background: var(--surface-2); border: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px; }
.enr-test.ok { background: var(--st-present-bg); border-color: transparent; } .enr-test.bad { background: var(--st-missing-bg); border-color: var(--scc-red-tint-2); }
.enr-test small { color: var(--ink-3); font-size: 11.5px; }
.enr-danger { color: var(--scc-red); } .enr-danger-solid { background: var(--scc-red); }
`;
