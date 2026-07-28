/* =============================================================================
 *  OWNED BY:  Vance — MusterChat "quick chat". A compact person-to-person
 *  messaging surface for the floating chat bubbles (desktop + mobile): a recent-
 *  conversation list that opens an inline mini-thread. Supports text, stickers
 *  (emoji + image), inline document parse-&-share (with "Add to trip"), and video
 *  clips — the same send features as the full inbox, just space-optimised.
 *  "Open full inbox" (desktop) jumps to /assistant for calls / groups / edit.
 *  Reuses the same /api/messages/* backend.
 * ============================================================================= */
import { useState, useEffect, useRef, useCallback } from "react";
import { Search, Send, ArrowLeft, ExternalLink, Paperclip, Smile, FileText, Film, X } from "lucide-react";
import { useLang } from "../../lib/i18n.jsx";
import { listContacts, getThread, sendMessage, markThreadRead } from "../../lib/messagesApi.js";
import { parseDocument, confirmDelegates } from "../../lib/claudeParse.js";
import { TRIP_ID } from "../../lib/exceptionsApi.js";
import DocShareCard from "./DocShareCard.jsx";
import StickerPicker from "./StickerPicker.jsx";

const MAX_VIDEO_BYTES = 8 * 1024 * 1024;
const initialsOf = (n) => (n || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const hhmm = (iso) => { try { return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
const fileToDataUrl = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });
const parseDoc = (m) => { try { return JSON.parse(m.media || "{}"); } catch { return {}; } };

export default function QuickChat({ onOpenFull }) {
  const { t } = useLang();
  const [contacts, setContacts] = useState([]);
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState(null);   // peer { kind, id, name } or null (list view)
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [added, setAdded] = useState({});
  const [error, setError] = useState(null);
  const listRef = useRef(null);
  const docInputRef = useRef(null);
  const videoInputRef = useRef(null);

  const loadContacts = useCallback(async () => {
    try { const { contacts } = await listContacts(); setContacts(contacts || []); } catch { /* transient */ }
  }, []);
  useEffect(() => { loadContacts(); const id = setInterval(loadContacts, 4000); return () => clearInterval(id); }, [loadContacts]);

  // Load + poll the open thread, and mark it read so the bubble badge clears.
  useEffect(() => {
    if (!active) return;
    let alive = true;
    setMessages([]); setAttachOpen(false); setStickerOpen(false); setError(null);
    const pull = async () => {
      try { const r = await getThread(active.kind, active.id); if (alive) setMessages(r.messages || []); }
      catch { /* transient */ }
    };
    pull();
    markThreadRead(active.kind, active.id).then(loadContacts).catch(() => {});
    const id = setInterval(pull, 1800);
    return () => { alive = false; clearInterval(id); };
  }, [active, loadContacts]);

  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [messages]);

  /* ---- send helpers ----------------------------------------------------- */
  const pushOpt = (partial) => {
    const opt = { id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, at: new Date().toISOString(), mine: true, pending: true, ...partial };
    setMessages((m) => [...m, opt]);
    return opt;
  };
  const settle = (id, real) => setMessages((m) => m.map((x) => (x.id === id ? { ...real } : x)));
  const fail = (id) => setMessages((m) => m.map((x) => (x.id === id ? { ...x, pending: false, failed: true } : x)));

  const send = async () => {
    const body = draft.trim();
    if (!body || sending || !active) return;
    setDraft(""); setSending(true);
    const opt = pushOpt({ kind: "text", body });
    try { const { message } = await sendMessage(active.kind, active.id, { kind: "text", body }); settle(opt.id, message); loadContacts(); }
    catch { fail(opt.id); }
    finally { setSending(false); }
  };

  async function sendSticker(payload) {
    setStickerOpen(false);
    if (payload.error) { setError(payload.error); return; }
    if (!active) return;
    const opt = pushOpt({ kind: "sticker", body: payload.body || null, media: payload.media || null });
    try { const { message } = await sendMessage(active.kind, active.id, { kind: "sticker", body: payload.body || null, media: payload.media || null }); settle(opt.id, message); loadContacts(); }
    catch { fail(opt.id); }
  }

  async function onPickDoc(e) {
    const file = e.target.files?.[0]; e.target.value = ""; setAttachOpen(false);
    if (!file || !active) return;
    const opt = pushOpt({ kind: "doc", body: file.name, media: JSON.stringify({ filename: file.name, rows: [] }), parsing: true });
    try {
      const { rows } = await parseDocument(file);
      const media = JSON.stringify({ filename: file.name, rows: rows || [] });
      const { message } = await sendMessage(active.kind, active.id, { kind: "doc", body: file.name, media });
      settle(opt.id, message); loadContacts();
    } catch (err) { setError(err?.message || "Couldn't read that document."); fail(opt.id); }
  }

  async function onPickVideo(e) {
    const file = e.target.files?.[0]; e.target.value = ""; setAttachOpen(false);
    if (!file || !active) return;
    if (file.size > MAX_VIDEO_BYTES) { setError("That clip is too large — keep it under ~8 MB."); return; }
    const opt = pushOpt({ kind: "video", body: file.name, media: null, uploading: true });
    try {
      const dataUrl = await fileToDataUrl(file);
      const { message } = await sendMessage(active.kind, active.id, { kind: "video", body: file.name, media: dataUrl });
      settle(opt.id, message); loadContacts();
    } catch (err) { setError(err?.message || "Couldn't send that clip."); fail(opt.id); }
  }

  async function addDocToTrip(msg) {
    const rows = parseDoc(msg).rows || [];
    if (!rows.length) return;
    setAdded((a) => ({ ...a, [msg.id]: "adding" }));
    try { await confirmDelegates(TRIP_ID, rows); setAdded((a) => ({ ...a, [msg.id]: "added" })); }
    catch (err) { setError(err?.message || "Couldn't add those delegates."); setAdded((a) => { const n = { ...a }; delete n[msg.id]; return n; }); }
  }

  const openFull = () => onOpenFull?.();

  /* ---- list view -------------------------------------------------------- */
  if (!active) {
    const visible = contacts.filter((c) => c.name.toLowerCase().includes(filter.toLowerCase()));
    const sorted = [...visible].sort((a, b) => (b.lastAt ? new Date(b.lastAt) : 0) - (a.lastAt ? new Date(a.lastAt) : 0));
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        <div style={{ padding: 10, borderBottom: "1px solid var(--line)", flexShrink: 0, position: "relative" }}>
          <Search size={14} style={{ position: "absolute", left: 20, top: 20, color: "var(--ink-3)" }} />
          <input className="input" placeholder={t("Search people…")} value={filter} onChange={(e) => setFilter(e.target.value)} style={{ paddingLeft: 30, padding: "7px 8px 7px 30px", fontSize: 13 }} />
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 6 }}>
          {sorted.length === 0 && <div className="muted" style={{ fontSize: 12.5, textAlign: "center", padding: 20 }}>{t("No contacts found.")}</div>}
          {sorted.map((c) => (
            <button key={`${c.kind}:${c.id}`} onClick={() => setActive({ kind: c.kind, id: c.id, name: c.name })}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, border: "none", background: "transparent", cursor: "pointer", textAlign: "left" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
              <div style={{ position: "relative", flexShrink: 0 }}>
                <span className="avatar" style={{ background: c.kind === "delegate" ? "var(--ink-2)" : "var(--scc-red)", color: "#fff" }}>{initialsOf(c.name)}</span>
                {c.online && <span style={{ position: "absolute", bottom: 0, right: 0, width: 10, height: 10, borderRadius: "50%", background: "var(--st-present)", border: "2px solid var(--surface,#fff)" }} />}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="row between" style={{ gap: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                  {c.lastAt && <div className="muted" style={{ fontSize: 10, flexShrink: 0 }}>{hhmm(c.lastAt)}</div>}
                </div>
                <div className="row between" style={{ gap: 6 }}>
                  <div className="muted" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                    {c.lastMessage ? `${c.lastMine ? "You: " : ""}${c.lastMessage}` : c.subtitle}
                  </div>
                  {c.unread > 0 && <span style={{ flexShrink: 0, background: "var(--scc-red)", color: "#fff", fontSize: 10, fontWeight: 700, minWidth: 17, height: 17, borderRadius: 9, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>{c.unread}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
        {onOpenFull && (
          <button className="btn btn-ghost" onClick={openFull} style={{ margin: 8, flexShrink: 0, fontSize: 12.5, justifyContent: "center" }}>
            <ExternalLink size={13} /> {t("Open full inbox")}
          </button>
        )}
      </div>
    );
  }

  /* ---- mini-thread view ------------------------------------------------- */
  const isDelegate = active.kind === "delegate";
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, position: "relative" }}>
      <div className="row" style={{ gap: 8, padding: "8px 10px", borderBottom: "1px solid var(--line)", flexShrink: 0, alignItems: "center" }}>
        <button className="btn btn-ghost" style={{ padding: 5 }} onClick={() => setActive(null)}><ArrowLeft size={16} /></button>
        <span className="avatar" style={{ background: isDelegate ? "var(--ink-2)" : "var(--scc-red)", color: "#fff", flexShrink: 0, width: 30, height: 30, fontSize: 12 }}>{initialsOf(active.name)}</span>
        <div style={{ fontWeight: 600, fontSize: 13.5, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{active.name}</div>
        {onOpenFull && <button className="btn btn-ghost" title={t("Open full inbox")} style={{ padding: 5 }} onClick={openFull}><ExternalLink size={15} /></button>}
      </div>

      <div ref={listRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
        {messages.length === 0 && <div className="muted" style={{ margin: "auto", fontSize: 12.5, textAlign: "center", padding: "0 16px" }}>{t("No messages yet. Say hello.")}</div>}
        {messages.map((m) => {
          if (m.kind === "call") return <div key={m.id} style={{ alignSelf: "center", fontSize: 11, color: "var(--ink-3)" }}>{m.body} · {hhmm(m.at)}</div>;
          const mine = m.mine;
          if (m.deleted) return (
            <div key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", fontStyle: "italic", color: "var(--ink-3)", fontSize: 12.5, border: "1px dashed var(--line)", borderRadius: 10, padding: "5px 10px" }}>🚫 {t("This message was deleted")}</div>
          );
          if (m.kind === "sticker") return (
            <div key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", opacity: m.pending ? 0.7 : 1 }}>
              {m.media ? <img src={m.media} alt="sticker" style={{ width: 88, height: 88, objectFit: "contain" }} /> : <span style={{ fontSize: 46, lineHeight: 1 }}>{m.body}</span>}
            </div>
          );
          const isDoc = m.kind === "doc";
          return (
            <div key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "84%", background: mine ? "var(--scc-red)" : "var(--surface,#fff)", color: mine ? "#fff" : "var(--ink)", border: mine ? "none" : "1px solid var(--line)", borderRadius: mine ? "12px 12px 3px 12px" : "12px 12px 12px 3px", padding: isDoc ? 0 : "6px 10px", fontSize: 13, lineHeight: 1.4, whiteSpace: "pre-wrap", wordBreak: "break-word", opacity: m.pending ? 0.7 : 1 }}>
              {m.kind === "text" && m.body}
              {m.kind === "video" && (m.media
                ? <video src={m.media} controls playsInline style={{ width: 190, maxWidth: "100%", borderRadius: 8, display: "block" }} />
                : <span style={{ padding: "6px 10px", display: "inline-block" }}>{m.uploading ? t("Uploading clip…") : (m.body || "Video")}</span>)}
              {isDoc && (m.parsing
                ? <div style={{ padding: "8px 12px", fontSize: 12.5 }}>📄 {t("Reading")} {m.body}…</div>
                : <DocShareCard doc={parseDoc(m)} mine={mine} onAddToTrip={!isDelegate ? () => addDocToTrip(m) : undefined} adding={added[m.id] === "adding"} added={added[m.id] === "added"} />)}
            </div>
          );
        })}
      </div>

      {error && (
        <div style={{ position: "absolute", bottom: 58, left: 10, right: 10, background: "var(--st-unassigned-bg, #fff4e5)", border: "1px solid var(--st-unassigned, #e0a800)", color: "var(--st-unassigned, #a76b00)", borderRadius: 8, padding: "6px 10px", fontSize: 12, display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span>{error}</span><span role="button" onClick={() => setError(null)} style={{ cursor: "pointer" }}><X size={13} /></span>
        </div>
      )}

      <div style={{ borderTop: "1px solid var(--line)", padding: 8, flexShrink: 0, position: "relative" }}>
        {attachOpen && (
          <div className="card" style={{ position: "absolute", bottom: 52, left: 8, padding: 6, display: "grid", gap: 2, zIndex: 6, minWidth: 190 }}>
            <button className="btn btn-ghost" style={{ justifyContent: "flex-start", fontSize: 12.5 }} onClick={() => docInputRef.current?.click()}><FileText size={15} /> {t("Document (parse & share)")}</button>
            <button className="btn btn-ghost" style={{ justifyContent: "flex-start", fontSize: 12.5 }} onClick={() => videoInputRef.current?.click()}><Film size={15} /> {t("Video clip")}</button>
          </div>
        )}
        {stickerOpen && <StickerPicker onPick={sendSticker} />}
        <div className="row" style={{ gap: 6, alignItems: "flex-end" }}>
          <button className="btn btn-ghost" title={t("Attach")} style={{ padding: 8 }} onClick={() => { setAttachOpen((v) => !v); setStickerOpen(false); }}><Paperclip size={17} /></button>
          <button className="btn btn-ghost" title={t("Sticker")} style={{ padding: 8 }} onClick={() => { setStickerOpen((v) => !v); setAttachOpen(false); }}><Smile size={17} /></button>
          <input className="input" placeholder={`${t("Message")} ${active.name}…`} value={draft}
            onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            style={{ fontSize: 13, padding: "8px 10px" }} />
          <button className="btn btn-primary" onClick={send} disabled={sending || !draft.trim()} style={{ padding: 9 }}><Send size={15} /></button>
        </div>
        <input ref={docInputRef} type="file" accept="application/pdf,image/*" hidden onChange={onPickDoc} />
        <input ref={videoInputRef} type="file" accept="video/*" hidden onChange={onPickVideo} />
      </div>
    </div>
  );
}
