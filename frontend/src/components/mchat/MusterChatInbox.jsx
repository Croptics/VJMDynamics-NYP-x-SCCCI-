/* =============================================================================
 *  OWNED BY:  Vance — the MusterChat inbox body (contact rail + AI/human/group
 *  conversation pane). Shared by the /assistant page and the floating ChatBubble
 *  so both render the exact same full inbox — no duplication.
 * ============================================================================= */
import { useState, useEffect, useCallback } from "react";
import { Search, Bot, Users, Plus, X, Check } from "lucide-react";
import { useLang } from "../../lib/i18n.jsx";
import { listContacts, listGroups, createGroup } from "../../lib/messagesApi.js";
import AssistantConversation from "./AssistantConversation.jsx";
import HumanThread from "./HumanThread.jsx";
import GroupThread from "./GroupThread.jsx";
import VideoCallOverlay from "./VideoCallOverlay.jsx";
import callManager from "../../lib/callManager.js";

const initialsOf = (n) => (n || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const hhmm = (iso) => { try { return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };

const AI = { kind: "ai", id: "assistant", name: "Trip Assistant" };

export default function MusterChatInbox({ railWidth = 300 }) {
  const { t } = useLang();
  const [contacts, setContacts] = useState([]);
  const [groups, setGroups] = useState([]);
  const [active, setActive] = useState(AI);
  const [filter, setFilter] = useState("");
  const [failed, setFailed] = useState(false);
  // Create-group modal
  const [newOpen, setNewOpen] = useState(false);
  const [gName, setGName] = useState("");
  const [gMembers, setGMembers] = useState(() => new Set());
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [c, g] = await Promise.all([listContacts(), listGroups()]);
      setContacts(c.contacts || []); setGroups(g.groups || []); setFailed(false);
    } catch { setFailed(true); }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  // Start the incoming-call / signaling poll so calls ring here too (the global
  // ChatBubble also does this; startGlobalPoll is idempotent).
  useEffect(() => { callManager.startGlobalPoll(); }, []);

  const isActive = (kind, id) => active.kind === kind && active.id === id;
  const visible = contacts.filter((c) => c.name.toLowerCase().includes(filter.toLowerCase()));
  const staff = contacts.filter((c) => c.kind === "account");

  const rowStyle = (on) => ({
    cursor: "pointer",
    background: on ? "var(--scc-red-tint)" : "transparent",
    border: `1px solid ${on ? "var(--scc-red)" : "transparent"}`,
    borderRadius: 12, padding: "10px 12px", marginBottom: 4,
    display: "flex", alignItems: "center", gap: 10,
  });

  const toggleMember = (id) => setGMembers((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  async function submitGroup() {
    const name = gName.trim();
    if (!name || gMembers.size === 0 || creating) return;
    setCreating(true);
    try {
      const { group } = await createGroup(name, [...gMembers]);
      setNewOpen(false); setGName(""); setGMembers(new Set());
      await refresh();
      setActive({ kind: "group", id: group.id, name: group.name, memberCount: group.memberCount });
    } catch { /* keep modal open */ } finally { setCreating(false); }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: `${railWidth}px 1fr`, gap: 16, minHeight: 0 }}>
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

        {/* Groups */}
        <div className="row between" style={{ padding: "14px 8px 6px" }}>
          <div className="page-eyebrow" style={{ display: "flex", alignItems: "center", gap: 6 }}><Users size={12} /> {t("Groups")}</div>
          <span role="button" title={t("New group")} onClick={() => setNewOpen(true)} style={{ cursor: "pointer", color: "var(--scc-red)", display: "flex" }}><Plus size={16} /></span>
        </div>
        {groups.filter((g) => g.name.toLowerCase().includes(filter.toLowerCase())).map((g) => {
          const on = isActive("group", g.id);
          return (
            <div key={`group:${g.id}`} onClick={() => setActive({ kind: "group", id: g.id, name: g.name, memberCount: g.memberCount })} style={rowStyle(on)}>
              <span className="avatar" style={{ background: "var(--scc-red)", color: "#fff", flexShrink: 0 }}><Users size={15} /></span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="row between" style={{ gap: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</div>
                  {g.lastAt && <div className="muted" style={{ fontSize: 10.5, flexShrink: 0 }}>{hhmm(g.lastAt)}</div>}
                </div>
                <div className="muted" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {g.lastMessage ? `${g.lastMine ? "You: " : ""}${g.lastMessage}` : `${g.memberCount} members`}
                </div>
              </div>
            </div>
          );
        })}
        {groups.length === 0 && <div className="muted" style={{ fontSize: 12, padding: "2px 8px 4px" }}>{t("No groups yet.")}</div>}

        {/* People */}
        <div className="page-eyebrow" style={{ padding: "14px 8px 6px", display: "flex", alignItems: "center", gap: 6 }}>
          <Users size={12} /> {t("People")}
        </div>
        {failed && <div className="muted" style={{ fontSize: 12, padding: "4px 8px" }}>{t("Couldn't load contacts.")}</div>}
        {!failed && visible.length === 0 && <div className="muted" style={{ fontSize: 12, padding: "4px 8px" }}>{t("No contacts found.")}</div>}
        {visible.map((c) => {
          const on = isActive(c.kind, c.id);
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
      {active.kind === "ai" ? <AssistantConversation />
        : active.kind === "group" ? <GroupThread key={`group:${active.id}`} group={active} onActivity={refresh} />
        : <HumanThread key={`${active.kind}:${active.id}`} peer={active} onActivity={refresh} />}

      {/* New-group modal */}
      {newOpen && (
        <div onClick={() => setNewOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70 }}>
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ padding: 0, width: 380, maxWidth: "92%", maxHeight: "80vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div className="row between" style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
              <div style={{ fontWeight: 700 }}>{t("New group")}</div>
              <span role="button" onClick={() => setNewOpen(false)} style={{ cursor: "pointer", color: "var(--ink-3)", display: "flex" }}><X size={18} /></span>
            </div>
            <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
              <input className="input" autoFocus placeholder={t("Group name")} value={gName} onChange={(e) => setGName(e.target.value)} />
              <div className="page-eyebrow" style={{ padding: 0 }}>{t("Add members")}</div>
              <div style={{ overflowY: "auto", display: "grid", gap: 4, maxHeight: 260 }}>
                {staff.length === 0 && <div className="muted" style={{ fontSize: 12 }}>{t("No teammates to add.")}</div>}
                {staff.map((c) => {
                  const checked = gMembers.has(c.id);
                  return (
                    <div key={c.id} onClick={() => toggleMember(c.id)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, background: checked ? "var(--scc-red-tint)" : "transparent" }}>
                      <span className="avatar" style={{ background: "var(--scc-red)", color: "#fff" }}>{initialsOf(c.name)}</span>
                      <div style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{c.name}</div>
                      <span style={{ width: 20, height: 20, borderRadius: 6, border: `1.5px solid ${checked ? "var(--scc-red)" : "var(--line)"}`, background: checked ? "var(--scc-red)" : "transparent", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {checked && <Check size={13} />}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="row" style={{ gap: 8, padding: 12, borderTop: "1px solid var(--line)" }}>
              <button className="btn btn-ghost btn-block" onClick={() => setNewOpen(false)}>{t("Cancel")}</button>
              <button className="btn btn-primary btn-block" disabled={!gName.trim() || gMembers.size === 0 || creating} onClick={submitGroup}>
                {creating ? t("Creating…") : `${t("Create")} (${gMembers.size})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live call screen (ringing / in-call) — fixed overlay, renders above all */}
      <VideoCallOverlay />

      <style>{`@keyframes mc-spin{to{transform:rotate(360deg)}} .mc-spin{animation:mc-spin 0.9s linear infinite}`}</style>
    </div>
  );
}
