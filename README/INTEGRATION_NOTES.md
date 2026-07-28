# Feature Integration Notes

> **Use this file when you're asking "whose file is this, can I touch it, what broke last time someone merged a branch?"** It's organized by feature/contributor and documents ownership boundaries + integration gotchas.
> Asking "what does `X.jsx` do / how does it work?" instead? Use **`PROJECT_STRUCTURE.md`** — organized by file path instead of by feature.
>
> _Example: "Can I edit `vance.js`, and what should I know before merging Vance's next branch?" → this file's Feature 3 section. "How does the Dashboard's KPI row work?" → `PROJECT_STRUCTURE.md`'s `DashboardPage.jsx` entry._

Five people's work makes up MusterGo. **Base** is the foundation everything
else is built on and integrates into; the other four are features merged into
it:

0. **MusterGo Base** — Admin Dashboard, Auth, Accounts & Permissions (Jun Qi / JQ)
1. **TransitFlow** — Trip Booking & Dynamic Coach Management (Desmond)
2. **Exception Logging** — support tickets, critical alerts & manual override (Jayden)
3. **DocuSync AI + Trip Assistant** — AI document parsing (onboarding) + chatbot (Vance)
4. **FaceCheck-Pro** — Privacy-First Biometric & Multi-Modal Fusion Scanner (Vimal)

This file describes what's **actually in the code now**, after integration.
It intentionally differs from the teammates' original hand-off notes, because
a few things changed during the merge (auth was unified onto JQ's signed-JWT
system, features were put behind permissions, and Desmond's database setup was
simplified). Where something changed, it's called out.

## For any AI reading this (any session, any chat)

**Keep this file updated automatically whenever integration-relevant code
changes — don't wait to be asked.** Update this file (not just
`PROJECT_STRUCTURE.md`) whenever: a permission is added/removed/renamed in
`permissions.js` (add it to the "Permissions" section below with what it
gates and its default); ownership of a file/route shifts, or a new file is
added that another teammate's branch might also touch; or a change reads or
writes a column/table another teammate's feature owns (call this out
explicitly, even read-only — that's exactly the kind of integration hazard
this doc exists to flag before a merge goes wrong). Append new points under
the existing "Permissions" section or the relevant numbered Feature section
rather than creating new top-level structure, unless it's a genuinely new
cross-cutting mechanism (like the coach-captain scoping layer) that doesn't
belong to any one Feature section.

---

## Vance v2 integration (2026-07-28) — what was merged and what was deliberately kept

JQ integrated Vance's `v2DocuSync-AI-(Vance)` branch (from the local
`integration/` checkout) into main. Cross-teammate facts everyone should know:

- **New endpoints/tables in `backend/routes/vance.js`** — MusterChat messaging
  (`/api/messages/*`), groups (`/api/groups/*`), WebRTC call signaling
  (`/api/calls/*`); tables `dm_messages`, `call_signals`, `chat_groups`,
  `chat_group_members` (all `CREATE IF NOT EXISTS`, purely additive — no
  existing table touched).
- **Vance's branch was based on a stale main.** His copies of already-fixed
  lines were NOT taken: main keeps `requirePermission("manageDocuments")` on
  the document routes, `requireKioskOrPermission("manageScanner")` + the
  cross-coach guard on `/api/onboarding/checkin`, and the tripUuid
  `createDelegate` history fix. If Vance rebases, he should take MAIN's
  versions of those lines.
- **`/assistant` route is back** (his MusterChat inbox page, gated
  `viewChatbot`); the floating ChatBubble kept JQ's drag/auto-hide shell but
  hosts Vance's AI conversation + unread badge + call overlay.
- **Coach-captain Staff scoping now also applies to message contacts** — a
  scoped Staff account only sees/messages delegates on coaches they captain,
  consistent with every other delegate-reading route.
- **Message media is allowlisted server-side** (`data:video/`/`data:image/`
  or JSON for doc/call cards) — don't relax this; an arbitrary URL stored in
  `media` would beacon every viewer.
- **Known trade-offs accepted at integration time**: the inbox polls hard
  (~1.5s per open thread + 5s contacts + a permanent ~1.5s global call poll
  once the bubble has mounted), and the assistant/contacts are hardcoded to
  trip `t-1` (Vance's design — `resolveTripUuid("t-1")`). Both are candidates
  for later work, not bugs.
- Vance's unit tests live in `tests/vance/` (run from repo root:
  `node --test tests/vance/*.test.js` — 82 tests, all passing post-merge).

## ⚠️ CRITICAL — known gap: no offline support (2026-07-25)

**Read this before doing any more work on attendance/check-in features.**
Client feedback: staff need to be able to take attendance even with **no
internet signal** (common on-site) — this is NOT built yet. Do not assume the
app works offline anywhere; it currently doesn't.

**What's actually true today:**
1. **Login/auth is *mostly* fine already.** A JWT is self-verifying — the
   existing session-check (`useSessionGuard.js`) already tolerates an
   unreachable server (only forces logout on an explicit 401, not on a
   network failure). So the realistic constraint is "online once per shift"
   (log in before losing signal), not continuous connectivity. No urgent
   work needed here.
2. **QR / face scan are EXPECTED to fail offline, by design.** Both need
   server-side data (the real delegate record, the reference photo) to mean
   anything — there's no honest way to verify someone offline. The fix
   needed is just a clear "No connection — use manual check-in" message, not
   a real offline scan capability.
