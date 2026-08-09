# API Documentation — Vance (Document Parsing + Trip Assistant)

All routes live in `backend/routes/vance.js` and are mounted under the app's
`/api` base. Auth is a Bearer JWT: `Authorization: Bearer <token>`.

- **`signed-in`** = requires a valid token (`requireAuth`) → `401` if missing/invalid.
- **`manageDelegates`** = requires that permission (`requirePermission`) → `403` if lacking it (and `401` if not signed in).

Trip ids: endpoints that take a `tripId` accept **either** the legacy string id
(`t-1`) **or** the trip's `uuid_id` (what `GET /api/all-trips` returns). Both are
resolved by `resolveTripUuid()`; an id that matches no trip resolves to “no trip”.

---

## 1. Document parsing

### `POST /api/documents/parse-async`
Start a **background** parse job (a large directory takes minutes on local
Ollama). Returns a job id to poll. Auth: `manageDelegates`.

Query: `?name=<filename>&type=<mime>`. Body: the **raw file bytes** (PDF or
image), `Content-Type` = the file's mime type.

```
POST /api/documents/parse-async?name=Delegation-2pages.pdf&type=application/pdf
Content-Type: application/pdf
Authorization: Bearer <token>
<binary pdf bytes>
```
**202 Accepted**
```json
{ "jobId": "3f8c1e2a-..." }
```
Errors: `400 NO_FILE` (empty body), `415 UNSUPPORTED_TYPE` (not PDF/image).

### `GET /api/documents/parse-async/:id`
Poll a parse job; rows stream in as pages are read. Auth: `signed-in` (only the
job's creator may read it, else `404`).

**200 OK**
```json
{
  "status": "running",          // running | done | error
  "done": 2, "total": 4,        // pages processed / total
  "method": "text/ollama",      // text/ollama | text/anthropic | vision/anthropic | ocr/tesseract
  "rows": [
    { "id": "file-0", "fullName": "Chew Kam Swee", "company": "K.S. Chew & Co",
      "role": "Director", "email": null, "confidence": 0.93, "needsReview": false }
  ],
  "error": null
}
```
Errors: `404 NOT_FOUND` (unknown/expired job, or not the owner).

### `POST /api/trips/:id/onboarding/confirm`
Commit reviewed rows into the shared `delegates` table; mints a unique `qr_code`
for each and assigns the trip + optional coach. Auth: `manageDelegates`.

```
POST /api/trips/t-1/onboarding/confirm
Content-Type: application/json
```
```json
{
  "rows": [
    { "fullName": "Chew Kam Swee", "company": "K.S. Chew & Co", "role": "Director",
      "email": "cks@example.com", "vip": true, "coachId": "c1" },
    { "fullName": "jq" }
  ]
}
```
**201 Created** — a coach assignment makes the delegate `MISSING` (expected on a
coach), otherwise `UNASSIGNED`. Junk rows (see `isPlausibleDelegate`) are skipped
and counted in `skippedInvalid`.
```json
{ "added": 1, "skippedInvalid": 1, "delegates": [ { "id": "...", "name": "Chew Kam Swee" } ] }
```
Errors: `400 NO_ROWS` (empty `rows`), `404 UNKNOWN_TRIP` (trip id resolves to no
trip — prevents silently orphaning delegates).

### `GET /api/onboarding/context`
Existing delegate names (for duplicate detection) + the trip's coaches (for the
per-row coach dropdown). Auth: `signed-in`. Query: `?tripId=<id>` (optional; omit
for all delegates).

**200 OK**
```json
{ "existingNames": ["Chew Kam Swee", "Dane Soh"],
  "coaches": [ { "id": "c1", "label": "C1", "name": "Coach 1", "city": "Beijing" } ] }
```

### `POST /api/documents/parse` *(synchronous, legacy)*
One-shot parse used before the async job flow. Same request shape as
`parse-async`; returns `{ rows, totalCount, method }`. Auth: `manageDelegates`.
Errors: `400 NO_FILE`, `415 UNSUPPORTED_TYPE`, `503 AI_NOT_CONFIGURED` (no Ollama
and no Claude key), `422 PARSE_FAILED`, `502 AI_SERVICE_ERROR`.

---

## 2. QR boarding passes & check-in ⭐ shared contract

### `GET /api/onboarding/badges`
Delegates with their `qr_code` for the printable passes; backfills a code for any
delegate that lacks one. Auth: `signed-in`. Query: `?tripId=<id>`.

