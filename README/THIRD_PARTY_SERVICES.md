# Third-Party Services — What MusterGo Uses, and How to Set Each One Up

This is a client-facing index of **every external service** MusterGo talks to,
why it's used, whether it costs anything, and how to set it up. Every one of
these is **optional** except the database — the app degrades gracefully (a
clear "not configured" message) if a given service isn't set up, it never
crashes.

All credentials go in **`backend/.env`** (or `frontend/.env` for the one
frontend-side key) — never commit these files; both are already gitignored.

---

## 1. Postgres database — required

**What it's for:** the only required piece — every delegate, trip, account,
and activity record lives here.

**Cost:** free tier is enough for this app's scale (Neon's free tier: 0.5GB
storage, which is very roomy for a few thousand delegate rows).

**Setup:**
1. Sign up free at **neon.tech** (or use any other Postgres host — Supabase,
   a local Postgres server, etc. all work the same way).
2. Create a project/database, copy the connection string it gives you.
3. Set in `backend/.env`:
   ```
   DATABASE_URL=postgresql://user:password@host:5432/dbname
   ```
4. Nothing else needed — the app creates all its own tables automatically on
   first start (`backend/db/schema.js`).

---

## 2. Cloudinary — delegate & account profile photos

**What it's for:** stores every uploaded photo (delegate photos, staff
profile pictures in Settings) as a hosted URL, rather than in the database.

**Cost:** free tier — 25 monthly credits (~1GB storage / bandwidth /
1,000 transformations, whichever is used first). Plenty for photo storage at
this app's scale; only likely to matter if traffic/photo count grows a lot.

**Setup:**
1. Sign up free at **cloudinary.com**.
2. The dashboard's front page shows **Cloud Name**, **API Key**, and
   **API Secret** — no extra configuration needed.
3. Set in `backend/.env`:
   ```
   CLOUDINARY_CLOUD_NAME=
   CLOUDINARY_API_KEY=
   CLOUDINARY_API_SECRET=
   ```
4. Without this set, photo uploads show a clear "photo storage isn't set up
   yet" message instead of failing silently.

**Managing storage:** Settings → Image storage (admin-only) lists every photo
this app has ever uploaded and can bulk-delete/purge, so storage never grows
unbounded without anyone noticing.

---

## 3. Google Maps — delegate "Last known location" map

**What it's for:** the small embedded map shown for a delegate's last known
location (Dashboard, Missing-location prompts).

**Cost:** free — the **Maps Embed API** specifically has no billing
requirement even on a Google Cloud account with billing off.

**Setup:**
1. Go to **console.cloud.google.com**, create a project (or use an existing
   one).
2. **APIs & Services → Library** → search **"Maps Embed API"** → Enable.
3. **APIs & Services → Credentials** → Create Credentials → API Key → copy it.
4. (Recommended) Restrict the key to your domain under the key's settings, so
   it can't be reused elsewhere if it leaks.
5. Set in **`frontend/.env`** (this one's a frontend key, not backend):
   ```
   VITE_GOOGLE_MAPS_API_KEY=
   ```
6. Without this set, the location card just shows the place name as plain
   text instead of a map.

### AMap (Gaode) — no setup needed
The same location card also offers an **AMap** tab (better for locations
inside mainland China, where Google Maps is unreliable). This currently uses
AMap's free public search-preview link, not an authenticated API — **no
account or key required**. If AMap's own coverage/reliability becomes an
issue later, a proper AMap API key could be added the same way as Google's.

---

## 4. AI features — Ollama (free, local) or Anthropic (paid, cloud)

**What it's for:** three features — Analytics "Generate Insights", the Trip
Assistant chatbot, and AI-assisted document parsing (reading delegate lists
out of uploaded PDFs/scans).

**Cost:** **Ollama is completely free** (runs the AI model on your own
machine/server, no account, no per-request cost) — this is what local
development already uses. **Anthropic (Claude) is pay-as-you-go, no free
tier**, and is only needed as a fallback for whichever machine actually runs
the backend in production, if it won't have Ollama installed, or for the
document-parsing feature's scanned-document reading (Ollama can't process
images, only text).

**Setup — Ollama (recommended default, free):**
1. Install from **ollama.com**.
2. Run `ollama pull llama3.2` once.
3. That's it — the app auto-detects it at `http://localhost:11434`. No env
   var needed unless it's running somewhere other than localhost
   (`OLLAMA_HOST=http://...`).

**Setup — Anthropic (optional paid fallback):** see **`AI_DEPLOYMENT.md`** in
this same folder for the full walkthrough (getting a key, where to set it on
whatever hosting platform is used, cost expectations).

---

## 5. Email — escalation alerts ("Escalate to office")

**Status: ✅ live** — this app is currently sending via **SendGrid** (see
setup below), confirmed working with a real test send.

**What it's for:** when on-site staff can't reach a delegate and escalates to
office/admin staff (the siren button on a Missing delegate), an email goes
out to the chosen admin(s) in addition to the in-app banner.

**Cost:** free either way, at this app's scale — the two supported options:

- **Gmail (personal account)** — free, but **not recommended for real use**:
  emails sent this way are more likely to land in Spam, since Gmail-via-raw-
  SMTP-relay looks less "legitimate" to spam filters than a real transactional
  email service. Fine for testing.
