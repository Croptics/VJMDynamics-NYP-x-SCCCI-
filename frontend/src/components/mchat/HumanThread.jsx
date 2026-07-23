/* =============================================================================
 *  OWNED BY:  Vance — MusterChat human conversation (staff↔staff two-way, or
 *  staff→delegate). WhatsApp-style bubbles, near-real-time via polling, video/
 *  voice calls (live local camera), and inline document sharing that parses and
 *  adds delegates to the trip — the same messaging surface the AI assistant
 *  lives beside, so the whole inbox feels like one app.
 * ============================================================================= */
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Send, Paperclip, Phone, Video, FileText, Film, Check, CheckCheck, X, ArrowLeft,
} from "lucide-react";
import { getThread, sendMessage } from "../../lib/messagesApi.js";
import { parseDocument, confirmDelegates } from "../../lib/claudeParse.js";
import DocShareCard from "./DocShareCard.jsx";
import VideoCallOverlay, { fmtDuration } from "./VideoCallOverlay.jsx";

const TRIP_ID = "t-1";
const MAX_VIDEO_BYTES = 8 * 1024 * 1024; // ~8MB clip → ~11MB base64 (under backend cap)

const initialsOf = (n) => (n || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const hhmm = (iso) => { try { return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = reject;
  r.readAsDataURL(file);
});
const parseDoc = (m) => { try { return JSON.parse(m.media || "{}"); } catch { return {}; } };

export default function HumanThread({ peer, onActivity, onBack }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [call, setCall] = useState(null);      // null | "video" | "voice"
  const [added, setAdded] = useState({});       // messageId -> "adding" | "added"
  const [error, setError] = useState(null);

  const listRef = useRef(null);
  const taRef = useRef(null);
  const docInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const lastCountRef = useRef(0);

  /* ---- load history when the peer changes ------------------------------- */
  useEffect(() => {
    let alive = true;
    setMessages([]); setLoading(true); setError(null); setAttachOpen(false);
    getThread(peer.kind, peer.id)
      .then((r) => { if (alive) { setMessages(r.messages || []); setLoading(false); } })
      .catch(() => { if (alive) { setLoading(false); setError("Couldn't load this conversation."); } });
    return () => { alive = false; };
  }, [peer.kind, peer.id]);

  /* ---- poll for new messages (keeps optimistic/pending ones) ------------ */
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const r = await getThread(peer.kind, peer.id);
        setMessages((prev) => {
          const pending = prev.filter((m) => m.pending || m.failed);
          const merged = [...(r.messages || []), ...pending];
          if (merged.length !== prev.length || merged[merged.length - 1]?.id !== prev[prev.length - 1]?.id) onActivity?.();
          return merged;
        });
      } catch { /* transient */ }
    }, 3500);
    return () => clearInterval(id);
  }, [peer.kind, peer.id, onActivity]);

  /* ---- keep pinned to the latest message -------------------------------- */
  useEffect(() => {
    if (messages.length !== lastCountRef.current) {
      lastCountRef.current = messages.length;
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    const el = taRef.current;
    if (el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 120) + "px"; }
  }, [draft]);

  /* ---- send helpers ----------------------------------------------------- */
  const pushOptimistic = useCallback((partial) => {
    const optimistic = { id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, at: new Date().toISOString(), mine: true, read: false, pending: true, ...partial };
    setMessages((m) => [...m, optimistic]);
    return optimistic;
  }, []);

  const settle = (tmpId, real) => setMessages((m) => m.map((x) => (x.id === tmpId ? { ...real } : x)));
  const fail = (tmpId) => setMessages((m) => m.map((x) => (x.id === tmpId ? { ...x, pending: false, failed: true } : x)));

  async function sendText() {
    const body = draft.trim();
    if (!body || sending) return;
    setDraft(""); setSending(true);
    const opt = pushOptimistic({ kind: "text", body });
    try {
      const { message } = await sendMessage(peer.kind, peer.id, { kind: "text", body });
      settle(opt.id, message); onActivity?.();
    } catch { fail(opt.id); }
    finally { setSending(false); }
  }

  async function onPickDoc(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    setAttachOpen(false);
    if (!file) return;
    const opt = pushOptimistic({ kind: "doc", body: file.name, media: JSON.stringify({ filename: file.name, rows: [] }), parsing: true });
    try {
      const { rows } = await parseDocument(file);
      const media = JSON.stringify({ filename: file.name, rows: rows || [] });
      const { message } = await sendMessage(peer.kind, peer.id, { kind: "doc", body: file.name, media });
      settle(opt.id, message); onActivity?.();
    } catch (err) {
      setError(err?.message || "Couldn't read that document.");
      fail(opt.id);
    }
  }

  async function onPickVideo(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    setAttachOpen(false);
    if (!file) return;
    if (file.size > MAX_VIDEO_BYTES) { setError("That clip is too large — keep it under ~8 MB."); return; }
    const opt = pushOptimistic({ kind: "video", body: file.name, media: null, uploading: true });
    try {
      const dataUrl = await fileToDataUrl(file);
      const { message } = await sendMessage(peer.kind, peer.id, { kind: "video", body: file.name, media: dataUrl });
      settle(opt.id, message); onActivity?.();
    } catch (err) {
      setError(err?.message || "Couldn't send that clip.");
      fail(opt.id);
    }
  }

  async function addDocToTrip(msg) {
    const rows = parseDoc(msg).rows || [];
    if (!rows.length) return;
    setAdded((a) => ({ ...a, [msg.id]: "adding" }));
    try {
      await confirmDelegates(TRIP_ID, rows);
      setAdded((a) => ({ ...a, [msg.id]: "added" }));
    } catch (err) {
      setError(err?.message || "Couldn't add those delegates.");
      setAdded((a) => { const n = { ...a }; delete n[msg.id]; return n; });
    }
  }

  function endCall(durationSec) {
    const kind = call;
    setCall(null);
    const label = durationSec > 0
      ? `${kind === "video" ? "📹 Video" : "📞 Voice"} call · ${fmtDuration(durationSec)}`
      : `${kind === "video" ? "📹 Video" : "📞 Voice"} call · no answer`;
    const opt = pushOptimistic({ kind: "call", body: label });
    sendMessage(peer.kind, peer.id, { kind: "call", body: label })
      .then(({ message }) => settle(opt.id, message))
      .catch(() => fail(opt.id))
      .finally(() => onActivity?.());
  }

  /* ---- render ----------------------------------------------------------- */
  const isDelegate = peer.kind === "delegate";

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", height: 560, position: "relative", overflow: "hidden" }}>
      {/* Header */}
      <div className="row" style={{ gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--line)", alignItems: "center" }}>
        {onBack && (
          <button className="btn btn-ghost" style={{ padding: 6 }} onClick={onBack}><ArrowLeft size={16} /></button>
        )}
        <span className="avatar" style={{ background: isDelegate ? "var(--ink-2)" : "var(--scc-red)", color: "#fff", flexShrink: 0 }}>
          {initialsOf(peer.name)}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{peer.name}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {isDelegate ? (peer.subtitle || "Delegate")
              : peer.online ? <span style={{ color: "var(--st-present)" }}>● online</span>
              : "offline"}
          </div>
        </div>
        <button className="btn btn-ghost" title="Voice call" style={{ padding: 8 }} onClick={() => setCall("voice")}><Phone size={17} /></button>
        <button className="btn btn-ghost" title="Video call" style={{ padding: 8 }} onClick={() => setCall("video")}><Video size={17} /></button>
      </div>

      {/* Messages */}
      <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 8, background: "var(--surface-2)" }}>
        {loading && <div className="muted" style={{ margin: "auto", fontSize: 13 }}>Loading…</div>}
        {!loading && messages.length === 0 && (
          <div style={{ margin: "auto", textAlign: "center", color: "var(--ink-3)", fontSize: 13, maxWidth: 300 }}>
            No messages yet. Say hello{isDelegate ? "" : ", share a document, or start a call"}.
          </div>
        )}

        {messages.map((m) => {
          if (m.kind === "call") {
            return (
              <div key={m.id} style={{ alignSelf: "center", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 999, padding: "5px 12px", fontSize: 12, color: "var(--ink-2)" }}>
                {m.body} · {hhmm(m.at)}
              </div>
            );
          }
          const mine = m.mine;
          const bubble = {
            maxWidth: "78%", alignSelf: mine ? "flex-end" : "flex-start",
            background: mine ? "var(--scc-red)" : "var(--surface, #fff)",
            color: mine ? "#fff" : "var(--ink)",
            border: mine ? "none" : "1px solid var(--line)",
            padding: m.kind === "doc" ? 0 : "8px 12px",
            borderRadius: mine ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
            fontSize: 14, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word",
            opacity: m.pending ? 0.7 : 1,
          };
          return (
            <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start", gap: 2 }}>
              <div style={bubble}>
                {m.kind === "text" && m.body}
                {m.kind === "video" && (
                  m.media
                    ? <video src={m.media} controls playsInline style={{ width: 240, maxWidth: "100%", borderRadius: 10, display: "block" }} />
                    : <span style={{ padding: "8px 12px", display: "inline-block" }}>{m.uploading ? "Uploading clip…" : (m.body || "Video")}</span>
                )}
                {m.kind === "doc" && (
                  m.parsing
                    ? <div style={{ padding: "10px 14px", fontSize: 13 }}>📄 Reading {m.body}…</div>
                    : <DocShareCard
                        doc={parseDoc(m)}
                        mine={mine}
                        onAddToTrip={!isDelegate ? () => addDocToTrip(m) : undefined}
                        adding={added[m.id] === "adding"}
                        added={added[m.id] === "added"}
                      />
                )}
              </div>
              <div className="muted" style={{ fontSize: 10.5, display: "flex", alignItems: "center", gap: 3, padding: "0 4px" }}>
                {hhmm(m.at)}
                {mine && !m.failed && !m.pending && (m.read
                  ? <CheckCheck size={13} style={{ color: "var(--scc-red)" }} />
                  : <Check size={13} />)}
                {m.failed && <span style={{ color: "#ef4444" }}>· failed</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Error toast */}
      {error && (
        <div style={{ position: "absolute", bottom: 74, left: 16, right: 16, background: "var(--st-unassigned-bg, #fff4e5)", border: "1px solid var(--st-unassigned, #e0a800)", color: "var(--st-unassigned, #a76b00)", borderRadius: 10, padding: "8px 12px", fontSize: 12.5, display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span>{error}</span>
          <span role="button" onClick={() => setError(null)} style={{ cursor: "pointer" }}><X size={14} /></span>
        </div>
      )}

      {/* Composer */}
      <div style={{ borderTop: "1px solid var(--line)", padding: 10, position: "relative" }}>
        {attachOpen && (
          <div className="card" style={{ position: "absolute", bottom: 60, left: 10, padding: 6, display: "grid", gap: 2, zIndex: 5, minWidth: 180 }}>
            <button className="btn btn-ghost" style={{ justifyContent: "flex-start", fontSize: 13 }} onClick={() => docInputRef.current?.click()}>
              <FileText size={16} /> Document (parse & share)
            </button>
            <button className="btn btn-ghost" style={{ justifyContent: "flex-start", fontSize: 13 }} onClick={() => videoInputRef.current?.click()}>
              <Film size={16} /> Video clip
            </button>
          </div>
        )}
        <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
          <button className="btn btn-ghost" title="Attach" style={{ padding: 9 }} onClick={() => setAttachOpen((v) => !v)}>
            <Paperclip size={18} />
          </button>
          <textarea
            ref={taRef} className="input" rows={1}
            placeholder={`Message ${peer.name}…`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendText(); } }}
            style={{ resize: "none", maxHeight: 120, overflowY: "auto", lineHeight: 1.45, paddingTop: 9, paddingBottom: 9 }}
          />
          <button className="btn btn-primary" onClick={sendText} disabled={sending || !draft.trim()}>
            <Send size={16} />
          </button>
        </div>
        <input ref={docInputRef} type="file" accept="application/pdf,image/*" hidden onChange={onPickDoc} />
        <input ref={videoInputRef} type="file" accept="video/*" hidden onChange={onPickVideo} />
      </div>

      {call && <VideoCallOverlay peer={peer} mode={call} onEnd={endCall} />}
    </div>
  );
}
