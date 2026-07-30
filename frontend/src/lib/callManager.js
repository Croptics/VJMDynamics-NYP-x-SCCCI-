/* =============================================================================
 *  OWNED BY:  Vance — MusterChat call manager. A singleton that runs ONE real
 *  WebRTC call at a time — either a 1:1 audio/video call between two staff, or a
 *  multi-party GROUP call (full mesh: every participant holds a peer connection
 *  to every other participant). Signaling is the /api/calls/* relay (offer /
 *  answer / ICE over polling) plus a public STUN server — no dedicated media or
 *  signaling server needed.
 *
 *  Group mesh, in short:
 *   - The initiator rings each member with `ginvite`.
 *   - A member who accepts broadcasts `gjoin` to all members; anyone already in
 *     the call replies `gpresence`. So every participant learns every other,
 *     whatever the join order.
 *   - For each pair, the peer with the smaller account id creates the offer
 *     (deterministic → no glare). `meId` (from /api/calls/poll) is that ordering
 *     key.
 *
 *  UI (VideoCallOverlay) subscribes for state; ChatBubble / MusterChatInbox
 *  start the incoming-call poll so a call can ring on any page.
 * ============================================================================= */
import { apiGet, apiPost, getToken } from "./api.js";
import { sendMessage, getGroupMembers, sendGroupMessage } from "./messagesApi.js";

// ICE servers are env-configurable (integration patch 2026-07-27): set
// VITE_ICE_SERVERS to a JSON array (e.g. to add a TURN server so calls work
// across symmetric NAT / strict firewalls). Falls back to Google's public
// STUN, which is enough for same-network and most home-NAT cases but will
// leave a call stuck on "Connecting…" behind corporate/carrier NAT.
const RTC_CONFIG = {
  iceServers: (() => {
    try {
      const env = import.meta.env.VITE_ICE_SERVERS;
      if (env) return JSON.parse(env);
    } catch { /* malformed env — use the default below */ }
    return [{ urls: "stun:stun.l.google.com:19302" }];
  })(),
};
const uuid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `c-${Date.now()}-${Math.random().toString(36).slice(2)}`);
export const fmtCallDuration = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;

class CallManager {
  constructor() {
    this.listeners = new Set();
    this.polling = false;
    this.since = null;
    this.seen = new Set();
    this.meId = null;
    this._reset();
  }

  _reset() {
    this.status = "idle"; // idle | outgoing | incoming | connecting | connected
    this.pc = null;               // 1:1 peer connection
    this.localStream = null;
    this.remoteStream = null;     // 1:1 remote
    this.callId = null;
    this.peer = null;             // 1:1 peer, or (for a group ring) the initiator { id, name }
    this.mode = "video";
    this.isInitiator = false;
    this.sentInvite = false;
    this.micOn = true;
    this.camOn = true;
    this.error = null;
    this._retry = null;           // fn to re-attempt after a media failure
    this.startedAt = 0;
    this.pendingIce = [];         // 1:1 ICE queued before remoteDescription
    this._incomingOffer = null;
    this._facing = "user";
    // group
    this.isGroup = false;
    this.groupId = null;
    this.groupName = null;
    this.participants = new Map(); // peerId -> { id, name, pc, stream, pendingIce:[], offered:bool }
  }

  snapshot() {
    return {
      status: this.status, peer: this.peer, mode: this.mode,
      micOn: this.micOn, camOn: this.camOn, error: this.error, canRetry: !!this._retry,
      startedAt: this.startedAt, isInitiator: this.isInitiator,
      localStream: this.localStream, remoteStream: this.remoteStream,
      isGroup: this.isGroup, groupName: this.groupName,
      participants: [...this.participants.values()].map((p) => ({ id: p.id, name: p.name, stream: p.stream })),
    };
  }
  subscribe(fn) { this.listeners.add(fn); fn(this.snapshot()); return () => this.listeners.delete(fn); }
  _emit() { const s = this.snapshot(); this.listeners.forEach((fn) => { try { fn(s); } catch { /* */ } }); }

