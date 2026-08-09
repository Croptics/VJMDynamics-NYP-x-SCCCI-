# API Documentation — Jayden (Exception Logging, Critical Alerts & QR Fallback)

All endpoints below live in `backend/routes/exceptions.js` and are mounted in
the teammate zone of `server.js`. They are the ten routes I own.

**Base URL** — same origin as the app; the frontend calls `/api/...` and the
dev server proxies to the Express backend on port 4000.

**Authentication** — every route requires a signed-in account. The bearer token
issued at login goes in the `Authorization` header:

```
Authorization: Bearer <jwt>
```

**Authorisation** — two levels, deliberately different:

| Level | Routes | Reasoning |
| --- | --- | --- |
| `requireAuth()` — any signed-in staff | all reads, the SSE stream, and QR check-in | Anyone should be able to *see* the inbox and receive critical alerts. A QR scan is a primary field check-in, exactly like a face scan, so it uses the same level rather than the elevated one. |
| `requirePermission("manageExceptions")` | create, update, delete, manual override, undo | Raising, closing or overriding attendance changes the record, so it is gated. A viewer sees the inbox read-only instead of buttons that would 403. |

**Error shape** — every failure returns a machine-readable code plus a message
safe to show a user:

```json
{ "error": "ALREADY_RESOLVED", "message": "That ticket is already resolved." }
```

**Ticket object** — returned by every ticket endpoint:

```json
{
  "id": "76f00f5c-f53a-44c3-a0b3-303f86982683",
  "type": "MISSING_PERSON",
  "typeOther": null,
  "priority": "CRITICAL",
  "status": "OPEN",
  "note": "Not boarded · departure imminent. Last seen near gift shop 14:08.",
  "delegateId": "d-1",
  "delegateName": "Lim Wei Jie",
  "delegateVip": false,
  "delegateStatus": "MISSING",
  "coach": "Coach 2",
  "raisedBy": "Staff 194",
  "resolvedBy": null,
  "createdAt": "2026-07-30T10:00:00.000Z",
  "resolvedAt": null
}
```

`delegateStatus` is the linked delegate's *live* attendance status, joined in at
read time. The inbox uses it to decide whether the manual **Override** action
still has anything to do; without it the UI would offer an override on someone
already boarded.

---

## 1. GET `/api/trips/:id/exceptions`

List a trip's tickets with counts. Any signed-in staff.

**Query parameters** (both optional)

| Name | Values | Effect |
| --- | --- | --- |
| `status` | `OPEN` \| `RESOLVED` | Only tickets in that state |
| `priority` | `CRITICAL` \| `NORMAL` \| `LOW` | Only tickets at that priority |

**Request**
```http
GET /api/trips/t-1/exceptions?status=OPEN
Authorization: Bearer <jwt>
```

**Response `200`**
```json
{
  "tickets": [ /* ticket objects, see above */ ],
  "counts": { "all": 8, "critical": 3, "open": 2, "resolved": 6, "criticalOpen": 1 }
}
```

Tickets are ordered critical first, then newest first, so the most urgent row is
always at the top regardless of when it was raised.

`counts` always describes the **whole trip**, not the filtered slice — the
summary tiles and tab badges need trip-wide totals even when a filter is
applied. The inbox screens therefore call this once unfiltered and slice
client-side.

**Errors** — `401` not signed in.

---

## 2. GET `/api/trips/:id/exceptions/critical-count`

Cheap count of unresolved critical tickets, for the sidebar badge. Any signed-in
staff.

Exists so the sidebar can stay accurate without pulling the entire ticket list
on every page.

**Response `200`**
```json
{ "criticalOpen": 1 }
```

---

## 3. GET `/api/exceptions/:id`

A single ticket. Any signed-in staff.

**Response `200`** — one ticket object.

**Errors** — `404 NOT_FOUND`.

---

## 4. GET `/api/exceptions/stream`

Server-Sent Events stream of live ticket activity. Any signed-in staff.