**200 OK**
```json
{
  "delegates": [ { "id": "...", "name": "Chew Kam Swee", "company": "K.S. Chew & Co",
                   "role": "Director", "industry": "Finance & Insurance",
                   "coach_id": "c1", "status": "PRESENT", "vip": false, "qr_code": "MG-86B620A4" } ],
  "coaches": [ { "id": "c1", "name": "Coach 1", "city": "Beijing" } ],
  "total": 33, "present": 8
}
```
The **branded QR** (company monogram in the QR centre) and the company **logo chip /
industry tag** on the badge are generated **client-side** in `BoardingPassesView.jsx`
from `company` + `industry` — no extra endpoint. `role`/`industry` were added to this
payload to drive the badge.

### `POST /api/onboarding/checkin` ⭐
Resolve a scanned `qr_code` → mark the delegate `PRESENT` (+coach), log the scan.
**Consumed by Jayden's on-site scanner — do not remove.** Auth: `signed-in`.
```json
{ "code": "MG-86B620A4", "tripId": "t-1", "coachId": "c2" }
```
**200 OK** — the trip is resolved from the delegate's own record, so a mistyped
`tripId` can't file a check-in against the wrong trip. `coachId` is an optional
override.
```json
{ "ok": true, "alreadyBoarded": false,
  "delegate": { "id": "...", "name": "Chew Kam Swee", "coachId": "c2" },
  "total": 33, "present": 9 }
```
Errors: `400 NO_CODE` (missing code), `404 UNKNOWN_CODE` (badge not recognised).

---

## 3. Trip Assistant (chatbot)

Snapshot-grounded answers over live cross-team data. Common factual questions are
answered **instantly and deterministically** (`source: "local"`, no model call);
open-ended and Chinese questions go to the LLM (Ollama-first, Claude fallback).

### `POST /api/chat/messages` *(stateless — mobile)*
Auth: `signed-in`.
```json
{ "messages": [ { "role": "user", "content": "how many are missing?" } ], "lang": "en" }
```
**200 OK** — `source` is `local` (fast-path), `ollama`, `anthropic`, `none`, or
`unavailable` (no AI text engine reachable — the fast-path still answers common
factual questions; open-ended ones return a graceful guidance message).
```json
{ "reply": { "content": "**20** delegates are missing (expected but not yet checked in)." }, "source": "local" }
```
Errors: `500/502/503 ASSISTANT_ERROR` (model unavailable/busy — message explains which).

### `POST /api/chat/sessions/:id/stream` *(SSE token streaming)*
Auth: `signed-in`. Body `{ "content": "...", "lang": "en" }`. Responds
`text/event-stream`; the fast-path emits the whole answer as one token event.
```
data: {"token":"**8** of **33** delegates are checked in — 20 still missing..."}
data: {"done":true,"title":"how many present?"}
```
On model failure a single `data: {"error":"..."}` event is sent. Errors before
streaming: `404 NOT_FOUND` (not your session), `400 EMPTY` (blank content).

### `POST /api/chat/sessions/:id/messages` *(non-streaming, saved)*
Auth: `signed-in`. Same body as `/stream`. Returns `{ reply:{content}, title, source }`.
Auto-titles a `New chat` from the first question. Errors: `404 NOT_FOUND`, `400 EMPTY`.

### `POST /api/chat/sessions/:id/regenerate` *(SSE)*
Drops the last assistant reply and re-answers the same question **via the model**
(never the fast-path, so it genuinely varies). Errors: `404 NOT_FOUND`,
`400 NOTHING_TO_REGENERATE`.

### Session management
| Method | Path | Body | Response | Errors |
| --- | --- | --- | --- | --- |
| `GET` | `/api/chat/sessions` | — | `{ sessions:[{id,title,updated_at,pinned,message_count}] }` | — |
| `POST` | `/api/chat/sessions` | — | `201 { id, title:"New chat", messages:[] }` | — |
| `GET` | `/api/chat/sessions/:id` | — | `{ id, title, messages:[{role,content}] }` | `404 NOT_FOUND` |
| `PATCH` | `/api/chat/sessions/:id` | `{ title?, pinned? }` | `{ id, title, pinned }` | `404 NOT_FOUND`, `400 NOTHING_TO_UPDATE` |
| `DELETE` | `/api/chat/sessions/:id` | — | `{ deleted: true }` | `404 NOT_FOUND` |
| `GET` | `/api/assistant/roster` | — | `{ delegates:[{name,company,role,industry,status,vip,coach,coach_city}] }` | — |
| `GET` | `/api/assistant/pulse` | — | `{ trip:{name,dayOf,totalDays,departsIn}, kpis:{total,present,missing,unassigned}, risk:[{level,text}], asOf }` — powers the live header widget | — |