3. **Manual check-in is the actual gap — not yet built.** Needs an offline
   queue ("outbox") + optimistic UI: a failed write gets queued locally (the
   *intended action* — delegate, new status, timestamp, who — not just
   cached data) and replayed against the backend once connectivity returns
   (`online` event + periodic retry), with a "N changes waiting to sync"
   indicator. Plain `localStorage` of data alone does NOT solve this — the
   problem is queuing a WRITE, not caching a read.
4. **A service worker (PWA asset caching) is a separate, also-needed piece**
   — without it, a fully offline phone may fail to load the app at all, not
   just fail API calls.

**Recommendation:** three independently-buildable pieces — (a) tolerate-
offline session handling (mostly already true, low effort), (b) offline
queue for manual check-in writes (the piece that actually addresses the
client's stated concern), (c) service worker for the app shell (supporting
piece, makes (b) usable when the page itself can't load).

**Status: advised only, nothing built yet as of this entry.** If you're an
AI assistant reading this before starting attendance/offline-related work,
surface this section to the user first rather than assuming it's handled.

---

## Quick start (all features)

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
shared database — see PROJECT_STRUCTURE.md), run `npm run reset:login` in
`backend/`.

**No manual database steps.** Every table all three features need is created
automatically when the backend boots — there are no `.sql` files to paste and
no migration command to run.

**AI features need a key or Ollama.** Document parsing and the chatbot (Vance's
feature) need either `ANTHROPIC_API_KEY` in `backend/.env`, or a local Ollama
(`ollama pull llama3.2`) for the text-based paths — see that feature's section.
Everything else works without them.

**New npm packages:** `unpdf` and `tesseract.js` (backend, PDF text extraction
+ offline OCR fallback), `qrcode` (frontend, QR-pass generation), and
`@vitejs/plugin-basic-ssl` (frontend, serves the dev server over HTTPS — see
"Getting a trusted HTTPS cert for local dev" below). `npm install` pulls them
all in.

---

## Getting a trusted HTTPS cert for local dev

`frontend/vite.config.js` serves the dev site over HTTPS (`@vitejs/plugin-basic-ssl`)
because the camera (`getUserMedia`, used by the Face/QR scanners) and the
browser's password-save/autofill only work in a "secure context" —
`https://` or `http://localhost`. A phone reaching the dev server over the LAN
as plain `http://192.168.x.x:5173` gets silently blocked on both.

**Default (zero setup):** the plugin auto-generates a **self-signed** cert on
every `npm run dev`. It works immediately, but every browser flags it as "not
secure" / shows a warning interstitial, because a self-signed cert has no
trusted issuer — that's expected, not a bug, and safe to click through
("Advanced" → "Proceed") on a local dev server.

