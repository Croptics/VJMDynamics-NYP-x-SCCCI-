# API Documentation — Desmond (Trip Booking & Dynamic Coach Management)

All routes live in `backend/routes/trip.js` and are mounted under the app's
`/api` base. Auth is a Bearer JWT: `Authorization: Bearer <token>`.

- **`signed-in`** = requires a valid token (`requireAuth`) → `401` if missing/invalid.
- **`manageTrips`** = requires that permission (`requirePermission`) → `403` if lacking it.
  The board is **view-for-all, edit-gated**: any signed-in user can `GET` the board;
  every create/update/delete needs `manageTrips`.

**Trip ids:** endpoints that take a `:tripId` accept **either** the legacy string id
(`t-1`) **or** the trip's `uuid_id` (what `GET /api/all-trips` returns). Both are
resolved by `resolveTripUuid()` / the `withTripUuid` middleware; an id that matches
no trip returns `404 NOT_FOUND` (not a 500).

**Pure decision core:** the reassignment guards are unit-tested in isolation via
`backend/routes/reassign-core.js` (`evaluateReassign`) — see `tests/desmond/`.

---

## 1. Trips

### `GET /api/all-trips`
Every trip with its live coach/delegate counts and progress fields (drives the
Trips list cards + the Edit-trip form). Auth: `signed-in`.

**200 OK**
```json
{ "trips": [
  { "id": "0ce87a79-...", "name": "Beijing study mission", "status": "In progress",
    "dateRange": "12–16 Aug 2026", "dayOf": 3, "totalDays": 5, "lead": "Wei Ming Tan",
    "coachCount": 4, "delegateCount": 9 }
] }
```

### `GET /api/trips/:tripId/summary`
The board's header + KPI figures for one trip. Auth: `signed-in`.

**200 OK**
```json
{ "id": "0ce87a79-...", "name": "Beijing study mission", "status": "In progress",
  "dayOf": 3, "totalDays": 5, "startDate": "2026-08-12", "dateRange": "12–16 Aug 2026",
  "lead": "Wei Ming Tan", "coachCount": 4, "delegateCount": 9 }
```

### Trip create / edit / delete

| Method | Path | Body (key fields) | Response | Errors |
| --- | --- | --- | --- | --- |
| `POST` | `/api/trips` | `{ name, lead?, startDate?, departureTime?, countryFrom?, countryTo? }` | `201 { id, name, status:"Planning", ... }` | `400 NAME_REQUIRED` |
| `PATCH` | `/api/trips/:tripId` | any of `{ name, status, lead, startDate, dayOf, totalDays, departureTime, countryFrom, countryTo }` | `200 { ...updated }` | `404 NOT_FOUND` |
| `DELETE` | `/api/trips/:tripId` | — | `200 { deleted: true }` | `404 NOT_FOUND` |
| `POST` | `/api/trips/seed` | — | `201 { ...demo trip }` — dev convenience | — |

`status` moves through **Planning → In progress → Completed / Cancelled**.
`dayOf`/`totalDays`/`dateRange` are normally derived from the itinerary; a manual
`dayOf` sets `dayOfIsManual`. Writes are `manageTrips`.

### Activity & audit (change history)

| Method | Path | Body / Query | Response | Notes |
| --- | --- | --- | --- | --- |
| `GET` | `/api/trips/:tripId/audit` | `?limit=` (≤200) | `{ events:[{ id, actor, action, entity, entityId, summary, before, after, at }] }` | Persisted before→after audit (powers the **History** panel). |
| `GET` | `/api/trips/:tripId/activity` | — | `{ activity:[{ id, text, kind, at }] }` | Ephemeral in-memory feed. |
| `POST` | `/api/trips/:tripId/activity` | `{ text, kind?, before?, after? }` | `201 { id, text, kind, at }` | Lets the client record a move done through a teammate's route. `400 TEXT_REQUIRED`. |

---

## 2. Coaches (fleet management)

### `GET /api/trips/:tripId/coaches`
Every coach on the trip with its captains, capacity, boarding and bus-arrival
status (drives the fleet cards). Auth: `signed-in`.

