/* =============================================================================
 *  OWNED BY:  Vance — Screen 6, now "MusterChat": one WhatsApp-style inbox that
 *  holds BOTH the AI Trip Assistant (pinned) and person-to-person messaging
 *  (staff↔staff, staff→delegate) with live video calls and inline document
 *  sharing. The AI assistant conversation and the human threads share the same
 *  contact rail so the whole thing feels like one connected app.
 *
 *  Assistant logic lives in components/mchat/AssistantConversation.jsx; human
 *  threads in components/mchat/HumanThread.jsx; both use vance.js on the backend.
 * ============================================================================= */
import { useState, useEffect, useCallback, useRef } from "react";
import { Search, Bot, Users } from "lucide-react";
import { useLang } from "../lib/i18n.jsx";
import { listContacts } from "../lib/messagesApi.js";
import TripPulse from "../components/TripPulse.jsx";
import AssistantConversation from "../components/mchat/AssistantConversation.jsx";
import HumanThread from "../components/mchat/HumanThread.jsx";

const initialsOf = (n) => (n || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const hhmm = (iso) => { try { return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };

const AI = { kind: "ai", id: "assistant", name: "Trip Assistant" };

export default function ChatAssistantPage() {
  const { t } = useLang();
  const [contacts, setContacts] = useState([]);
  const [active, setActive] = useState(AI);
  const [filter, setFilter] = useState("");
  const [failed, setFailed] = useState(false);
  const activeRef = useRef(active);
  activeRef.current = active;

  const refreshContacts = useCallback(async () => {
    try { const { contacts } = await listContacts(); setContacts(contacts || []); setFailed(false); }
    catch { setFailed(true); }
  }, []);

  useEffect(() => {
    refreshContacts();
    const id = setInterval(refreshContacts, 5000);
    return () => clearInterval(id);
  }, [refreshContacts]);

  const isActive = (c) => active.kind === c.kind && active.id === c.id;
  const visible = contacts.filter((c) => c.name.toLowerCase().includes(filter.toLowerCase()));

  const rowStyle = (on) => ({
    cursor: "pointer",
    background: on ? "var(--scc-red-tint)" : "transparent",
    border: `1px solid ${on ? "var(--scc-red)" : "transparent"}`,
    borderRadius: 12, padding: "10px 12px", marginBottom: 4,
    display: "flex", alignItems: "center", gap: 10,
  });

  return (
    <div className="page" style={{ maxWidth: 1200 }}>
      <div className="row between" style={{ alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div className="page-eyebrow">{t("Assistant")}</div>
          <h1 className="page-title">MusterChat</h1>
          <p className="page-sub">{t("AI assistant + team messaging, video calls and document sharing — in one inbox.")}</p>
        </div>
        <TripPulse mode="assistant" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 16, marginTop: 20 }}>
        {/* Contact rail */}
        <div className="card" style={{ padding: 12, height: 560, overflowY: "auto" }}>
          <div style={{ position: "relative", marginBottom: 12 }}>
            <Search size={15} style={{ position: "absolute", left: 10, top: 11, color: "var(--ink-3)" }} />
            <input className="input" placeholder={t("Search people…")} value={filter}
              onChange={(e) => setFilter(e.target.value)} style={{ paddingLeft: 32, padding: "8px 8px 8px 32px" }} />
          </div>

          {/* AI assistant — pinned */}
          <div className="page-eyebrow" style={{ padding: "4px 8px 6px" }}>{t("Assistant")}</div>
          <div onClick={() => setActive(AI)} style={rowStyle(active.kind === "ai")}>
            <span className="avatar" style={{ background: "var(--ink)", color: "#fff", flexShrink: 0 }}><Bot size={16} /></span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{t("Trip Assistant")}</div>
              <div className="muted" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t("Ask about the live trip")}</div>
            </div>
          </div>

          {/* People */}
          <div className="page-eyebrow" style={{ padding: "14px 8px 6px", display: "flex", alignItems: "center", gap: 6 }}>
            <Users size={12} /> {t("People")}
          </div>

          {failed && <div className="muted" style={{ fontSize: 12, padding: "4px 8px" }}>{t("Couldn't load contacts.")}</div>}
          {!failed && visible.length === 0 && <div className="muted" style={{ fontSize: 12, padding: "4px 8px" }}>{t("No contacts found.")}</div>}

          {visible.map((c) => {
            const on = isActive(c);
            return (
              <div key={`${c.kind}:${c.id}`} onClick={() => setActive(c)} style={rowStyle(on)}>
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <span className="avatar" style={{ background: c.kind === "delegate" ? "var(--ink-2)" : "var(--scc-red)", color: "#fff" }}>{initialsOf(c.name)}</span>
                  {c.online && <span style={{ position: "absolute", bottom: 0, right: 0, width: 11, height: 11, borderRadius: "50%", background: "var(--st-present)", border: "2px solid var(--surface, #fff)" }} />}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="row between" style={{ gap: 6 }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                    {c.lastAt && <div className="muted" style={{ fontSize: 10.5, flexShrink: 0 }}>{hhmm(c.lastAt)}</div>}
                  </div>
                  <div className="row between" style={{ gap: 6 }}>
                    <div className="muted" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                      {c.lastMessage ? `${c.lastMine ? "You: " : ""}${c.lastMessage}` : c.subtitle}
                    </div>
                    {c.unread > 0 && !on && (
                      <span style={{ flexShrink: 0, background: "var(--scc-red)", color: "#fff", fontSize: 10.5, fontWeight: 700, minWidth: 18, height: 18, borderRadius: 9, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>{c.unread}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Conversation pane */}
        {active.kind === "ai"
          ? <AssistantConversation />
          : <HumanThread key={`${active.kind}:${active.id}`} peer={active} onActivity={refreshContacts} />}
      </div>

      <style>{`@keyframes mc-spin{to{transform:rotate(360deg)}} .mc-spin{animation:mc-spin 0.9s linear infinite}`}</style>
    </div>
  );
}