**If you want that warning gone (recommended if it bothers you or a teammate
on the same LAN):** use [`mkcert`](https://github.com/FiloSottile/mkcert) to
generate a cert your OS actually trusts:

```bash
# 1. Install mkcert (once per machine)
choco install mkcert          # Windows (Chocolatey)
brew install mkcert           # macOS
# Linux: see the mkcert README for your distro's package manager

# 2. Install the local CA into your OS/browser trust store (once per machine)
mkcert -install

# 3. From frontend/, generate a cert covering localhost + your LAN IP
cd frontend
mkcert localhost 127.0.0.1 ::1 192.168.1.11   # swap in your own LAN IP
# → writes localhost+3.pem and localhost+3-key.pem into frontend/
```

Then point `vite.config.js`'s `basicSsl()` call at those files instead of
letting it self-sign:

```js
import fs from "node:fs";
// ...
server: {
  https: {
    cert: fs.readFileSync("./localhost+3.pem"),
    key: fs.readFileSync("./localhost+3-key.pem"),
  },
  // ... rest unchanged; drop basicSsl() from the plugins array once this is set
},
```

Don't commit the generated `.pem`/`-key.pem` files or run `mkcert -install`
on a shared/CI machine — the CA it installs is trusted machine-wide, so this
is a per-developer, per-machine step, not something to bake into the repo.
Re-run step 3 (with your own IP) whenever your LAN IP changes.

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

**Vance's feature originally reused `manageDelegates` rather than adding its own
permission** — document parsing/confirm bulk-creates delegates, which is exactly
what `manageDelegates` already governs, so a separate permission would have been
redundant. **Updated 2026-07-21**: as part of a broader permissions reorganization,
document parsing/confirm now has its own **`manageDocuments`** permission, carved
out of `manageDelegates` (defaults **on** for every existing account, so nobody
silently lost upload access the moment this shipped — an admin can now narrow it
per-account going forward). The `/onboarding` page/sidebar item's *visibility* is
still `viewDocuments` (unchanged); `manageDocuments` gates the actual parse/confirm
writes.

- **The chat assistant** was open to **any signed-in user** with no permission at
  all; now gated on **`viewChatbot`** (desktop) / **`viewMobileChatbot`** (mobile),
  both defaulting **on** for the same "don't silently revoke existing access" reason.

**2026-07-27 — `manageAnnouncements` added, plus a NEW cross-cutting
access-control layer (coach-captain Staff scoping):**

- **`manageAnnouncements`** (action permission, defaults **off**) now gates
  posting/editing/deleting on the new Trip Announcements page
  (`routes/announcements.js`) — separate from `manageAccounts`, which
  previously did this job as a stand-in. Viewing stays on the existing
  `viewAnnouncements` (defaults **on**).
- **Coach-captain-based Staff visibility** (`getVisibleCoachIds()` in
  `db/dashboard.js`) is a NEW, separate mechanism from the permission-toggle
  system above — worth flagging here because it silently changes what data
  several shared read routes return, not just what a UI button does. Built on
  Desmond's **existing** "Coach captain" field (`coaches.account_id`, added
  for the Trips board's Switch-staff modal), which was previously just
  stored/displayed with **no enforcement anywhere**. Now enforced: a Staff
  account only sees delegates/KPIs/coach-status/history/export data for
  coaches THEY personally captain; an uncaptained coach is hidden from Staff
  entirely (not "open to everyone" — a coach with no captain assigned yet is
  simply invisible to Staff until one is). Admin always bypasses, same as
  every other check in this app. A Staff account that captains NO coach on a
  given trip falls back to seeing everything unrestricted (so this doesn't
  silently lock out every existing account the moment it ships).
  **Touches shared files other teammates' branches may also touch**:
  `routes/dashboard.js`, `routes/delegates.js`, `routes/history.js`,
  `routes/export.js` (each now calls `getVisibleCoachIds(tripUuid, req.account)`
  and filters its own result before returning) — reads `coaches.account_id`,
  a column Desmond's `routes/desmond.js` owns/writes, but never mutates it.

---

# Feature 0 — MusterGo Base: Admin Dashboard, Auth, Accounts & Permissions · Jun Qi (JQ)

Not a "merged" feature like the other four — this is the foundation the other
four are built on and integrate into: authentication, the permission system,
the live Dashboard, Account control, and the mobile app shell.

### Files

**Backend:** `server.js` (now just Express bootstrap + mounting — see "Updates
since initial merge" 2026-07-22 for the routes split), `auth.js`, `data.js`
(now a barrel over `db/*.js`), `cloudinary.js`, `reset-login.js`,
`seed-team.js`, `routes/auth.js`/`accounts.js`/`dashboard.js`/`delegates.js`/
`history.js` (JQ's own routes, split out of `server.js` 2026-07-22),
`lib/wrap.js`/`actor.js`/`rateLimit.js` (shared helpers), `routes/insights.js`
(AI insights), `routes/export.js` (Excel export), `routes/media.js`
(Cloudinary photo storage).

**Frontend:** `LoginPage.jsx` and `KioskScannerPage.jsx` at the `pages/` root
(render outside both layouts); everything else moved into `pages/desktop/`
2026-07-22 (mirrors `pages/mobile/`): `DashboardPage.jsx`,
`AccountControlPage.jsx`, `HistoryLogPage.jsx`, `SettingsPage.jsx`,
`UserGuidePage.jsx` (now a 5-tab page), plus `TripsListPage.jsx`,
`BoardingPassesView.jsx`, `ChatAssistantPage.jsx` (embedded sub-views, not
routed directly). Also: `components/Layout.jsx`, `components/Sidebar.jsx`,
`lib/api.js`, `lib/i18n.jsx`, `lib/theme.jsx`, `permissions.js` (root — shared
with the backend, the single source of truth for every permission in the
app — restructured 2026-07-21/22, see its own file for the current full list
and the `parent`/`adminOnly` fields). Also owns the mobile app shell
(`MobileLayout.jsx`, `MobileHomePage.jsx`, `MobileAttendancePage.jsx`,
`MobileTripsPage.jsx`, `MobileProfilePage.jsx`, `MobileIssuesPage.jsx`,
`MobileUserGuidePage.jsx` — new 2026-07-21) and the three scanner surfaces
built on top of Vimal's Face/QR primitives: `UnifiedScannerPage.jsx` (desktop
entrance-kiosk scanner), `KioskScannerPage.jsx` (passwordless entrance kiosk),
`MobileScannerPage.jsx` (mobile-native scanner) — see "Updates since initial
merge" for all three.

**A teammate's local copy predates the 2026-07-22 backend/frontend reorgs** —
if integrating their branch, watch for stale flat-path imports
(`../pages/XPage.jsx` instead of `../pages/desktop/XPage.jsx`) and check
whether they import anything from `data.js` that the new barrel doesn't
re-export (unlikely — verified against every existing consumer at split time).

### Database (created in `createSchema()`/`seed()` in `data.js`)

`accounts`, the base `trips`/`delegates` columns, `activity_log`. Every other
feature's schema is additive on top of this (`ADD COLUMN IF NOT EXISTS`,
`CREATE TABLE IF NOT EXISTS`) — nothing here is ever dropped or renamed for
a teammate's feature.

### Endpoints

**Auth:** `POST /api/auth/login`, `POST /api/auth/reset-password`,
`GET /api/auth/session`, `POST /api/auth/logout`,
`POST /api/auth/kiosk` (mints the passwordless kiosk token — see "Updates
since initial merge").

**Accounts** (needs `manageAccounts`): `GET|POST /api/accounts`,
`PATCH|DELETE /api/accounts/:id`, `GET /api/staff/active-sessions`.

**Dashboard / delegates:** `GET /api/trips`, `GET /api/trips/:id`,
`GET /api/trips/:id/dashboard`, `GET /api/trips/:id/missing`,
`GET|POST|DELETE /api/trips/:id/delegates`, `PATCH|DELETE /api/delegates/:id`,
`POST|DELETE /api/delegates/:id/photo`.

**Activity / history** (edits need `manageDelegates`): `GET /api/activity`,
`DELETE /api/activity[/:id]`, `POST /api/activity/:id/rollback`.

### Permissions system (`permissions.js` — the single source of truth)

- Every permission is one entry: `key, label, desc, chip, default, group`
  (`action` | `desktopView` | `mobileView`).
- `cleanPermissions()` falls back to each permission's own `default` when a
  key is **absent** from stored input (never a hardcoded `false`) — this is
  what let well over a dozen new view permissions roll out over time without
  silently locking out every account that existed before them.
- Two roles only: `admin` (bypasses every check) and `staff` (whatever's
  ticked). `ViewGate` in `App.jsx` does route-level gating on the frontend;
  `requireAuth()`/`requirePermission()` in `auth.js` enforce it on the
  backend for actual writes — the frontend gate alone is never the real
  security boundary.

### Good to know

- **5-status delegate model** (`UNASSIGNED → ASSIGNED → ARRIVED → LATE →
  MISSING`) lives here (`data.js`'s `normalize()`/`updateDelegate()`), and
  every teammate's check-in writer goes through it.
- **Field-level activity log + rollback** — most delegate edits are undoable
  from the History Log page.
- The mobile app shell (`MobileLayout.jsx`'s bottom-tab nav) and the desktop
  `Layout.jsx` sidebar are both driven by the SAME permissions object, so a
  permission unchecked in Account control disappears from both nav rails and
  both route trees automatically — no per-feature nav-hiding code needed.
- **Chinese/English toggle** (`i18n.jsx`) and **light/dark theme**
  (`theme.jsx`) are app-wide and shared by every teammate's page for free —
  no per-feature i18n/theme code needed. Every string in the app (base +
  all four merged features) has a `DICT` entry as of 2026-07-21.
- Login → dashboard/mobile-home auto-routing and the passwordless entrance
  kiosk are both 2026-07-21 additions — see "Updates since initial merge"
  below for the full detail on both.

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
- **Fully bilingual as of 2026-07-21** — every string on the board has a `DICT` entry in `i18n.jsx` (verified with a project-wide `t()`-key audit, 0 missing).

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

**Screens:** 4 (Document Parsing / Onboarding) and 6 (Trip Assistant).
Three things in one module:

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
  `/api/checkins/qr`, and it's the same endpoint the passwordless kiosk
  scanner and the mobile scanner's QR mode both call (see "Updates since
  initial merge" below).

### Files

**New:**
- `backend/routes/vance.js` — all APIs (parsing, boarding passes, assistant), plus its own lazy schema setup.
- `frontend/src/lib/claudeParse.js` — parse / confirm / badges / check-in bridge used by the onboarding page.
- `frontend/src/pages/BoardingPassesView.jsx` — pass desk: search/filter, per-coach list, view/print a pass.
- `frontend/src/components/TripPulse.jsx` — header status widget: onboarding progress (Onboarding tab) / ranked "what to watch" risks (Assistant).

**Replaced (were placeholders/demos before):**
- `frontend/src/pages/OnboardingPage.jsx` — real upload → parse → review → confirm flow (2 tabs: parse / boarding passes).
- `frontend/src/pages/ChatAssistantPage.jsx` — real streaming chatbot with saved history.
- `frontend/src/pages/mobile/MobileAssistantPage.jsx` — the mobile chat, real AI.

**Edited during merge:**
- `backend/server.js` — mounted in the TEAMMATE ZONE (`import vanceRouter` + `app.use`).
- `backend/package.json` — added `unpdf` (PDF text extraction) and `qrcode` (frontend QR-pass generation).
- `frontend/src/App.jsx` + `frontend/src/components/Sidebar.jsx` — the `/onboarding` route and its "Documents" nav item are now gated behind `manageDelegates` (matching the backend), so an account without it doesn't land on a page that would 403.

*(Auth needed no rewrite — unlike Jayden's, Vance's router already used JQ's `requireAuth`/`requirePermission` from `auth.js`.)*

### Database (auto-created lazily in vance.js on first use, additive only)

- `delegates` — `ADD COLUMN IF NOT EXISTS` for `passport_no, nationality, passport_expiry, role, industry, email, phone, website, qr_code` (+ a partial unique index on `qr_code`). Reuses Desmond's existing `company`.
- `chat_sessions` (incl. `pinned`), `chat_messages` — saved assistant history, one set per account.

### Endpoints

**Document parsing & onboarding** (needs `manageDelegates` unless noted):
| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/documents/parse` | `manageDelegates` | Synchronous parse → structured rows + confidence |
| POST | `/api/documents/parse-async` | `manageDelegates` | Start a **background** parse job (returns `jobId`) |
| GET | `/api/documents/parse-async/:id` | signed-in | Poll job: `status`, `done/total`, streamed `rows` |
| GET | `/api/onboarding/context` | signed-in | Existing delegate names (dedup) + coaches |
| POST | `/api/trips/:id/onboarding/confirm` | `manageDelegates` | Commit rows to shared `delegates`; mints a `qr_code` each |

**QR boarding passes & check-in** ⭐ shared contract:
| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/onboarding/badges` | signed-in | Delegates + generated `qr_code` for the printable passes |
| POST | `/api/onboarding/checkin` | signed-in, **or a passwordless kiosk token** (`requireKioskOrAuth`) | Resolve a scanned `qr_code` → `ARRIVED` (+coach) → `check_in_logs` |

**Trip assistant (chatbot)** (any signed-in user):
`POST /api/chat/messages` (mobile, stateless), `GET|POST /api/chat/sessions`,
`GET|PATCH|DELETE /api/chat/sessions/:id`, `POST /api/chat/sessions/:id/messages`,
`POST /api/chat/sessions/:id/stream` (live SSE token streaming), `.../regenerate`,
`GET /api/assistant/roster` (delegate details → clickable cards),
`GET /api/assistant/pulse` (compact live status for the header widget).

### Connective tissue (how this integrates with the team)

- **Onboarding writes to the SHARED `delegates` table** via JQ's `createDelegate()`, scoped to the trip at creation — so a parsed delegate appears on JQ's dashboard, Desmond's Trips board, and the check-in module with no sync step.
- **The QR boarding pass is the badge contract.** `BoardingPassesView` encodes the delegate's plain `qr_code` (e.g. `MG-86B620A4`) from the shared `delegates` table. Jayden's `QRScannerPanel.jsx` (now shared by the desktop `/scanner` page, the mobile `/mobile/scanner` page, and Vimal's `QRCheckInPage`) scans that code and registers it through `POST /api/onboarding/checkin` (via `qrCheckin()`), which flips the delegate to `ARRIVED` (+coach) and writes a `check_in_logs` QR row. Desmond's coach board counts `ARRIVED`/`PRESENT` by coach and JQ's head-count agrees. **`qr_code`, `/api/onboarding/checkin` and `qrCheckin()` are load-bearing for every scanner surface in the app: do not remove them.**
- **Trip scoping uses `resolveTripUuid()`** (a local helper in `vance.js`, kept self-contained rather than editing JQ's `data.js`) everywhere a trip id arrives from the client. It resolves the trip by either the `trips.id` string (`"t-1"`) or its `uuid_id` (what `GET /all-trips` returns). `confirm` returns `404 UNKNOWN_TRIP` instead of writing orphans when a trip can't be resolved.

### AI providers (deliberate, cost-aware split)

- **Document parsing — text-first, vision-fallback (hybrid):**
  1. PDFs are read as **text server-side** with `unpdf`. If real text is present, it's structured by an LLM as text — cheap, fast, page-by-page, and runs on free local Ollama.
  2. Scanned images (no extractable text) fall back to **vision**: Claude vision if `ANTHROPIC_API_KEY` is set, else **local Tesseract OCR** (`method: "ocr/tesseract"`) so passport/ID photos work fully offline. (Scanned image-only PDFs aren't rasterised; upload them as an image.)
  Structuring prefers Claude if `ANTHROPIC_API_KEY` is set (best accuracy), else Ollama `OLLAMA_PARSE_MODEL` (default `llama3.2`, 3B). Bilingual (中文/English) names collapse to the romanised name; placeholder/garbage names are dropped.
- **Chatbot — Ollama-first, Claude fallback** (mirrors JQ's `insights.js`). Uses `OLLAMA_MODEL` (`llama3.2:1b` for demo speed); replies **stream token-by-token** over SSE. Attendance figures are pre-computed into the snapshot so even a small model reports exact numbers — AI handles language, code handles arithmetic.
- **Deterministic fast-path (`answerLocally`)** — common factual questions (attendance, present/missing/unassigned, coach superlatives, company/industry breakdowns, VIPs, exceptions, itinerary, named delegate look-ups) are answered **instantly from the snapshot with no model call**. Open-ended/generative questions and any Chinese question fall through to the LLM. Because the fast-path needs no model, the assistant still answers common factual questions even where no AI engine is reachable at all.
- **Passport-expiry validation (`checkPassportExpiry`)** flags delegates whose passport is expired or expiring within 6 months. Surfaced three ways: a review-time pill on the onboarding cards, a fast-path assistant intent, and a `computeRisk` item so it appears in the "what to watch" widget too.
- **Risk scoring (`computeRisk`)** ranks what to worry about — missing VIPs and CRITICAL exceptions first, then the coach furthest from boarded, then ordinary open tickets. Powers both the fast-path "who should I worry about" answer and a ranked `PRIORITIES` block in the model prompt.
- **Snapshot cache + model warm-up:** `getSnapshot()` caches the ~6-query snapshot for 5s (invalidated on confirm and QR check-in); a fire-and-forget warm-up call preloads the chat model so the first question doesn't pay the ~20-30s cold load.
- If neither Claude nor Ollama is configured, each feature returns a clear "not configured" message, never a crash.

### Good to know / edge cases handled

- **Writes to the SHARED `delegates` table** via JQ's own `createDelegate()`, so a parsed delegate instantly appears on the Dashboard, the Trips board, and the Exception delegate-picker — no separate table, no sync.
- The chatbot reads a snapshot spanning delegates, coaches, open exceptions, check-ins, and today's itinerary — each cross-feature read is `try/catch`-wrapped, so it still works if a teammate's table isn't present yet. Only this developer-authored snapshot is sent to the model; it can't query arbitrary rows.
- **Low-confidence extraction:** rows below the threshold are flagged "Needs review" and are editable inline; the model returns `null` rather than inventing a field. A directory with no passport numbers still imports fine.
- **Big documents:** async job with progress; the admin can leave the page and re-attach — parsing continues server-side.
- **Duplicates / junk rows:** rows already in the trip are flagged and skipped on confirm; `onboarding/confirm` also skips implausible rows (e.g. a stray 1-2 char test entry with no supporting field) and returns `skippedInvalid` alongside `added`.
- **Unknown / already-scanned QR:** check-in returns a clear message (404 unknown, "already boarded" otherwise), resolved from the delegate's own trip record so a mistyped `tripId` can't file against the wrong trip.
- **Ambiguous chatbot query:** the prompt asks ONE clarifying question rather than guessing; out-of-scope questions are politely declined.
- **Chinese is fully covered** — every string this feature introduces (onboarding review states, boarding passes, the assistant's placeholder copy, TripPulse) has a `DICT` entry in `i18n.jsx` as of 2026-07-21; nothing falls back to English anymore.

### Env (`backend/.env`, see `.env.example`)

```
DATABASE_URL=postgresql://...neon.tech/...?sslmode=require   # shared team Neon
OLLAMA_MODEL=llama3.2:1b        # chatbot model (fast). Omit for llama3.2 (3B, more accurate)
# OLLAMA_PARSE_MODEL=llama3.2   # parsing model (defaults to llama3.2 / 3B)
# ANTHROPIC_API_KEY=sk-ant-...  # optional: enables Claude vision (scanned docs) + higher accuracy
```

The chatbot and text-based parsing work fully offline on Ollama; a Claude key is only needed to read **scanned/image** documents (vision).

---

# Feature 4 — FaceCheck-Pro: Privacy-First Biometric & Multi-Modal Fusion Scanner · Vimal

The `/checkin` page (phone-frame staff app): live per-coach Reverse Headcount
plus Face/Voice scanning that resolves an anonymous biometric token to a
missing delegate in under 1 second, with **zero images or audio ever
touching the server**.

### Files

**New:**
- `backend/routes/vimal.js` — all attendance/scan/consent/history endpoints.
- `frontend/src/pages/QRCheckInPage.jsx` — the phone-frame staff app (Trip → coach → Reverse Headcount → scan).

**Reused elsewhere:** the Face vectorizer + biometric-token validator were
extracted into `frontend/src/lib/faceScan.js` so the desktop
`UnifiedScannerPage.jsx`, the mobile `MobileScannerPage.jsx`, and the
passwordless `KioskScannerPage.jsx` (all JQ-side additions, see "Updates
since initial merge") share Vimal's original zero-image logic instead of
each keeping its own copy.

### Database

No new tables — reads/writes the SHARED `delegates` table via JQ's
`listDelegates()`/`updateDelegate()`/`createDelegate()`. Consent lifecycle +
per-delegate check-in history are kept **in-memory** (Vimal-owned
bookkeeping, not persisted — resets if the backend restarts).

### Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/attendance/coaches` | signed-in | Trip meta + every coach with live counts, for the mobile dashboard |
| POST | `/api/attendance/scan` | signed-in, **or a passwordless kiosk token** (`requireKioskOrAuth`) | Resolve a face/voice token → the matching `MISSING` delegate → `ARRIVED` |
| GET | `/api/attendance/:trip_id/coach/:coach_id` | signed-in | Reverse Headcount for one coach (roster + consent flags) |
| GET | `/api/attendance/headcount` | signed-in | Boarded/missing/unassigned stats + the missing-delegate call list |
| POST | `/api/attendance/consent` | signed-in | Grant/revoke biometric consent; stores only an irreversible checksum, never the token/image |
| GET | `/api/attendance/history/:delegate_id` | signed-in | This delegate's check-in history across venues |
| POST | `/api/attendance/assign-unassigned` | signed-in | Muster-prep: move `UNASSIGNED` delegates onto a coach as `MISSING` |
| POST | `/api/attendance/demo-seed` | signed-in | Seed a small named demo roster onto an empty coach |

### Good to know

- **PDPA privacy design:** the server NEVER receives or stores an image or
  audio clip. `scanData` is always an irreversible one-way token string
  (`face:v1:…` / `voice:v1:…`) produced client-side; even a full DB leak
  exposes no biometric imagery, only meaningless checksums.
- **1-second SLA:** `processedInMs` is returned on every scan so the client
  can flag a scan that took >1s as a retry rather than silently accepting a
  slow match.
- **Matching is coach-scoped** when a `coachId` is supplied, so mustering one
  coach never matches a delegate expected on another.
- **Coaches are dynamic** — every lookup goes through JQ's `getDashboard()`,
  so coaches Desmond's module adds later (c5, c6, …) work here with zero
  code change.
- **Fixed 2026-07-21:** the coach-detail and headcount endpoints' "boarded"
  counts only checked the legacy `PRESENT` status, undercounting delegates
  already `ARRIVED` via QR/manual/kiosk check-in — both now match the same
  `status === "PRESENT" || status === "ARRIVED"` pattern as `data.js`.

---

## Updates since initial merge

This file describes the state right after the three-feature merge. Several
things have since changed; noted here rather than rewriting the sections
above wholesale:

- **5-status delegate model.** The original 3-status system
  (`UNASSIGNED`/`PRESENT`/`MISSING`) expanded to 5:
  `UNASSIGNED → ASSIGNED → ARRIVED → LATE → MISSING`. `PRESENT` is kept as a
  legacy alias mapped to `ARRIVED` in `data.js`'s `normalize()`, so old rows
  and any not-yet-migrated writer keep working. See `PROJECT_STRUCTURE.md`
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
- **Passwordless entrance-kiosk scanner (2026-07-21).** New route `/kiosk-scan`
  (`KioskScannerPage.jsx`), reachable straight from the Login page's "Quick
  Scanner Access" link with **no sign-in at all**. It mints a short-lived,
  narrowly-scoped kiosk JWT (`POST /api/auth/kiosk`, `signKioskToken()` in
  `auth.js`) that a new `requireKioskOrAuth()` middleware accepts ONLY on
  `POST /api/attendance/scan` and `POST /api/onboarding/checkin` — every other
  route still requires a real session. The token maps to a hidden `__kiosk__`
  backing account (seeded once in `data.js`, excluded from `listAccounts()`)
  for FK-safety, and lives only in a React ref in the browser (never
  localStorage), so it can't leak into or affect a real login on the same
  device. Face + QR only — no Manual mode, since manual override stays behind
  a real login.
- **Mobile-native scanner (2026-07-21).** New route `/mobile/scanner`
  (`MobileScannerPage.jsx`) brings the same Face/QR/Manual scanner inside the
  logged-in mobile app (gated on the new `viewMobileScanner` permission,
  linked from a card on Mobile Home), with a front/rear camera flip button
  (defaults to the front/selfie camera) — the same flip control was added to
  `QRScannerPanel.jsx` (now takes a `facingMode` prop) and the kiosk scanner.
- **Two new granular mobile permissions:** `viewMobileScanner` and
  `viewMobileIssues` (both `mobileView` group, default on) — an admin can now
  hide the mobile scanner or the mobile Issues page per-account, same as every
  other `viewX` toggle.
- **Login page simplified + auto-routing (2026-07-21).** The "Login for
  Mobile" button is gone — there's a single "Sign in" button now. `App.jsx`'s
  `handleSignIn` derives desktop vs. mobile automatically from the account's
  own permissions instead: mobile-only perms → mobile UI, desktop-only →
  desktop UI, both → current viewport width decides, a single allowed page →
  straight to that page. See `pickModeFromPermissions()` in `App.jsx`.
- **HTTPS on the dev server** (`@vitejs/plugin-basic-ssl`) so the camera and
  password-autofill work when a phone reaches the dev server over the LAN —
  see "Getting a trusted HTTPS cert for local dev" above.
- **Fixed: all new-account creation was silently broken** (500 error on
  `POST /api/accounts`) — the `__kiosk__` seed account's non-numeric id
  (`"u-kiosk"`) broke `nextAccountId()`'s `MAX(CAST(... AS INTEGER))` query for
  every account, not just kiosk-related ones. Fixed by scoping that query to
  ids shaped like `u-<number>` (`backend/data.js`).
- **Fixed: inconsistent "boarded" counts.** Several endpoints only checked
  `status === "PRESENT"` for a boarded/already-checked-in delegate, undercounting
  anyone whose status was the modern `ARRIVED` value. All boarded-count checks
  now match `data.js`'s own `status === "PRESENT" || status === "ARRIVED"` pattern.
- **Manual check-in "Undo"** — `POST /api/checkins/manual/undo`
  (`manageExceptions`-gated) reverts the most recent manual check-in back to
  `ASSIGNED`, surfaced as an inline "Undo" button in `ManualTrackingPanel.jsx`.
- **Chinese translation audit (2026-07-21).** Every `t()` call across the
  entire frontend was cross-checked against `i18n.jsx`'s dictionary; 36
  missing keys were filled in and 3 duplicate keys removed. 0 missing, 0
  duplicates as of this writing.
- **`backend/server.js` split (2026-07-22).** JQ's own routes (auth, accounts,
  dashboard reads, delegate CRUD, activity/history) moved out of the single
  ~550-line `server.js` into `backend/routes/{auth,accounts,dashboard,
  delegates,history}.js`; shared helpers (`wrap`, `actorOf`, the auth rate
  limiter) moved into `backend/lib/{wrap,actor,rateLimit}.js`. `server.js`
  itself is now ~140 lines — just Express bootstrap, middleware, and mounting
  every router (JQ's + every teammate's, unchanged mount points). `auth.js`'s
  own duplicate local `wrap()` was deduped into an import from `lib/wrap.js`.
  Verified via a full live smoke test (login/session/logout, RBAC-gated
  routes, kiosk mint + scan, every teammate router, the 404 fallback) —
  zero behavior change.
- **`frontend/src/pages/desktop/` folder (2026-07-22).** All 15 desktop-shell
  pages (the 7 sidebar pages plus History/Settings/User Guide and 3 embedded
  sub-views) moved out of the flat `pages/` root into `pages/desktop/`,
  mirroring the existing `pages/mobile/` pattern. `LoginPage.jsx`/
  `KioskScannerPage.jsx` stayed at the root (they render outside both
  layouts). Every relative import was updated for the new depth; confirmed
  via `git status` that all 15 moves tracked as renames (history preserved),
  and `vite build` produces an identical output bundle.
- **Permission nesting + tabbed User Guide (2026-07-22).** `viewHistory` now
  nests under `viewDelegates` (`viewDashboard → viewDelegates → viewHistory`,
  2 levels deep) — `AccountControlPage.jsx`'s checkbox renderer became a
  recursive `PermRow` to support it. Desktop `UserGuidePage.jsx` was rewritten
  into a 5-tab page (Getting Started / Dashboard & Metrics / Live Trip &
  Attendance / Scanner & Kiosk / Account & Permissions); a new
  `MobileUserGuidePage.jsx` fixes a bug where the mobile "User guide" link
  used to render the desktop guide with desktop chrome.
- **Dashboard KPI redesign (2026-07-22).** Added an `assigned` count to
  `getDashboard()`'s `kpis`. Desktop folded Arrived/Assigned/Unassigned into
  one "Roster breakdown" card (a proportional bar + 3 compact stats) instead
  of 5 equal-weight tiles; mobile Home added a 4th tile in a 2×2 grid.
- **Fixed: mobile Attendance filter-chip colors.** Every selected filter chip
  except Missing rendered green (`badge-present`) regardless of which status
  it actually was — selecting "Assigned" visually read as "Arrived". Each
  status now keeps its own color (`badge-assigned`/`badge-late`/etc.) when
  selected.
- **Unified delegate profile panel (2026-07-23, branch `InsightMetrics-(JQ)`).**
  `DashboardPage.jsx`'s three separate delegate popups (the edit modal's
  read-only info block, the checkpoint-timeline modal, and the location-map
  modal) merged into one scrollable profile panel opened by clicking a
  delegate. Adds a photo lightbox (click to enlarge) and a pre-upload
  crop/zoom step, `PhotoCropModal` — plain canvas, no new dependency.
- **Pagination/search/filter retrofitted onto 3 previously-unbounded lists
  (2026-07-23).** Account Control's Accounts table (full pagination + a
  per-page "select all" scoped to the visible page), the History Log page
  (search + trip/coach filters), and Staff Operations' Active-sessions list
  (search/role filter + a responsive card grid). The History Log filters
  needed a backend join in `backend/db/history.js` —
  `activity_log.trip_id` joins to `trips.uuid_id`, **not** `trips.id` — worth
  flagging since that's an easy mistake for anyone else querying this table.
  The Active-sessions card grid uses `auto-fill`, not `auto-fit`, for
  `grid-template-columns`: `auto-fit` stretches a lone result to fill the
  whole row, which read as a layout bug. Both the Accounts table and the
  All-delegates table now default to 10 rows/page.
- **Analytics panel rework (2026-07-23).** `AnalyticsPanel.jsx` split into
  Overview / Custom-chart tabs. The custom chart builder lets a user pick a
  chart type + group-by field directly, or describe the chart in natural
  language via a new bounded AI endpoint, `POST
  /api/trips/:id/analytics/ai-chart` (`backend/routes/insights.js`),
  Ollama-then-Anthropic fallback matching the existing AI Insights pattern —
  the model only ever picks from a fixed enum of chart types/fields, it never
  touches raw data directly. The Filter/Sort/Customize control panels were
  also restyled (dashed border, tinted background, a matching icon per
  panel) and laid out in one row instead of stacked, after feedback that they
  were visually indistinguishable from the actual chart/data cards.
- **Full Role Template system (2026-07-23).** Account Control's "Manage
  roles" screen is now persisted CRUD — `role_templates` table
  (`backend/db/schema.js`), CRUD in `backend/db/accounts.js`, 4 routes in
  `backend/routes/accounts.js`, all gated on `manageAccounts` — replacing an
  earlier hardcoded 2-template version. **A real seeding race condition was
  caught and fixed here:** the original seed check was "does any
  `role_templates` row exist at all", wrapping two sequential inserts, so a
  `node --watch` restart landing mid-seed left one row permanently missing
  (the gate was already "satisfied" by the partial insert). Fixed to a
  per-row idempotent check. `AccountControlPage.jsx` now extracts a shared
  `PermissionCheckboxGroups` component used by both the account modal and the
  role editor, so the two checkbox UIs structurally cannot drift apart.
  Follow-up UX pass: the "Manage roles" button moved from inside the
  New/Edit account modal onto the main Accounts page, and the Access column
  now shows the matched role template's name as one badge instead of a
  wrapped row of permission chips.
- **Chinese translation completeness sweep (2026-07-23).** Every `t("...")`
  call in the entire frontend — every teammate's pages included, since they
  all import this one shared `i18n.jsx` dictionary — was diffed against the
  dictionary; 157 missing keys were added. Verified 0 missing / 0 duplicate
  afterward. **For teammates:** if you add a new `t("some new string")` call
  in your own files going forward, it needs a matching entry in `i18n.jsx`'s
  `DICT` object or it silently renders in English regardless of the language
  toggle. `i18n.jsx` is JQ-owned but shared by everyone — it's just a flat
  key→string dictionary with low collision risk, so add your own new-string
  entries there directly rather than asking JQ to do it.
- **Housekeeping (2026-07-23).** Deleted two untracked stray files that
  weren't part of the real app: `README/_dates_tmp.txt` (a leftover
  grep-output scratch file) and `frontend/out.tmp.css` (a leftover
  build-check artifact). Renamed `README/AI Log for claude.md` →
  `README/Jun Qi - AI Log.md`, and deleted the stale, superseded
  `README/AI Log for claude - backup.md` (an older narrative log that
  stopped at 2026-07-14 with no update since, while the renamed condensed log
  already covers that period plus everything since).
- **No cross-teammate impact this batch.** Everything above (branch
  `InsightMetrics-(JQ)`) touched only JQ-owned files —
  `DashboardPage.jsx`, `AccountControlPage.jsx`, `AnalyticsPanel.jsx`,
  `HistoryLogPage.jsx`, `i18n.jsx`, `backend/db/schema.js`,
  `backend/db/accounts.js`, `backend/db/history.js`,
  `backend/routes/accounts.js`, `backend/routes/insights.js` — no
  teammate's file was edited. The one item worth a teammate's attention
  going forward is the `i18n.jsx` convention note above. Verified with an
  `esbuild` bundle-check + a full `vite build` after every change (clean,
  only the pre-existing chunk-size warning) plus a live `curl` test against
  the running dev backend for the History Log join.

---

## Open items for the team

1. **Own database per developer.** Everyone currently shares one Neon database, which causes the "can't log in after clone" issue (see PROJECT_STRUCTURE.md → "CAN'T LOG IN AFTER CLONING?"). Giving each developer their own Neon DB (free tier allows several) would remove that whole class of problem.
2. **`CANCELLED` ticket status** (Jayden): the exception status enum is `OPEN | RESOLVED` only, so a ticket raised in error is hard-deleted rather than soft-cancelled — losing the audit trail. Adding `CANCELLED` back is a small change but needs a team decision.
3. **SSE vs WebSockets** (Jayden): the live alert channel uses SSE. If Vimal/Vance are assuming WebSockets elsewhere, align before deployment.
4. **Deployment bug in the base** (flagged by Jayden, still open): `frontend/src/lib/api.js` imports `../../../permissions.js` from *outside* `frontend/`. It works locally (Vite `fs.allow`) but a Vercel build rooted at `frontend/` won't have that parent file and will fail. Worth fixing before deployment day.