**200 OK**
```json
{ "coaches": [
  { "id": "c1", "label": "C1", "name": "Coach 1", "city": "Beijing",
    "capacity": 40, "total": 2, "boarded": 1, "driverName": "Lim B.",
    "arrivalStatus": "not_arrived",
    "captains": [ { "id": "acc-7", "username": "Staff_1", "name": "Staff 1" } ] }
] }
```
`total` = delegates on the coach; `boarded` = of those, how many are checked in.

### Coach create / edit / delete / staffing

| Method | Path | Body | Response | Errors |
| --- | --- | --- | --- | --- |
| `POST` | `/api/coaches` | `{ tripId, label, capacity, driverName?, accountIds?[] }` | `201 { id, label, capacity, ... }` | `400 LABEL_REQUIRED` / `BAD_CAPACITY` |
| `PATCH` | `/api/coaches/:id` | `{ driverName?, capacity?, accountIds?[] }` | `200 { ...updated }` | `404 NOT_FOUND` |
| `DELETE` | `/api/coaches/:id` | — | `200 { deleted: true }` — delegates fall back to Unassigned | `404 NOT_FOUND` |
| `POST` | `/api/coaches/generate` | `{ tripId, count, capacity }` | `201 { created:[...] }` — makes N staffless "Coach N" | `400` on bad count |
| `PATCH` | `/api/trips/:tripId/coaches/capacity` | `{ capacity }` | `200 { updated: N, capacity }` — sets **every** coach to N seats | `400 BAD_CAPACITY` |
| `PATCH` | `/api/coaches/:id/arrival` | `{ arrivalStatus }` | `200 { ...updated }` — `not_arrived`\|`en_route`\|`arrived` | `404 NOT_FOUND` |

`accountIds` sets up to **3 coach captains** (login accounts) via the
`coach_captains` table — see [database-schema.md](database-schema.md). All writes
are `manageTrips`.

---

## 3. Itinerary & per-stop attendance

### `GET /api/trips/:tripId/itinerary`
All stops for the trip, plus the allowed categories. Auth: `signed-in`.

**200 OK**
```json
{ "items": [
  { "id": "uuid", "dayNumber": 3, "startTime": "12:45", "title": "Forbidden City tour",
    "location": "Forbidden City", "category": "attraction",
    "status": "delayed", "delayMinutes": 20, "completed": false, "sortOrder": 2 }
], "categories": ["hotel","attraction","meal","factory","airport","transport","other"] }
```

### Itinerary create / edit / status / complete / delete

| Method | Path | Body | Response | Errors |
| --- | --- | --- | --- | --- |
| `POST` | `/api/trips/:tripId/itinerary` | `{ dayNumber, startTime, title, location?, category?, status?, delayMinutes? }` | `201 { ...item }` | `400` (title/time required, or gap conflict) |
| `PATCH` | `/api/trips/:tripId/itinerary/:itemId` | same fields | `200 { ...item }` | `400`, `404` |
| `PATCH` | `/api/trips/:tripId/itinerary/:itemId/status` | `{ status, delayMinutes? }` | `200 { ...item }` — live `scheduled\|delayed\|moved\|cancelled` | `404` |
| `PATCH` | `/api/trips/:tripId/itinerary/:itemId/complete` | `{ completed }` | `200 { ...item }` — tick a stop done | `404` |
| `DELETE` | `/api/trips/:tripId/itinerary/:itemId` | — | `200 { deleted: true }` | `404` |

### `GET` / `POST /api/trips/:tripId/itinerary/:itemId/attendance`
Per-stop head-count. `GET` returns each delegate's status **at that stop** grouped
by coach, plus a full before→after history; `POST` sets one delegate's status.
Captain-scoped (a captain only sees/marks their own coach). Auth: `GET` signed-in,
`POST` `manageTrips`.

```json
// POST body
{ "delegateId": "d-4", "status": "ARRIVED" }   // ARRIVED | LATE | MISSING
```
**200 OK** — writes an `attendance_log` row and upserts JQ's `checkpoint_checkins`
so the Dashboard/Timeline stay in sync.

---

