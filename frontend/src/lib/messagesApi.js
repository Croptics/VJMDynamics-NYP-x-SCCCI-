/* =============================================================================
 *  OWNED BY:  Vance — MusterChat (person-to-person messaging layer that lives
 *  beside the AI Trip Assistant in one inbox). Thin wrappers over the
 *  /api/messages/* routes in backend/routes/vance.js.
 * ============================================================================= */
import { apiGet, apiPost, apiPatch, apiDelete } from "./api.js";

/** Everyone I can message (staff + delegates), with last-message preview,
 *  unread count and presence; most-recent conversations first. */
export const listContacts = () => apiGet("/messages/contacts");

/** Full message history with one peer (auto-marks their messages read). */
export const getThread = (peerKind, peerId) =>
  apiGet(`/messages/thread?peerKind=${encodeURIComponent(peerKind)}&peerId=${encodeURIComponent(peerId)}`);

/** Send a message. kind: "text" | "video" | "doc" | "call".
 *  body = text/caption; media = data URL (video clip) or JSON (doc / call). */
export const sendMessage = (peerKind, peerId, { kind = "text", body = null, media = null }) =>
  apiPost("/messages/thread", { peerKind, peerId, kind, body, media });

/** Poll for messages addressed to me since a timestamp + my total unread. */
export const pollUpdates = (sinceIso) =>
  apiGet(`/messages/updates${sinceIso ? `?since=${encodeURIComponent(sinceIso)}` : ""}`);

/** Mark a whole thread read. */
export const markThreadRead = (peerKind, peerId) =>
  apiPost("/messages/read", { peerKind, peerId });

/** Edit / delete a message by id (works for DMs and groups; sender-only). */
export const editMessage = (id, body) => apiPatch(`/messages/${id}`, { body });
export const deleteMessage = (id) => apiDelete(`/messages/${id}`);

/* ---- Group chats -------------------------------------------------------- */
export const listGroups = () => apiGet("/groups");
export const createGroup = (name, memberIds) => apiPost("/groups", { name, memberIds });
export const getGroupThread = (id) => apiGet(`/groups/${id}/thread`);
export const sendGroupMessage = (id, { kind = "text", body = null, media = null }) =>
  apiPost(`/groups/${id}/messages`, { kind, body, media });
export const getGroupMembers = (id) => apiGet(`/groups/${id}/members`);
