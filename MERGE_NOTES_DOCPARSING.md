# Merge — Vance's new Document Parsing into Jayden's build

**Base:** `VJMDynamics-QR+Exceptions-Jayden` (your branch — everything of yours kept).
**Merged in:** the Document Parsing / Onboarding feature from `DocuSync-AI-Vance`.

Your branch was the base on purpose: it is **newer** for your own files. Vance's
copy of `exceptions.js` was missing your `POST /api/checkins/qr` endpoint, his
`exceptionsApi.js` was missing `checkInByQR`, and his `QRCheckInPage.jsx` is a
26-line stub versus your 1271-line version. Nothing of yours was overwritten.

## Changed vs your original zip

**Added (4):**
```
backend/routes/vance.js                    all parsing + assistant APIs
frontend/src/pages/BoardingPassesView.jsx  printable QR badge per delegate
frontend/src/pages/ScanToBoardView.jsx     on-site scan → check-in
INTEGRATION_NOTES_VANCE.md                 his own notes
```

**Replaced (2) — the actual document-parsing swap:**
```
frontend/src/pages/OnboardingPage.jsx      364 → 464 lines, now 3 tabs
frontend/src/lib/claudeParse.js            parse/confirm/badge/check-in bridge
```

**Merged, not overwritten (3):**
| File | Change |
| --- | --- |
| `backend/server.js` | +6 lines: mounts `vanceRouter` in the TEAMMATE ZONE, next to your `exceptionsRouter` and `vimalRouter`. It needs no startup-chain entry — it creates its own schema lazily via `ensureReady()`. |
| `backend/package.json` | +`unpdf` (server-side PDF text extraction) |
| `frontend/package.json` | +`qrcode`, +`html5-qrcode`. **`jsqr` deliberately kept.** |

**Removed: nothing.**

> ### The one trap worth knowing about
> Vance's `frontend/package.json` **drops `jsqr`** — the library your QR scanner
> runs on. Copying his file wholesale would have broken your scanner at build
> time. Dependencies were merged key-by-key instead, so all three QR libraries
> coexist: `jsqr` (yours), `html5-qrcode` + `qrcode` (his).

## Your files — byte-identical to your zip

Verified with `diff`, all 12:

```
frontend/src/pages/QRCheckInPage.jsx          frontend/src/pages/ExceptionInboxPage.jsx
frontend/src/components/QRScannerPanel.jsx    frontend/src/pages/ExceptionInboxPage.css
frontend/src/components/ManualTrackingPanel.jsx  frontend/src/components/LogExceptionModal.jsx
frontend/src/components/IssuesPanel.jsx       frontend/src/lib/useCriticalCount.js
backend/routes/exceptions.js                  backend/routes/vimal.js
frontend/src/lib/exceptionsApi.js             backend/seed-demo.js
```

## No route collisions

Every path in `vance.js` was compared against `exceptions.js`, `vimal.js`,
`desmond.js` and `insights.js`. **Zero overlaps.** His are namespaced under
`/api/documents/*`, `/api/onboarding/*`, `/api/chat/*`, `/api/assistant/*`;
yours stay on `/api/exceptions/*`, `/api/trips/:id/exceptions`, `/api/checkins/qr`
and `/api/checkins/manual`.

His schema work is additive only — `ADD COLUMN IF NOT EXISTS` on `delegates`
(`qr_code`, `passport_no`, `nationality`, `industry`, `email`, …) plus two new
tables (`chat_sessions`, `chat_messages`). Nothing of yours is touched.

## Verified against a real PostgreSQL database

**Your functions:**
- Exception inbox loads with live counts `{all, critical, open, resolved, criticalOpen}`
- Create CRITICAL exception → fans out; repeated `clientEventId` returns `duplicate: true`
- `POST /api/checkins/qr` → `PRESENT / QR`, delegate name resolved
- `POST /api/checkins/manual` → `PRESENT / MANUAL`
- Resolve → `RESOLVED`; resolving again → **409**
- SSE alert stream connects; sidebar critical-count endpoint returns live number
- `check_in_logs` recorded **both** `QR=1` and `MANUAL=1`
- Vimal's `/api/attendance/*` still mounted (HTTP 200)

**In the browser (14/14 checks):** exception inbox renders with its 4 filter tabs
and a live SSE indicator; `/checkin` renders; the **QR tab is your real scanner,
not a template**; the Manual tab is real; the Issues tab is your log form.

**Vance's new page:** renders with all three tabs — *Document parsing ·
Boarding passes · Scan to board* — and the Boarding passes tab generated **9 QR
badges** (e.g. `MG-0735E115`).

**Bonus fix:** your `MobileAssistantPage` already called `/chat/messages`, which
did not exist on your branch (it 404'd). `vance.js` provides it, so the mobile
assistant now works.

---

## ⚠️ Document parsing needs an AI engine — read this before demoing

Your `backend/.env` has **no AI engine configured**, so parsing will not run yet.
Tested with your `Delegation-sample-2pages.pdf`: the upload succeeds and a job
starts, then stops with

> *"Document reading needs an AI engine. Start Ollama (ollama pull llama3.2), or
> set ANTHROPIC_API_KEY in backend/.env."*

That is Vance's error handling working correctly, not a merge fault. Pick one:

**Option A — Ollama (free, offline, no key):**
```bash
ollama pull llama3.2      # then just restart the backend
```

**Option B — Claude (better accuracy, needed for scanned/image docs):**
add to `backend/.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
```

The good news: your sample PDF is **text-based**, so the cheap text-first path
applies. `unpdf` already extracts it cleanly — 2 pages, 3388 characters, and all
four delegate names (Cliff Chai, Vincent Koh, Reyes Tin, Marc Goh) are present in
the extracted text. Once an engine is configured, this document should import.

## Also worth knowing

- **The demo account cannot log exceptions by default.** `staff_194` ships with
  `manageExceptions: false`, so `POST /api/trips/:id/exceptions` correctly returns
  **403**. Grant it on the **Account control** page before demoing your Issues tab
  and inbox actions. (Not a merge issue — it is the seeded permission set.)
- **`backend/.env` is included** in this zip because it was in yours, so the app
  runs immediately. It contains your Neon password — it is already in
  `.gitignore`, so keep it out of Git.
- **Not brought over (out of scope, as you asked):** Vance's
  `ChatAssistantPage.jsx` (Screen 6, 513 lines). Yours stays the 192-line mock,
  which makes no API calls, so nothing breaks. Say the word if you want it.
- **QR codes are not cross-compatible yet** — as you specified. His badges are
  `MG-XXXXXXXX` strings resolved via `/api/onboarding/checkin`; your scanner reads
  `{"t":"mg-checkin","tripId":...,"delegateId":...}` JSON. Both work independently.

## Run it

```bash
cd backend  && npm install && npm start      # terminal 1
cd frontend && npm install && npm run dev    # terminal 2
```
Sign in `staff_194` / `password123!` → **Documents** (new parsing page),
**Exceptions** (your inbox), **/checkin** (your QR + manual + issues).