`EventSource` cannot set an `Authorization` header, so this route also accepts
the token as a query parameter:

```http
GET /api/exceptions/stream?token=<jwt>
```

SSE was chosen over WebSockets because it is ordinary HTTP — it survives
restrictive proxies and needs no additional dependency.

**Events**

| Event | Payload | Raised when |
| --- | --- | --- |
| `ready` | `{}` | Stream established (drives the **Live** indicator) |
| `exception:created` | ticket | A non-critical ticket is raised |
| `exception:critical` | ticket | A critical ticket is raised **or escalated** — this is what makes every device show the red banner |
| `exception:updated` | ticket | Resolved, escalated or edited |
| `exception:deleted` | `{ id }` | Ticket removed |
| `attendance:override` | `{ delegateId, name, method }` | A manual override, its undo, or a QR check-in changed a delegate's attendance |

**Example frame**
```
event: exception:critical
data: {"id":"76f0…","priority":"CRITICAL","delegateName":"Lim Wei Jie", …}
```

---

## 5. POST `/api/trips/:id/exceptions`

Raise a ticket. Needs `manageExceptions`.

**Request body**
```json
{
  "type": "MISSING_PERSON",
  "typeOther": null,
  "delegateId": "d-1",
  "coachId": "c2",
  "note": "Not boarded · departure imminent.",
  "priority": "CRITICAL",
  "clientEventId": "3f1c9e64-2b7a-4a19-9a6c-6d1b0f2f77ad"
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `type` | yes | One of `MISSING_PERSON`, `LOST_BADGE`, `FACE_MATCH_FAILED`, `DEAD_PHONE`, `VIP_REQUEST`, `OTHER` |
| `typeOther` | only when `type` is `OTHER` | Free-text label, max **20** characters |
| `delegateId` | no | Ticket may concern nobody in particular |
| `coachId` | no | Derived from the delegate when omitted |
| `note` | no | Free text |
| `priority` | no | Defaults to `NORMAL` |
| `clientEventId` | recommended | Idempotency key for offline retries |

**Response `201`** — the created ticket.

A `CRITICAL` ticket is broadcast as `exception:critical`; anything else as
`exception:created`.

**Response `200`** — the *original* ticket, with `"duplicate": true`, when a
`clientEventId` has already been seen. This is what makes an offline retry safe:
the same submission replayed twice creates one ticket, not two.

**Errors**

| Status | Code | Cause |
| --- | --- | --- |
| `400` | `TYPE_REQUIRED` | No issue type supplied |
| `400` | `INVALID_TYPE` | Type is not one of the six |
| `400` | `TYPE_OTHER_REQUIRED` | `OTHER` chosen with no label |
| `400` | `TYPE_OTHER_TOO_LONG` | Label over 20 characters |
| `404` | `TRIP_NOT_FOUND` | Unknown trip |
| `409` | `DELEGATE_ALREADY_HAS_OPEN_TICKET` | That delegate already has an open ticket — stops several staff each raising one for the same missing person |
| `403` | — | Missing `manageExceptions` |

---

## 6. PATCH `/api/exceptions/:id`

Resolve, escalate or edit an open ticket. Needs `manageExceptions`.

**Resolve**
```json
{ "status": "RESOLVED" }
```
Stamps `resolved_at` and `resolved_by` from the calling account. Guarded so only
an `OPEN` ticket can be resolved — a second attempt returns `409
ALREADY_RESOLVED` rather than quietly overwriting who resolved it first.

**Escalate**
```json
{ "priority": "CRITICAL" }
```
Broadcast as `exception:critical`, so escalating an existing ticket alerts every
device exactly as raising one does.

**Edit the note**
```json
{ "note": "Found at gate B." }
```

**Response `200`** — the updated ticket.

**Errors**

| Status | Code | Cause |
| --- | --- | --- |
| `400` | `INVALID_PRIORITY` | Priority not one of the three |
| `400` | `NO_FIELDS` | Body contained nothing to update |
| `409` | `ALREADY_RESOLVED` | Ticket was already resolved |
| `409` | `CONFLICT` | Ticket is not open, or does not exist |

---

## 7. DELETE `/api/exceptions/:id`

Remove a ticket raised in error. Needs `manageExceptions`.

**Response `200`**
```json
{ "deleted": true, "id": "76f00f5c-…" }
```

Distinct from resolving: delete is for tickets that should never have existed.
Resolved tickets are kept deliberately — they are what average resolve time and
the CSV export are computed from.

**Errors** — `404 NOT_FOUND`.

---

## 8. POST `/api/checkins/manual`

Manual attendance override — count a delegate present without a scan. Needs
`manageExceptions`.

This is the fallback path for a delegate who is physically present but cannot be
scanned: lost badge, failed face match, dead phone.

**Request body**
```json
{
  "tripId": "t-1",
  "delegateId": "d-1",
  "clientEventId": "8c2e…",
  "clientTs": "2026-07-30T10:12:04.000Z"
}
```

**Response `201`**
```json
{ "id": "…", "delegateId": "d-1", "status": "ARRIVED", "duplicate": false, "method": "MANUAL" }
```

Side effects: the delegate is marked checked in, their previous status is stored
in `check_in_logs.prev_status` so the action can be undone, a `MANUAL` row is
written recording who did it, and `attendance:override` is broadcast so every
head-count on every screen agrees.

**Response `200`** with `"duplicate": true` when the `clientEventId` has already
been recorded — an offline replay applies exactly once.

**Errors** — `400 MISSING_FIELDS`, `404 NOT_FOUND` (unknown delegate), `403`.

---

## 9. POST `/api/checkins/manual/undo`

Reverse a manual override. Needs `manageExceptions`.

**Request body**
```json
{ "delegateId": "d-1" }
```

Restores the delegate's status from the `prev_status` recorded on the most
recent manual check-in, rather than guessing a value. Broadcasts
`attendance:override` with `method: "MANUAL_UNDO"`.

**Errors** — `400 MISSING_FIELDS`, `404 NOT_FOUND`.

---

## 10. POST `/api/checkins/qr`

Register a check-in from a scanned delegate badge. **Any signed-in staff** —
deliberately not gated on `manageExceptions`, because a QR scan is a primary
field check-in exactly like a face scan, not an administrative override.

**Request body**
```json
{
  "tripId": "t-1",
  "delegateId": "d-1",
  "coachId": "c2",
  "clientEventId": "b41f…",
  "clientTs": "2026-07-30T10:14:31.000Z"
}
```

**Response `201`**
```json
{ "id": "…", "delegateId": "d-1", "name": "Lim Wei Jie", "status": "ARRIVED", "duplicate": false, "method": "QR" }
```

Writes a `QR` row to `check_in_logs`, marks the delegate checked in, and
broadcasts `attendance:override` so the dashboard head-count and the reverse
head-count agree. Idempotent on `clientEventId`.

**Errors** — `400 MISSING_FIELDS`, `404 NOT_FOUND`, `401`.

---

## Note on badge formats

The scanner accepts two kinds of QR badge:

1. **Self-describing MusterGo badge** — carries the delegate inline:
   ```json
   {"sys":"MUSTERGO","v":1,"typ":"DELEGATE_BADGE","tripId":"t-1","delegateId":"d-1","name":"Lim Wei Jie"}
   ```
   Validated in the browser and sent to `POST /api/checkins/qr` above.

2. **Boarding pass** (generated on the Documents screen) — encodes only an
   opaque code such as `MG-A1B2C3D4`. That code is meaningless client-side, so
   it is sent to the onboarding module's own check-in endpoint, which owns the
   `qr_code → delegate` lookup.

Both paths end with the delegate checked in and a `QR` row in `check_in_logs`.
Anything else scanned is rejected as an invalid badge.
