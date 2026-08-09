# API Documentation — JQ (InsightMetrics)

The MusterGo base API: authentication, accounts and permissions, the dashboard,
delegates, history, checkpoints, escalations, announcements, export and media.

Source: `backend/routes/auth.js`, `accounts.js`, `announcements.js`, `media.js`,
`guideVideo.js` and `backend/routes/dashboard/*`, mounted in
`backend/server.js`.

Base URL: `http://localhost:4000` locally, `https://mustergo.duckdns.org` live.
JSON in, JSON out. Errors are always `{ "error": "CODE", "message": "human text" }`.

## Authentication

Send `Authorization: Bearer <jwt>` on every call except login, register,
reset-password and the public guide-video read.

The token embeds the username **and a session version**. Each login bumps that
version, so a token is valid only while it matches the stored one — signing in
on a new browser invalidates the old session. Clients poll
`GET /api/auth/session` every 15s and are logged out when it stops resolving.

### Permissions

Permissions are declared once in `frontend/src/lib/permissions.js` and imported
by **both** sides, so the checkbox, the chip and the backend's accepted key all
come from a single entry.

| Group | Keys |
| --- | --- |
| Action (backend-enforced) | `manageDelegates`, `exportData`, `viewDelegateDetails`, `manageTrips`, `manageDocuments`, `manageScanner`, `manageExceptions`, `manageAnnouncements`, `manageAccounts` |
| Desktop view (route gating) | `viewDashboard`, `viewDelegates`, `viewHistory`, `viewTrips`, `viewDocuments`, `viewExceptions`, `viewChatbot`, `viewAnnouncements` |
| Mobile view (route gating) | `viewMobileHome`, `viewMobileAttendance`, `viewMobileIssues`, `viewMobileTrips`, `viewMobileScannerFace`, `viewMobileScannerQr`, `viewMobileScannerManual`, `viewMobileChatbot` |

Rule: **action** permissions default *closed*, **view** permissions default
*open* — so a new capability is never silently granted, and a new page toggle
never silently locks out staff who could already reach that page. Admin bypasses
individual checks by role; a **read-only Admin** keeps every view permission and
loses every action permission.

**Where each group is enforced, precisely:** `action` keys are checked
server-side with `requirePermission(...)`. `desktopView` / `mobileView` keys gate
**routes in the frontend only** — the read endpoints behind those pages require a
valid token but not the view key. That is a deliberate split (a view permission
tidies navigation; it is not a data control) and it is documented rather than
implied: the security boundary is the action permission plus the per-trip and
per-coach scoping applied inside each read.

Shared failure responses, not repeated per endpoint: `401 UNAUTHENTICATED`
(missing, expired or superseded token), `403 FORBIDDEN` (lacks the permission),
`500` (unexpected — handled centrally, so a client never hangs).

---

## Auth & session

### `POST /api/auth/login` 🌐 *rate-limited*
**Request** `{ "staffId": "vance", "password": "password123!" }`

**200**
```json
{ "token": "<jwt>", "id": "u-1", "role": "admin", "readOnly": false,
  "name": "Vance Wang", "username": "vance",
  "permissions": { "manageDelegates": true, "exportData": false, "…": true } }
```
The permission set is returned on login so the UI renders correct navigation
immediately, with no second round-trip.

| Code | `error` | When |
| --- | --- | --- |
| 400 | `MISSING_FIELDS` | Staff ID or password absent. |
| 401 | `INVALID_CREDENTIALS` | Unknown account **or** wrong password — deliberately the same response, so the API can't be used to enumerate accounts. |
| 403 | `ACCOUNT_PENDING` | Self-registered, not yet approved. Checked **after** the password verifies, so a wrong guess doesn't reveal that the account exists. |
| 403 | `ACCOUNT_REJECTED` | Registration was declined. |
| 429 | — | More than 10 attempts per 10 minutes from one IP. A successful login clears that IP's counter. |

### `POST /api/auth/register` 🌐 *rate-limited*
**Request** `{ "email": "a@b.com", "username": "newstaff", "password": "…" }`
Always creates a **`staff` / `pending`** account — it exists but cannot sign in
until an admin approves it.

| Code | `error` | When |
| --- | --- | --- |
| 400 | `MISSING_FIELDS` / validation codes | Any field missing or invalid. |
| 409 | `USERNAME_TAKEN` / `EMAIL_TAKEN` | Already in use. |

