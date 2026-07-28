# AI Deployment Guide — Anthropic (Claude) API Key

MusterGo's AI features (Analytics "Generate Insights", the Trip Assistant chatbot,
and the document-parsing vision path in `routes/vance.js`) try a local **Ollama**
server first (free, no key, nothing leaves the machine) and fall back to the
**Anthropic API** if Ollama isn't reachable. Both are optional — a missing key
never crashes the server, the feature just shows a "not configured" message.

This guide covers getting an Anthropic API key and wiring it up once the app is
deployed (not running on your own machine with Ollama installed).

## 1. Get an Anthropic API key

1. Go to **console.anthropic.com** and sign in (or sign up).
2. Add a payment method under **Billing** — pay-as-you-go, no free tier. Cost stays
   low here since Claude is only ever a *fallback* when Ollama isn't available.
3. Go to **Settings → API Keys → Create Key**. Name it something identifiable
   (e.g. `mustergo-prod`) and copy it immediately — it starts with `sk-ant-...`
   and is only shown once.

## 2. Never commit it

`backend/.env` is already gitignored (`backend/.gitignore`). The key belongs in
an environment variable on whatever host runs the backend — never in a file
that gets pushed to git, and never hardcoded into a route file.

The code already reads it from `process.env.ANTHROPIC_API_KEY` (see
`backend/routes/insights.js`, `backend/routes/vance.js`) — no code changes are
needed to deploy this, only setting the variable on the host.

## 3. Set it on your hosting platform

Where you set this depends on where the **backend** actually runs. Note: this
backend has a persistent `setInterval` (the late-cutoff scheduler in
`server.js`) — it needs an always-on Node process, so a serverless platform
like plain Vercel functions isn't a great fit for the backend specifically
(the frontend, per `FRONTEND_URL` in `.env.example`, is fine on Vercel).

- **Render**: Dashboard → your service → **Environment** tab → Add
  `ANTHROPIC_API_KEY` → paste the value → Save (auto-redeploys).
- **Railway**: Project → your service → **Variables** tab → New Variable → same.
- **Fly.io**: from the CLI —
  ```bash
  fly secrets set ANTHROPIC_API_KEY=sk-ant-...
  ```

Whichever host is used, the pattern is the same: paste the raw key into that
platform's environment-variable UI, exactly like `DATABASE_URL`, `JWT_SECRET`,
and the `CLOUDINARY_*` keys are already meant to be set per
`backend/.env.example`.

## 4. Related env vars (same file, same idea)

These all live in `backend/.env.example` and follow the identical
"env var on the host, never committed" pattern:

| Variable | Required? | Purpose |
|---|---|---|
| `DATABASE_URL` | Required | Postgres connection string (e.g. Neon) |
| `JWT_SECRET` | Recommended | Signs login session tokens |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Optional | Delegate profile photo uploads |
| `FRONTEND_URL` | Optional (needed once deployed) | Locks CORS to your deployed frontend URL |
| `ANTHROPIC_API_KEY` | Optional | AI Insights / chatbot / document-vision fallback when Ollama isn't running |
| `OLLAMA_MODEL` / `ANTHROPIC_MODEL` | Optional | Override the default model name for either provider |

## Why Claude over Gemini for these features

The app is already architected around Claude specifically, not just for text
generation — `routes/vance.js`'s document-parsing VISION path (scanned
passports/boarding passes/travel documents) uses Claude's vision capability,
with local Tesseract OCR as the no-key fallback for images (Ollama can't see).
Switching providers would mean rewriting that vision path, not just swapping a
key — so unless cost becomes a real blocker, staying on one provider
(Anthropic) across all three AI features keeps the codebase simpler.
