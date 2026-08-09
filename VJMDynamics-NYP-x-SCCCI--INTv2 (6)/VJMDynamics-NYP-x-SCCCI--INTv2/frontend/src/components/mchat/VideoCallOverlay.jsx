/* =============================================================================
 *  OWNED BY:  Vance — MusterChat call screen. Fully driven by callManager: the
 *  incoming ring, the outgoing "calling…" state, and the live connected call —
 *  1:1 (one remote + local PIP) or a GROUP call (responsive participant grid).
 *  Real remote + local video via WebRTC, with mute / camera / flip / hang-up.
 *  Rendered globally so a call rings and runs on any page. Returns null when idle.
 * ============================================================================= */
import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Video, VideoOff, PhoneOff, Phone, SwitchCamera, Users } from "lucide-react";
import callManager, { fmtCallDuration } from "../../lib/musterchat/callManager.js";

const initialsOf = (n) => (n || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

/* A single <video> bound to a MediaStream (imperatively — srcObject isn't a prop). */
function Stream({ stream, muted, mirror, style }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream || null; }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted}
    style={{ width: "100%", height: "100%", objectFit: "cover", transform: mirror ? "scaleX(-1)" : "none", ...style }} />;
}

/* One tile in the group grid. The stream is ALWAYS mounted (so a peer's audio
 * plays even in a voice call / camera-off); the <video> is just hidden when
 * there's no video track, and an avatar is shown over it. Self is muted (no echo). */
function GroupTile({ name, stream, self, camOn }) {
  const hasVideo = self ? camOn : !!(stream && stream.getVideoTracks && stream.getVideoTracks().length);
  return (
    <div style={{ position: "relative", borderRadius: 16, overflow: "hidden", background: "#16161f", border: "1px solid rgba(255,255,255,0.08)", minHeight: 0 }}>
      {stream && <Stream stream={stream} muted={!!self} mirror={!!self} style={{ display: hasVideo ? "block" : "none" }} />}
      {!hasVideo && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 76, height: 76, borderRadius: "50%", background: self ? "#3a3a48" : "var(--scc-red, #E1232A)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: 700, color: "#fff" }}>{initialsOf(name)}</div>
        </div>
      )}
      <div style={{ position: "absolute", left: 10, bottom: 10, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)", color: "#fff", fontSize: 12.5, fontWeight: 600, padding: "3px 9px", borderRadius: 999 }}>
        {self ? "You" : name}
      </div>
    </div>
  );
}

