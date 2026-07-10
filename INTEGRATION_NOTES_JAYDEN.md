# Exception Logging — Integration Notes (Jayden)

My feature is now integrated into the VJMDynamics base repo. This file records exactly what was added, the one shared line I had to touch, and the decisions that need a team ruling.

## Files I added (all mine)

```
backend/routes/exceptions.js          Feature router: tickets, alerts, manual override, SSE
backend/seed-demo.js                  Demo roster + sample tickets  (npm run seed:demo)
frontend/src/lib/exceptionsApi.js     Data layer, built on the shared lib/api.js
frontend/src/components/LogExceptionModal.jsx
frontend/src/pages/ExceptionInboxPage.jsx    (replaces the scaffold tagged "Owner · Jayden")
frontend/src/pages/ExceptionInboxPage.css
```

## Files I changed (minimal, declared)

| File | Change | Why |
|---|---|---|
| `backend/server.js` | 2 lines in the **TEAMMATE ZONE** — import + `app.use(exceptionsRouter)` | The zone exists for exactly this |
| `backend/server.js` | 1 line: `.then(initExceptions)` in the startup chain | My tables must be created *after* the base schema, since they hold foreign keys into `trips`, `delegates` and `accounts`. This is outside the TEAMMATE ZONE — **flagged for JQ's approval.** |
| `backend/package.json` | added `"seed:demo"` script | additive only |

I did **not** touch `data.js`, `permissions.js`, `lib/api.js`, `Layout.jsx`, `Sidebar.jsx`, `App.jsx`, or any teammate page. `App.jsx` already routes `/exceptions` to my page and `Sidebar.jsx` already links it, so no edits were needed.

## Reusing the base rather than duplicating it

- **Auth:** my router resolves the caller by importing JQ's exported `getAccountByUsername` and decoding the same `demo.<base64(username)>.token` her `/api/auth/login` issues. No second login flow, no duplicated password logic.
- **HTTP:** the frontend data layer calls the shared `apiGet/apiPost/apiPatch/apiDelete`, so it inherits token storage, "keep me signed in", and typed errors (`err.status`, `err.code`).
- **UI:** priority and status pills use the existing `StatusBadge`; all colour/spacing come from `tokens.css`. My CSS is scoped to `.exc-*` and adds no global rules.

## Database

Two tables from `HIGH_LEVEL_DESIGN.md` §2, created idempotently on boot (`CREATE TABLE IF NOT EXISTS`) so Vimal's check-in module can be added later without a migration clash:

- `exception_tickets` (§7) — mine
- `check_in_logs` (§6) — shared with Vimal; this module writes only the `MANUAL` rows

### Deviations from the HLD (deliberate)

1. **`VARCHAR(64)` ids, not `UUID`.** The HLD types ids as UUID, but the live schema in `data.js` uses `VARCHAR(64)` (`t-1`, `c1`, `d-1`). A foreign key must match its parent's type, so my tables follow the live schema. Ids are still UUID *values*, generated with `randomUUID()`.
2. **`raised_by` / `resolved_by` reference `accounts(id)`, not `users(id)`.** The HLD's `users` table doesn't exist yet; `accounts` is what the base actually implements.
3. **Real-time push is not in the HLD.** The "alert all staff devices" requirement needs a transport, so I added Server-Sent Events at `GET /api/exceptions/stream`. It needs no new dependency and passes through restrictive proxies. **This is the item most worth a team decision** — if Vimal or Vance are assuming WebSockets, we should align.

## Endpoints (per HLD §3.6)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/trips/:id/exceptions?status=&priority=` | List tickets + counts |
| GET | `/api/exceptions/:id` | Single ticket |
| POST | `/api/trips/:id/exceptions` | Raise a ticket (CRITICAL → push) |
| PATCH | `/api/exceptions/:id` | Resolve, or change priority/note |
| DELETE | `/api/exceptions/:id` | Remove a ticket raised in error |
| POST | `/api/checkins/manual` | Manual attendance override |
| GET | `/api/exceptions/stream` | Live alert channel (SSE) |

`POST /api/checkins` (the QR path) is intentionally **not** implemented here — that's Vimal's. I namespaced mine to `/checkins/manual` so both routers can mount side by side.

## Two things worth raising with the team

1. **`CANCELLED` no longer exists.** The HLD's `exception_status` enum is `OPEN | RESOLVED` only, so a ticket raised in error is now hard-deleted rather than soft-cancelled. That loses the audit trail. If we want it back, we add `CANCELLED` to the enum — a one-line HLD change, but it needs agreeing, not assuming.
2. **A real deployment bug in the base.** `frontend/src/lib/api.js` imports `../../../permissions.js`, a file *outside* `frontend/`. Vite's dev server allows it via `fs.allow: ['..']` and `vite build` works locally — but when Vercel builds with `frontend/` as the root directory, that parent file won't be in the build context and the deploy will fail. Worth fixing before deployment day, not on it.

## Running it

```bash
# 1. Database — put your Neon connection string in backend/.env
cd backend
cp .env.example .env          # set DATABASE_URL=postgresql://...neon.tech/...?sslmode=require
npm install
npm start                     # creates every table on first boot

# 2. Demo data (delegates + sample tickets) — once, in a second terminal
npm run seed:demo

# 3. Frontend
cd ../frontend
npm install
npm run dev                   # http://localhost:5173  (proxies /api to :4000)
```

Sign in with **`staff_194` / `password123!`**, then open **Exceptions** in the sidebar.

A local Postgres works too — leave `DATABASE_URL` pointing at `localhost` and SSL switches off automatically.

## Verified

Against a real PostgreSQL database, end to end:

- Boot creates `exception_tickets` + `check_in_logs` alongside the base tables.
- Login through the team's own login page issues a token my routes accept; an unauthenticated request gets `401`, a bad SSE token gets `401`.
- Inbox renders real joined data (delegate, coach, raiser, VIP flag) with counts `{all, critical, open, resolved}`.
- Create → the ticket appears in Postgres; a repeated `clientEventId` returns the original (idempotent, `duplicate: true`).
- Resolve → `RESOLVED`; resolving again returns `409`. Delete → `404` on the second attempt.
- Manual override writes a `MANUAL` row to `check_in_logs` and flips the delegate to `PRESENT`, which the dashboard head-count picks up.
- All of JQ's base routes still pass: dashboard, session, delegates, accounts, missing view, and the Excel export (`HTTP 200`).
- Responsive: table on desktop, cards on mobile.
