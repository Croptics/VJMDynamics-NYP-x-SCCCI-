# Feature Integration Notes

Three teammate features are merged into JQ's `InsightMetrics-(JQ)` branch:

1. **TransitFlow** — Trip Booking & Dynamic Coach Management (Desmond)
2. **Exception Logging** — support tickets, critical alerts & manual override (Jayden)
3. **DocuSync AI + Trip Assistant** — AI document parsing (onboarding) + chatbot (Vance)

This file describes what's **actually in the code now**, after integration.
It intentionally differs from the teammates' original hand-off notes, because
a few things changed during the merge (auth was unified onto JQ's signed-JWT
system, features were put behind permissions, and Desmond's database setup was
simplified). Where something changed, it's called out.

---

## Quick start (both features)

```bash
# 1. Backend — needs DATABASE_URL in backend/.env (Neon or local Postgres)
cd backend
npm install
npm run dev            # creates ALL tables automatically on first boot

# 2. Optional: demo data (delegate roster + 7 sample exception tickets)
npm run seed:demo

# 3. Frontend
cd ../frontend
npm install
npm run dev            # http://localhost:5173  (proxies /api to :4000)
```

Sign in with **`staff_194` / `password123!`**. If that login fails (common on a
shared database — see PROJECT_STRUCTURE.txt), run `npm run reset:login` in
`backend/`.

**No manual database steps.** Every table all three features need is created
automatically when the backend boots — there are no `.sql` files to paste and
no migration command to run.

**AI features need a key or Ollama.** Document parsing and the chatbot (Vance's
feature) need either `ANTHROPIC_API_KEY` in `backend/.env`, or a local Ollama
(`ollama pull llama3.2`) for the text-based paths — see that feature's section.
Everything else works without them.

**One new npm package:** `unpdf` (backend), used to read text out of PDFs for
document parsing. `npm install` pulls it in.

---

## Permissions (important — read this first)

Two new permissions were added to `permissions.js` for the Trips and Exceptions
features. Both follow the same **"view for all, edit gated"** model already used
elsewhere in the app:

| Permission | Who needs it | What it unlocks |
|---|---|---|
| `manageTrips` | trip coordinators | Editing the Trips board — add/edit/remove coaches, itinerary, delegates, seed demo trips |
| `manageExceptions` | on-ground staff | Raising / resolving / deleting tickets and manual attendance overrides |

- **Any signed-in user can VIEW** both the Trips board and the Exception inbox.
- **Only accounts with the permission can EDIT.** Without it, the edit buttons
  are hidden and the backend rejects the write with `403`.
- Both default to **off**, and existing accounts (like `staff_194`) don't get
  them automatically. Tick them per-account in **Account control**.
- One nuance for Trips: dragging a delegate between coaches and removing a
  delegate reuse JQ's *existing* `/api/delegates/:id` routes, which are gated
  by `manageDelegates`. So a full trip editor should have **both** `manageTrips`
  and `manageDelegates`.

**Vance's feature deliberately did NOT add a new permission:**

