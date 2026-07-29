# Third-Party Services — What MusterGo Uses, and How to Set Each One Up

This is a client-facing index of **every external service** MusterGo talks to,
why it's used, whether it costs anything, and how to set it up. Every one of
these is **optional** except the database — the app degrades gracefully (a
clear "not configured" message) if a given service isn't set up, it never
crashes.

All credentials go in **`backend/.env`** (or `frontend/.env` for the one
frontend-side key) — never commit these files; both are already gitignored.

## For any AI reading this (any session, any chat)

**Keep this file updated automatically — don't wait to be asked.** Whenever a
new external service gets integrated, an existing one's usage scope changes
(new folder, new use case, new API surface — e.g. Cloudinary going from
photos-only to also handling video across 3 folders), or a cost/setup step
changes, update that service's section here. Keep the same per-service shape
(What it's for / Cost / Setup / any "Managing X" subsection) so every service
reads consistently, and update the summary table at the bottom to match.

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

## 2. Cloudinary — photos, announcement media, and the User Guide video

**What it's for:** stores every uploaded image/video (delegate photos, staff
profile pictures in Settings, trip announcement photos/videos, and the User
Guide's walkthrough video) as a hosted URL, rather than in the database.
Originally photo-only — extended (2026-07-27) to also handle video uploads
(`uploadVideo`/`destroyVideo` in `backend/lib/cloudinary.js`, same
memory-storage multer pattern, just `resource_type: "video"`) once
Announcements and the User Guide both needed video support.

**Three separate folders**, each independently listable/deletable/purgeable
from Settings — a purge in one folder can never touch another:
- `mustergo/delegates` — delegate/staff profile photos (images only)
- `mustergo/announcements` — trip announcement media (images **and** videos,
  up to 6 images + 2 videos per announcement)
- `mustergo/guide` — the single User Guide walkthrough video

**Cost:** free tier — 25 monthly credits (~1GB storage / bandwidth /
1,000 transformations, whichever is used first). Video assets consume
roughly 2x the credits of a similarly-sized image — still plenty at this
app's scale, only likely to matter if traffic/media volume grows a lot.

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
4. Without this set, uploads show a clear "storage isn't set up yet" message
   instead of failing silently.

**Managing storage:** Settings → Image storage (admin-only) — three separate
panels, one per folder above, each listing every asset actually in Cloudinary
and letting an admin bulk-delete/purge it. Deleting from here also unlinks
whatever in the app was pointing at that asset (a delegate's photoUrl, an
announcement's images/videos array, the User Guide video row), so storage
never grows unbounded and nothing keeps pointing at a deleted asset.

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

### AMap (高德地图) — works with no account; a key makes it better

**Why it's here, and why it matters more than Google Maps for this client:**
**Google Maps is blocked in mainland China.** MusterGo's flagship trip is a
Beijing study mission, so for staff standing in Beijing on a China SIM, the
Google tab simply won't load — the AMap tab is the one that works. Keep both.

**No account is required.** The tab previews AMap's own public search page and
always shows an **"Open in AMap ↗"** link that works for anyone, signed in or
not. Nothing to register for basic use.

**Why the preview may look empty (this is expected, not a bug):** AMap has very
little map data outside mainland China, so a Singapore address typically returns
nothing to draw, and a cross-border page load can be slow. Testing from
Singapore with a Singapore address is the worst case. The card now shows the
address plus an explanation behind the preview area, so an empty map still reads
as informative rather than broken. Verified 2026-07-28 that AMap does **not**
block embedding (no `X-Frame-Options`, no CSP `frame-ancestors`), so the preview
is technically allowed to render — coverage, not permission, is the limit.

**Optional upgrade — if the client (or their China partner) has an AMap account:**
set `VITE_AMAP_KEY` in `frontend/.env`. With a key the card geocodes the address
and renders a clean **static map image** pinned to the exact spot — no iframe, so
nothing can be blocked, mis-sized or slow, and it renders correctly from inside
China.

**How to register (be realistic about who can):**
1. Go to **console.amap.com** (高德开放平台) and create a developer account.
2. **This requires a mainland-China mobile number and real-name verification**
   (实名认证) — an ID or business registration. That is normally **not
   obtainable by a Singapore-based student**, which is why the app is built to
   work fully without it. SCCCI or a mainland partner organisation can usually
   satisfy this.
3. Create an application, then add a key of type **Web服务 (Web service)** —
   not "Web端(JS API)", because this integration calls the REST geocoding and
   static-map endpoints.
4. Paste it into `frontend/.env` as `VITE_AMAP_KEY=...` and rebuild.
5. If the key is restricted by domain/referer, allow the deployed frontend
   origin, or the requests will be rejected.

**Fail-soft by design:** a missing, invalid, quota-exceeded or referer-blocked
key silently falls back to the keyless preview + link — the location card never
breaks, it just gets less pretty. ⚠️ The keyed path was written without a key to
test against, so **verify it once** the first time a real key is added.

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

## 5. Email — escalation alerts AND biometric-enrolment invites

**Status: ✅ live** — this app is currently sending via **SendGrid** (see
setup below), confirmed working with a real test send.

**What it's for — two features, one SMTP config:**

1. **Escalation alerts** — when on-site staff can't reach a delegate and
   escalates to office/admin staff (the siren button on a Missing delegate), an
   email goes out to the chosen admin(s) in addition to the in-app banner.
2. **Biometric-enrolment invites** (added 2026-07-29 with Vimal's FaceCheck-Pro
   integration) — `backend/lib/mailer.js` emails a delegate a signed, expiring
   link to `/enroll`, where they register their own face and voice. Sent one at
   a time or in bulk from the mobile Enrolment view
   (`/api/enroll/invite`, `/api/enroll/invite-all`; `/api/enroll/invite/preview`
   renders the email without sending it).

> **⚠️ Invites SEND FOR REAL in this project.** `mailer.js` fails soft only when
> SMTP is *unconfigured* — and SMTP here is fully populated for the escalation
> feature above, so the two features share it. Clicking "invite" with a real
> delegate email dispatches a real email. Learned the hard way: one genuinely
> went out during integration testing.
>
> **Before any demo or dry run, set `MAIL_DRY_RUN=true` in `backend/.env`** —
> the email is composed and logged to the backend console, and nothing leaves
> the machine.

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

## 7. Face recognition — on-device, no account, nothing to sign up for

**Status: ✅ working, zero setup.** Added 2026-07-29 with Vimal's FaceCheck-Pro
integration. This is the one "AI service" in the app that needs **no key, no
account, and no internet** — worth knowing, because it's the opposite of every
other entry on this page.

**What it is:** [`@vladmandic/human`](https://github.com/vladmandic/human), an
npm package that runs face detection, landmarks, a face **embedding**, and an
anti-spoof/liveness check entirely in the browser via TensorFlow.js. It powers
the face check-in scanner and the delegate self-enrolment flow.

**Why there's nothing to configure:**

- **It runs in the browser, on the delegate's/staff's own device.** No image, no
  video, and no vector is ever sent to a third party. The only thing that
  reaches our own backend is the resulting numeric embedding.
- **The model weights are self-hosted, deliberately not loaded from a CDN.**
  `frontend/scripts/copy-human-models.mjs` copies them out of the installed npm
  package into `frontend/public/models/human/` (~11MB, 10 files), and it runs
  automatically from the `predev` and `prebuild` hooks in
  `frontend/package.json`. So a plain `npm install && npm run dev` is all the
  setup there is.
  - The folder is **gitignored** — it's build output, regenerated from the
    package, not source. If face scan ever says the model failed to load, the
    fix is `npm install` in `frontend/` (which re-runs the copy), not a config
    change.
  - Self-hosting also means face scan keeps working on a venue's captive/dead
    Wi-Fi once the page is loaded, which a CDN dependency would not.
- **The library is loaded by dynamic `import()`**, so its ~2MB never enters the
  initial bundle — pages that don't scan faces don't pay for it.

**Privacy / PDPA position (unchanged by this upgrade):** what's stored against a
delegate is a token like `face:v3:<hash>:<~1024 floats>` — a one-way numeric
descriptor, **not a photograph**. You cannot reconstruct a face from it. The
older `face:v1:` hash tokens are still accepted so existing enrolments keep
working.

**Matching happens on our backend**, in `backend/lib/biometricMatch.js`: cosine
similarity against the enrolled roster, gated by both a confidence threshold
**and** a runner-up margin — if two delegates score too closely, it rejects
rather than guesses, because a confidently wrong check-in is worse than asking
staff to fall back to manual.

**Cost: free** (Apache-2.0 / MIT-licensed model weights, no per-call pricing).

---

## Summary table

| Service | Required? | Cost | Powers |
|---|---|---|---|
| Postgres (Neon) | **Required** | Free tier is enough | Everything — the database |
| Cloudinary | Optional | Free tier (25 credits/mo) | Delegate/staff photos, announcement media (image+video), User Guide video |
| Google Maps (Embed API) | Optional | Free | "Last known location" map |
| AMap (高德) | Optional — works keyless | Free; key needs a mainland-CN phone + real-name check | Same map, and **the only one that works in mainland China** (Google is blocked there) |
| Ollama | Optional (recommended) | Free | AI Insights / chatbot / document parsing |
| Anthropic (Claude) | Optional (fallback) | Pay-as-you-go | Same 3 AI features, if Ollama unavailable |
| SendGrid | Optional — **✅ currently live** | Free (100/day) | "Escalate to office" emails **and biometric-enrolment invites** — both send for real; use `MAIL_DRY_RUN=true` to demo |
| `@vladmandic/human` face models | Bundled — **no account, no key** | Free | Face check-in + self-enrolment; runs on-device, weights self-hosted and copied automatically by `npm install` |
| Twilio | Optional, **not yet enabled** | Paid per message | SMS/WhatsApp escalation alerts |
| JWT_SECRET | Recommended | Free (self-generated) | Signs login sessions — see `backend/.env.example` |