## 4. Delegates & reassignment

### `PATCH /api/trips/:tripId/reassign`  ⭐ the enhanced capability
Move a delegate to a coach (or to Unassigned) with **server-side capacity,
cross-trip and optimistic-lock guards**. This is the board's own reassignment
path — distinct from JQ's generic delegate PATCH. Auth: `manageTrips`.

```json
{ "delegateId": "d-5",
  "toCoachId": "c4",          // null = release to Unassigned
  "expectedCoachId": "c1",    // OPTIONAL — the coach the client last saw them on
  "override": false }         // set true to accept a full coach
```
- `expectedCoachId` **present** enables optimistic locking; **omitted** (an offline
  replay) applies last-write-wins.
- Status is computed server-side: `UNASSIGNED → ASSIGNED`, a real status is kept,
  release → `UNASSIGNED`.

**200 OK**
```json
{ "id": "d-5", "name": "Yeo Pei Lin", "coachId": "c4", "status": "ASSIGNED", ... }
```
No-op (same coach) returns `{ ...id, coachId, unchanged: true }`.

**Errors**
| Status | Code | When |
| --- | --- | --- |
| `400` | `DELEGATE_REQUIRED` | no `delegateId` |
| `400` | `WRONG_TRIP` | delegate isn't on this trip |
| `404` | `NOT_FOUND` | delegate doesn't exist |
| `404` | `COACH_NOT_FOUND` | target coach doesn't exist |
| `400` | `COACH_WRONG_TRIP` | target coach belongs to another trip |
| `403` | `FORBIDDEN` | a scoped captain moving to/from a coach they can't see |
| `409` | `CAPACITY_FULL` | target at seat limit and `override` not set (returns `used`, `capacity`) |
| `409` | `CONFLICT` | `expectedCoachId` no longer matches — a concurrent move (returns `currentCoachId`) |

### Other delegate routes

| Method | Path | Body / Query | Response | Errors |
| --- | --- | --- | --- | --- |
| `GET` | `/api/delegates` | `?tripId=` | `{ delegates:[{ id, name, coachId, status, vip, company, accessibilityNotes, notes }] }` | — |
| `POST` | `/api/delegates` | `{ tripId, name, vip?, company?, accessibilityNotes?, notes? }` | `201 { ...delegate }` (lands `UNASSIGNED`) | `400 NAME_REQUIRED` |
| `PATCH` | `/api/delegates/:id/details` | any of `{ name, vip, company, accessibilityNotes, notes }` | `200 { ...delegate }` | `400 NO_FIELDS`, `404 NOT_FOUND` |

> **coachId/status reassignment** goes through the `/reassign` endpoint above (or
> JQ's generic `PATCH /api/delegates/:id`); the `/details` route only touches the
> profile columns this feature owns.

---

## 5. Captains & staff (for coach assignment)

| Method | Path | Response | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/assignable-accounts` | `{ accounts:[{ id, username, name, role }] }` | Login accounts a coordinator can make a captain (no secrets). |
| `GET` | `/api/my-captain-coaches` | `{ coaches:[{ coachId, coachLabel, tripId, tripName }] }` | Coaches the **signed-in** account captains — scopes the Trips list. |
| `GET` | `/api/users/staff` | `{ staff:[{ id, name, email, role }] }` | Staff directory. |

---

## Common error shape

Every error is JSON: `{ "error": "<CODE>", "message": "<human-readable>" }`.

| Status | When |
| --- | --- |
| `400` | Bad input — `NAME_REQUIRED`, `DELEGATE_REQUIRED`, `WRONG_TRIP`, `COACH_WRONG_TRIP`, `BAD_CAPACITY`, `NO_FIELDS`, itinerary title/time/gap. |
| `401` | Not signed in (missing/invalid token). |
| `403` | Signed in but lacking `manageTrips`, or a scoped captain acting outside their coach (`FORBIDDEN`). |
| `404` | `NOT_FOUND`, `COACH_NOT_FOUND` (also an unresolved `:tripId`). |
| `409` | `CAPACITY_FULL` (full coach), `CONFLICT` (concurrent move). |