- **Document parsing / onboarding** reuses the existing **`manageDelegates`**
  permission — it bulk-creates delegates, which is exactly what `manageDelegates`
  already governs. (The `/onboarding` page and its sidebar item are hidden for
  accounts without it, matching the backend's `403`.)
- **The chat assistant** is open to **any signed-in user** (read-only Q&A over
  live data — same access level as the Dashboard's "Generate Insights").

So adding an onboarding-specific permission would have been redundant, and would
have created the odd state of "can bulk-add delegates by upload but not manually."

---

# Feature 1 — TransitFlow (Trips & Coaches) · Desmond

The `/trips` page: a live "operational workspace" for a trip coordinator —
a hero header, a journey timeline with a moving bus icon, a fleet of coach
cards you drag delegates between, and a live activity feed. Not a KPI
dashboard (that's the main Dashboard's job).

### Files

**New:**
- `backend/routes/desmond.js` — all of this feature's API routes.
- `frontend/src/pages/TripsListPage.jsx` — the trip grid (also owns the shared `useTfTheme` dark-mode hook).
- `frontend/src/pages/TripCoachPage.jsx` — the per-trip board (replaced the old placeholder). Shows the trip grid when no `?tripId=` is set.
- `frontend/src/pages/TripCoachPage.css` — its `.tf-*` design system.

**Edited during merge:**
- `backend/server.js` — mounted in the TEAMMATE ZONE (`import desmondRouter` + `app.use(desmondRouter)`).
- `backend/data.js` — Desmond's database schema was **folded into `createSchema()` / `seed()`** so it auto-applies on startup. *(This replaced the standalone `database/003_*.sql` + `004_*.sql` files and `run-migration.js` from his original hand-off — those are no longer used, so there's no manual SQL step.)*
- `permissions.js` — added the `manageTrips` permission.

### Database (auto-created in data.js)

- `trips.uuid_id` — a parallel UUID id (the base `trips.id` stays `"t-1"`).
- `users` — a small staff directory for coach "guide" assignment (NOT login accounts — separate from `accounts`).
- `coaches` — added `trip_id`, `staff_user_id`, `sort_order`, `driver_name`.
- `delegates` — added `trip_id`, `notes`, `company`, `accessibility_notes`.
- `itinerary_items` — per-trip schedule (drives the journey timeline).

All additive and idempotent; nothing the base app relies on was changed.

### Endpoints

Read (any signed-in user):
`GET /api/all-trips`, `GET /api/trips/:tripId/summary`,
`GET /api/trips/:tripId/coaches`, `GET /api/trips/:tripId/itinerary`,
`GET /api/delegates?tripId=…`, `GET /api/users/staff`,
`GET /api/coaches/staff-assignments`, `GET /api/trips/:tripId/activity`,
and `POST /api/trips/:tripId/activity` (cosmetic activity-feed logging).

Write (needs `manageTrips`):
`POST /api/trips/seed`, `POST|PATCH|DELETE /api/coaches[/:id]`,
`POST|PATCH|DELETE /api/trips/:tripId/itinerary[/:itemId]`,
`POST /api/delegates`, `PATCH /api/delegates/:id/details`.

**Why the odd paths?** The base app already owns `GET /api/trips` (returns the
one hardcoded Beijing trip) and `GET /api/trips/:id/delegates` (returns every
delegate). Express runs the first matching route, so this feature uses new
paths like `/api/all-trips` and `/api/delegates?tripId=` to avoid silently
shadowing — or being shadowed by — those.

### Good to know

- **Activity feed is in-memory** — it resets if the backend restarts (mirrors the Dashboard's own activity pattern; not a persisted audit log).
- Drag-and-drop uses plain Pointer Events (no `@dnd-kit`); the moving "bus" is a CSS-animated 2D icon (no 3D library).
- Coach capacity is informational, not enforced. Reassigning a delegate out of "Unassigned" onto a coach sets them to `ASSIGNED` (updated from the original `MISSING` — see "Updates since initial merge" below).
- **Partial Chinese:** the new UI strings fall back to English until added to `DICT` in `i18n.jsx`. The board works fully in English.

---

# Feature 2 — Exception Logging · Jayden

The `/exceptions` page (Screen 5): a support-ticket inbox with All / Critical /
Open / Resolved tabs, a live critical-alert banner, and a manual attendance
override. Critical tickets push in real time to every open browser.

### Files

**New:**
- `backend/routes/exceptions.js` — ticket CRUD, manual override, and the live (SSE) alert channel.
- `backend/seed-demo.js` — demo delegate roster + 7 sample tickets (`npm run seed:demo`).
- `frontend/src/lib/exceptionsApi.js` — data layer built on the shared `lib/api.js`.
- `frontend/src/components/LogExceptionModal.jsx` — the "Log exception" form.
- `frontend/src/pages/ExceptionInboxPage.jsx` — the inbox (replaced the old placeholder).
- `frontend/src/pages/ExceptionInboxPage.css` — scoped `.exc-*` styles.

**Edited during merge:**
- `backend/server.js` — mounted in the TEAMMATE ZONE, plus `.then(initExceptions)` in the startup chain (its tables must be created after the base schema, since they hold foreign keys into `trips`/`delegates`/`accounts`).
- `backend/auth.js` — `accountFromReq` now also accepts a token via `?token=` query param, because the live alert stream uses `EventSource`, which can't send an `Authorization` header.
- `frontend/src/components/Layout.jsx` — the sidebar's "Exceptions" badge now shows the **live** count of unresolved critical tickets (was a hardcoded demo number).
- `permissions.js` — added the `manageExceptions` permission.

> **Auth was rewritten during the merge.** Jayden's original version decoded
> the old `demo.<base64(username)>.token` format by hand. That no longer
> validates against JQ's signed-JWT + bcrypt login, so his router now reuses
> `requireAuth` / `requirePermission` from `auth.js` like every other route.

### Database (auto-created by initExceptions on boot)

- `exception_tickets` — the support tickets.
- `check_in_logs` — shared with Vimal's face/voice scan module and Vance's QR boarding-pass check-in (both merged since this doc was originally written); this feature writes the `MANUAL` rows (manual override). Created with `CREATE TABLE IF NOT EXISTS` so none of the writers clash.

Ids are `VARCHAR(64)` to match the live base schema (the HLD's UUID types
wouldn't match the real `t-1`/`c1`/`d-1` foreign keys); id *values* are still
UUIDs. `raised_by` / `resolved_by` reference `accounts(id)` (the HLD's separate
`users` table for auth doesn't exist).

### Endpoints

View (any signed-in user):
`GET /api/trips/:id/exceptions`, `GET /api/trips/:id/exceptions/critical-count`
(sidebar badge), `GET /api/exceptions/:id`, `GET /api/exceptions/stream` (live SSE feed).

Edit (needs `manageExceptions`):
`POST /api/trips/:id/exceptions` (raise; CRITICAL pushes to all devices),
`PATCH /api/exceptions/:id` (resolve / re-prioritise),
`DELETE /api/exceptions/:id`, `POST /api/checkins/manual` (mark present without a scan).

`POST /api/checkins/qr` exists in this file too (Jayden's own QR path) but has
no frontend caller — the live QR scan flow actually goes through Vance's
`POST /api/onboarding/checkin` (see Feature 3 below). Both this module's
`/checkins/manual` and Vance's `/onboarding/checkin` now write the current
`ARRIVED` status (was `PRESENT` at original merge — see "Updates since
initial merge" below).

### Good to know

- **Idempotent writes:** raising a ticket or an override with a repeated `clientEventId` returns the original (`duplicate: true`) instead of creating a duplicate — safe for an offline retry queue.
- **Real-time** uses Server-Sent Events (SSE), not WebSockets — no new dependency, works through restrictive proxies.
- A manual override writes a `MANUAL` `check_in_logs` row and flips the delegate to `ARRIVED` (was `PRESENT` — see "Updates since initial merge"), which the main Dashboard head-count then reflects.

---

# Feature 3 — DocuSync AI + Trip Assistant · Vance

Two AI features in one module:

- **`/onboarding`** — upload a delegation directory, attendee list, spreadsheet
  export, or scanned passport; an AI reads it and returns structured delegate
  rows (name, company, role, industry, passport, etc.) with a confidence score.
  You review/edit, then confirm — and they're added to the shared delegate list.
- **The Trip assistant chatbot** — answers plain-language questions about the
  live trip ("who's missing from Coach 2?", "which companies are biggest?") over
  a snapshot assembled from *everyone's* data. Replies stream in; chats are
  saved, renameable, pinnable, and exportable. Originally a dedicated
  `/assistant` page; now a floating chat bubble on every route instead — see
  "Updates since initial merge" below.
- **QR boarding passes + on-site check-in** — every onboarded delegate gets a
  unique `qr_code`; scanning it flips them to `ARRIVED`. This is the LIVE QR
  scan path (`POST /api/onboarding/checkin`), not Jayden's orphaned
  `/api/checkins/qr`.

### Files

**New:**
- `backend/routes/vance.js` — both features' API (document parsing + assistant), plus its own lazy schema setup.
- `frontend/src/lib/claudeParse.js` — the parse/confirm bridge used by the onboarding page.

**Replaced (were placeholders/demos before):**
- `frontend/src/pages/OnboardingPage.jsx` — real upload → parse → review → confirm flow.
- `frontend/src/pages/ChatAssistantPage.jsx` — real streaming chatbot with saved history.
- `frontend/src/pages/mobile/MobileAssistantPage.jsx` — the mobile chat, real AI.

**Edited during merge:**
- `backend/server.js` — mounted in the TEAMMATE ZONE (`import vanceRouter` + `app.use`).
- `backend/package.json` — added `unpdf`.
- `frontend/src/App.jsx` + `frontend/src/components/Sidebar.jsx` — the `/onboarding` route and its "Documents" nav item are now gated behind `manageDelegates` (matching the backend), so an account without it doesn't land on a page that would 403.

*(Auth needed no rewrite — unlike Jayden's, Vance's router already used JQ's `requireAuth`/`requirePermission` from `auth.js`.)*

### Database (auto-created lazily in vance.js on first use)

- `delegates` — added `passport_no`, `nationality`, `passport_expiry`, `role`, `industry`, `email`, `phone`, `website` (all additive; reuses Desmond's `company`).
- `chat_sessions`, `chat_messages` — saved assistant history, one set per account.

### Endpoints

Document parsing (needs `manageDelegates`):
`POST /api/documents/parse`, `POST /api/documents/parse-async` (+ `GET .../:id` to poll),
`GET /api/onboarding/context`, `POST /api/trips/:id/onboarding/confirm`.

Assistant (any signed-in user):
`POST /api/chat/messages` (mobile, stateless), `GET|POST /api/chat/sessions`,
`GET|PATCH|DELETE /api/chat/sessions/:id`, `POST /api/chat/sessions/:id/messages`,
`POST /api/chat/sessions/:id/stream` (live tokens), `.../regenerate`, `GET /api/assistant/roster`.

### AI providers (deliberate split)

- **Parsing prefers Claude** (best accuracy, and *required* for scanned docs/images — it must "see" them). For text-based PDFs it can fall back to local Ollama. Needs `ANTHROPIC_API_KEY`, or Ollama for the text path.
- **Chatbot is Ollama-first, Claude-fallback** (mirrors JQ's `insights.js`) — it reasons over a text snapshot, so a free local model handles it.
- If neither is configured, each returns a clear "not configured" message, never a crash.

### Good to know

- **Writes to the SHARED `delegates` table** via JQ's own `createDelegate()`, so a parsed delegate instantly appears on the Dashboard, the Trips board, and the Exception delegate-picker — no separate table, no sync.
- The chatbot reads a snapshot spanning delegates, coaches, open exceptions, check-ins, and today's itinerary — each cross-feature read is `try/catch`-wrapped, so it still works if a teammate's table isn't present yet. Only this developer-authored snapshot is sent to the model; it can't query arbitrary rows.
- **Edge cases handled:** low-confidence rows are flagged for manual review (the model returns `null` rather than inventing a passport number); a plain directory with no passport numbers still imports; an ambiguous chatbot question triggers one clarifying question instead of a guess.
- **Partial Chinese:** the assistant replies in the UI's selected language, but Vance's new page labels fall back to English until added to `DICT` in `i18n.jsx`.

---

## Updates since initial merge

This file describes the state right after the three-feature merge. Several
things have since changed; noted here rather than rewriting the sections
above wholesale:

- **5-status delegate model.** The original 3-status system
  (`UNASSIGNED`/`PRESENT`/`MISSING`) expanded to 5:
  `UNASSIGNED → ASSIGNED → ARRIVED → LATE → MISSING`. `PRESENT` is kept as a
  legacy alias mapped to `ARRIVED` in `data.js`'s `normalize()`, so old rows
  and any not-yet-migrated writer keep working. See `PROJECT_STRUCTURE.txt`
  for the full rollout history across Dashboard, TripCoachPage, and mobile.
- **Trip-page reassignment now sets `ASSIGNED`, not `MISSING`.** Dragging a
  delegate onto a coach used to mark them `MISSING` ("still has to prove they
  boarded") — now sets `ASSIGNED`, since `MISSING` is reserved for a genuine
  check-in miss or explicit staff override.
- **Configurable per-trip "Late" cutoff.** `trips."lateCutoffTime"`
  (`"HH:MM"`, default `"10:00"`) replaces a single hardcoded 10am check. A
  background scheduler (`applyLateCutoff()` in `data.js`, runs every 60s) auto-
  flips `ASSIGNED` delegates to `LATE` once their own trip's cutoff passes.
  Editable via a "Trip settings" button on TripCoachPage.jsx
  (`PATCH /api/trips/:tripId/late-cutoff`, gated on `manageTrips`).
- **QR/face-scan → `ARRIVED` migration (2026-07-18).** All live check-in
  writers (`vance.js`'s `/api/onboarding/checkin`, `exceptions.js`'s
  `/api/checkins/manual` and the orphaned `/api/checkins/qr`) now write
  `ARRIVED` instead of the legacy `PRESENT` literal, and re-scan/duplicate
  guards are properly enforced (a re-scan no longer silently re-writes).
  Vimal's `/api/attendance/scan` needed no change — it already went through
  `updateDelegate()`, which already aliased `PRESENT`→`ARRIVED`.
- **Missing status is manual-only, by design.** It is NOT auto-set by any
  scan/check-in flow — it's for a delegate who steps away mid-trip (toilet,
  wandering off) and isn't back by an appointed time, so a staff member marks
  it by hand (with a required last-seen location on mobile).
- **Chat assistant is now a floating bubble**, not a dedicated `/assistant`
  page — `ChatBubble.jsx` (desktop) / `MobileChatBubble.jsx` (mobile) wrap
  the existing chat engines unchanged and render on every route. Both FABs
  stay hidden until the page is scrolled down ~120px, so they don't sit over
  other clickable UI near the top of a page.
- **Field-level rollback** was added to the persisted `activity_log` table —
  most delegate edits can be undone from the History Log page.

---

## Open items for the team

1. **Own database per developer.** Everyone currently shares one Neon database, which causes the "can't log in after clone" issue (see PROJECT_STRUCTURE.txt → "CAN'T LOG IN AFTER CLONING?"). Giving each developer their own Neon DB (free tier allows several) would remove that whole class of problem.
2. **`CANCELLED` ticket status** (Jayden): the exception status enum is `OPEN | RESOLVED` only, so a ticket raised in error is hard-deleted rather than soft-cancelled — losing the audit trail. Adding `CANCELLED` back is a small change but needs a team decision.
3. **SSE vs WebSockets** (Jayden): the live alert channel uses SSE. If Vimal/Vance are assuming WebSockets elsewhere, align before deployment.
4. **Deployment bug in the base** (flagged by Jayden, still open): `frontend/src/lib/api.js` imports `../../../permissions.js` from *outside* `frontend/`. It works locally (Vite `fs.allow`) but a Vercel build rooted at `frontend/` won't have that parent file and will fail. Worth fixing before deployment day.
