/* =============================================================================
 *  OWNED BY:  Vance — Trip Assistant (AI Chatbot)
 * ============================================================================= */
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Send, Plus, Bot, Search, Trash2, Copy, Check, Pin, RefreshCw, Download, Star, X } from "lucide-react";
import { apiGet, apiPost, apiPatch, apiDelete, getToken } from "../lib/api.js";
import { useLang } from "../lib/i18n.jsx";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

/**
 * Screen 6 — AI Trip Assistant (Vance). Use Case 2.
 *
 * Natural-language questions answered over the LIVE trip snapshot (delegates,
 * coaches, exceptions, check-ins, itinerary — every teammate's data), by
 * backend/routes/vance.js. Replies stream in token-by-token; chats are saved,
 * renameable, pinnable, exportable, and answers are regenerable. Delegate names
 * in a reply are clickable and open an info card.
 */

const STARTERS = [
  "Who is missing from Coach 2?",
  "Give me an attendance summary.",
  "What open exceptions are there right now?",
  "What's on today's itinerary?",
];

const FOLLOWUPS = [
  "Who should I worry about right now?",
  "Break down delegates by company",
  "Which coach has the most missing?",
];

const initialsOf = (n) => (n || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

/* ---- Minimal, safe markdown-ish renderer -------------------------------- *
 * **bold** + "- " bullets + line breaks, and (via ctx) clickable delegate
 * names. Renders to React nodes — no dangerouslySetInnerHTML, so no XSS. */
function withNames(text, keyBase, ctx) {
  if (!ctx?.nameRe || !text) return [text];
  const nodes = [];
  let last = 0, m, n = 0;
  ctx.nameRe.lastIndex = 0;
  while ((m = ctx.nameRe.exec(text)) !== null) {
    const name = m[0];
    const del = ctx.nameMap.get(name.toLowerCase());
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (del) {
      nodes.push(
        <span key={`${keyBase}-n${n++}`} onClick={() => ctx.onName(del)}
          style={{ color: "var(--scc-red)", cursor: "pointer", fontWeight: 600, textDecoration: "underline dotted" }}>
          {name}
        </span>
      );
    } else nodes.push(name);
    last = m.index + name.length;
    if (m.index === ctx.nameRe.lastIndex) ctx.nameRe.lastIndex++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
function inline(s, keyBase, ctx) {
  const out = [];
  s.split(/(\*\*[^*]+\*\*)/g).forEach((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) out.push(<strong key={`${keyBase}-b${i}`}>{p.slice(2, -2)}</strong>);
    else withNames(p, `${keyBase}-t${i}`, ctx).forEach((node, j) =>
      out.push(typeof node === "string" ? <span key={`${keyBase}-t${i}s${j}`}>{node}</span> : node));
  });
  return out;
}
function renderRich(text, ctx) {
  const lines = (text || "").split("\n");
  const out = [];
  let bullets = null;
  const flush = () => { if (bullets) { out.push(<ul key={`ul-${out.length}`} style={{ margin: "4px 0", paddingLeft: 18 }}>{bullets}</ul>); bullets = null; } };
  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, "");
    const m = line.match(/^\s*[-*]\s+(.*)$/);
    if (m) { (bullets ||= []).push(<li key={`li-${i}`} style={{ margin: "2px 0" }}>{inline(m[1], i, ctx)}</li>); return; }
    flush();
    if (line.trim() === "") { out.push(<div key={`sp-${i}`} style={{ height: 6 }} />); return; }
    out.push(<div key={`ln-${i}`}>{inline(line, i, ctx)}</div>);
  });
  flush();
  return out;
}

/* Consume an SSE token stream, calling onToken(text) per chunk. */
async function consumeStream(res, onToken) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const data = JSON.parse(line.slice(5).trim());
      if (data.token) onToken(data.token);
      if (data.error) throw new Error(data.error);
    }
  }
}