export default function VideoCallOverlay() {
  const [s, setS] = useState(callManager.snapshot());
  const [seconds, setSeconds] = useState(0);
  useEffect(() => callManager.subscribe(setS), []);

  useEffect(() => {
    if (s.status !== "connected") { setSeconds(0); return; }
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - s.startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [s.status, s.startedAt]);

  // Brief error toast (declined / blocked) after a call ends.
  if (s.status === "idle") {
    if (!s.error) return null;
    return (
      <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 95, background: "#111", color: "#fff", padding: "10px 16px", borderRadius: 999, fontSize: 13, boxShadow: "0 10px 30px rgba(0,0,0,0.35)" }}>
        {s.error}
      </div>
    );
  }

  const { peer, mode, status, isGroup, groupName, participants } = s;
  const isIncoming = status === "incoming";
  const isVideo = mode === "video";
  const title = isGroup ? (groupName || "Group call") : (peer?.name || "Contact");
  const statusText = isIncoming ? `Incoming ${isGroup ? "group " : ""}${isVideo ? "video" : "voice"} call${isGroup && peer?.name ? ` from ${peer.name}` : ""}…`
    : status === "outgoing" ? "Calling…"
    : status === "connecting" ? "Connecting…"
    : isGroup ? `${(participants?.length || 0) + 1} in call · ${fmtCallDuration(seconds)}`
    : fmtCallDuration(seconds);

  const ctrl = (active, danger) => ({
    width: 54, height: 54, borderRadius: "50%", border: "none", cursor: "pointer",
    display: "inline-flex", alignItems: "center", justifyContent: "center", transition: "transform .1s ease, background .15s ease",
    background: danger ? "#ef4444" : active ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.92)",
    color: danger ? "#fff" : active ? "#fff" : "#111", backdropFilter: active ? "blur(8px)" : "none",
  });
  const roundBtn = (bg) => ({ width: 64, height: 64, borderRadius: "50%", border: "none", cursor: "pointer", background: bg, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 24px rgba(0,0,0,0.35)" });

  const tiles = isGroup ? (participants?.length || 0) + 1 : 0;
  const cols = tiles <= 1 ? 1 : tiles <= 4 ? 2 : 3;
  const remoteHasVideo = !isGroup && !!(s.remoteStream && s.remoteStream.getVideoTracks && s.remoteStream.getVideoTracks().length);
  const showRemote1to1 = status === "connected" && remoteHasVideo;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 95, color: "#fff", display: "flex", flexDirection: "column",
      background: "radial-gradient(1200px 700px at 50% -10%, #1e1e2b 0%, #0b0b12 60%), #0b0b12" }}>
      <style>{`@keyframes mc-ring{0%{box-shadow:0 0 0 0 rgba(225,35,42,.45)}70%{box-shadow:0 0 0 22px rgba(225,35,42,0)}100%{box-shadow:0 0 0 0 rgba(225,35,42,0)}}`}</style>

      {/* Top info bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 22px" }}>
        <span style={{ width: 38, height: 38, borderRadius: "50%", background: "rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {isGroup ? <Users size={18} /> : <span style={{ fontSize: 14, fontWeight: 700 }}>{initialsOf(peer?.name)}</span>}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
          <div style={{ fontSize: 12.5, opacity: 0.75 }}>{statusText}</div>
        </div>
        <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase", opacity: 0.8, background: "rgba(255,255,255,0.1)", padding: "5px 10px", borderRadius: 999, display: "inline-flex", alignItems: "center", gap: 5 }}>
          {isVideo ? <Video size={13} /> : <Phone size={13} />} {isGroup ? "Group " : ""}{isVideo ? "Video" : "Voice"}
        </span>
      </div>

      {/* Stage */}
      <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 20px" }}>
        {isGroup ? (
          (participants?.length || 0) === 0 ? (
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 120, height: 120, borderRadius: "50%", background: "var(--scc-red, #E1232A)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px", animation: status !== "connected" ? "mc-ring 1.6s infinite" : "none" }}>
                <Users size={44} />
              </div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{groupName}</div>
              <div style={{ opacity: 0.7, fontSize: 14, marginTop: 6 }}>{isIncoming ? statusText : "Waiting for others to join…"}</div>
            </div>
          ) : (
            <div style={{ width: "100%", maxWidth: 1100, maxHeight: "100%", display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 12 }}>
              {participants.map((p) => <GroupTile key={p.id} name={p.name} stream={p.stream} />)}
              {!isIncoming && <GroupTile name="You" stream={s.localStream} self camOn={isVideo && s.camOn} />}
            </div>
          )
        ) : (
          <>
            {/* Remote stream stays mounted while connected so a voice call / camera-off
                peer is still audible; the <video> is hidden unless there's real video. */}
            {status === "connected" && s.remoteStream && (
              <div style={{ position: "absolute", inset: 0, display: showRemote1to1 ? "block" : "none" }}><Stream stream={s.remoteStream} /></div>
            )}
            {!showRemote1to1 && (
              <div style={{ textAlign: "center" }}>
                <div style={{ width: 128, height: 128, borderRadius: "50%", background: "var(--scc-red, #E1232A)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 44, fontWeight: 700, margin: "0 auto", animation: status !== "connected" ? "mc-ring 1.6s infinite" : "none" }}>
                  {initialsOf(peer?.name)}
                </div>
              </div>
            )}
          </>
        )}

        {/* 1:1 local PIP */}
        {!isGroup && isVideo && s.localStream && !isIncoming && (
          <div style={{ position: "absolute", top: 8, right: 20, width: 128, height: 180, borderRadius: 16, overflow: "hidden", background: "#000", border: "1px solid rgba(255,255,255,0.2)", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
            {s.camOn
              ? <Stream stream={s.localStream} muted mirror />
              : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.5)" }}><VideoOff size={22} /></div>}
          </div>
        )}
      </div>

      {/* Controls */}
      <div style={{ display: "flex", justifyContent: "center", padding: "18px 20px 34px" }}>
        {isIncoming ? (
          <div style={{ display: "flex", gap: 56, alignItems: "center" }}>
            <div style={{ textAlign: "center" }}>
              <button title="Decline" style={roundBtn("#ef4444")} onClick={() => callManager.reject()}><PhoneOff size={26} /></button>
              <div style={{ fontSize: 12, marginTop: 8, opacity: 0.8 }}>Decline</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <button title="Accept" style={{ ...roundBtn("#22c55e"), animation: "mc-ring 1.6s infinite" }} onClick={() => callManager.accept()}>{isVideo ? <Video size={26} /> : <Phone size={26} />}</button>
              <div style={{ fontSize: 12, marginTop: 8, opacity: 0.8 }}>Accept</div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 16, alignItems: "center", background: "rgba(255,255,255,0.06)", padding: "10px 16px", borderRadius: 999, backdropFilter: "blur(10px)" }}>
            <button title={s.micOn ? "Mute" : "Unmute"} style={ctrl(!s.micOn)} onClick={() => callManager.toggleMic()}>{s.micOn ? <Mic size={22} /> : <MicOff size={22} />}</button>
            {isVideo && (
              <>
                <button title={s.camOn ? "Camera off" : "Camera on"} style={ctrl(!s.camOn)} onClick={() => callManager.toggleCam()}>{s.camOn ? <Video size={22} /> : <VideoOff size={22} />}</button>
                <button title="Flip camera" style={ctrl(true)} onClick={() => callManager.flipCam()}><SwitchCamera size={22} /></button>
              </>
            )}
            <button title="Hang up" style={roundBtn("#ef4444")} onClick={() => callManager.hangup()}><PhoneOff size={24} /></button>
          </div>
        )}
      </div>
    </div>
  );
}