  /* ---- signaling helpers ------------------------------------------------- */
  async _signal(kind, payload) { // 1:1 (uses this.peer)
    if (!this.peer || !this.callId) return;
    await this._signalTo(this.peer.id, kind, payload);
  }
  async _signalTo(toId, kind, payload) {
    if (!toId || !this.callId) return;
    try { await apiPost("/calls/signal", { callId: this.callId, toId, kind, payload: payload ?? null, mode: this.mode }); }
    catch { /* transient */ }
  }
  async _ensureMeId() {
    if (this.meId) return;
    try { const r = await apiGet("/calls/poll"); if (r?.meId) this.meId = r.meId; } catch { /* */ }
  }

  /* ---- media ------------------------------------------------------------- */
  // Human-readable, ACTIONABLE reason a getUserMedia call failed — so the user
  // knows what to actually do (allow permission / close the other app / …)
  // instead of a dead-end "blocked".
  _mediaErrorMessage(e) {
    switch (e?.name) {
      case "NotAllowedError":
      case "SecurityError":
        return "Camera & mic are blocked. Click the camera icon in your browser's address bar, choose Allow, then Retry.";
      case "NotFoundError":
      case "OverconstrainedError":
        return "No camera or microphone was found on this device.";
      case "NotReadableError":
      case "AbortError":
        return "Your camera/mic is busy in another app (Zoom, Teams, another tab). Close it, then Retry.";
      default:
        return "Couldn't access your camera/mic. Check the browser permission, then Retry.";
    }
  }