function groupByDay(sessions) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const groups = { Pinned: [], Today: [], Yesterday: [], Earlier: [] };
  for (const s of sessions) {
    if (s.pinned) { groups.Pinned.push(s); continue; }
    const t = new Date(s.updated_at).getTime();
    if (t >= startOfToday) groups.Today.push(s);
    else if (t >= startOfYesterday) groups.Yesterday.push(s);
    else groups.Earlier.push(s);
  }
  return Object.entries(groups).filter(([, items]) => items.length);
}

const hhmm = (iso) => {
  try { return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); }
  catch { return ""; }
};

const iconBtn = { background: "none", border: "none", cursor: "pointer", color: "var(--ink-3)", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4, padding: 0 };

export default function ChatAssistantPage() {
  const { t, lang } = useLang();
  const [sessions, setSessions] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [filter, setFilter] = useState("");
  const [copiedIdx, setCopiedIdx] = useState(null);
  const [roster, setRoster] = useState([]);
  const [card, setCard] = useState(null);      // delegate shown in the info card
  const [renaming, setRenaming] = useState(null); // { id, value }
  const endRef = useRef(null);

  const copyMsg = (i, text) => {
    navigator.clipboard?.writeText(text);
    setCopiedIdx(i);
    setTimeout(() => setCopiedIdx((c) => (c === i ? null : c)), 1500);
  };

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending]);

  /* ---- delegate roster → clickable-name context ------------------------ */
  useEffect(() => { apiGet("/assistant/roster").then((r) => setRoster(r.delegates || [])).catch(() => {}); }, []);
  const nameCtx = useMemo(() => {
    const nameMap = new Map();
    const names = [];
    for (const d of roster) {
      const nm = (d.name || "").trim();
      if (nm.length < 3) continue;
      nameMap.set(nm.toLowerCase(), d);
      names.push(nm);
    }
    if (!names.length) return null;
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp("(" + names.sort((a, b) => b.length - a.length).map(esc).join("|") + ")", "gi");
    return { nameRe: re, nameMap, onName: setCard };
  }, [roster]);

  /* ---- sidebar list ---------------------------------------------------- */
  const loadSessions = useCallback(async () => {
    try { const { sessions } = await apiGet("/chat/sessions"); setSessions(sessions); return sessions; }
    catch { return []; }
  }, []);

  useEffect(() => {
    (async () => { const list = await loadSessions(); if (list.length) openSession(list[0].id); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- open / new / delete / rename / pin ------------------------------ */
  async function openSession(id) {
    setCurrentId(id);
    setMessages([]);
    try {
      const { messages } = await apiGet(`/chat/sessions/${id}`);
      setMessages(messages.map((m) => ({ role: m.role.toUpperCase(), content: m.content })));
    } catch { /* ignore */ }
  }

  async function newChat() {
    if (currentId && messages.length === 0) return; // already on a blank chat
    setDraft("");
    setMessages([]);
    try { const created = await apiPost("/chat/sessions", {}); setCurrentId(created.id); await loadSessions(); }
    catch { setCurrentId(null); }
  }

  async function removeSession(id, e) {
    e.stopPropagation();
    if (!window.confirm(t("Delete this chat?"))) return;
    try {
      await apiDelete(`/chat/sessions/${id}`);
      const list = await loadSessions();
      if (id === currentId) { if (list.length) openSession(list[0].id); else newChat(); }
    } catch { /* ignore */ }
  }

  async function togglePin(h, e) {
    e.stopPropagation();
    try { await apiPatch(`/chat/sessions/${h.id}`, { pinned: !h.pinned }); loadSessions(); } catch { /* ignore */ }
  }

  async function commitRename() {
    const r = renaming;
    setRenaming(null);
    if (!r) return;
    const title = r.value.trim();
    if (!title) return;
    try { await apiPatch(`/chat/sessions/${r.id}`, { title }); loadSessions(); } catch { /* ignore */ }
  }

  /* ---- export transcript ----------------------------------------------- */
  function exportChat() {
    if (!messages.length) return;
    const title = sessions.find((s) => s.id === currentId)?.title || "Trip assistant chat";
    const body = messages.map((m) => `**${m.role === "USER" ? "You" : "Assistant"}:** ${m.content}`).join("\n\n");
    const blob = new Blob([`# ${title}\n\n${body}\n`], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.slice(0, 40).replace(/[^\w -]/g, "_").trim() || "chat"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ---- streaming ------------------------------------------------------- */
  const appendToLast = (tok) =>
    setMessages((m) => {
      const copy = [...m];
      const last = copy[copy.length - 1];
      copy[copy.length - 1] = { ...last, content: last.content + tok };
      return copy;
    });

  async function streamReply(sessionId, content) {
    const token = getToken();
    const res = await fetch(`${API_BASE}/chat/sessions/${sessionId}/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ content, lang }),
    });
    if (!res.ok || !res.body) { // fallback to non-streaming
      const { reply } = await apiPost(`/chat/sessions/${sessionId}/messages`, { content, lang });
      appendToLast(reply.content);
      return;
    }
    await consumeStream(res, appendToLast);
  }

  async function send(text) {
    const content = (text ?? draft).trim();
    if (!content || sending) return;
    setDraft("");
    setSending(true);
    setMessages((m) => [...m, { role: "USER", content }, { role: "ASSISTANT", content: "" }]);
    try {
      let sessionId = currentId;
      if (!sessionId) {
        const created = await apiPost("/chat/sessions", {});
        sessionId = created.id;
        setCurrentId(sessionId);
        await loadSessions();
      }
      await streamReply(sessionId, content);
      loadSessions();
    } catch (err) {
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: "ASSISTANT", content: err.message || t("The assistant is temporarily unavailable."), notice: true };
        return copy;
      });
    } finally { setSending(false); }
  }

  async function regenerate() {
    if (sending || !currentId) return;
    setSending(true);
    setMessages((m) => {
      const copy = [...m];
      while (copy.length && copy[copy.length - 1].role === "ASSISTANT") copy.pop();
      copy.push({ role: "ASSISTANT", content: "" });
      return copy;
    });
    try {
      const token = getToken();
      const res = await fetch(`${API_BASE}/chat/sessions/${currentId}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ lang }),
      });
      if (!res.ok || !res.body) { const j = await res.json().catch(() => ({})); throw new Error(j.message || "Couldn't regenerate."); }
      await consumeStream(res, appendToLast);
      loadSessions();
    } catch (err) {
      setMessages((m) => { const copy = [...m]; copy[copy.length - 1] = { role: "ASSISTANT", content: err.message, notice: true }; return copy; });
    } finally { setSending(false); }
  }

  const visible = sessions.filter((s) => s.title.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="page-eyebrow">{t("Assistant")}</div>
      <h1 className="page-title">{t("Trip assistant")}</h1>
      <p className="page-sub">{t("Conversational queries · live data · translation")}</p>

      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16, marginTop: 20 }}>
        {/* History sidebar */}
        <div className="card" style={{ padding: 12, height: 520, overflowY: "auto" }}>
          <button className="btn btn-dark btn-block" style={{ marginBottom: 12 }} onClick={newChat}>
            <Plus size={16} /> {t("New chat")}
          </button>
          <div style={{ position: "relative", marginBottom: 12 }}>
            <Search size={15} style={{ position: "absolute", left: 10, top: 11, color: "var(--ink-3)" }} />
            <input className="input" placeholder={t("Search chats…")} value={filter}
              onChange={(e) => setFilter(e.target.value)} style={{ paddingLeft: 32, padding: "8px 8px 8px 32px" }} />
          </div>

          {visible.length === 0 && (
            <div className="muted" style={{ fontSize: 12, padding: "4px 8px" }}>
              {t("No saved chats yet. Ask something to start one.")}
            </div>
          )}

          {groupByDay(visible).map(([group, items]) => (
            <div key={group} style={{ marginBottom: 8 }}>
              <div className="page-eyebrow" style={{ padding: "8px 8px 4px" }}>{t(group)}</div>
              {items.map((h) => {
                const active = h.id === currentId;
                const isRenaming = renaming?.id === h.id;
                return (
                  <div key={h.id} onClick={() => openSession(h.id)}
                    style={{
                      cursor: "pointer",
                      background: active ? "var(--scc-red-tint)" : "var(--surface-2)",
                      color: active ? "var(--scc-red)" : "var(--ink-2)",
                      border: `1px solid ${active ? "var(--scc-red)" : "var(--line)"}`,
                      borderRadius: 10, padding: "10px 12px", marginBottom: 8,
                      display: "flex", alignItems: "center", gap: 6,
                    }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      {isRenaming ? (
                        <input autoFocus className="input" value={renaming.value}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setRenaming({ id: h.id, value: e.target.value })}
                          onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenaming(null); }}
                          onBlur={commitRename}
                          style={{ padding: "4px 6px", fontSize: 13 }} />
                      ) : (
                        <div onDoubleClick={(e) => { e.stopPropagation(); setRenaming({ id: h.id, value: h.title }); }}
                          title={t("Double-click to rename")}
                          style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 5 }}>
                          {h.pinned && <Pin size={11} fill="currentColor" />}{h.title}
                        </div>
                      )}
                      <div className="muted" style={{ fontSize: 11 }}>{hhmm(h.updated_at)} · {h.message_count} {t("messages")}</div>
                    </div>
                    <span role="button" title={h.pinned ? t("Unpin") : t("Pin")} onClick={(e) => togglePin(h, e)}
                      style={{ color: h.pinned ? "var(--scc-red)" : "var(--ink-3)", display: "flex", padding: 2 }}>
                      <Pin size={14} fill={h.pinned ? "currentColor" : "none"} />
                    </span>
                    <span role="button" aria-label={t("Delete this chat?")} onClick={(e) => removeSession(h.id, e)}
                      style={{ color: "var(--ink-3)", display: "flex", padding: 2 }}>
                      <Trash2 size={14} />
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Conversation panel */}
        <div className="card" style={{ display: "flex", flexDirection: "column", height: 520 }}>
          <div className="row" style={{ gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
            <span className="avatar" style={{ background: "var(--ink)", color: "#fff" }}><Bot size={16} /></span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{t("Trip assistant")}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                <span style={{ color: "var(--st-present)" }}>● {t("Ready")}</span> · scoped to Beijing study mission · Eng/中文
              </div>
            </div>
            <button className="btn btn-ghost" style={{ fontSize: 12 }} disabled={!messages.length} onClick={exportChat}>
              <Download size={14} /> {t("Export")}
            </button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
            {messages.length === 0 && (
              <div style={{ margin: "auto 0", textAlign: "center" }}>
                <p className="muted" style={{ fontSize: 14, marginBottom: 14 }}>
                  {t("Ask about live attendance, missing delegates, exceptions or the itinerary.")}
                </p>
                <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                  {STARTERS.map((s) => (
                    <button key={s} className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => send(s)}>{t(s)}</button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) =>
              m.role === "USER" ? (
                <div key={i} style={{ alignSelf: "flex-end", maxWidth: "75%" }}>
                  <div style={{ background: "var(--scc-red)", color: "#fff", padding: "10px 14px", borderRadius: "14px 14px 4px 14px", fontSize: 14, whiteSpace: "pre-wrap" }}>{m.content}</div>
                </div>
              ) : (
                <div key={i} className="row" style={{ alignItems: "flex-start", gap: 10, maxWidth: "85%" }}>
                  <span className="avatar" style={{ background: "var(--ink)", color: "#fff", flexShrink: 0 }}><Bot size={15} /></span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      background: m.notice ? "var(--st-unassigned-bg)" : "var(--surface-2)",
                      border: m.notice ? "1px solid var(--st-unassigned)" : "1px solid var(--line)",
                      color: m.notice ? "var(--st-unassigned)" : undefined,
                      padding: "10px 14px", borderRadius: "14px 14px 14px 4px", fontSize: 14, lineHeight: 1.5,
                    }}>
                      {m.notice ? m.content
                        : m.content ? renderRich(m.content, nameCtx)
                        : <span className="mg-typing"><i /><i /><i /></span>}
                    </div>
                    {!m.notice && m.content && (
                      <div className="row" style={{ gap: 14, marginTop: 5, marginLeft: 4 }}>
                        <button onClick={() => copyMsg(i, m.content)} style={iconBtn}>
                          {copiedIdx === i ? <Check size={13} /> : <Copy size={13} />} {copiedIdx === i ? t("Copied") : t("Copy")}
                        </button>
                        {i === messages.length - 1 && !sending && (
                          <button onClick={regenerate} style={iconBtn}><RefreshCw size={13} /> {t("Regenerate")}</button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            )}

            {!sending && messages.length > 0 &&
              messages[messages.length - 1].role === "ASSISTANT" &&
              !messages[messages.length - 1].notice && (
              <div className="row" style={{ gap: 8, flexWrap: "wrap", paddingLeft: 44 }}>
                {FOLLOWUPS.map((s) => (
                  <button key={s} className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => send(s)}>{t(s)}</button>
                ))}
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="row" style={{ gap: 8, padding: 12, borderTop: "1px solid var(--line)" }}>
            <input className="input" placeholder={t("Ask anything about the trip…")} value={draft} disabled={sending}
              onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
            <button className="btn btn-primary" onClick={() => send()} disabled={sending}>
              <Send size={16} /> {t("Send")}
            </button>
          </div>
        </div>
      </div>

      {/* Delegate info card */}
      {card && (
        <div onClick={() => setCard(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.2)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }}>
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ padding: 0, width: 340, maxWidth: "92%", overflow: "hidden" }}>
            <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 12 }}>
              <span className="avatar" style={{ background: "var(--ink)", color: "#fff" }}>{initialsOf(card.name)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                  {card.name} {card.vip && <Star size={14} fill="#e0a800" color="#e0a800" />}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>{card.role || t("Delegate")}</div>
              </div>
              <span role="button" onClick={() => setCard(null)} style={{ cursor: "pointer", color: "var(--ink-3)", display: "flex" }}><X size={18} /></span>
            </div>
            <div style={{ padding: "14px 18px", display: "grid", gap: 8, fontSize: 13 }}>
              <CardRow label={t("Company")} value={card.company} />
              <CardRow label={t("Industry")} value={card.industry} />
              <CardRow label={t("Coach")} value={card.coach ? `${card.coach}${card.coach_city ? ` (${card.coach_city})` : ""}` : t("Unassigned")} />
              <CardRow label={t("Status")} value={card.status} />
              {card.email && <CardRow label={t("Email")} value={card.email} />}
            </div>
          </div>
        </div>
      )}

      <style>{`
        .mg-typing{display:inline-flex;gap:4px;align-items:center}
        .mg-typing i{width:7px;height:7px;border-radius:50%;background:var(--ink-3);display:inline-block;animation:mg-bounce 1.2s infinite ease-in-out}
        .mg-typing i:nth-child(2){animation-delay:.15s}
        .mg-typing i:nth-child(3){animation-delay:.3s}
        @keyframes mg-bounce{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-5px);opacity:1}}
      `}</style>
    </div>
  );
}

function CardRow({ label, value }) {
  return (
    <div style={{ display: "flex", gap: 10 }}>
      <div className="muted" style={{ width: 84, flexShrink: 0 }}>{label}</div>
      <div style={{ fontWeight: 500 }}>{value || "—"}</div>
    </div>
  );
}
