/* =============================================================================
 *  OWNED BY:  Vance — MusterChat group conversation. Like HumanThread but for a
 *  group: messages come from multiple people, so each incoming message shows the
 *  sender's name. Near-real-time via polling. Supports text, stickers, inline
 *  document parse-&-share ("Add to trip"), video clips, edit/delete of your own
 *  messages, and group voice/video calls (real WebRTC mesh via callManager).
 * ============================================================================= */
import { useState, useEffect, useRef, useCallback } from "react";
import { Send, Users, Paperclip, Phone, Video, FileText, Film, X, Smile, Pencil, Trash2, Ban, Check } from "lucide-react";
import { getGroupThread, sendGroupMessage, editMessage, deleteMessage } from "../../lib/messagesApi.js";
import { parseDocument, confirmDelegates } from "../../lib/claudeParse.js";
import DocShareCard from "./DocShareCard.jsx";
import StickerPicker from "./StickerPicker.jsx";
import callManager from "../../lib/callManager.js";
// Shared trip id constant (integration patch 2026-07-27) — was a duplicated
// local `const TRIP_ID = "t-1"`; lib/mobileTrip.js explicitly warns against
// exactly that duplication.
import { TRIP_ID } from "../../lib/exceptionsApi.js";

const MAX_VIDEO_BYTES = 8 * 1024 * 1024;

const hhmm = (iso) => { try { return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
const fileToDataUrl = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });
const parseDoc = (m) => { try { return JSON.parse(m.media || "{}"); } catch { return {}; } };

