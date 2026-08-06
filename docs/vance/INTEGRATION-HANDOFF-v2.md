# Vance — v2 integration handoff (read before the cloud push)

Branch: `v2DocuSync-AI-(Vance)`. This note lists what changed in Vance's area
(Screen 4 — Document parsing / Boarding passes, plus MusterChat pass surfaces)
so it merges cleanly and runs on the cloud. **Nothing here needs a manual DB
migration or a new backend dependency.**

## TL;DR for the person deploying
- **DB**: all new columns/tables are created automatically by `ensureReady()` in
  `backend/routes/vance.js` (`ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT
  EXISTS`, idempotent). Safe to run against the existing DB — no migration step.
- **Env** (set these on the cloud backend, else features degrade):
  - `FRONTEND_URL` → the **deployed frontend URL** (e.g. the Vercel/Render URL).
    Used for the emailed pass link **and** CORS. If unset, CORS allows any origin
    and pass links fall back to `https://localhost:5173`.
  - `SMTP_HOST/PORT/USER/PASS/FROM` → required for "Email pass" (SendGrid works).
  - `ANTHROPIC_API_KEY` → **required for document parsing in the cloud.** Local
    dev falls back to Ollama; there is no Ollama in the cloud, so without this key
    the parser returns "needs an AI engine". (`ANTHROPIC_MODEL` optional.)
  - `VITE_ICE_SERVERS` (optional) → JSON array with a TURN server if you want
    calls to survive strict/cross-network NAT; STUN-only otherwise.
- **No new backend deps.** `qrcode`/`jsqr` are frontend-only (already present).
- `npm run build` (frontend) passes clean.

## What's new (features)

**Boarding passes / onboarding (Screen 4)**
- **Physical pass linking** — link an SCCCI-issued pass to a delegate; check-in
  resolves **either** our `qr_code` **or** the linked `external_badge_code`.
- **Branded QR** — the company's real logo (unavatar by website domain, monogram
  fallback, error-correction H) in the QR centre, on the app, the webpage and the
  email — consistent everywhere.
- **Download** a pass (PNG), **select-all / individual → Save as PDF**, and a
  redesigned printed/PDF pass card.
- **Email pass** — sends a branded, table-based email (mirrors the pass). The QR
  in the body is served from a **public image URL** (`quickchart.io/qr`, same
  code, logo composited in the centre) so **Gmail renders it (web + app)** — an
  inline `cid:` image does not render reliably in Gmail. The QR also ships as a
  `boarding-pass.png` attachment, plus a button to the hosted flip page.
- **Public flip badge page** `/badge/:code` — QR first, ↻ flips to the company-ID
  badge. Renders from the URL code even before the API responds.
- **Parse UX** — live waiting-time timer; after "Confirm & add" the app
  auto-jumps to the Boarding passes tab so new passes are immediately visible.

**MusterChat**
- Robust video/voice calls: progressive `getUserMedia` fallback (video→voice),
  actionable errors, and a Retry that re-runs the call.
- Group-chat unread red-dot (admin + mobile), quick-chat groups/timestamps/
  edit-delete, per-character bubble-wrap fix, mobile assistant suggested prompts,
  and a mobile scanner "View badge" flip (reuses `BadgeFlipCard`).

## DB additions (auto-migrated in `ensureReady`)
- `delegates.external_badge_code VARCHAR(128)` + unique index.
- `delegates.email/phone/website/role/industry/qr_code/...` (already part of the
  onboarding schema).
- `chat_group_reads (group_id, account_id, last_read_at)` — group unread tracking.

## New / changed API routes (all in `backend/routes/vance.js`)
- `POST /api/onboarding/delegates/:id/badge` — link/unlink a physical pass code
  (409 `CODE_TAKEN` on collision).
- `POST /api/onboarding/delegates/:id/email-pass` — email the branded pass.
- `GET  /api/badge/:code` — **public** (no auth) pass lookup for `/badge/:code`.
- `POST /api/onboarding/checkin` — resolves `qr_code` **or** `external_badge_code`
  (this is what `QRScannerPanel` calls; unchanged contract, extended resolver).
- `GET  /api/onboarding/badges` — now also selects `email` (so the "Email pass"
  button appears).

## New frontend files
- `src/pages/BadgePage.jsx` — public `/badge/:code` flip page (route already wired
  in `App.jsx`, both logged-out and logged-in trees).
- `src/components/BadgeFlipCard.jsx` — reusable flip-badge overlay (used by the
  mobile scanner's "View badge").

## Known limitations (by design, for a local demo)
- The email QR is fetched from `quickchart.io` (a public QR image service) so
  Gmail can proxy it — it must be reachable at send/open time. The `qr_code` is a
  non-sensitive random boarding token (already the shared secret in the badge
  URL). Swap for a self-hosted `/qr.png` endpoint later if you prefer no third
  party.
- Calls are STUN-only unless `VITE_ICE_SERVERS` adds a TURN server.
- Local parse uses Ollama; cloud needs `ANTHROPIC_API_KEY`.

## Demo asset
`docs/vance/demo/Delegation-demo-v2.pdf` — a 2-page, text-extractable delegate
directory (6 delegates incl. **Vance Wong / Grab Holdings / vwwj0907@gmail.com**)
for the live parse demo. See `docs/vance/demo-run-sheet.md` for the run order:
parse → Confirm & add → Boarding passes → Email/Download → QR scan → boarded.