  // Acquire local media with progressive fallback so a call still connects when
  // possible: ideal (facingMode) video+audio → plain video+audio → AUDIO-ONLY.
  // A video call on a device with no/blocked camera thus degrades to voice
  // instead of failing outright. Only a hard permission denial (mic AND cam) or
  // "no devices at all" throws — surfaced with an actionable message + Retry.
  async _getMedia() {
    const wantVideo = this.mode === "video";
    const attempts = wantVideo
      ? [{ audio: true, video: { facingMode: this._facing } }, { audio: true, video: true }, { audio: true, video: false }]
      : [{ audio: true, video: false }];

    let lastErr = null;
    for (const constraints of attempts) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        this.localStream = stream;
        // Wanted video but only got audio (no camera / camera blocked but mic ok)
        // → run as a voice call so the UI stops promising video we can't send.
        if (wantVideo && stream.getVideoTracks().length === 0) { this.mode = "voice"; this.camOn = false; }
        stream.getAudioTracks().forEach((t) => (t.enabled = this.micOn));
        stream.getVideoTracks().forEach((t) => (t.enabled = this.camOn));
        return;
      } catch (e) {
        lastErr = e;
        // Fall through to the next, looser constraint set. Even on a permission
        // denial we still try audio-only, in case ONLY the camera was blocked
        // (mic ok) → the call degrades to voice instead of failing.
      }
    }
    throw lastErr || new DOMException("No media", "NotFoundError");
  }

  // Media couldn't be acquired: park in idle with an actionable error + a Retry
  // that re-runs the exact action the user attempted (kept alive across the reset).
  _failMedia(e, retryFn) {
    try { this.localStream && this.localStream.getTracks().forEach((t) => t.stop()); } catch { /* */ }
    const msg = this._mediaErrorMessage(e);
    this._reset();
    this.error = msg;
    this._retry = retryFn || null;
    this._emit();
  }
  retry() { const fn = this._retry; this.error = null; this._retry = null; this._emit(); if (fn) fn(); }
  dismissError() { this.error = null; this._retry = null; this._emit(); }

  /* =========================================================================
   *  1:1 CALLS
   * ======================================================================= */
  _newPc() {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pc.onicecandidate = (e) => { if (e.candidate) this._signal("ice", e.candidate.toJSON()); };
    pc.ontrack = (e) => {
      this.remoteStream = this.remoteStream || new MediaStream();
      if (!this.remoteStream.getTracks().includes(e.track)) this.remoteStream.addTrack(e.track);
      this._emit();
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "connected" && this.status !== "connected") { this.status = "connected"; this.startedAt = Date.now(); this._emit(); }
      else if (st === "failed" || st === "closed") this._end();
    };
    return pc;
  }

  async startCall(peer, mode = "video") {
    if (this.status !== "idle" || !peer?.id) return;
    this._reset();
    this.peer = { id: peer.id, name: peer.name };
    this.mode = mode; this.isInitiator = true; this.callId = uuid();
    this.status = "outgoing"; this._emit();
    try { await this._getMedia(); }
    catch (e) { return this._failMedia(e, () => this.startCall(peer, mode)); }
    try {
      this.pc = this._newPc();
      this.localStream.getTracks().forEach((t) => this.pc.addTrack(t, this.localStream));
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      await this._signal("invite", offer);
      this.sentInvite = true;
      this._emit();
    } catch {
      this.error = "Couldn't start the call.";
      this._emit(); this._end();
    }
  }

  /* =========================================================================
   *  GROUP CALLS (mesh)
   * ======================================================================= */
  _newPeer(peerId, name) {
    if (this.participants.has(peerId)) return this.participants.get(peerId);
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const part = { id: peerId, name: name || "…", pc, stream: new MediaStream(), pendingIce: [], offered: false };
    pc.onicecandidate = (e) => { if (e.candidate) this._signalTo(peerId, "ice", e.candidate.toJSON()); };
    pc.ontrack = (e) => {
      if (!part.stream.getTracks().includes(e.track)) part.stream.addTrack(e.track);
      this._emit();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") this._removePeer(peerId);
    };
    if (this.localStream) this.localStream.getTracks().forEach((t) => pc.addTrack(t, this.localStream));
    this.participants.set(peerId, part);
    this._emit();
    return part;
  }

  // Decide who offers: the smaller account id. Idempotent (guarded by `offered`).
  async _maybeOffer(peerId, name) {
    const part = this._newPeer(peerId, name);
    if (part.offered || !this.meId) return;
    if (String(this.meId) < String(peerId)) {
      part.offered = true;
      try {
        const offer = await part.pc.createOffer();
        await part.pc.setLocalDescription(offer);
        await this._signalTo(peerId, "offer", offer);
      } catch { part.offered = false; }
    }
  }

  _removePeer(peerId) {
    const part = this.participants.get(peerId);
    if (!part) return;
    try { part.pc.onconnectionstatechange = null; part.pc.close(); } catch { /* */ }
    this.participants.delete(peerId);
    this._emit();
  }

  /** Start a group call — rings every other member into a mesh room. */
  async startGroupCall(group, mode = "video") {
    if (this.status !== "idle" || !group?.id) return;
    this._reset();
    this.isGroup = true; this.groupId = group.id; this.groupName = group.name;
    this.mode = mode; this.isInitiator = true; this.callId = uuid();
    this.status = "connecting"; this._emit();
    try { await this._ensureMeId(); await this._getMedia(); }
    catch (e) { return this._failMedia(e, () => this.startGroupCall(group, mode)); }
    try {
      this.status = "connected"; this.startedAt = Date.now(); this.sentInvite = true; this._emit();
      const { members } = await getGroupMembers(group.id);
      const others = (members || []).filter((m) => String(m.id) !== String(this.meId));
      for (const m of others) await this._signalTo(m.id, "ginvite", { groupId: group.id, groupName: group.name });
    } catch {
      this.error = "Couldn't start the group call.";
      this._emit(); this._end();
    }
  }

  async _acceptGroup() {
    const snap = { callId: this.callId, groupId: this.groupId, groupName: this.groupName, mode: this.mode, peer: this.peer };
    this.status = "connecting"; this._emit();
    try { await this._ensureMeId(); await this._getMedia(); }
    catch (e) {
      return this._failMedia(e, () => {
        this._reset();
        this.isGroup = true; this.status = "incoming";
        this.callId = snap.callId; this.groupId = snap.groupId; this.groupName = snap.groupName; this.mode = snap.mode; this.peer = snap.peer;
        this._emit(); this.accept();
      });
    }
    try {
      this.status = "connected"; this.startedAt = Date.now(); this._emit();
      // Announce myself to every member; those already in the room will reply.
      const { members } = await getGroupMembers(this.groupId);
      const others = (members || []).filter((m) => String(m.id) !== String(this.meId));
      for (const m of others) await this._signalTo(m.id, "gjoin", null);
    } catch {
      this.error = "Couldn't join the group call.";
      this._emit(); this._end();
    }
  }

  /* ---- accept / decline / hangup (shared) -------------------------------- */
  async accept() {
    if (this.status !== "incoming") return;
    if (this.isGroup) return this._acceptGroup();
    if (!this._incomingOffer) return;
    const snap = { offer: this._incomingOffer, peer: this.peer, callId: this.callId, mode: this.mode };
    this.status = "connecting"; this._emit();
    try { await this._getMedia(); }
    catch (e) {
      return this._failMedia(e, () => {
        this._reset();
        this.status = "incoming"; this.peer = snap.peer; this.callId = snap.callId; this.mode = snap.mode; this._incomingOffer = snap.offer;
        this._emit(); this.accept();
      });
    }
    try {
      this.pc = this._newPc();
      this.localStream.getTracks().forEach((t) => this.pc.addTrack(t, this.localStream));
      await this.pc.setRemoteDescription(this._incomingOffer);
      await this._flushIce();
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      await this._signal("answer", answer);
      this._emit();
    } catch {
      this.error = "Couldn't join the call.";
      this._emit(); this._end();
    }
  }

  reject() { if (this.isGroup) { this._signalTo(this.peer?.id, "gleave", null); } else { this._signal("reject"); } this._end(); }
  hangup() {
    if (this.isGroup) { for (const id of this.participants.keys()) this._signalTo(id, "gleave", null); }
    else { this._signal("hangup"); }
    this._end();
  }

  async _flushIce() {
    if (!this.pc?.remoteDescription) return;
    for (const c of this.pendingIce.splice(0)) { try { await this.pc.addIceCandidate(c); } catch { /* */ } }
  }
  async _flushPeerIce(part) {
    if (!part.pc.remoteDescription) return;
    for (const c of part.pendingIce.splice(0)) { try { await part.pc.addIceCandidate(c); } catch { /* */ } }
  }

  _end() {
    const { peer, mode, isInitiator, sentInvite, isGroup, groupId } = this;
    const wasConnected = this.status === "connected";
    const dur = wasConnected ? Math.floor((Date.now() - this.startedAt) / 1000) : 0;

    // Tear down every connection.
    try { this.pc && (this.pc.onconnectionstatechange = null, this.pc.close()); } catch { /* */ }
    for (const part of this.participants.values()) { try { part.pc.onconnectionstatechange = null; part.pc.close(); } catch { /* */ } }
    try { this.localStream && this.localStream.getTracks().forEach((t) => t.stop()); } catch { /* */ }

    const noun = mode === "video" ? "📹 Video" : "📞 Voice";
    if (isGroup && isInitiator && sentInvite && groupId) {
      const label = wasConnected ? `${mode === "video" ? "📹 Group video" : "📞 Group voice"} call · ${fmtCallDuration(dur)}` : `${mode === "video" ? "📹 Group video" : "📞 Group voice"} call · ended`;
      sendGroupMessage(groupId, { kind: "call", body: label }).catch(() => {});
    } else if (!isGroup && isInitiator && sentInvite && peer?.id) {
      const label = wasConnected ? `${noun} call · ${fmtCallDuration(dur)}` : `${noun} call · no answer`;
      sendMessage("account", peer.id, { kind: "call", body: label }).catch(() => {});
    }

    const keepError = this.error;
    this._reset();
    this.error = keepError;
    this._emit();
    if (keepError) setTimeout(() => { if (this.status === "idle") { this.error = null; this._emit(); } }, 2500);
  }

  /* ---- media controls (apply across every peer connection) --------------- */
  toggleMic() { this.micOn = !this.micOn; this.localStream?.getAudioTracks().forEach((t) => (t.enabled = this.micOn)); this._emit(); }
  toggleCam() { this.camOn = !this.camOn; this.localStream?.getVideoTracks().forEach((t) => (t.enabled = this.camOn)); this._emit(); }
  async flipCam() {
    if (this.mode !== "video" || !this.localStream) return;
    this._facing = this._facing === "user" ? "environment" : "user";
    try {
      const ns = await navigator.mediaDevices.getUserMedia({ video: { facingMode: this._facing } });
      const track = ns.getVideoTracks()[0];
      const senders = [];
      if (this.pc) senders.push(...this.pc.getSenders());
      for (const part of this.participants.values()) senders.push(...part.pc.getSenders());
      for (const s of senders) if (s.track?.kind === "video") await s.replaceTrack(track);
      this.localStream.getVideoTracks().forEach((t) => t.stop());
      const audio = this.localStream.getAudioTracks();
      this.localStream = new MediaStream([track, ...audio]);
      track.enabled = this.camOn;
      this._emit();
    } catch { /* */ }
  }

  /* ---- global incoming-call + signaling poll ----------------------------- */
  startGlobalPoll() {
    if (this.polling) return;
    this.polling = true;
    const loop = async () => {
      if (getToken()) {
        try {
          const r = await apiGet(`/calls/poll${this.since ? `?since=${encodeURIComponent(this.since)}` : ""}`);
          this.since = r.now;
          if (r.meId) this.meId = r.meId;
          for (const sig of r.signals || []) {
            if (this.seen.has(sig.id)) continue;
            this.seen.add(sig.id);
            await this._handleSignal(sig);
          }
        } catch { /* */ }
      }
      setTimeout(loop, this.status === "idle" ? 1500 : 900);
    };
    loop();
  }

  async _handleSignal(sig) {
    // ---- Group ring (may arrive while idle) ----
    if (sig.kind === "ginvite") {
      if (this.status !== "idle") return; // busy → silently ignore
      this._reset();
      this.isGroup = true;
      this.status = "incoming";
      this.callId = sig.callId;
      this.groupId = sig.payload?.groupId || null;
      this.groupName = sig.payload?.groupName || "Group";
      this.mode = sig.mode || "video";
      this.peer = { id: sig.fromId, name: sig.fromName }; // the caller
      this._emit();
      return;
    }

    // ---- In-call group signals (match room) ----
    if (this.isGroup && this.callId === sig.callId && this.status !== "incoming") {
      const from = sig.fromId, name = sig.fromName;
      if (from && String(from) === String(this.meId)) return; // ignore echoes of myself
      switch (sig.kind) {
        case "gjoin": // someone joined → tell them I'm here, then connect
          if (from) { await this._signalTo(from, "gpresence", null); await this._maybeOffer(from, name); }
          break;
        case "gpresence": // reply from an existing participant → connect
          if (from) await this._maybeOffer(from, name);
          break;
        case "offer": {
          const part = this._newPeer(from, name);
          try {
            await part.pc.setRemoteDescription(sig.payload);
            await this._flushPeerIce(part);
            const answer = await part.pc.createAnswer();
            await part.pc.setLocalDescription(answer);
            await this._signalTo(from, "answer", answer);
          } catch { /* */ }
          break;
        }
        case "answer": {
          const part = this.participants.get(from);
          if (part) { try { await part.pc.setRemoteDescription(sig.payload); await this._flushPeerIce(part); } catch { /* */ } }
          break;
        }
        case "ice": {
          const part = this._newPeer(from, name);
          if (part.pc.remoteDescription) { try { await part.pc.addIceCandidate(sig.payload); } catch { /* */ } }
          else part.pendingIce.push(sig.payload);
          break;
        }
        case "gleave":
        case "hangup": if (from) this._removePeer(from); break;
        default: break;
      }
      return;
    }

    // ---- 1:1 signals (existing behaviour) ----
    switch (sig.kind) {
      case "invite":
        if (this.status !== "idle") {
          try { await apiPost("/calls/signal", { callId: sig.callId, toId: sig.fromId, kind: "busy" }); } catch { /* */ }
          return;
        }
        this._reset();
        this.status = "incoming";
        this.callId = sig.callId;
        this.peer = { id: sig.fromId, name: sig.fromName };
        this.mode = sig.mode || "video";
        this._incomingOffer = sig.payload;
        this._emit();
        break;
      case "answer":
        if (this.isInitiator && this.pc && sig.callId === this.callId) {
          try { await this.pc.setRemoteDescription(sig.payload); await this._flushIce(); this.status = "connecting"; this._emit(); } catch { /* */ }
        }
        break;
      case "ice":
        if (sig.callId === this.callId && sig.payload) {
          if (this.pc?.remoteDescription) { try { await this.pc.addIceCandidate(sig.payload); } catch { /* */ } }
          else this.pendingIce.push(sig.payload);
        }
        break;
      case "reject": if (sig.callId === this.callId) { this.error = `${this.peer?.name || "They"} declined.`; this._end(); } break;
      case "busy": if (sig.callId === this.callId) { this.error = `${this.peer?.name || "They"} are on another call.`; this._end(); } break;
      case "hangup": if (sig.callId === this.callId) this._end(); break;
      default: break;
    }
  }
}

const callManager = new CallManager();
export default callManager;
