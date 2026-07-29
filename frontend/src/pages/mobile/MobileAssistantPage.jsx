import { useEffect, useRef, useState } from "react";
import { Send, Bot, Sparkles } from "lucide-react";
import { apiPost } from "../../lib/api.js";
import { useLang } from "../../lib/i18n.jsx";

/**
 * Mobile Assistant — thin mobile-styled wrapper around the same
 * POST /api/chat/messages endpoint used by the desktop ChatAssistantPage.
 * No backend changes needed; same auth, same route.
 */
export default function MobileAssistantPage({ embedded = false }) {
  const { t } = useLang();
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  async function send(textArg) {
    const text = (typeof textArg === "string" ? textArg : draft).trim();
    if (!text || sending) return;
    const history = [...messages, { role: "USER", content: text }];
    setMessages(history);
    setDraft("");
    setSending(true);
    try {
      const { reply } = await apiPost("/chat/messages", { messages: history });
      setMessages((m) => [...m, { role: "ASSISTANT", content: reply.content }]);
    } catch (e) {
      const notice = e.message || "The AI assistant is temporarily unavailable.";
      setMessages((m) => [...m, { role: "ASSISTANT", content: notice, notice: true }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="m-fade-in" style={{ display: "flex", flexDirection: "column", height: embedded ? "100%" : "calc(100vh - 180px)" }}>
      {!embedded && (<>
        <div className="m-eyebrow">{t("Assistant")}</div>
        <h1 className="m-page-title" style={{ marginBottom: 12 }}>{t("Ask about the trip")}</h1>
      </>)}

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, paddingBottom: 8 }}>
        {messages.length === 0 && (
          <div>
            <div className="mobile-card" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span className="avatar" style={{ background: "var(--ink-solid)", color: "#fff", flexShrink: 0 }}><Bot size={15} /></span>
              <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                {t("Ask me anything about this trip — headcounts, who's missing, or a quick report.")}
              </div>
            </div>
            <div className="m-eyebrow" style={{ margin: "4px 2px 8px" }}>{t("Try asking")}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                t("Who is missing from Coach 2?"),
                t("Generate an attendance report."),
                t("How many delegates are late?"),
              ].map((q) => (
                <button key={q} className="m-row" onClick={() => send(q)} style={{ fontSize: 13, fontWeight: 600 }}>
                  <Sparkles size={15} style={{ color: "var(--scc-red)", flexShrink: 0 }} /> {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "USER" ? (
            <div key={i} style={{ alignSelf: "flex-end", maxWidth: "85%", background: "var(--scc-red)", color: "#fff", padding: "10px 14px", borderRadius: "14px 14px 4px 14px", fontSize: 14 }}>
              {m.content}
            </div>
          ) : (
            <div key={i} className="row" style={{ alignItems: "flex-start", gap: 8, maxWidth: "90%" }}>
              <span className="avatar" style={{ background: "var(--ink-solid)", color: "#fff", flexShrink: 0 }}><Bot size={14} /></span>
              <div style={{
                background: m.notice ? "var(--st-unassigned-bg)" : "var(--surface-2)",
                border: m.notice ? "1px solid var(--st-unassigned)" : "1px solid var(--line)",
                color: m.notice ? "var(--st-unassigned)" : undefined,
                padding: "10px 14px", borderRadius: "14px 14px 14px 4px", fontSize: 14, whiteSpace: "pre-wrap",
              }}>
                {m.content}
              </div>
            </div>
          )
        )}
        {sending && <div className="muted" style={{ fontSize: 13 }}>{t("Thinking…")}</div>}
        <div ref={endRef} />
      </div>

      <div className="row" style={{ gap: 8, paddingTop: 8, borderTop: "1px solid var(--line)" }}>
        <input
          className="input"
          placeholder={t("Ask anything…")}
          value={draft}
          disabled={sending}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button className="btn btn-primary" onClick={send} disabled={sending} aria-label={t("Send")}>
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
