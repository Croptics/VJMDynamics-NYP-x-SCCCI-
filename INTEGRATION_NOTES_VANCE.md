# Integration Notes — DocuSync AI + Trip Assistant + QR Boarding Passes (Vance)

**Screens:** 4 (Document Parsing / Onboarding) and 6 (Trip Assistant).
**Use cases:**
- **UC1** Automated Attendee Onboarding via AI Document Parsing.
- **UC2** Real-Time Attendance & Exception Tracking via AI Chatbot.
- **Cross-feature:** every onboarded delegate gets a unique **QR boarding pass**,
  which is the badge the on-site scanner reads to check them in.

Self-contained module — it does **not** modify JQ's base files (`server.js` beyond
the two-line TEAMMATE-ZONE mount, `auth.js`, `permissions.js`) and edits no
teammate feature files. Everything lives in:

```
backend/routes/vance.js                    ← all APIs (parsing, boarding passes, assistant)
frontend/src/lib/claudeParse.js            ← parse / confirm / badges / check-in bridge
frontend/src/pages/OnboardingPage.jsx      ← Screen 4 (2 tabs: parse / boarding passes)
frontend/src/pages/BoardingPassesView.jsx  ← pass desk: search/filter, per-coach list, view/print a pass
frontend/src/pages/ChatAssistantPage.jsx   ← Screen 6 (streaming AI + saved history)
frontend/src/components/TripPulse.jsx       ← header status widget: onboarding progress (Onboarding tab) / ranked "what to watch" risks (Assistant)
frontend/src/pages/mobile/MobileAssistantPage.jsx ← mobile chat
```

Dependencies added by this module: `unpdf` (backend PDF text extraction) and
`qrcode` (frontend QR-pass generation).

## API endpoints

### Document parsing & onboarding
| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/documents/parse` | `manageDelegates` | Synchronous parse → structured rows + confidence |
| POST | `/api/documents/parse-async` | `manageDelegates` | Start a **background** parse job (returns `jobId`) |
| GET | `/api/documents/parse-async/:id` | signed-in | Poll job: `status`, `done/total`, streamed `rows` |
| GET | `/api/onboarding/context` | signed-in | Existing delegate names (dedup) + coaches |
| POST | `/api/trips/:id/onboarding/confirm` | `manageDelegates` | Commit rows to shared `delegates`; mints a `qr_code` each |

### QR boarding passes & check-in  ⭐ shared contract
| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/onboarding/badges` | signed-in | Delegates + generated `qr_code` for the printable passes |
| POST | `/api/onboarding/checkin` | signed-in | Resolve a scanned `qr_code` → PRESENT (+coach) → `check_in_logs` |

