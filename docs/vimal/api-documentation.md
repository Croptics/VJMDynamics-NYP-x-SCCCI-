# API Documentation — Vimal (FaceCheck-Pro)

Every endpoint I own lives in `backend/routes/facescan.js`, mounted in the
TEAMMATE ZONE of `server.js`. Two prefixes:

- `/api/attendance/*` — biometric check-in, headcount, consent, resets
- `/api/enroll/*` — delegate self-enrolment, invites, coverage, erasure

Base URL: `http://localhost:4000` locally, `https://mustergo.duckdns.org` live.
JSON in, JSON out. Errors are always `{ "error": "CODE", "message": "human text" }`.

## Authentication

| Marker | Meaning |
| --- | --- |
| 🔒 **Auth** | `Authorization: Bearer <jwt>` required (`requireAuth`). |
| 🔑 **Permission** | Requires a permission, or the passwordless kiosk token. |
| 🌐 **Public** | No token required — the delegate self-service surface. A staff token is *optionally* read to scope results and reveal staff-only fields. |

Shared failure responses, not repeated per endpoint: `401 UNAUTHORIZED` (missing
or invalid token), `403 FORBIDDEN` (lacks the permission), `500` (unexpected —
handled centrally so a client never hangs).

## Biometric tokens

Every biometric value crossing the wire is a token string, never an image or
audio clip:

```
face:v3:<hex integrity hash>:<comma-separated floats>    # deep face embedding (~1024)
face:v2:<hex integrity hash>:<dot-separated integers>    # legacy descriptor (~40), still accepted
voice:v2:<hex integrity hash>:<64 floats>                # FFT voiceprint
voice:v1:<hex hash>:<length>                             # typed-passphrase fallback (a shared secret)
```

Anything not matching `^(face|voice):v\d+:[0-9a-f]+:` is rejected before any
matching or storage happens.

---

## Attendance

### `GET /api/attendance/coaches` 🔒
Coach picker for the mobile scanner: trip meta plus live counts per coach.

| Query | Type | Notes |
| --- | --- | --- |
| `tripId` | string | Optional. `"t-1"` or a uuid. Omit for the base trip. |

**200**
```json
{
  "trip": { "id": "t-1", "name": "SCCCI Delegation to Chengdu", "dayOf": 2,
            "totalDays": 5, "localTime": "14:26", "departsIn": "35m", "lead": "Vance Wang" },
  "unassigned": 29,
  "coaches": [
    { "id": "c1", "label": "Coach 1", "name": "Coach 1 — Orchard",
      "city": "Chengdu", "capacity": 30, "boarded": 18, "missing": 5, "total": 23 }
  ]
}
```
Coach-captain scoped: a captain sees only their own coaches.

---

### `POST /api/attendance/scan` 🔑 `manageScanner` *or kiosk token*
The core check-in. Matches a face/voice token against enrolled delegates and
boards the winner.

**Request**
```json
{
  "tripId": "t-1",
  "scanData": "face:v3:9c2af1:0.0132,-0.0871,…",
  "timestamp": "2026-08-09T14:26:31.000Z",
  "coachId": "c2"
}
```
`coachId` is optional and scopes the check-in to the coach being mustered.

**200 — matched and boarded**
```json
{ "delegateId": "d-118", "name": "Wesley Wong", "status": "PRESENT",
  "method": "FACE", "processedInMs": 412 }
```

| Code | `error` | When |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | `tripId` missing or blank. |
| 400 | `INVALID_SCAN` | Face token carried no usable vector (too dark, no face). |
| 404 | `SCAN_FAILED` | Malformed token, **or** nothing scored above threshold — an un-enrolled face, a stranger, or a delegate outside this account's trips. Never a guess. |
| 409 | `COACH_MISMATCH` | Recognised, but assigned to another coach. Body adds `delegateName`, `assignedCoachId`, `assignedCoachLabel`, `scannerCoachId`. |
| 409 | `ALREADY_BOARDED` | Recognised, right coach, already checked in. |