- **SendGrid (recommended)** — **free forever, 100 emails/day**, and
  significantly better inbox deliverability (it handles the SPF/DKIM
  authentication that makes an email look legitimate, which personal Gmail
  doesn't).

**Setup — SendGrid (recommended):**
1. Sign up free at **sendgrid.com**.
2. **Settings → Sender Authentication → Verify a Single Sender** — enter an
   email, click the confirmation link SendGrid emails you.
   (Optional, better deliverability: **Domain Authentication** instead, if
   there's a domain with DNS access available.)
3. **Settings → API Keys → Create API Key** — "Mail Send" permission is
   enough. Copy the key (shown once).
4. Set in `backend/.env`:
   ```
   SMTP_HOST=smtp.sendgrid.net
   SMTP_PORT=587
   SMTP_USER=apikey
   SMTP_PASS=<the API key>
   SMTP_FROM=<the email verified in step 2>
   ```
   (`SMTP_USER` is literally the word `apikey` — not a placeholder, that's
   SendGrid's actual required username for SMTP.)

**⚠️ Security note:** if an API key was ever pasted into a chat, Slack
message, or anywhere outside `.env` itself, treat it as compromised —
SendGrid → Settings → API Keys → delete it, create a fresh one, update
`.env`. API keys should only ever live in the `.env` file, never shared in
plain text elsewhere.

**Setup — Gmail (testing only):**
1. Turn on **2-Step Verification** on the Gmail account
   (myaccount.google.com → Security).
2. **myaccount.google.com/apppasswords** → create one, name it `MusterGo`,
   copy the 16-character password.
3. Set in `backend/.env`:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=<the Gmail address>
   SMTP_PASS=<the 16-character App Password, no spaces>
   SMTP_FROM=<the same Gmail address>
   ```

**Who receives it:** by default, every admin account that has an email on
file (Account Control / Settings) — or pick specific people right on the
Escalate modal each time. `ESCALATION_EMAIL_TO` in `.env` (comma-separated
addresses) can also force a fixed list regardless of the UI.

**⚠️ Known issue: emails land in Spam.** Confirmed live — removing emoji/
"urgent" wording from the subject made no difference, which rules out
content-based filtering. The real cause: `SMTP_FROM` is a personal
`@gmail.com` address, but the email is sent through **SendGrid's** servers,
not Google's own. Gmail's anti-spoofing rules (DMARC) are unusually strict
specifically for `@gmail.com` senders — a third party sending "from" a Gmail
address looks like spoofing almost regardless of what the email says. Two
ways to handle it:

1. **Quick, free, no domain needed — train the filter.** Open the email in
   Spam and click **"Report as not spam"**. After doing this once or twice,
   Gmail learns to trust this sender and stops routing future emails from it
   to Spam. The Escalate modal now shows a warning about this so staff know
   to tell the recipient to check Spam the first few times.
2. **Durable fix — needs a real domain.** If there's a domain (not
   `gmail.com`) with DNS access available, set up SendGrid's **Domain
   Authentication** for it instead of Single Sender Verification, and send
   from an address on that domain (e.g. `alerts@yourdomain.com`). This gets
   proper SPF/DKIM alignment and stops fighting Gmail's anti-spoofing rules
   entirely — the only way to fix this for good rather than just training
   around it.

---

## 6. SMS / WhatsApp escalation alerts — optional, PAID, not yet turned on

**What it's for:** the same "Escalate to office" alert, also as a text
message/WhatsApp — for reaching someone who isn't near a computer or phone
with the app open.

**Status: written, but intentionally NOT wired to a real provider yet** —
this is the one part of the app that costs real per-message money, so nothing
sends until this is deliberately turned on. Right now, triggering an
escalation just logs what *would* have been sent, at zero cost.

**Cost (once turned on):** **Twilio** — no free tier for ongoing use (a
small trial credit exists for new accounts), then pay-per-message (SMS is a
few cents per message; WhatsApp similar, plus WhatsApp requires Twilio's own
sender-approval process before use).

**Setup, if wanted:**
1. Sign up at **twilio.com**, buy a phone number (a few dollars/month) for
   SMS; for WhatsApp, follow Twilio's separate WhatsApp sender approval flow.
2. `npm install twilio` in `backend/`.
3. Uncomment the Twilio API call in **`backend/lib/notify.js`** (`sendEscalationSms`
   / `sendEscalationWhatsApp`) — the exact code is already written, just
   commented out.
4. Set in `backend/.env`:
   ```
   TWILIO_ACCOUNT_SID=
   TWILIO_AUTH_TOKEN=
   TWILIO_FROM_NUMBER=      # for SMS
   TWILIO_WHATSAPP_FROM=    # for WhatsApp (needs Twilio's approval first)
   ESCALATION_SMS_TO=       # comma-separated phone numbers, e.g. +6591234567,+6598765432
   ESCALATION_WHATSAPP_TO=
   ```

---

## Summary table

| Service | Required? | Cost | Powers |
|---|---|---|---|
| Postgres (Neon) | **Required** | Free tier is enough | Everything — the database |
| Cloudinary | Optional | Free tier (25 credits/mo) | Delegate/staff profile photos |
| Google Maps (Embed API) | Optional | Free | "Last known location" map |
| AMap | N/A | Free, no key needed | Same map, China-focused alternative |
| Ollama | Optional (recommended) | Free | AI Insights / chatbot / document parsing |
| Anthropic (Claude) | Optional (fallback) | Pay-as-you-go | Same 3 AI features, if Ollama unavailable |
| SendGrid | Optional — **✅ currently live** | Free (100/day) | "Escalate to office" emails |
| Twilio | Optional, **not yet enabled** | Paid per message | SMS/WhatsApp escalation alerts |
| JWT_SECRET | Recommended | Free (self-generated) | Signs login sessions — see `backend/.env.example` |
