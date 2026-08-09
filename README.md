# MusterGo — VJMDynamics × SCCCI

Real-time headcount & attendance reconciliation for SCCCI overseas delegations.
**SCCCI AI Challenge — Problem Statement #10.** *No one gets left behind.*

> **🌐 Live app:** **https://mustergo.duckdns.org**
> Architecture: [`docs/architecture.md`](docs/architecture.md)
> Submission index (per-student docs, tests, AI logs): [`docs/SUBMISSION.md`](docs/SUBMISSION.md)
> Who built what: [`CONTRIBUTIONS.md`](CONTRIBUTIONS.md)

A live trip-tracking app: admins/staff run a Dashboard + Trips/Coach board on
desktop, delegates get scanned in via QR or face recognition on mobile, and
missing/late/exception cases surface in real time across both.

## What's actually built

Every item below is a real, working feature against a live PostgreSQL
database — nothing here is a scaffold or simulated data.

| Area | Screen(s) | Owner | What it does |
|---|---|---|---|
| Admin Dashboard | Overview / Delegate management / Room Management / Checkpoint history / Analytics / Staff operations | Jun Qi (JQ) | Live KPIs, full delegate CRUD, reverse-headcount "Missing" list, multi-checkpoint attendance history, AI-assisted room assignment |
| Auth, Accounts & RBAC | Login, Account control, Settings | Jun Qi (JQ) | Signed-JWT sessions (single active session per account), granular per-account permissions (`permissions.js`), named role templates |
| Trips & Coach board | Trips list, Trip/Coach board | Desmond | Trip CRUD, coach capacity + drag-and-drop reassignment, offline reassignment queue, live Now/Next itinerary |
| Exception Logging | Exception inbox, mobile Exceptions | Jayden | Support-ticket-style exception tracking, critical alerts, QR check-in fallback, manual override |
| DocuSync AI + MusterChat | Documents (Onboarding), MusterChat | Vance | AI document parsing for delegate onboarding, boarding passes, full team messaging (1:1/group/AI assistant) + video calls |
| FaceCheck-Pro | Mobile QR/Face scanner, biometric enrolment | Vimal | Privacy-first on-device face/voice matching (zero-image — raw pixels never leave the device), QR fallback, manual check-in |
| Multi-checkpoint attendance | Delegate timeline, checkpoint history | Jun Qi (JQ) | Per-stop (not just per-day) attendance tracking, auto Late/Arrived transitions against each itinerary stop's own cutoff |

Full ownership boundaries and integration history: see
[`README/INTEGRATION_NOTES.md`](README/INTEGRATION_NOTES.md).

## Architecture

- **Frontend:** React 18 + Vite, plain CSS (no framework), `react-router-dom`.
  Two parallel shells — a desktop sidebar layout and a mobile bottom-tab
  layout — sharing the same backend and most of the same `lib/` code.