Matching rules: cosine similarity against every **consented and enrolled**
delegate. Deep `v3` embeddings are compared with raw cosine at a `0.55`
threshold; legacy descriptors mean-centred at `0.94`; voice at `0.75`, or exact
hash for a `v1` passphrase. Side effects on success: the shared delegate row
flips to boarded, a `checkin.scan` row is written to the trip audit trail, and
`"X checked in (Face)"` is written to the History Log.

---

### `GET /api/attendance/:trip_id/coach/:coach_id` 🔒
Reverse-headcount detail for one coach.

**200**
```json
{
  "tripId": "t-1", "coachId": "c2", "coachLabel": "Coach 2 — Marina",
  "trip": { "name": "…", "dayOf": 2, "totalDays": 5, "localTime": "14:26", "departsIn": "35m" },
  "location": "Chengdu", "departure": "departs in 35m",
  "expected": 25, "boarded": 20, "missing": 5,
  "delegates": [
    { "delegateId": "d-118", "name": "Wesley Wong", "initials": "WW", "vip": false,
      "status": "MISSING", "lastSeen": "Lobby · 14:02",
      "consent": "GRANTED", "enrolled": true }
  ]
}
```
`enrolled` lets the UI show who can actually be face/voice matched.
**404 `NOT_FOUND`** — unknown coach.

---

### `GET /api/attendance/headcount` 🔒
Stats plus the still-missing list, so one call powers both the hero card and the
call list.

| Query | Type | Notes |
| --- | --- | --- |
| `coachId` | string | Optional. Omit for the whole trip (excludes `UNASSIGNED`). |

**200**
```json
{
  "tripId": "t-1", "coachId": "c2",
  "stats": { "expected": 25, "boarded": 20, "missing": 5, "unassigned": 29 },
  "missingDelegates": [
    { "delegateId": "d-201", "name": "Lim Wei Jie", "initials": "LW", "vip": true,
      "coachId": "c2", "lastSeen": "VIP · last 14:08", "consent": "GRANTED" }
  ]
}
```
**404 `NOT_FOUND`** — unknown `coachId`.

---

### `POST /api/attendance/consent` 🔒
Staff-side consent lifecycle, with full auditable history.

**Request**
```json
{ "delegateId": "d-118", "consent": "GRANTED", "method": "staff-app",
  "biometricToken": "face:v3:9c2af1:…" }
```
`biometricToken` is optional; supplying it with `GRANTED` enrols that sample.

**200**
```json
{ "delegateId": "d-118", "status": "GRANTED", "method": "staff-app",
  "biometricTokenStored": true, "updatedAt": "2026-08-09T06:31:02.114Z",
  "history": [ { "status": "GRANTED", "method": "onboarding-form", "at": "…" } ] }
```

| Code | `error` | When |
| --- | --- | --- |
| 400 | `INVALID_CONSENT` | `consent` is not `GRANTED` or `REVOKED`. |
| 400 | `INVALID_BIOMETRIC_TOKEN` | Malformed or a placeholder (e.g. `deadbeef`). |
| 404 | `NOT_FOUND` | Unknown delegate. |

`REVOKED` **purges** the stored vectors (PDPA erasure) and hard-excludes the
delegate from all future matching.

---

### `GET /api/attendance/history/:delegate_id` 🔒
Check-in records for one delegate across venues.

**200**
```json
{ "delegateId": "d-118", "name": "Wesley Wong",
  "records": [ { "venue": "Coach 2 — Marina · Chengdu", "tripId": "t-1",
                 "method": "FACE", "matchedIn": "0.4s",
                 "timestamp": "2026-08-09T14:26:31.000Z" } ] }
```
**404 `NOT_FOUND`** — unknown delegate.

---

### `POST /api/attendance/assign-unassigned` 🔒
Muster prep: move `UNASSIGNED` delegates onto a coach as "expected, not yet
boarded", respecting capacity.

**Request** `{ "coachId": "c2", "limit": 10 }` (`limit` optional)
**200** `{ "assigned": 10, "coachId": "c2", "remainingUnassigned": 19 }`

| Code | `error` | When |
| --- | --- | --- |
| 404 | `NOT_FOUND` | Unknown coach. |
| 409 | `NO_UNASSIGNED` | Nobody to muster. |
| 409 | `COACH_FULL` | Coach at capacity. |

