/* =============================================================================
 *  OWNED BY:  Vance — MusterChat "quick chat". A compact messaging surface for
 *  the floating chat bubbles (desktop + mobile). Shows GROUPS and PEOPLE; opens
 *  an inline mini-thread for either. Supports text, stickers (emoji + image),
 *  inline document parse-&-share ("Add to trip"), video clips, per-message
 *  timestamps, and edit/delete of your own messages — the same as the full inbox,
 *  just space-optimised. Groups sync with the desktop inbox (same backend).
 *  Merged 2026-07-31 from Vance's post-v2 branch. NOTE: does not import
 *  markThreadRead() — that wrapper was removed from messagesApi.js in a
 *  2026-07-28 dead-code audit (getThread() already marks a 1:1 thread read
 *  server-side, same as HumanThread.jsx relies on) — this file just calls
 *  loadLists() directly after pulling the thread to refresh unread badges.
 * ============================================================================= */
import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import { Search, Send, ArrowLeft, ExternalLink, Paperclip, Smile, FileText, Film, X, Pencil, Trash2, Check, Users } from "lucide-react";
import { useLang } from "../../lib/i18n.jsx";
import {
  listContacts, getThread, sendMessage, editMessage, deleteMessage,
  listGroups, getGroupThread, sendGroupMessage,
} from "../../lib/messagesApi.js";
import { parseDocument, confirmDelegates } from "../../lib/claudeParse.js";
import { TRIP_ID } from "../../lib/exceptionsApi.js";
import { formatClock as hhmm, formatListStamp, dayLabel, isSameDay } from "../../lib/chatTime.js";
import DocShareCard from "./DocShareCard.jsx";
import StickerPicker from "./StickerPicker.jsx";

const MAX_VIDEO_BYTES = 8 * 1024 * 1024;
const initialsOf = (n) => (n || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const fileToDataUrl = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });
const parseDoc = (m) => { try { return JSON.parse(m.media || "{}"); } catch { return {}; } };

