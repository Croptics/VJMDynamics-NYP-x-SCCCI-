# Deployment Guide — Getting MusterGo Running on a Real Server

`README/THIRD_PARTY_SERVICES.md`'s AI section covers wiring up the
`ANTHROPIC_API_KEY` specifically, along with every other external service the
app talks to. This doc covers everything else needed to take the repo from
"runs on my laptop" to "runs on a server someone else can reach" — a bare VM
(Alibaba ECS, AWS EC2, DigitalOcean droplet, etc.), not a managed PaaS.

## For any AI reading this (any session, any chat)

**Keep this file updated automatically — don't wait to be asked.** Update it
whenever the deployment process changes (a new required env var, a different
process manager, a new build step) so it stays a true step-by-step, not a
snapshot of one deploy.

## Current live deployment (verified 2026-08-12)

- **Server:** Alibaba Cloud ECS VM.
- **Repo path on the server:** `/var/www/mustergo/backend` (and sibling
  `/var/www/mustergo/frontend`) — NOT the repo root name you'd guess from
  `git clone`; if you `find / -iname "VJMDynamics*"` on this box it will find
  nothing, because the folder was renamed to `mustergo` at some point. Use
  `pm2 show <process-name>` (see below) to locate it directly instead of
  guessing a folder name.
- **PM2 process name:** `mustergo-api` — **not** `mustergo-backend` as
  written in step 5 below (that was this doc's original placeholder name;
  the live process was actually started under a different name and this
  doc wasn't updated to match at the time). Use `mustergo-api` in every
  `pm2 restart` / `pm2 logs` command against this server.
- **Database:** as of 2026-08-12, this server's `DATABASE_URL` was found
  pointed at a **separate local Postgres on the same VM**
  (`postgresql://mustergo:...@localhost:5432/mustergo`), NOT the team's
  shared Neon instance — meaning the live site had been showing its own
  isolated seed data ("Demo (malaysia)" trip) instead of the real shared
  data every teammate sees locally. This was corrected by editing
  `backend/.env`'s `DATABASE_URL` to the team's real Neon connection string
  and restarting `mustergo-api`. If the live site ever shows unfamiliar
  trips/data again, checking `cat .env | grep DATABASE_URL` on this server
  is the first thing to do — don't assume it's still pointed at Neon just
  because it was fixed once.

To update the live backend after pulling new code:
```bash
ssh root@<vm-ip>              # credentials: ask whoever set up the VM
cd /var/www/mustergo/backend
git status                    # confirm branch — should be on INTv2
git pull origin INTv2
pm2 restart mustergo-api
pm2 logs mustergo-api --lines 50   # confirm clean startup, no errors
```
A **frontend-only** fix additionally needs a rebuild — `pm2 restart` alone
does not pick up `.jsx` changes:
```bash
cd /var/www/mustergo/frontend
git pull origin INTv2   # if not already pulled from the backend dir above
npm run build
```

## The short version

The code itself is already deploy-ready — the parts that would normally block
a deploy are already done:

- `backend/db/connection.js` reads `DATABASE_URL` from the environment (never
  hardcoded) and auto-detects whether SSL is needed, so it works unmodified
  against Neon, Supabase, or a plain Postgres install.
- `backend/.env` and `frontend/.env` are gitignored (`backend/.gitignore`,
  `frontend/.gitignore`) — pushing the repo does **not** push your local
  secrets. This also means the new server needs its OWN `.env` files created
  by hand; `git clone` alone will not bring them.
- Schema creation is idempotent (`CREATE TABLE IF NOT EXISTS` /
  `ADD COLUMN IF NOT EXISTS`, run on every boot) — no manual migration step.

What's missing is the **server setup around the code** — installing Node,
creating real `.env` files on the new machine, keeping the backend process
alive, and serving the built frontend. None of that is in the repo because
it's specific to whichever server you're deploying to.

## 1. Decide where the database lives

Don't install a fresh local Postgres on the new server. The team already has
a working cloud database (Neon) with the current schema and demo data. Reuse
it — one connection string works from anywhere:

```
DATABASE_URL=postgresql://<user>:<password>@<host>/<dbname>?sslmode=require
```

This is the same value in the *commented-out* Neon line already sitting in
most teammates' local `backend/.env` — ask whoever has it, or check the team's
Neon dashboard at neon.tech. Using the same database means every deploy target
(your laptop, a teammate's laptop, this VM) sees the same live data — no
migration, no drift, no separate "production data" to keep in sync.

## 2. On the new server: install Node.js

```bash
# Ubuntu/Debian-based VM — adjust for your distro
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # confirm it installed
```

## 3. Clone the repo and install dependencies

```bash
git clone <your-repo-url>
cd VJMDynamics-NYP-x-SCCCI-
cd backend  && npm install
cd ../frontend && npm install
```

## Do NOT delete `tests/` or `scripts/` — they just don't need to *run* on the server

It's tempting to strip these out for a "lean" production deploy, but don't —
none of them cost anything sitting unused, and deleting them breaks real
things:

- **`tests/`** (`tests/desmond/`, `tests/jq/`, `tests/vance/`) — the team's
  actual test suite (149 tests). The deployed server never executes these,
  but deleting the folder destroys the whole regression safety net for
  everyone's local development and CI. Keep it in the repo; it simply isn't
  part of what `npm start` runs.
- **`backend/scripts/`** (`reset-login.js`, `seed-demo.js`, `seed-team.js`,
  etc.) — not run automatically, but wired into real `npm run` commands in
  `backend/package.json` (`seed:demo`, `reset:login`, `seed:team`). Deleting
  the folder breaks those commands. `reset-login.js` specifically is the
  documented fix for the shared-database "can't log in after cloning" issue
  — losing it removes a troubleshooting tool the team relies on.
- **`frontend/scripts/copy-human-models.mjs`** — the one exception that
  actually IS required: it's wired into `prebuild`/`predev` (step 6 below)
  and copies the face-recognition model weights into `public/models/human/`.
  Deleting it doesn't error the build — it just makes face-scan check-in fail
  at runtime with a model-load error, silently, later.

If the goal is just keeping the deployed VM's disk usage lean, the right move
is to not bother copying these folders onto the server (or exclude them from
whatever deploy artifact/zip you build) — not to delete them from the actual
git repo.

## 4. Create real `.env` files on the server

These are gitignored, so they do **not** come from `git clone` — create them
fresh on the server itself.

**`backend/.env`** (copy from `backend/.env.example`, fill in real values):
```
DATABASE_URL=<the Neon connection string from step 1>
JWT_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))">
FRONTEND_URL=<wherever the frontend ends up — see step 6>
```
Everything else in `.env.example` (Cloudinary, SMTP, Twilio, Anthropic) is
optional — each feature just shows a "not configured" message if skipped.

**`frontend/.env`** (copy from `frontend/.env.example`):
```
VITE_API_URL=<this server's address, e.g. http://<vm-ip>:4000 or https://api.yourdomain.com>
```
Leave this **blank** for local dev (the Vite dev proxy handles `/api` →
`localhost:4000` automatically) — it's only needed once the frontend and
backend are on different origins, which is exactly the deployed case.

## 5. Run the backend as a real service, not a terminal session

`npm run dev` runs `node --watch server.js` — built for editing code locally,
not for staying alive unattended. Use the plain start script instead, under a
process manager so it survives you disconnecting SSH and restarts if it
crashes:

```bash
cd backend
npm install -g pm2          # one-time
pm2 start server.js --name mustergo-backend
pm2 save                    # so it restarts on server reboot
pm2 logs mustergo-backend   # check it actually started clean —
                             # look for "PostgreSQL connected" and
                             # "MusterGo backend running"
```

## 6. Build and serve the frontend

The backend does **not** serve the frontend's static files itself — they are
two separate processes. Pick one:

- **Same VM, via nginx** (simplest for a single-server setup):
  ```bash
  cd frontend
  npm run build              # outputs to frontend/dist/
  ```
  Point nginx at `frontend/dist/` for the site root, and reverse-proxy
  `/api/*` to `http://localhost:4000`. This also lets you terminate HTTPS at
  nginx (see step 7) for both frontend and backend under one cert.

- **Frontend hosted elsewhere** (Vercel, Render static site, etc.), backend
  on this VM: set `VITE_API_URL` (step 4) to this VM's public address, and set
  `FRONTEND_URL` in `backend/.env` to that frontend's real URL so CORS allows
  it. This was the original setup this repo's `.env.example` files were
  written for (`your-app.onrender.com` / `your-app.vercel.app` are the
  placeholder examples in each `.env.example`).

## 7. HTTPS is required for face-scan check-in

`getUserMedia` (the browser camera API the face scanner uses) is blocked on
plain HTTP for anything except `localhost`. A bare VM IP address served over
HTTP will load fine, but the face-scan check-in and self-enrolment pages will
fail at the camera-permission step specifically — everything else in the app
still works.

Fix: put a real domain in front of the VM and get a free cert (Let's Encrypt
via `certbot`, or nginx's built-in ACME support). A self-signed cert is not
enough — browsers won't grant camera access through an untrusted certificate
warning.

## 8. Open the right ports

Whatever cloud firewall/security-group console the VM has (Alibaba ECS's
"Security Group" panel, AWS's "Security Groups", etc.), make sure it allows:

- **22** (SSH) — already open if you can reach the VM at all
- **80** and **443** (HTTP/HTTPS) if nginx is fronting things — step 6/7
- **4000** (or whatever port `backend/server.js` listens on) only if the
  frontend is hosted elsewhere and needs to reach this VM's API directly,
  without an nginx reverse proxy in front of it

## 9. Verify it actually works end to end

- `pm2 logs mustergo-backend` shows `PostgreSQL connected` and
  `MusterGo backend running` with no errors.
- Load the frontend URL in a browser, open devtools → Network tab, confirm
  API calls go to the right backend address (not a stale placeholder like
  `your-app.onrender.com` — see the "CORS blocked" / "404 Not Found" failure
  mode this exact mistake produces, and how `VITE_API_URL` controls it,
  further up this doc).
- Log in with a real account and confirm the dashboard loads real data — this
  confirms `DATABASE_URL` is pointed at the right database, not an empty one.

## Rotate any credentials that traveled over email or chat

If SSH credentials, database passwords, or API keys were ever sent in plain
text (email, Slack, WhatsApp), rotate them once the person who needs them has
logged in — plain-text credential delivery is inherently exposed to anyone
with access to that inbox/thread, independent of how the server itself is
secured.