---

## 4. MusterChat — messaging, calls & groups

WhatsApp-style inbox beside the assistant. All `signed-in`. Messages persist in
`dm_messages`; near-real-time via polling. See
[database-schema.md](database-schema.md) for the tables.

### Messaging
| Method | Path | Body / Query | Response |
| --- | --- | --- | --- |
| `GET` | `/api/messages/contacts` | — | `{ me, contacts:[{kind,id,name,online,lastMessage,lastAt,lastMine,unread,subtitle}] }` |
| `GET` | `/api/messages/thread` | `?peerKind=&peerId=` | `{ peer, messages:[{id,kind,body,media,at,mine,read,edited,deleted}] }` (auto-marks read) |
| `POST` | `/api/messages/thread` | `{ peerKind, peerId, kind, body?, media? }` | `{ message }` — `kind` ∈ `text\|sticker\|video\|doc\|call` |
| `PATCH` | `/api/messages/:id` | `{ body }` | `{ ok, id, body, edited:true }` — **sender-only** text edit |
| `DELETE` | `/api/messages/:id` | — | `{ ok, id, deleted:true }` — **sender-only** soft-delete (blanks `body`/`media`) |
| `GET` | `/api/messages/updates` | `?since=ISO` | `{ now, unread, incoming:[{id,convoKey,senderId,kind,preview,at}] }` |
| `POST` | `/api/messages/read` | `{ peerKind, peerId }` | `{ ok }` |

`edit`/`delete` are keyed by **message id**, so the same two endpoints serve DMs and
groups. Errors: `403 NOT_YOURS` (not the sender), `404 NO_MESSAGE`, `400 NOT_EDITABLE`
(non-text edit), `409 DELETED` (editing a deleted message).

### Calls — WebRTC signaling relay (staff↔staff)
Real peer-to-peer audio/video (1:1 **and** group mesh) over a DB relay + public STUN;
no media server. `callManager` (frontend) drives it; `VideoCallOverlay` renders it.

| Method | Path | Body / Query | Response |
| --- | --- | --- | --- |
| `POST` | `/api/calls/signal` | `{ callId, toId, kind, payload?, mode? }` | `{ ok }` — `kind` ∈ `invite\|offer\|answer\|ice\|reject\|hangup\|busy` (1:1) or `ginvite\|gjoin\|gpresence\|gleave` (group mesh) |
| `GET` | `/api/calls/poll` | `?since=ISO` | `{ now, meId, signals:[{id,callId,fromId,fromName,kind,payload,mode,at}] }` |

`meId` (your account id) is returned so the client can order mesh offers
deterministically (smaller id offers → no glare). Errors: `400 BAD_SIGNAL`, `404 NO_PEER`.

### Groups
| Method | Path | Body | Response |
| --- | --- | --- | --- |
| `POST` | `/api/groups` | `{ name, memberIds:[] }` | `{ group:{id,name,memberCount} }` — creator auto-added; needs ≥2 members |
| `GET` | `/api/groups` | — | `{ groups:[{id,name,memberCount,lastMessage,lastAt,lastMine}] }` |
| `GET` | `/api/groups/:id/thread` | — | `{ group, messages:[{...,sender}] }` (403 `NOT_MEMBER`) |
| `POST` | `/api/groups/:id/messages` | `{ kind, body?, media? }` | `{ message }` |
| `GET` | `/api/groups/:id/members` | — | `{ members:[{id,name}] }` |

Group messages reuse `dm_messages` with `convo_key = 'g:<id>'`. Errors:
`400 NO_NAME`/`TOO_FEW`, `403 NOT_MEMBER`, `404 NO_GROUP`.

---

## Common error shape

Every error is JSON: `{ "error": "<CODE>", "message": "<human-readable>" }`.

| Status | When |
| --- | --- |
| `400` | Bad input — `NO_FILE`, `NO_ROWS`, `NO_CODE`, `EMPTY`, `NOTHING_TO_UPDATE`, `NOTHING_TO_REGENERATE`. |
| `401` | Not signed in (missing/invalid token). |
| `403` | Signed in but lacking `manageDelegates`. |
| `404` | `NOT_FOUND`, `UNKNOWN_TRIP`, `UNKNOWN_CODE`. |
| `415` | `UNSUPPORTED_TYPE` (not a PDF or image). |
| `422` | `PARSE_FAILED` (document couldn't be read into delegates). |
| `502` | `AI_SERVICE_ERROR` / assistant upstream failure. |
| `503` | `AI_NOT_CONFIGURED` / assistant busy. |