---

### `POST /api/attendance/reset` 🔒
Individual undo for multi-leg trips — one delegate back to not-yet-boarded.

**Request** `{ "delegateId": "d-118" }` · **200** `{ "delegateId": "d-118", "status": "MISSING" }`
**404 `NOT_FOUND`** — unknown delegate. Check-in history is retained.

---

### `POST /api/attendance/reset-coach` 🔒
Whole-coach undo in one tap, for starting a fresh headcount at the next venue.

**Request** `{ "coachId": "c2" }` · **200** `{ "reset": 20, "coachId": "c2" }`

| Code | `error` | When |
| --- | --- | --- |
| 404 | `NOT_FOUND` | Unknown coach. |
| 409 | `NOTHING_TO_RESET` | Nobody boarded on that coach yet. |

---

### `POST /api/attendance/demo-seed` 🔒
Demo convenience on an **empty** database only: inserts a small named roster.
Refuses to run if the coach already has delegates or unassigned delegates exist,
so it can never touch real data.

**Request** `{ "coachId": "c2" }` · **201** `{ "seeded": 10, "coachId": "c2" }`
Errors: `404 NOT_FOUND`, `409 COACH_NOT_EMPTY`, `409 USE_ASSIGN`.

---

## Enrolment

### `GET /api/enroll/lookup` 🌐 *(staff token optional)*
Find the record to enrol against. Returns minimal fields only.

| Query | Type | Notes |
| --- | --- | --- |
| `t` | string | Signed invite token from the email. Resolves to exactly one delegate. |
| `id` | string | Exact delegate id. |
| `name` | string | Name filter, 2+ characters. |
| `tripId` | string | Scope to one trip (used by the staff view). |

With none of these, returns the browsable roster (capped at 300, sorted by coach
then name).

**200**
```json
{ "matches": [
  { "delegateId": "d-118", "name": "Wesley Wong", "coachId": "c2",
    "coachLabel": "Coach 2 — Marina", "email": "wesley@example.com",
    "enrolled": { "face": true, "voice": false } } ] }
```
`email` is **omitted entirely** for anonymous callers — the route is public so
the magic link works with no account, and the roster's contact details must not
be harvestable. A signed-in coach captain is scoped to their own coaches.

**410 `INVITE_EXPIRED`** — the `t` token is expired or tampered with.

---

### `POST /api/enroll` 🌐
Store a delegate's own face and/or voice sample. At least one required.

**Request**
```json
{ "delegateId": "d-118",
  "faceToken": "face:v3:9c2af1:0.0132,…",
  "voiceToken": "voice:v2:41ba7:0.9,0.71,…" }
```

**200**
```json
{ "delegateId": "d-118", "name": "Wesley Wong",
  "enrolled": { "face": true, "voice": true, "voiceType": "acoustic" } }
```
`voiceType` is `"acoustic"` for a real voiceprint, `"passphrase"` for the v1
fallback.

| Code | `error` | When |
| --- | --- | --- |
| 400 | `NOTHING_TO_ENROLL` | Neither token supplied. |
| 400 | `INVALID_FACE_TOKEN` | Malformed, a placeholder, or too little detail. |
| 400 | `INVALID_VOICE_TOKEN` | Malformed or a placeholder. |
| 404 | `NOT_FOUND` | Unknown delegate. |

Sets consent to `GRANTED` and records a `self-enroll` history entry.

---

### `POST /api/enroll/verify` 🌐
Self-test. Scores a fresh sample against what is stored and reports the
similarity **without** touching attendance or the stored template.

**Request** `{ "delegateId": "d-118", "faceToken": "face:v3:…" }`
(or `voiceToken`)

**200** `{ "modality": "FACE", "similarity": 0.9871, "threshold": 0.55, "match": true }`

| Code | `error` | When |
| --- | --- | --- |
| 400 | `NOTHING_TO_VERIFY` / `INVALID_FACE_TOKEN` | No sample, or an unusable one. |
| 404 | `NOT_FOUND` | Unknown delegate. |
| 409 | `NOT_ENROLLED` | Nothing stored for this delegate / this modality. |

---