- **Backend:** Express + `pg` (PostgreSQL, tested against Neon). One base
  router (JQ's Auth/Dashboard/Delegates/Accounts) plus one router per
  teammate feature, all mounted in `backend/server.js`.
- **AI:** Anthropic Claude (document parsing) and/or local Ollama (chat
  assistant, insights) — both called **server-side only**, so no API key
  ever reaches the browser.
- **Biometrics:** on-device only (`@vladmandic/human` for face, Web Speech
  for voice) — no image or audio is ever uploaded or stored.

Full file-by-file breakdown: [`README/PROJECT_STRUCTURE.md`](README/PROJECT_STRUCTURE.md).

## Run it locally

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env      # then fill in at least DATABASE_URL — see below
npm run dev                # http://localhost:4000
```

The schema (tables, columns, indexes) is created automatically on first boot
— there is no separate migration step to run. A few demo accounts and a
sample trip are seeded automatically too.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev                # https://localhost:5173
```

**Note the `https://`, not `http://`** — the dev server serves over HTTPS
with an auto-generated self-signed certificate (accept the one-time browser
warning: "Advanced" → "Proceed"). This isn't cosmetic: the camera
(`getUserMedia`, used by the face/QR scanner) and the browser's
password-save/autofill (Credential Management API, used by passkey sign-in)
only work in a secure context — `https://` or `http://localhost` specifically.
Reaching the dev server from a phone over the LAN (`http://192.168.x.x:5173`)
is **not** a secure context, so both would silently fail without this.

### 3. Sign in

```
staff_194 / password123!
```

This is a shared demo login seeded on first boot. If several people are
developing against the **same** database (see the gotcha below), logins
enforce a single active session per account — signing in on one machine logs
out everyone else currently using that same login. Run `npm run seed:team`
(from `backend/`) once to give each developer their own login instead.

## Environment variables

Only `DATABASE_URL` is required — every other feature just shows a plain
"not configured" message instead of failing if its variables are omitted.
Full list with explanations: [`backend/.env.example`](backend/.env.example).

| Variable | Required? | Powers |
|---|---|---|
| `DATABASE_URL` | **Required** | The Postgres connection (Neon, Supabase, or local) |
| `JWT_SECRET` | Recommended | Signs login sessions — a random default is used (with a console warning) if omitted |
| `FRONTEND_URL` | Recommended for deploy | CORS allowlist — without it, any origin is allowed (fine for local dev, not for production) |
| `CLOUDINARY_*` | Optional | Delegate profile photo uploads |
| `ANTHROPIC_API_KEY` / `OLLAMA_*` | Optional | AI Insights, document parsing, chat assistant (defaults to local Ollama if no key is set) |
| `SMTP_*` | Optional | "Escalate to office" emails |
| `TWILIO_*` | Optional | Escalation SMS/WhatsApp (unset = server just logs what would have sent) |

## Database initialization rules

- Schema creation is **idempotent** — every `CREATE TABLE IF NOT EXISTS` /
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` runs on every boot, so a fresh
  database and an already-running one both end up correct with no manual
  migration step.
- Demo/seed data (`backend/data.js` → `initDb()`) only inserts rows that
  don't already exist — safe to restart the server repeatedly without
  duplicating anything.
- **Shared-database gotcha:** the team develops against one shared Neon
  database by default. `git clone` resets your *code*, not the *database* —
  if a teammate's branch has since changed the seeded login, "can't log in
  after cloning" is a database-drift issue, not a code bug. Fix:
  `npm run reset:login` (from `backend/`), or better, give each developer
  their own free-tier Neon database. Full writeup:
  [`README/PROJECT_STRUCTURE.md`](README/PROJECT_STRUCTURE.md) → "CAN'T LOG
  IN AFTER CLONING?".

## Where to find more

| Question | Doc |
|---|---|
| "How does file X work?" | [`README/PROJECT_STRUCTURE.md`](README/PROJECT_STRUCTURE.md) — organized by file path |
| "Whose file is this, can I touch it, what broke last time someone merged?" | [`README/INTEGRATION_NOTES.md`](README/INTEGRATION_NOTES.md) — organized by feature/contributor |
| "How does multi-checkpoint attendance work end to end?" | [`README/INTEGRATION_NOTES.md`](README/INTEGRATION_NOTES.md)'s "Feature Deep-Dive: Multi-Checkpoint Attendance" section (merged in from the former standalone `CHECKPOINT_FEATURE_HANDOFF.md`) |
| "What third-party services does this use and how are they configured?" | [`README/THIRD_PARTY_SERVICES.md`](README/THIRD_PARTY_SERVICES.md) |
| "How do I deploy this?" | [`README/DEPLOYMENT.md`](README/DEPLOYMENT.md) (general server setup) — the Anthropic API key specifically is covered in [`README/THIRD_PARTY_SERVICES.md`](README/THIRD_PARTY_SERVICES.md)'s AI section |
| "What changed, in order, session by session?" | [`README/Jun Qi - AI Log.md`](README/Jun%20Qi%20-%20AI%20Log.md) — JQ's own condensed AI-usage log |
| Original design/sprint docs | [`HIGH_LEVEL_DESIGN.md`](HIGH_LEVEL_DESIGN.md), [`PROJECT_IMPLEMENTATION_PHASE.md`](PROJECT_IMPLEMENTATION_PHASE.md) |