### `POST /api/auth/reset-password` 🌐 *rate-limited*
Password reset for an existing account. Same limiter as login and register — a
public endpoint that writes to the accounts table is exactly what deserves
throttling.

### `GET /api/auth/session` 🔒
**200**
```json
{ "id": "u-1", "username": "vance", "name": "Vance Wang",
  "email": "vance@example.com", "photoUrl": null,
  "role": "admin", "readOnly": false, "permissions": { "…": true } }
```
Also stamps `last_seen_at`, powering the "active now" list — piggybacking on the
15-second poll the client already makes rather than adding a second one.
**401 `UNAUTHENTICATED`** when the token is superseded or the account is gone.

### `POST /api/auth/logout` 🔒
Clears `last_seen_at` immediately so an explicit logout shows at once instead of
after the 45-second activity window lapses. **200** `{ "ok": true }`

### `PATCH /api/auth/me` 🔒
Self-service profile edit — **any** signed-in account, on its own record only.

**Request** `{ "name": "…", "username": "…", "email": "…", "password": "…", "currentPassword": "…" }`
Can **never** change `role` or `permissions` — those fields aren't even accepted.
Changing the password requires `currentPassword`.

**200** returns the updated profile **and a fresh token**, because changing a
username invalidates the old token's lookup and the client would otherwise be
silently logged out.

| Code | `error` | When |
| --- | --- | --- |
| 400 | validation codes | Invalid field. |
| 401 | `CURRENT_PASSWORD_INCORRECT` | Wrong current password. |
| 409 | `USERNAME_TAKEN` / `EMAIL_TAKEN` | Already in use. |

### `POST` / `DELETE /api/auth/me/photo` 🔒
Upload or remove your own avatar. Stored in a **separate** Cloudinary folder from
delegate photos, so avatars never appear in the delegate media manager.

---

## Accounts & permissions

All require `manageAccounts` unless noted; the read routes also accept an
accounts-view capability.

| Method & path | Purpose |
| --- | --- |
| `GET /api/accounts` | List accounts with role, status, permission chips and matched role template. |
| `POST /api/accounts` | Create an account. Created by an admin ⇒ starts `approved` — that *is* the approval. |
| `PATCH /api/accounts/:id` | Edit name, username, email, phone, role, read-only flag and permissions. |
| `DELETE /api/accounts/:id` | Remove an account. |
| `GET /api/accounts/pending` | The self-registration queue. |
| `POST /api/accounts/:id/approve` | Approve one applicant — they can now sign in. |
| `POST /api/accounts/:id/reject` | Reject one applicant. |
| `POST /api/accounts/pending/approve-all` | Bulk approve. |
| `POST /api/accounts/pending/reject-all` | Bulk reject. |
| `GET /api/staff/active-sessions` | Who is active now, from `last_seen_at` within ~45s. |
| `GET /api/role-templates` | List permission presets. |
| `POST /api/role-templates` | Create a preset. |
| `PATCH /api/role-templates/:id` | Edit a preset. |
| `DELETE /api/role-templates/:id` | Delete a preset. |

**Example — create an account**
```json
POST /api/accounts
{ "username": "desmond", "name": "Desmond", "password": "…", "role": "staff",
  "permissions": { "manageDelegates": true, "exportData": false } }
```

Role templates are a **quick-fill preset only** — never stored as a tag on the
account. Enforced permissions live solely on the account, and template matching
is computed fresh, so editing or deleting a template can never silently change
what an existing account can do.

Unknown or stale keys in a stored permission set are cleaned on read; keys added
since the account was created fall back to their declared default.

---

## Dashboard & trips

### `GET /api/trips/:id/dashboard` 🔒
The single call behind the whole dashboard. (The `viewDashboard` permission gates
the *page* client-side; the endpoint itself requires a valid token and applies
per-coach scoping.)