export default function QuickChat({ onOpenFull }) {
  const { t } = useLang();
  const [contacts, setContacts] = useState([]);
  const [groups, setGroups] = useState([]);
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState(null);   // { kind: "account"|"delegate"|"group", id, name }
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [added, setAdded] = useState({});
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const listRef = useRef(null);
  const docInputRef = useRef(null);
  const videoInputRef = useRef(null);

  const isGroup = active?.kind === "group";

  const loadLists = useCallback(async () => {
    try {
      const [c, g] = await Promise.all([listContacts(), listGroups()]);
      setContacts(c.contacts || []); setGroups(g.groups || []);
    } catch { /* transient */ }
  }, []);
  useEffect(() => { loadLists(); const id = setInterval(loadLists, 4000); return () => clearInterval(id); }, [loadLists]);

  // Load + poll the open thread (1:1 or group). getThread() marks a 1:1 thread
  // read server-side as a side effect; group read is marked server-side by
  // getGroupThread (chat_group_reads). Refresh lists so previews/badges update.
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const grp = active.kind === "group";
    setMessages([]); setAttachOpen(false); setStickerOpen(false); setError(null); setEditing(null);
    const pull = async () => {
      try { const r = grp ? await getGroupThread(active.id) : await getThread(active.kind, active.id); if (alive) setMessages(r.messages || []); }
      catch { /* transient */ }
    };
    pull().then(loadLists);
    const id = setInterval(pull, 1800);
    return () => { alive = false; clearInterval(id); };
  }, [active, loadLists]);

  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [messages]);

  /* ---- send helpers (branch 1:1 vs group) ------------------------------- */
  const sendTo = (payload) => (active.kind === "group" ? sendGroupMessage(active.id, payload) : sendMessage(active.kind, active.id, payload));
  const pushOpt = (partial) => {
    const opt = { id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, at: new Date().toISOString(), mine: true, sender: "You", pending: true, ...partial };
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
    try { const { message } = await sendTo({ kind: "text", body }); settle(opt.id, message); loadLists(); }
    catch { fail(opt.id); }
    finally { setSending(false); }
  };

  async function sendSticker(payload) {
    setStickerOpen(false);
    if (payload.error) { setError(payload.error); return; }
    if (!active) return;
    const opt = pushOpt({ kind: "sticker", body: payload.body || null, media: payload.media || null });
    try { const { message } = await sendTo({ kind: "sticker", body: payload.body || null, media: payload.media || null }); settle(opt.id, message); loadLists(); }
    catch { fail(opt.id); }
  }

  async function onPickDoc(e) {
    const file = e.target.files?.[0]; e.target.value = ""; setAttachOpen(false);
    if (!file || !active) return;
    const opt = pushOpt({ kind: "doc", body: file.name, media: JSON.stringify({ filename: file.name, rows: [] }), parsing: true });
    try {
      const { rows } = await parseDocument(file);
      const media = JSON.stringify({ filename: file.name, rows: rows || [] });
      const { message } = await sendTo({ kind: "doc", body: file.name, media });
      settle(opt.id, message); loadLists();
    } catch (err) { setError(err?.message || "Couldn't read that document."); fail(opt.id); }
  }

  async function onPickVideo(e) {
    const file = e.target.files?.[0]; e.target.value = ""; setAttachOpen(false);
    if (!file || !active) return;
    if (file.size > MAX_VIDEO_BYTES) { setError("That clip is too large — keep it under ~8 MB."); return; }
    const opt = pushOpt({ kind: "video", body: file.name, media: null, uploading: true });
    try {
      const dataUrl = await fileToDataUrl(file);
      const { message } = await sendTo({ kind: "video", body: file.name, media: dataUrl });
      settle(opt.id, message); loadLists();
    } catch (err) { setError(err?.message || "Couldn't send that clip."); fail(opt.id); }
  }

  async function addDocToTrip(msg) {
    const rows = parseDoc(msg).rows || [];
    if (!rows.length) return;
    setAdded((a) => ({ ...a, [msg.id]: "adding" }));
    try { await confirmDelegates(TRIP_ID, rows); setAdded((a) => ({ ...a, [msg.id]: "added" })); }
    catch (err) { setError(err?.message || "Couldn't add those delegates."); setAdded((a) => { const n = { ...a }; delete n[msg.id]; return n; }); }
  }

  async function saveEdit() {
    const cur = editing; setEditing(null);
    if (!cur) return;
    const body = cur.value.trim();
    if (!body) return;
    setMessages((ms) => ms.map((x) => (x.id === cur.id ? { ...x, body, edited: true } : x)));
    try { await editMessage(cur.id, body); loadLists(); }
    catch (e) { setError(e?.message || t("Couldn't edit that message.")); }
  }
  async function doDelete(m) {
    setMessages((ms) => ms.map((x) => (x.id === m.id ? { ...x, deleted: true, body: null, media: null } : x)));
    try { await deleteMessage(m.id); loadLists(); }
    catch (e) { setError(e?.message || t("Couldn't delete that message.")); }
  }

  // Passes the currently-open thread (null in the list view) so the caller
  // can deep-link the full inbox straight into THIS conversation instead of
  // always landing on the generic AI tab (2026-07-31 — "the button link to
  // the correct stuff chat, currently it's the same link as open full inbox").
  const openFull = () => onOpenFull?.(active);

  /* ---- list view -------------------------------------------------------- */
  if (!active) {
    const f = filter.toLowerCase();
    const gVisible = groups.filter((g) => g.name.toLowerCase().includes(f));
    const cVisible = contacts.filter((c) => c.name.toLowerCase().includes(f))
      .sort((a, b) => (b.lastAt ? new Date(b.lastAt) : 0) - (a.lastAt ? new Date(a.lastAt) : 0));
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        <div style={{ padding: 10, borderBottom: "1px solid var(--line)", flexShrink: 0, position: "relative" }}>
          <Search size={14} style={{ position: "absolute", left: 20, top: 20, color: "var(--ink-3)" }} />
          <input className="input" placeholder={t("Search people…")} value={filter} onChange={(e) => setFilter(e.target.value)} style={{ paddingLeft: 30, padding: "7px 8px 7px 30px", fontSize: 13 }} />
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 6 }}>
          {gVisible.length > 0 && <div className="page-eyebrow" style={{ padding: "6px 8px 2px", display: "flex", alignItems: "center", gap: 5 }}><Users size={12} /> {t("Groups")}</div>}
          {gVisible.map((g) => (
            <button key={`group:${g.id}`} onClick={() => setActive({ kind: "group", id: g.id, name: g.name })}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, border: "none", background: "transparent", cursor: "pointer", textAlign: "left" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
              <span className="avatar" style={{ background: "var(--scc-red)", color: "#fff", flexShrink: 0 }}><Users size={15} /></span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="row between" style={{ gap: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</div>
                  {g.lastAt && <div className="muted" style={{ fontSize: 10, flexShrink: 0 }}>{formatListStamp(g.lastAt)}</div>}
                </div>
                <div className="muted" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {g.lastMessage ? `${g.lastMine ? "You: " : ""}${g.lastMessage}` : `${g.memberCount} ${t("members")}`}
                </div>
              </div>
            </button>
          ))}

          <div className="page-eyebrow" style={{ padding: "10px 8px 2px", display: "flex", alignItems: "center", gap: 5 }}><Users size={12} /> {t("People")}</div>
          {cVisible.length === 0 && <div className="muted" style={{ fontSize: 12.5, textAlign: "center", padding: 12 }}>{t("No contacts found.")}</div>}
          {cVisible.map((c) => (
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
                  {c.lastAt && <div className="muted" style={{ fontSize: 10, flexShrink: 0 }}>{formatListStamp(c.lastAt)}</div>}
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
        <span className="avatar" style={{ background: isDelegate ? "var(--ink-2)" : "var(--scc-red)", color: "#fff", flexShrink: 0, width: 30, height: 30, fontSize: 12 }}>{isGroup ? <Users size={15} /> : initialsOf(active.name)}</span>
        <div style={{ fontWeight: 600, fontSize: 13.5, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{active.name}</div>
        {onOpenFull && <button className="btn btn-ghost" title={t("Open full inbox")} style={{ padding: 5 }} onClick={openFull}><ExternalLink size={15} /></button>}
      </div>

      <div ref={listRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
        {messages.length === 0 && <div className="muted" style={{ margin: "auto", fontSize: 12.5, textAlign: "center", padding: "0 16px" }}>{t("No messages yet. Say hello.")}</div>}
        {messages.map((m, i) => {
          // Date separator (2026-07-31, "put date for mobile message page").
          const showDateSep = i === 0 || !isSameDay(m.at, messages[i - 1].at);
          const dateSep = showDateSep && (
            <div key={`sep-${m.id}`} style={{ alignSelf: "center", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 999, padding: "2px 10px", fontSize: 10.5, fontWeight: 600, color: "var(--ink-3)" }}>
              {dayLabel(m.at)}
            </div>
          );
          if (m.kind === "call") return <Fragment key={m.id}>{dateSep}<div style={{ alignSelf: "center", fontSize: 11, color: "var(--ink-3)" }}>{isGroup && m.sender && !m.mine ? `${m.sender} · ` : ""}{m.body} · {hhmm(m.at)}</div></Fragment>;
          const mine = m.mine;
          if (m.deleted) return (
            <Fragment key={m.id}>
              {dateSep}
              <div style={{ alignSelf: mine ? "flex-end" : "flex-start", fontStyle: "italic", color: "var(--ink-3)", fontSize: 12.5, border: "1px dashed var(--line)", borderRadius: 10, padding: "5px 10px" }}>🚫 {t("This message was deleted")}</div>
            </Fragment>
          );
          const canEdit = mine && m.kind === "text" && !m.pending;
          const canDelete = mine && !m.pending;
          const senderLabel = isGroup && !mine ? <div className="muted" style={{ fontSize: 10.5, fontWeight: 600, padding: "0 6px", color: "var(--scc-red)" }}>{m.sender}</div> : null;
          const meta = (
            <div className="muted" style={{ fontSize: 10, padding: "0 3px" }}>
              {hhmm(m.at)}{m.edited ? ` · ${t("edited")}` : ""}{m.failed ? <span style={{ color: "#ef4444" }}> · {t("failed")}</span> : ""}
            </div>
          );

          if (editing?.id === m.id) return (
            <Fragment key={m.id}>
              {dateSep}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                <div className="row" style={{ gap: 5, alignItems: "flex-end", maxWidth: "90%" }}>
                  <input autoFocus className="input" value={editing.value} onChange={(e) => setEditing({ id: m.id, value: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveEdit(); } if (e.key === "Escape") setEditing(null); }}
                    style={{ fontSize: 13, padding: "6px 9px" }} />
                  <button className="btn btn-primary" style={{ padding: 7 }} onClick={saveEdit}><Check size={14} /></button>
                  <button className="btn btn-ghost" style={{ padding: 7 }} onClick={() => setEditing(null)}><X size={14} /></button>
                </div>
                <div className="muted" style={{ fontSize: 10 }}>{t("Enter to save · Esc to cancel")}</div>
              </div>
            </Fragment>
          );

          if (m.kind === "sticker") return (
            <Fragment key={m.id}>
              {dateSep}
              <div style={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start", gap: 1 }}>
                {senderLabel}
                <div style={{ display: "flex", alignItems: "center", gap: 4, flexDirection: mine ? "row-reverse" : "row", opacity: m.pending ? 0.7 : 1 }}>
                  {m.media ? <img src={m.media} alt="sticker" style={{ width: 88, height: 88, objectFit: "contain" }} /> : <span style={{ fontSize: 46, lineHeight: 1 }}>{m.body}</span>}
                  {canDelete && <button className="btn btn-ghost" title={t("Delete")} style={{ padding: 3, opacity: 0.6 }} onClick={() => doDelete(m)}><Trash2 size={12} /></button>}
                </div>
                {meta}
              </div>
            </Fragment>
          );

          const isDoc = m.kind === "doc";
          const bubble = { maxWidth: "100%", background: mine ? "var(--scc-red)" : "var(--surface,#fff)", color: mine ? "#fff" : "var(--ink)", border: mine ? "none" : "1px solid var(--line)", borderRadius: mine ? "12px 12px 3px 12px" : "12px 12px 12px 3px", padding: isDoc ? 0 : "6px 10px", fontSize: 13, lineHeight: 1.4, whiteSpace: "pre-wrap", wordBreak: "break-word", opacity: m.pending ? 0.7 : 1 };
          return (
            <Fragment key={m.id}>
              {dateSep}
              <div style={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start", gap: 1 }}>
                {senderLabel}
                <div style={{ display: "flex", alignItems: "center", gap: 4, flexDirection: mine ? "row-reverse" : "row", maxWidth: "84%" }}>
                  <div style={bubble}>
                    {m.kind === "text" && m.body}
                    {m.kind === "video" && (m.media
                      ? <video src={m.media} controls playsInline style={{ width: 190, maxWidth: "100%", borderRadius: 8, display: "block" }} />
                      : <span style={{ padding: "6px 10px", display: "inline-block" }}>{m.uploading ? t("Uploading clip…") : (m.body || "Video")}</span>)}
                    {isDoc && (m.parsing
                      ? <div style={{ padding: "8px 12px", fontSize: 12.5 }}>📄 {t("Reading")} {m.body}…</div>
                      : <DocShareCard doc={parseDoc(m)} mine={mine} onAddToTrip={!isDelegate ? () => addDocToTrip(m) : undefined} adding={added[m.id] === "adding"} added={added[m.id] === "added"} />)}
                  </div>
                  {(canEdit || canDelete) && !isDoc && (
                    <span style={{ display: "flex", gap: 1, opacity: 0.55 }}>
                      {canEdit && <button className="btn btn-ghost" title={t("Edit")} style={{ padding: 3 }} onClick={() => setEditing({ id: m.id, value: m.body || "" })}><Pencil size={12} /></button>}
                      {canDelete && <button className="btn btn-ghost" title={t("Delete")} style={{ padding: 3 }} onClick={() => doDelete(m)}><Trash2 size={12} /></button>}
                    </span>
                  )}
                </div>
                {meta}
              </div>
            </Fragment>
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