### `POST /api/enroll/revoke` 🌐
PDPA right to erasure. Purges the stored vectors and marks consent `REVOKED`.

**Request** `{ "delegateId": "d-118" }`
**200** `{ "delegateId": "d-118", "name": "Wesley Wong", "consent": "REVOKED", "erased": true }`
**404 `NOT_FOUND`** — unknown delegate.

---

### `GET /api/enroll/stats` 🌐 *(staff token optional)*
Coverage for the readiness panel.

| Query | Type | Notes |
| --- | --- | --- |
| `tripId` | string | Optional; omit for the all-trips total. |

**200** `{ "total": 42, "face": 34, "voice": 21, "enrolled": 36 }`
(`enrolled` = has face **or** voice.) Coach-captain scoped when signed in.

---

## Enrolment invites (email notification)

### `GET /api/enroll/invite/preview` 🔒
Render the invite **without sending**, so staff (and tests) see exactly what a
delegate would get.

| Query | Type | Notes |
| --- | --- | --- |
| `delegateId` | string | Required. |

**200**
```json
{ "delegateId": "d-118", "name": "Wesley Wong", "to": "wesley@example.com",
  "dryRun": false, "mailConfigured": true, "linkWarning": null,
  "subject": "Set up face check-in for SCCCI Delegation to Chengdu",
  "html": "<!doctype html>…", "text": "Hi Wesley Wong,…",
  "link": "https://mustergo.duckdns.org/enroll?t=<signed token>" }
```
**404 `NOT_FOUND`** — unknown delegate.

---

### `POST /api/enroll/invite` 🔒
Email one delegate their personal enrolment link (valid 14 days).

**Request** `{ "delegateId": "d-118", "email": "wesley@example.com" }`
`email` is optional; when supplied it is saved onto the delegate first, so staff
can fill in a missing address and invite in one action.

**200**
```json
{ "delegateId": "d-118", "name": "Wesley Wong", "sent": true, "dryRun": false,
  "to": "wesley@example.com", "subject": "Set up face check-in for …",
  "messageId": "<…@example.test>", "linkWarning": null }
```

| Code | `error` | When |
| --- | --- | --- |
| 400 | `NO_EMAIL` | No valid address on file and none supplied. |
| 404 | `NOT_FOUND` | Unknown delegate. |

With SMTP unconfigured or `MAIL_DRY_RUN=true`, nothing is transmitted and the
response reports `"sent": false, "dryRun": true`.

---

### `POST /api/enroll/invite-all` 🔒
Bulk invite. Defaults to only those not yet enrolled.

**Request** `{ "onlyMissing": true, "tripId": "t-1" }`

**200**
```json
{ "dryRun": false, "linkWarning": null,
  "considered": 8, "sent": 6, "previewed": 0, "failed": 0,
  "skippedNoEmail": [ { "delegateId": "d-207", "name": "Ng Soo Peng" } ],
  "results": [ { "delegateId": "d-118", "name": "Wesley Wong", "sent": true,
                 "dryRun": false, "to": "wesley@example.com", "subject": "…" } ] }
```
Sends run **sequentially** on purpose — a burst of parallel sends is what gets an
SMTP account rate-limited or flagged as spam — and never throw, so one bad
address can't abort the run. Trip- and coach-captain scoped.

`linkWarning` (on both invite endpoints) is non-null when `PUBLIC_APP_URL` is a
localhost/LAN/bare-IP address, i.e. the link in the email would be dead on
arrival. It warns rather than blocks, because emailing a LAN link to yourself on
the same wifi is a legitimate way to test.

---

## Endpoints I consume rather than own

| Endpoint | Owner | Why |
| --- | --- | --- |
| `POST /api/checkins/manual` | Jayden | The mobile manual check-in screen is a touch-first UI over Jayden's existing endpoint — no new backend surface. |
| `POST /api/checkins/qr` | Jayden | QR mode in the mobile scanner mounts his panel unmodified. |
| `listDelegates` / `updateDelegate` / `getDashboard` (`data.js`) | JQ | Scans write to the **shared** delegates table through JQ's helpers, so a face check-in shows up live on the dashboard, the Missing page and the coach boards. |