**200**
```json
{
  "trip": { "id": "t-1", "name": "SCCCI Delegation to Chengdu", "dayOf": 2,
            "totalDays": 5, "lead": "Vance Wang", "localTime": "14:26", "departsIn": "35m" },
  "kpis": { "total": 54, "trackable": 25, "present": 18, "missing": 5, "late": 1,
            "unassigned": 29, "assigned": 1, "cancelled": 2,
            "openExceptions": 0, "criticalExceptions": 0, "normalExceptions": 0,
            "presentDelta": 4 },
  "coaches": [ { "id": "c1", "label": "C1", "name": "Coach 1 — Orchard", "city": "Chengdu",
                 "capacity": 30, "boarded": 18, "missing": 5, "late": 1, "total": 24 } ],
  "activity": [ { "id": "a-1", "text": "Wesley Wong checked in (Face)",
                  "kind": "checkin", "actor": "Vance Wang", "createdAt": "…" } ]
}
```
Two KPI choices worth calling out: **`trackable`** (`present + missing + late +
assigned`) is the denominator for "missing right now", because `UNASSIGNED`
covers two cases that can never be missing — no coach yet, and cancelled — and
including them overstated the total. **`cancelled`** is its own count because a
cancelled delegate is forced back to `UNASSIGNED`, so without it you cannot tell
"not assigned yet" from "not coming".

Coach-captain scoped: coach rows and every count are filtered at the data layer.

| Method & path | Purpose |
| --- | --- |
| `GET /api/trips` | Every trip the account can see. |
| `GET /api/trips/:id` | One trip's meta. |
| `GET /api/trips/:id/missing` | The still-missing list with coach, VIP flag, last seen and last location. |

`dayOf` is recomputed from the calendar date by a 60-second tick — unless staff
hand-edited it, which sets a manual flag so a deliberate override survives; "use
automatic day" clears the flag.

---

## Delegates

| Method & path | Permission | Purpose |
| --- | --- | --- |
| `GET /api/trips/:id/delegates` | 🔒 | Roster for a trip, coach-captain scoped. (`viewDelegates` gates the page client-side.) |
| `POST /api/trips/:id/delegates` | `manageDelegates` | Add a delegate. |
| `DELETE /api/trips/:id/delegates` | `manageDelegates` | Delete **all** delegates on the trip. |
| `PATCH /api/delegates/:id` | `manageDelegates` | Edit — diffed field-by-field into the activity log. |
| `DELETE /api/delegates/:id` | `manageDelegates` | Remove one delegate. |
| `POST /api/delegates/:id/photo` | `manageDelegates` | Upload a photo (multipart → Cloudinary). |
| `DELETE /api/delegates/:id/photo` | `manageDelegates` | Remove the photo and destroy the asset. |

**Example — edit**
```json
PATCH /api/delegates/d-118
{ "name": "Wesley Wong", "coachId": "c2", "vip": true, "status": "ASSIGNED",
  "cancelled": false, "notes": "Wheelchair access", "locked": false }
```

Behaviours worth knowing:
- **Cancelling** is a flag plus a reason, not a sixth status. It forces the
  status back to `UNASSIGNED` and clears the coach to free the seat; the reason
  is cleared if the delegate is un-cancelled, so it can't linger as stale
  context for a later, unrelated cancellation.
- **Ownership and locking** — the creating account's id is recorded, and locking
  blocks **everyone including the creator** until unlocked. A delegate with no
  recorded owner stays editable by any staff with the permission, rather than
  retroactively locking everyone out of legacy rows.
- **Photos** are settable *only* through the upload route, never through this
  JSON PATCH, so a client can't inject an arbitrary external URL and bypass
  upload validation.

| Code | `error` | When |
| --- | --- | --- |
| 400 | `INVALID_STATUS` | Not one of `UNASSIGNED`/`ASSIGNED`/`ARRIVED`/`LATE`/`MISSING`. |
| 403 | `LOCKED` / `NOT_OWNER` | Locked, or owned by another account. |
| 404 | `NOT_FOUND` | Unknown delegate or trip. |

---

## Activity history

| Method & path | Permission | Purpose |
| --- | --- | --- |
| `GET /api/activity` | 🔒 | The persisted feed: what changed, who did it, when. `?limit=` (capped at 1000) and `?tripId=`; a non-admin must name a trip they are actually on. (`viewHistory` gates the page client-side.) |
| `DELETE /api/activity/:id` | `manageDelegates` | Delete one entry. |
| `DELETE /api/activity` | `manageDelegates` | Clear the feed. |
| `POST /api/activity/:id/rollback` | `manageDelegates` | Undo a delegate edit, field by field. |
| `POST /api/system/late-cutoff` | `manageDelegates` | Apply the trip's Late cutoff to still-unboarded delegates. |

A delegate-edit entry stores `changes` as `{field: {from, to}}`, which is what
makes rollback possible. Add and remove entries carry no change set and are not
offered as rollbackable. Writes with no known actor render as "you" rather than
a guessed name.

---

## Multi-checkpoint attendance