### Trip assistant (chatbot)
| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/chat/messages` | signed-in | Stateless Q&A (mobile) |
| GET/POST | `/api/chat/sessions` | signed-in | List / start saved chats |
| GET | `/api/chat/sessions/:id` | signed-in | Load a chat's messages |
| POST | `/api/chat/sessions/:id/messages` | signed-in | Ask (non-streaming); auto-titles |
| POST | `/api/chat/sessions/:id/stream` | signed-in | Ask with **SSE token streaming** |
| POST | `/api/chat/sessions/:id/regenerate` | signed-in | Re-answer the last question (SSE) |
| PATCH | `/api/chat/sessions/:id` | signed-in | Rename and/or pin a chat |
| DELETE | `/api/chat/sessions/:id` | signed-in | Delete a chat |
| GET | `/api/assistant/roster` | signed-in | Delegate details → clickable delegate cards |
| GET | `/api/assistant/pulse` | signed-in | Compact live status (trip, KPIs, top risks) for the header widget |

## Connective tissue (how this integrates with the team)

- **Onboarding writes to the SHARED `delegates` table** via JQ's `createDelegate()`,
  scoped to the trip at creation — so a parsed delegate appears on JQ's dashboard,
  Desmond's Trips board, and the check-in module with no sync step.
- **The QR boarding pass is the badge contract.** `BoardingPassesView` encodes the
  delegate's plain `qr_code` (e.g. `MG-86B620A4`) from the shared `delegates` table.
  **Jayden's `QRScannerPanel.jsx`** (mounted in the `qr` slot of Vimal's shared
  `QRCheckInPage`) scans that code and registers it through **`POST /api/onboarding/checkin`**
  (via `qrCheckin()`), which flips the delegate to `status='PRESENT'` (+coach) and
  writes a `check_in_logs` QR row. **Desmond's coach board counts `PRESENT` by coach**
  and JQ's head-count agrees. Jayden dropped his original JSON badge format to
  standardise on this plain code — so **`qr_code`, `/api/onboarding/checkin` and
  `qrCheckin()` are load-bearing for the scanner: do not remove them.**
  (There is no separate "scan" tab on the Onboarding screen — the real scanner is
  the shared check-in page; Onboarding only *issues* the passes.)
- **The chatbot reads a live snapshot assembled from everyone's data:** delegate
  roster + coach counts (JQ/Desmond), open exception tickets (Jayden), check-in
  method breakdown (`check_in_logs`), and today's itinerary (Desmond). Every
  cross-feature read is `try/catch`-isolated, so a missing teammate table never
  breaks the chat. Only this developer-authored snapshot reaches the model — it
  cannot query arbitrary rows. **The snapshot is scoped to the Beijing study
  mission (`t-1`)** — `buildSnapshot()` passes `resolveTripUuid("t-1")` to
  `getTrip/getDashboard/getMissing` and filters the roster by `trip_id`, so the
  assistant + Trip Pulse widgets never mix trips or disagree with the dashboard
  (JQ's `getTrip/getDashboard` default to an arbitrary `LIMIT 1` trip otherwise).
- **Trip scoping uses `resolveTripUuid()`** (a local helper in `vance.js` — kept
  self-contained rather than editing JQ's `data.js`) everywhere a trip id arrives
  from the client: `onboarding/confirm`, `onboarding/context`, `onboarding/badges`.
  It resolves the trip by **either** the `trips.id` string (`"t-1"`, the base trip)
  **or** its `uuid_id` — which is what `GET /all-trips` returns as `id` and what the
  Onboarding trip picker now sends. A raw `trips WHERE id = $1` lookup silently
  matched nothing for non-base trips and orphaned the delegates (created with a null
  `trip_id`), so `confirm` now also **returns `404 UNKNOWN_TRIP`** instead of writing
  orphans when a trip can't be resolved. The Onboarding trip picker fetches the
  **real** trip list (`GET /all-trips`), not the old hardcoded `t-1/t-2/t-3` stub
  (whose `t-2`/`t-3` matched no row in the shared DB).

## Additive schema (never drops/changes base tables)

Created lazily on first use by `ensureReady()` in `vance.js`:

- `delegates`: `ADD COLUMN IF NOT EXISTS` for `passport_no, nationality,
  passport_expiry, role, industry, email, phone, website, qr_code`
  (+ a partial unique index on `qr_code`). Reuses Desmond's existing `company`.
- `chat_sessions` (incl. `pinned`), `chat_messages` for saved assistant history.

## AI providers (deliberate, cost-aware split)

- **Document parsing — text-first, vision-fallback (hybrid):**
  1. PDFs are read as **text server-side** with `unpdf`. If real text is present
     (delegate directories, attendee lists, spreadsheet exports), it's structured by
     an LLM as text — cheap, fast, page-by-page, and runs on free local Ollama.
  2. Scanned images (no extractable text) fall back to **vision**: Claude vision if
     `ANTHROPIC_API_KEY` is set, else **local Tesseract OCR** (`method: "ocr/tesseract"`)
     so passport/ID photos and photographed lists work fully offline — the OCR text
     flows through the same structuring step. (Scanned image-only PDFs aren't
     rasterised; upload them as an image.)
  Structuring prefers **Claude if `ANTHROPIC_API_KEY` is set** (best accuracy), else
  Ollama `OLLAMA_PARSE_MODEL` (default `llama3.2`, 3B). Bilingual (中文/English)
  names collapse to the romanised name; placeholder/garbage names are dropped.
- **Chatbot — Ollama-first, Claude fallback** (mirrors JQ's `insights.js`). Uses
  `OLLAMA_MODEL` (`llama3.2:1b` for demo speed); replies **stream token-by-token**
  over SSE. Attendance figures are pre-computed into the snapshot ("ready-made
  summary" line) so even a small model reports exact numbers — *AI handles language,
  code handles arithmetic.*
- **Deterministic fast-path (`answerLocally`)** — common factual questions
  (attendance, present/missing/unassigned, coach superlatives, company/industry
  breakdowns, VIPs, exceptions, itinerary, "who should I worry about", and named
  delegate look-ups) are answered **instantly from the snapshot with no model
  call** — exact and never hallucinated. Open-ended/generative questions and any
  Chinese question return `null` and fall through to the LLM. Applied on
  `/chat/messages` and the `/stream` endpoint (which emits the whole answer as one
  SSE token); `source:"local"` marks a fast-path reply. Not applied to
  `/regenerate` (that always re-attempts via the model). **Because the fast-path
  needs no model, the assistant still answers common factual questions even where
  no AI engine is reachable** (e.g. the deployed cloud host without Ollama) —
  open-ended questions then return a graceful "text engine unavailable here"
  message (`source:"unavailable"`) instead of an error.
- **Passport-expiry validation (`checkPassportExpiry`)** flags delegates whose
  passport is **expired** or **expiring within 6 months** (the standard overseas
  rule); missing/unparseable dates are never flagged. Surfaced three ways: a
  review-time pill on the onboarding cards (catch it before confirm), a fast-path
  assistant intent ("any passport issues?"), and a `computeRisk` item (expired =
  critical, expiring = medium) so it appears in the "what to watch" widget too.
- **Risk scoring (`computeRisk`)** ranks what to worry about from the live
  snapshot — missing VIPs and CRITICAL exceptions first, then the coach furthest
  from boarded, then ordinary open tickets. It powers the fast-path "who should I
  worry about" answer *and* a ranked `PRIORITIES` block in the model prompt, so
  both the instant and the LLM answers lead with the same computed judgement.
- **Snapshot cache + model warm-up (speed):** `getSnapshot()` caches the ~6-query
  snapshot for 5s (invalidated on confirm and QR check-in, so the bot never shows
  stale counts after a write); a fire-and-forget warm-up call on first module use
  preloads the chat model so the first question doesn't pay the ~20-30s cold load.

## Edge cases handled

- **Low-confidence extraction:** rows below the threshold are flagged "Needs review"
  and are editable inline; the model returns `null` rather than inventing a field.
- **Directory with no passport numbers:** missing passport fields don't force review.
- **Big documents:** async job with progress; the admin can leave the page and
  re-attach — parsing continues server-side.
- **Duplicates:** rows already in the trip are flagged and skipped on confirm; the
  Confirm button disables when there's nothing new to add.
- **Junk rows:** `onboarding/confirm` skips implausible rows (a name needs ≥2
  letters; a ≤2-char single-token name with no company/role/email/phone/passport
  is treated as a stray test entry) and returns `skippedInvalid` alongside `added`
  so the UI can report how many were dropped. Conservative — real short names
  like "Wu"/"Ng" pass whenever the row carries any supporting field.
- **Unknown / already-scanned QR:** check-in returns a clear message (404 unknown,
  "already boarded" otherwise), and resolves the trip from the delegate's own record
  so a mistyped `tripId` can't file a check-in against the wrong trip.
- **5-status compatibility (read side):** the team's integration introduced
  `ARRIVED`/`ASSIGNED`/`LATE` alongside the legacy `PRESENT`/`MISSING`. My read
  paths treat **`PRESENT` and `ARRIVED` both as "boarded"** (badges present-count,
  check-in `alreadyBoarded` + counts, boarding-pass status labels + filter, and
  the assistant's person/VIP status lines), so a delegate a teammate's scanner
  marks `ARRIVED` still reads correctly here. My check-in still *writes* `PRESENT`
  (which the team's app accepts as the legacy value). To keep every one of my own
  surfaces consistent, `buildSnapshot()` computes its **own** 5-status KPIs from
  the scoped roster (boarded = `PRESENT`+`ARRIVED`, unassigned = no coach, missing
  = the rest) rather than JQ's `getDashboard` (which counts `PRESENT` only on this
  branch) — so the assistant, Trip Pulse widget, and boarding-pass counts all agree.
- **AI busy vs not configured:** the assistant distinguishes "busy, try again"
  (Ollama up but slow) from "not configured" (nothing installed).
- **Ambiguous chatbot query:** the prompt asks ONE clarifying question rather than
  guessing; out-of-scope questions are politely declined.

## Env (`backend/.env`, see `.env.example`)

```
DATABASE_URL=postgresql://...neon.tech/...?sslmode=require   # shared team Neon
OLLAMA_MODEL=llama3.2:1b        # chatbot model (fast). Omit for llama3.2 (3B, more accurate)
# OLLAMA_PARSE_MODEL=llama3.2   # parsing model (defaults to llama3.2 / 3B)
# ANTHROPIC_API_KEY=sk-ant-...  # optional: enables Claude vision (scanned docs) + higher accuracy
```

The chatbot and text-based parsing work fully offline on Ollama; a Claude key is
only needed to read **scanned/image** documents (vision).
