# MusterGo — Project Implementation Phase Plan

**Project:** SCCCI Real-Time Headcount (Problem Statement #10)
**Team:** VJMDynamics — Vance (Lead), Vimal, Desmond, Jun Qi, Jayden
**Final submission target:** **Sunday, 14 June 2026**
**Build mode:** QR-primary. Facial recognition is deferred — **Vimal owns QR check-in workflows** for this phase.

---

## 0. Timeline reality check

The final-submission target (Sun 14 Jun 2026) is effectively a **final-sprint window**, so this
plan is written as a compressed four-phase push rather than a multi-week schedule. The phases are
sequential in dependency but run with heavy parallelism across the five members. Each phase below
lists an indicative block within the sprint; reorder freely as long as Phase 1 (the shared
foundation) lands before anyone builds feature UI against it.

| Phase | Focus | Indicative block | Gate to next phase |
|---|---|---|---|
| **Phase 1** | Foundation & Database | Sprint start → +6h | Migrations run; API skeleton boots; auth works |
| **Phase 2** | Core Features (per module) | +6h → +20h | Each member's CRUD + happy path demoable |
| **Phase 3** | Offline Sync & Polish | +20h → +28h | Outbox flush + idempotency verified offline→online |
| **Phase 4** | Integration & Testing | +28h → Sun 14 Jun | Integrated build runs end-to-end; demo data loaded |

---

## Phase 1 — Foundation & Database

*Goal: a running monorepo where every member can develop against a live API and schema.*

**Shared / Vance (Lead) — coordinates**
- Initialise the `VJMDynamics-NYP-x-SCCCI` repo branches (`main`, plus one feature branch per member) and protect `main`.
- Stand up the backend skeleton: `app.js`, gateway middleware (auth, validate, idempotency, errorHandler, rateLimit), `config/db.js` pg pool.
- Author and run migration `001_init.sql` (the full DDL — Users, Trips, Coaches, Delegates, Documents, Check-in Logs, Exception Tickets, Itinerary, Chat).
- Build the shared **auth module** (login, Workpass stub, JWT issue/verify, role guard) — accounts feature is shared per the brief.
- Scaffold the React app (Vite), routing in `App.jsx`, `tokens.css` (SCCCI Red + five-state palette), `lib/api.js`, `Layout` + `Sidebar`.
- Write `002_seed_dev.sql`: the "Beijing study mission" trip, 4 coaches, ~158 delegates, sample exceptions — so everyone shares realistic demo data.

**Vimal**
- Confirm QR encode/decode library choice (e.g. `html5-qrcode`) and prototype a scan that resolves a delegate `id` from a QR payload.
- Define the QR badge payload format with Vance (signed delegate token vs raw id).

**Desmond**
- Validate the Trips/Coaches schema against the itinerary UI needs; flag any missing columns now.

**Jun Qi**
- Define the dashboard KPI query shapes (missing / present / unassigned / open exceptions) against the seeded data.

**Jayden**
- Define the exception priority → push behaviour mapping (CRITICAL pushes to all staff devices).

---

## Phase 2 — Core Features

*Goal: every member's module is independently demoable (CRUD + enhanced capability happy path).*

**Vance — AI Document Parsing & Onboarding + Chatbot**
- Build the **Onboarding / Document Upload page** (full UI — see base code): drag-drop upload, per-file status, parse-preview table, confidence badges, inline edit, confirm.
- Backend `documents` module: upload endpoint, `claudeParser.js` wrapper calling the shared Claude seat to extract `{ fullName, passportNumber, nationality, passportExpiry, confidence }` from passport PDFs.
- Implement the **blurry-document alternative flow**: low-confidence rows flagged `needsReview`, editable manually before confirm.
- `delegates` CRUD + `/documents/:id/confirm` bulk insert with duplicate-passport guard.
- Build the **Trip Assistant** (Screen 6): chat sessions, `claudeAssistant.js` answering NL queries over live attendance data, clarifying-question flow for ambiguous coaches, auto-titling sessions.

**Vimal — QR Check-in (primary high-speed method)**
- Mobile-web QR scanner page: camera frame, scan → resolve delegate → optimistic "boarded" confirmation.
- `checkins` CRUD: `POST /checkins` records a `QR` method log; updates delegate `status = PRESENT`.
- Success/failure feedback (tone + visual), and the **scan-fail → manual override** hand-off to Jayden's flow.
- Live headcount counter on the scan screen (`X of Y boarded`).

**Desmond — Trip Booking & Dynamic Coach Management**
- Trips & Coaches CRUD; itinerary editor (today's schedule strip).
- **Coach Assignment board** (Screen 3): columns per coach + Unassigned; **drag-and-drop** reassignment calling `PATCH /delegates/:id/coach`.
- Capacity-override warning when target coach is full (alternative flow).
- Real-time manifest recount for both source and target coaches.

**Jun Qi — Admin Dashboard & Analytics**
- Dashboard (Screen 2): KPI tiles (Missing right now / Present / Unassigned / Open exceptions), coach status bars, live activity feed.
- **Reverse-headcount missing view**: photos + names of delegates not yet present.
- **Excel export**: `GET /trips/:id/export?format=xlsx` generating the attendance report.

**Jayden — Exception Logging & QR Fallback**
- Exception ticketing CRUD; Exception Inbox (Screen 5) with All / Critical / Open / Resolved filters.
- **Log Exception** mobile flow (Screen 10): issue type, delegate picker, quick note, "Mark as critical" → push to all staff.
- Manual attendance override (count a delegate present without a scan).
- QR-fallback identification path shared with Vimal's scanner ("Can't scan? → Log exception").

---

## Phase 3 — Offline Sync & Polish

*Goal: the staff PWA works on a flaky connection with zero data loss.*

**Vance (Lead) — owns the sync contract**
- Implement `lib/offlineQueue.js` (IndexedDB outbox) and the `POST /checkins/sync` batch endpoint with `client_event_id` idempotency.
- Wire `service-worker.js`: cache the active-trip manifest + Background Sync registration.

**Vimal**
- Route QR check-ins through the offline queue: write to outbox first, optimistic UI, flush on reconnect.
- Verify a delegate scanned offline appears `PRESENT` after sync with no duplicate log.

**Jayden**
- Route exception tickets through the same outbox; verify locally-queued tickets sync and de-dup correctly.

**Desmond**
- Coach reassignment offline path: last-write-wins by `clientTs`; confirm both manifests reconcile after sync.

**Jun Qi**
- Add the **offline-mode indicator** + "last synced HH:MM" banner; show last known missing list when network drops (alternative flow).

**All**
- UI polish pass against the Figma: SCCCI Red consistency, five-state status colours, mobile responsiveness, keyboard focus.

---

## Phase 4 — Integration & Testing

*Goal: one integrated build that demos end-to-end with prepared data.*

**Vance (Lead)**
- Merge all feature branches into `main`; resolve conflicts early; run the full migration + seed on a clean DB.
- Smoke-test the golden path: login → upload passports → parse → confirm delegates → assign coaches → QR check-in → missing list → raise critical exception → chatbot query → export.
- Assemble AI logs for submission (required by the assignment brief).

**Vimal** — QR check-in regression: success, fail→manual, offline→sync, duplicate-scan idempotency.
**Desmond** — Reassignment regression: drag-drop, capacity override, offline reconcile.
**Jun Qi** — Dashboard counts reconcile with raw logs; Excel export opens correctly; offline indicator behaves.
**Jayden** — Exception lifecycle: raise → critical push → resolve; QR-fallback path.

**Team — final deliverables checklist**
- [ ] Integrated app runs from a clean clone (`docker-compose up`).
- [ ] Demo dataset seeded (Beijing study mission, 158 delegates).
- [ ] Git history shows regular, meaningful commits per member.
- [ ] AI logs exported and attached.
- [ ] Each member's feature shows CRUD **and** enhanced capability.
- [ ] Facial recognition fully removed; QR documented as primary method.
- [ ] README updated with run instructions and feature → member map.

---

## Appendix — Feature ↔ Member ↔ Use Case map

| Member | Module | Core CRUD | Enhanced capability | Use case |
|---|---|---|---|---|
| **Vance** (Lead) | AI Document Parsing & Chatbot | Manage delegate profiles & travel docs | Claude PDF passport extraction → attendee list; NL trip assistant | UC1 Onboarding, UC2 Attendance/Exception chatbot |
| **Vimal** | QR Check-in *(was Face Recognition)* | Manage check-in records & statuses | High-speed **QR** check-in (primary) + manual fallback | UC3 High-speed coach check-in |
| **Desmond** | Trip Booking & Coach Management | Manage trips, coaches, itineraries | Drag-and-drop dynamic coach reassignment | UC4 Dynamic reassignment |
| **Jun Qi** | Admin Dashboard Analytics | Manage dashboard views & queries | Reverse-headcount missing list + Excel export | UC5 Missing-person identification |
| **Jayden** | Exception Logging & QR Fallback | Manage support tickets | QR-fallback identification + critical-exception push | UC6 Manual override & exception logging |