Checkpoints are read from the **existing itinerary**, not a parallel list, so the
selector shows exactly the stops staff already see on the Trips board.

### `POST /api/checkpoints/:id/checkins` 🔑 `manageDelegates` *or kiosk token*
**Request** `{ "delegateId": "d-118", "status": "ARRIVED", "method": "QR" }`
**201**
```json
{ "id": "…", "checkpointId": "…", "delegateId": "d-118", "status": "ARRIVED",
  "method": "QR", "scannedBy": "Vance Wang", "createdAt": "…", "updatedAt": "…" }
```
Upserts on `(checkpoint, delegate)` — re-scanning the same delegate at the same
checkpoint **updates** that row instead of creating a duplicate.

| Code | `error` | When |
| --- | --- | --- |
| 400 | `DELEGATE_REQUIRED` | No `delegateId`. |
| 400 | `INVALID_STATUS` | Not `ARRIVED`, `MISSING` or `LATE`. |
| 403 | — | The checkpoint belongs to a trip this account can't act on. The body is a raw id with no scanned badge, so without this guard an account on one trip could mark delegates present on another. |
| 404 | `CHECKPOINT_NOT_FOUND` / `DELEGATE_NOT_FOUND` | Unknown id. |

| Method & path | Purpose |
| --- | --- |
| `GET /api/trips/:id/checkpoints` | Checkpoint list (kiosk or signed in). |
| `GET /api/checkpoints/:id/checkins` | Every delegate's status at **this** checkpoint, plus stats scoped to it only. |
| `GET /api/trips/:id/checkpoint-stats` | Per-checkpoint totals across the trip. |
| `GET /api/trips/:id/checkpoint-matrix` | Every delegate × every checkpoint. |
| `GET /api/delegates/:id/checkpoint-timeline` | One delegate's journey. |
| `PATCH /api/trips/:id/checkpoint-reset-window` | Minutes before the next stop that an arrived delegate resets for re-scanning. |
| `PATCH /api/trips/:id/itinerary-buffer` | Minimum gap between two same-day stops — deliberately separate from the reset window, so shrinking one for testing doesn't shrink the other. |

`delegates.status` stays the authoritative live status everywhere else; this is a
parallel history, so `ARRIVED` at 10am and `MISSING` at 4pm coexist without
either overwriting the other.

---

## Emergency escalations

### `POST /api/escalations` 🔒 `manageDelegates`
**Request** `{ "tripId": "t-1", "delegateId": "d-201", "message": "Not at the coach, phone off", "recipientEmails": ["ops@example.com"] }`

**200 / 201** `{ "escalation": { "id": "…", "status": "open", "createdBy": "Vance Wang", "…": "…" }, "notified": { "email": 2 } }`

Re-clicking for a delegate who already has an open escalation returns
`{ "alreadyOpen": true, "notified": null }` and **skips re-notifying** — that
duplicate alert spam is the actual thing the dedupe guards against, and the UI
shows "already escalated" instead of a fresh success.

| Method & path | Purpose |
| --- | --- |
| `GET /api/escalations/recipients` | Candidate recipients for a trip. |
| `GET /api/escalations/open` | Open escalations — polled by every signed-in account so the banner is unmissable. |
| `GET /api/escalations/active` | Open **and** acknowledged, so an alert stays actionable until explicitly resolved rather than vanishing on acknowledgement. Trip-scoped; an unresolvable trip id returns an empty list rather than falling through to every trip. |
| `POST /api/escalations/:id/acknowledge` | Record who acknowledged, and when. |
| `POST /api/escalations/acknowledge-all` | One action for a burst of related alerts. |
| `POST /api/escalations/:id/resolve` | Close it out. |

Notification channels: **email is live** over SMTP. **SMS and WhatsApp are
deliberately stubbed** — the provider charges per message, so the calls are
written and log what *would* have been sent, keeping the flow testable
end-to-end at zero cost. Escalation is always a staff-clicked action, never
automatic.

---

## Announcements

| Method & path | Permission | Purpose |
| --- | --- | --- |
| `GET /api/trips/:id/announcements` | 🔒 | Read the trip's announcements. Also returns the trip's `dayOf`, so the mobile page can pick a "current stop" hero announcement without a second round-trip. (`viewAnnouncements` gates the page client-side.) |
| `POST /api/trips/:id/announcements` | `manageAnnouncements` | Post one (multipart: title, message, optional images/videos, optional itinerary tag). |
| `PATCH /api/announcements/:id` | `manageAnnouncements` | Edit, including adding or removing media. |
| `DELETE /api/announcements/:id` | `manageAnnouncements` | Delete, and destroy its Cloudinary assets. |

