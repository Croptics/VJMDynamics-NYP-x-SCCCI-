/* =============================================================================
 *  OWNED BY:  Vance — MusterChat call screen. Uses the REAL local camera/mic
 *  (getUserMedia) with WhatsApp-style controls. The remote party is simulated
 *  (no signaling server) so a video call is demoable on a single laptop. On end
 *  it reports the call duration back so the thread logs a call message.
 * ============================================================================= */
import { useEffect, useRef, useState, useCallback } from "react";
import { Mic, MicOff, Video, VideoOff, PhoneOff, SwitchCamera } from "lucide-react";

const two = (n) => String(n).padStart(2, "0");
export const fmtDuration = (s) => `${Math.floor(s / 60)}:${two(s % 60)}`;
const initialsOf = (n) => (n || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

export default function VideoCallOverlay({ peer, mode = "video", onEnd }) {
  const localRef = useRef(null);
  const streamRef = useRef(null);
  const startedRef = useRef(0);
  const [status, setStatus] = useState("connecting"); // connecting → connected
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(mode === "video");
  const [facing, setFacing] = useState("user");
  const [seconds, setSeconds] = useState(0);
  const [err, setErr] = useState(null);

  const stop = useCallback(() => {
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const acquire = useCallback(async (facingMode) => {
    stop();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: mode === "video" ? { facingMode } : false,
      });
      streamRef.current = stream;
      stream.getAudioTracks().forEach((t) => (t.enabled = micOn));
      stream.getVideoTracks().forEach((t) => (t.enabled = camOn));
      if (localRef.current) localRef.current.srcObject = stream;
      setErr(null);
    } catch (e) {
      setErr(e?.name === "NotAllowedError"
        ? "Camera / microphone permission was blocked."
        : "Couldn't access the camera or microphone.");
    }
  }, [mode, micOn, camOn, stop]);

  // Acquire media on mount; simulate the remote answering after a beat.
  useEffect(() => {
    acquire(facing);
    const t = setTimeout(() => setStatus("connected"), 1600);
    return () => { clearTimeout(t); stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Duration ticker, started when the call "connects".
  useEffect(() => {
    if (status !== "connected") return;
    startedRef.current = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - startedRef.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, [status]);

  const toggleMic = () => setMicOn((v) => {
    const nv = !v; streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = nv)); return nv;
  });
  const toggleCam = () => setCamOn((v) => {
    const nv = !v; streamRef.current?.getVideoTracks().forEach((t) => (t.enabled = nv)); return nv;
  });
  const flip = () => { const nf = facing === "user" ? "environment" : "user"; setFacing(nf); acquire(nf); };
  const hangUp = () => { stop(); onEnd?.(status === "connected" ? seconds : 0); };

  const ctrlBtn = (active) => ({
    width: 52, height: 52, borderRadius: "50%", border: "none", cursor: "pointer",
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    background: active ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.9)",
    color: active ? "#fff" : "#111",
  });

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 90, background: "#0b0b0f",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between",
      color: "#fff", padding: "28px 20px 32px",
    }}>
      {/* Remote (simulated) */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <div style={{
          width: 120, height: 120, borderRadius: "50%", background: "var(--scc-red, #E1232A)",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40, fontWeight: 700,
          boxShadow: status === "connected" ? "0 0 0 8px rgba(225,35,42,0.15)" : "none",
        }}>
          {initialsOf(peer?.name)}
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{peer?.name || "Contact"}</div>
          <div style={{ opacity: 0.7, fontSize: 14, marginTop: 4 }}>
            {err ? err
              : status === "connecting" ? `${mode === "video" ? "Video" : "Voice"} calling…`
              : fmtDuration(seconds)}
          </div>
        </div>
      </div>

      {/* Local camera PIP */}
      {mode === "video" && (
        <div style={{
          position: "absolute", top: 24, right: 20, width: 120, height: 168, borderRadius: 14,
          overflow: "hidden", background: "#000", border: "1px solid rgba(255,255,255,0.2)",
        }}>
          <video ref={localRef} autoPlay muted playsInline
            style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)", display: camOn ? "block" : "none" }} />
          {!camOn && (
            <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.5)" }}>
              <VideoOff size={22} />
            </div>
          )}
        </div>
      )}

      {/* Controls */}
      <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
        <button title={micOn ? "Mute" : "Unmute"} style={ctrlBtn(micOn)} onClick={toggleMic}>
          {micOn ? <Mic size={22} /> : <MicOff size={22} />}
        </button>
        {mode === "video" && (
          <>
            <button title={camOn ? "Camera off" : "Camera on"} style={ctrlBtn(camOn)} onClick={toggleCam}>
              {camOn ? <Video size={22} /> : <VideoOff size={22} />}
            </button>
            <button title="Flip camera" style={ctrlBtn(true)} onClick={flip}>
              <SwitchCamera size={22} />
            </button>
          </>
        )}
        <button title="End call" onClick={hangUp}
          style={{ width: 60, height: 60, borderRadius: "50%", border: "none", cursor: "pointer", background: "#ef4444", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          <PhoneOff size={24} />
        </button>
      </div>
    </div>
  );
}