export default function GroupThread({ group, onActivity }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [added, setAdded] = useState({});
  const [error, setError] = useState(null);
  const listRef = useRef(null);
  const taRef = useRef(null);
  const docInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const lastCountRef = useRef(0);

  useEffect(() => {
    let alive = true;
    setMessages([]); setLoading(true); setError(null); setAttachOpen(false); setStickerOpen(false);
    getGroupThread(group.id).then((r) => { if (alive) { setMessages(r.messages || []); setLoading(false); } }).catch(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [group.id]);

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const r = await getGroupThread(group.id);
        setMessages((prev) => {
          const pending = prev.filter((m) => m.pending || m.failed);
          const merged = [...(r.messages || []), ...pending];
          if (merged.length !== prev.length || merged[merged.length - 1]?.id !== prev[prev.length - 1]?.id) onActivity?.();
          return merged;
        });
      } catch { /* transient */ }
    }, 1500);
    return () => clearInterval(id);
  }, [group.id, onActivity]);

  useEffect(() => {
    if (messages.length !== lastCountRef.current) {
      lastCountRef.current = messages.length;
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);
  useEffect(() => { const el = taRef.current; if (el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 120) + "px"; } }, [draft]);

  /* ---- send helpers ----------------------------------------------------- */
  const pushOptimistic = useCallback((partial) => {
    const opt = { id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, at: new Date().toISOString(), mine: true, sender: "You", pending: true, ...partial };
    setMessages((m) => [...m, opt]);
    return opt;
  }, []);
  const settle = (tmpId, real) => setMessages((m) => m.map((x) => (x.id === tmpId ? { ...real } : x)));
  const fail = (tmpId) => setMessages((m) => m.map((x) => (x.id === tmpId ? { ...x, pending: false, failed: true } : x)));

  const send = useCallback(async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setDraft(""); setSending(true);
    const opt = pushOptimistic({ kind: "text", body });
    try {
      const { message } = await sendGroupMessage(group.id, { kind: "text", body });
      settle(opt.id, message); onActivity?.();
    } catch { fail(opt.id); }
    finally { setSending(false); }
  }, [draft, sending, group.id, onActivity, pushOptimistic]);

  async function sendSticker(payload) {
    setStickerOpen(false);
    if (payload.error) { setError(payload.error); return; }
    const opt = pushOptimistic({ kind: "sticker", body: payload.body || null, media: payload.media || null });
    try {
      const { message } = await sendGroupMessage(group.id, { kind: "sticker", body: payload.body || null, media: payload.media || null });
      settle(opt.id, message); onActivity?.();
    } catch { fail(opt.id); }
  }

  async function saveEdit() {
    const cur = editing; setEditing(null);
    if (!cur) return;
    const body = cur.value.trim();
    if (!body) return;
    setMessages((ms) => ms.map((x) => (x.id === cur.id ? { ...x, body, edited: true } : x)));
    try { await editMessage(cur.id, body); onActivity?.(); }
    catch (e) { setError(e?.message || "Couldn't edit that message."); }
  }
  async function doDelete(m) {
    setMessages((ms) => ms.map((x) => (x.id === m.id ? { ...x, deleted: true, body: null, media: null } : x)));
    try { await deleteMessage(m.id); onActivity?.(); }
    catch (e) { setError(e?.message || "Couldn't delete that message."); }
  }

  async function onPickDoc(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; setAttachOpen(false);
    if (!file) return;
    const opt = pushOptimistic({ kind: "doc", body: file.name, media: JSON.stringify({ filename: file.name, rows: [] }), parsing: true });
    try {
      const { rows } = await parseDocument(file);
      const media = JSON.stringify({ filename: file.name, rows: rows || [] });
      const { message } = await sendGroupMessage(group.id, { kind: "doc", body: file.name, media });
      settle(opt.id, message); onActivity?.();
    } catch (err) { setError(err?.message || "Couldn't read that document."); fail(opt.id); }
  }
  async function onPickVideo(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; setAttachOpen(false);
    if (!file) return;
    if (file.size > MAX_VIDEO_BYTES) { setError("That clip is too large — keep it under ~8 MB."); return; }
    const opt = pushOptimistic({ kind: "video", body: file.name, media: null, uploading: true });
    try {
      const dataUrl = await fileToDataUrl(file);
      const { message } = await sendGroupMessage(group.id, { kind: "video", body: file.name, media: dataUrl });
      settle(opt.id, message); onActivity?.();
    } catch (err) { setError(err?.message || "Couldn't send that clip."); fail(opt.id); }
  }
  async function addDocToTrip(msg) {
    const rows = parseDoc(msg).rows || [];
    if (!rows.length) return;
    setAdded((a) => ({ ...a, [msg.id]: "adding" }));
    try { await confirmDelegates(TRIP_ID, rows); setAdded((a) => ({ ...a, [msg.id]: "added" })); }
    catch (err) { setError(err?.message || "Couldn't add those delegates."); setAdded((a) => { const n = { ...a }; delete n[msg.id]; return n; }); }
  }

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", height: 560, position: "relative", overflow: "hidden" }}>
      {/* Header */}
      <div className="row" style={{ gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--line)", alignItems: "center" }}>
        <span className="avatar" style={{ background: "var(--scc-red)", color: "#fff", flexShrink: 0 }}><Users size={16} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{group.name}</div>
          <div className="muted" style={{ fontSize: 12 }}>{group.memberCount || ""} member{group.memberCount === 1 ? "" : "s"}</div>
        </div>
        <button className="btn btn-ghost" title="Group voice call" style={{ padding: 8 }} onClick={() => callManager.startGroupCall(group, "voice")}><Phone size={17} /></button>
        <button className="btn btn-ghost" title="Group video call" style={{ padding: 8 }} onClick={() => callManager.startGroupCall(group, "video")}><Video size={17} /></button>
      </div>

      {/* Messages */}
      <div ref={listRef} style={{
        flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 8,
        background: "radial-gradient(var(--line) 0.5px, transparent 0.5px), var(--surface-2)", backgroundSize: "18px 18px",
      }}>
        {loading && <div className="muted" style={{ margin: "auto", fontSize: 13 }}>Loading…</div>}
        {!loading && messages.length === 0 && (
          <div style={{ margin: "auto", textAlign: "center", padding: "0 24px" }}>
            <span className="avatar" style={{ width: 56, height: 56, fontSize: 20, margin: "0 auto 12px", background: "var(--scc-red)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}><Users size={24} /></span>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{group.name}</div>
            <div className="muted" style={{ fontSize: 13 }}>No messages yet — say hello, share a document, or start a call.</div>
          </div>
        )}

        {messages.map((m) => {
          if (m.deleted) {
            return (
              <div key={m.id} style={{ display: "flex", justifyContent: m.mine ? "flex-end" : "flex-start" }}>
                <div style={{ fontStyle: "italic", color: "var(--ink-3)", fontSize: 13, border: "1px dashed var(--line)", borderRadius: 12, padding: "6px 12px", display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Ban size={13} /> This message was deleted
                </div>
              </div>
            );
          }
          if (m.kind === "call") {
            return (
              <div key={m.id} style={{ alignSelf: "center", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 999, padding: "5px 12px", fontSize: 12, color: "var(--ink-2)" }}>
                {m.sender && !m.mine ? `${m.sender} · ` : ""}{m.body} · {hhmm(m.at)}
              </div>
            );
          }
          const mine = m.mine;
          const canEdit = mine && m.kind === "text" && !m.pending;
          const canDelete = mine && !m.pending;

          const meta = (
            <div className="muted" style={{ fontSize: 10.5, padding: "0 4px" }}>
              {hhmm(m.at)}{m.edited && <span> · edited</span>}{m.failed && <span style={{ color: "#ef4444" }}> · failed</span>}
            </div>
          );

          if (editing?.id === m.id) {
            return (
              <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "flex-end", maxWidth: "85%" }}>
                  <textarea autoFocus className="input" rows={1} value={editing.value}
                    onChange={(e) => setEditing({ id: m.id, value: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(); } if (e.key === "Escape") setEditing(null); }}
                    style={{ resize: "none", minWidth: 160, lineHeight: 1.4, padding: "7px 10px" }} />
                  <button className="btn btn-primary" style={{ padding: 8 }} onClick={saveEdit}><Check size={15} /></button>
                  <button className="btn btn-ghost" style={{ padding: 8 }} onClick={() => setEditing(null)}><X size={15} /></button>
                </div>
                <div className="muted" style={{ fontSize: 10.5, padding: "0 4px" }}>Enter to save · Esc to cancel</div>
              </div>
            );
          }

          if (m.kind === "sticker") {
            return (
              <div key={m.id} className="mc-msg" style={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start", gap: 2 }}>
                {!mine && <div className="muted" style={{ fontSize: 11, fontWeight: 600, padding: "0 8px", color: "var(--scc-red)" }}>{m.sender}</div>}
                <div style={{ display: "flex", alignItems: "center", gap: 4, flexDirection: mine ? "row-reverse" : "row", opacity: m.pending ? 0.7 : 1 }}>
                  {m.media
                    ? (m.media.startsWith("data:image/") ? <img src={m.media} alt="sticker" style={{ width: 120, height: 120, objectFit: "contain" }} /> : <span style={{ fontSize: 60, lineHeight: 1 }}>{m.body}</span>)
                    : <span style={{ fontSize: 60, lineHeight: 1 }}>{m.body}</span>}
                  {canDelete && <span className="mc-actions"><button className="btn btn-ghost" title="Delete" style={{ padding: 4 }} onClick={() => doDelete(m)}><Trash2 size={13} /></button></span>}
                </div>
                {meta}
              </div>
            );
          }

          const bubble = {
            maxWidth: "78%",
            background: mine ? "var(--scc-red)" : "var(--surface, #fff)", color: mine ? "#fff" : "var(--ink)",
            border: mine ? "none" : "1px solid var(--line)", padding: m.kind === "doc" ? 0 : "8px 12px",
            borderRadius: mine ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
            fontSize: 14, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word",
            boxShadow: m.kind === "doc" ? "none" : "0 1px 1.5px rgba(0,0,0,0.08)", opacity: m.pending ? 0.7 : 1,
          };
          return (
            <div key={m.id} className="mc-msg" style={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start", gap: 2 }}>
              {!mine && <div className="muted" style={{ fontSize: 11, fontWeight: 600, padding: "0 8px", color: "var(--scc-red)" }}>{m.sender}</div>}
              <div style={{ display: "flex", alignItems: "center", gap: 4, flexDirection: mine ? "row-reverse" : "row", maxWidth: "100%" }}>
                <div style={bubble}>
                  {m.kind === "text" && m.body}
                  {m.kind === "video" && (
                    m.media
                      ? (m.media.startsWith("data:video/") ? <video src={m.media} controls playsInline style={{ width: 240, maxWidth: "100%", borderRadius: 10, display: "block" }} /> : <span style={{ padding: "8px 12px", display: "inline-block" }}>{m.body || "Video"}</span>)
                      : <span style={{ padding: "8px 12px", display: "inline-block" }}>{m.uploading ? "Uploading clip…" : (m.body || "Video")}</span>
                  )}
                  {m.kind === "doc" && (
                    m.parsing
                      ? <div style={{ padding: "10px 14px", fontSize: 13 }}>📄 Reading {m.body}…</div>
                      : <DocShareCard doc={parseDoc(m)} mine={mine} onAddToTrip={() => addDocToTrip(m)} adding={added[m.id] === "adding"} added={added[m.id] === "added"} />
                  )}
                </div>
                {(canEdit || canDelete) && m.kind !== "doc" && (
                  <span className="mc-actions" style={{ gap: 2 }}>
                    {canEdit && <button className="btn btn-ghost" title="Edit" style={{ padding: 4 }} onClick={() => setEditing({ id: m.id, value: m.body || "" })}><Pencil size={13} /></button>}
                    {canDelete && <button className="btn btn-ghost" title="Delete" style={{ padding: 4 }} onClick={() => doDelete(m)}><Trash2 size={13} /></button>}
                  </span>
                )}
              </div>
              {meta}
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
            <button className="btn btn-ghost" style={{ justifyContent: "flex-start", fontSize: 13 }} onClick={() => docInputRef.current?.click()}><FileText size={16} /> Document (parse & share)</button>
            <button className="btn btn-ghost" style={{ justifyContent: "flex-start", fontSize: 13 }} onClick={() => videoInputRef.current?.click()}><Film size={16} /> Video clip</button>
          </div>
        )}
        {stickerOpen && <StickerPicker onPick={sendSticker} />}
        <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
          <button className="btn btn-ghost" title="Attach" style={{ padding: 9 }} onClick={() => { setAttachOpen((v) => !v); setStickerOpen(false); }}><Paperclip size={18} /></button>
          <button className="btn btn-ghost" title="Sticker" style={{ padding: 9 }} onClick={() => { setStickerOpen((v) => !v); setAttachOpen(false); }}><Smile size={18} /></button>
          <textarea ref={taRef} className="input" rows={1} placeholder={`Message ${group.name}…`} value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            style={{ resize: "none", maxHeight: 120, overflowY: "auto", lineHeight: 1.45, paddingTop: 9, paddingBottom: 9 }} />
          <button className="btn btn-primary" onClick={send} disabled={sending || !draft.trim()}><Send size={16} /></button>
        </div>
        <input ref={docInputRef} type="file" accept="application/pdf,image/*" hidden onChange={onPickDoc} />
        <input ref={videoInputRef} type="file" accept="video/*" hidden onChange={onPickVideo} />
      </div>

      <style>{`.mc-actions{opacity:0;transition:opacity .12s ease;display:flex;align-items:center}.mc-msg:hover .mc-actions{opacity:1}`}</style>
    </div>
  );
}