Only **posting** is restricted — any signed-in account viewing the trip can read
them, so information reaches everyone while authorship stays controlled. New
posts store media as a `[{url, publicId}]` array; older single-image rows still
render through the original columns.

---

## Export

### `POST /api/trips/:id/export` 🔒 `exportData`
**Request**
```json
{ "statuses": ["MISSING", "LATE"], "coachIds": ["c2"], "vipOnly": true,
  "columns": ["name", "coach", "status", "lastSeen"],
  "includeAiSummary": false, "includeCheckpoints": true, "lang": "en",
  "charts": [ { "dataUrl": "data:image/png;base64,…", "width": 640, "height": 360 } ] }
```
**200** — an `.xlsx` workbook stream.

Chart PNGs are the only client-supplied binary this API accepts, so they are
validated rather than trusted: a `data:image/png;base64,` URL only (a remote URL
would make the server fetch an attacker-chosen address), base64 must decode
cleanly, and there are hard caps on count and size so the endpoint can't become
a memory-exhaustion lever. A malformed chart is **dropped, not rejected** — it
should cost one picture, not the whole workbook.

| Method & path | Purpose |
| --- | --- |
| `GET /api/trips/:id/export` | Unfiltered one-click download (back-compat). |
| `GET /api/trips/:id/export/options` | Available columns, defaults, statuses and coaches for the config modal. |
| `POST /api/trips/:id/export/ai-filter` | Plain English → the same filter shape the checkboxes produce, so the UI can show and edit it before exporting. |

**AI filter** — `{ "prompt": "VIPs still missing on coach 2" }` → the filter
object. Tries a local Ollama first, then Anthropic. With neither configured it
returns `503 AI_NOT_CONFIGURED` with a message that says the checkbox filters
still work — a missing optional dependency degrades one shortcut, not the
feature.

---

## Analytics & room assignment

| Method & path | Permission | Purpose |
| --- | --- | --- |
| `POST /api/trips/:id/analytics/ai-chart` | 🔒 | Natural-language question → a chart specification for the analytics panel. |
| `POST /api/trips/:id/rooms/ai-suggest` | `manageDelegates` | Propose a rooming allocation for review. |
| `POST /api/trips/:id/rooms/ai-apply` | `manageDelegates` | Apply an approved allocation to `hotel_name` / `room_number`. |

Suggest and apply are deliberately **two steps**: an AI allocation is a proposal
a human approves, never an automatic write.

---

## Media & guide video

| Method & path | Permission | Purpose |
| --- | --- | --- |
| `GET /api/media/:folderKey` | `manageAccounts` | List stored assets in one folder. |
| `POST /api/media/:folderKey/delete` | `manageAccounts` | Delete selected assets. |
| `POST /api/media/:folderKey/purge` | `manageAccounts` | Empty the folder. |
| `GET /api/guide-video` | 🔒 | The User Guide walkthrough video (one global row). |
| `POST /api/guide-video` | `manageAccounts` | Upload/replace it. |
| `DELETE /api/guide-video` | `manageAccounts` | Remove it. |

`folderKey` is a **key**, not a path — each surface (delegates, accounts,
announcements, guide) has its own Cloudinary folder, so a purge in one can never
reach another's images.

---

## Shared foundations other modules build on

These aren't endpoints, but they are the contract teammates' feature modules
depend on — they import these helpers rather than editing base files:

| Export | From | Used for |
| --- | --- | --- |
| `requireAuth`, `requirePermission`, `requireKioskOrPermission`, `accountFromReq` | `lib/auth.js` | Every teammate router's authorisation. |
| `listDelegates`, `getDelegateById`, `updateDelegate`, `createDelegate`, `getDashboard`, `getTrip`, `resolveTripUuid`, `getVisibleCoachIds` | `data.js` | Reading and writing the shared roster, so a check-in from any module updates every screen. |
| `all`, `get`, `run` | `db/connection.js` | Feature modules owning their own tables. |
| `logActivity` | `db/history.js` | Writing to the History page. |
| `accountTripIds` | `lib/tripAccess.js` | Per-trip authorisation, failing closed. |
| `PERMISSIONS`, `PERM_KEYS` | `frontend/src/lib/permissions.js` | One catalogue, imported by both frontend and backend. |
