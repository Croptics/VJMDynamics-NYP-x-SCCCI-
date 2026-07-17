# Integration Notes — DocuSync AI + Trip Assistant + QR Boarding (Vance)

**Screens:** 4 (Document Parsing / Onboarding) and 6 (Trip Assistant).
**Use cases:**
- **UC1** Automated Attendee Onboarding via AI Document Parsing.
- **UC2** Real-Time Attendance & Exception Tracking via AI Chatbot.
- **Cross-feature:** onboarded delegates get a unique **QR boarding pass** — the
  hand-off to Vimal's on-site scanner, which boards them into Desmond's coach board.

Self-contained module — it does **not** modify JQ's base files (`server.js`
beyond the two-line TEAMMATE-ZONE mount, `data.js`, `auth.js`, `permissions.js`)
and edits **no** teammate feature files. Everything lives in:

```
backend/routes/vance.js                    ← all APIs (parsing, assistant, QR passes)
frontend/src/lib/claudeParse.js            ← parse / confirm / badges bridge
frontend/src/pages/OnboardingPage.jsx      ← Screen 4 (2 tabs: parse / boarding passes)
frontend/src/pages/BoardingPassesView.jsx  ← printable QR badge per delegate
frontend/src/pages/ChatAssistantPage.jsx   ← Screen 6 (streaming AI + saved history)
frontend/src/pages/mobile/MobileAssistantPage.jsx ← mobile chat
```

Mounted with two lines in `server.js`'s TEAMMATE ZONE, exactly like `desmond.js`
and `exceptions.js`. Dependencies added: `unpdf` (backend PDF text extraction)
and `qrcode` (frontend QR-pass generation).

## API endpoints

### Document parsing & onboarding
| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/documents/parse` | `manageDelegates` | Synchronous parse → structured rows + confidence |
| POST | `/api/documents/parse-async` | `manageDelegates` | Start a **background** parse job (returns `jobId`) |
| GET | `/api/documents/parse-async/:id` | signed-in | Poll job: `status`, `done/total`, streamed `rows` |
| GET | `/api/onboarding/context` | signed-in | Existing delegate names (dedup) + coaches |
| POST | `/api/trips/:id/onboarding/confirm` | `manageDelegates` | Commit rows to shared `delegates`; mints a `qr_code` each |

### QR boarding passes
| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/onboarding/badges` | signed-in | Delegates + generated `qr_code` for the printable boarding passes |

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

## Connective tissue (how it integrates with the team)

- **Onboarding writes to the SHARED `delegates` table** via JQ's `createDelegate()`
  — so a parsed delegate appears on JQ's dashboard, is linked to the trip
  (`trip_id`), and is available to everyone. No separate table, no sync step.
- **QR boarding passes → Vimal's scanner:** each onboarded delegate gets a unique
  `qr_code`, rendered as a printable QR pass. That pass is the **hand-off point** —
  Vimal's on-site scanner reads the code (`POST /api/checkins`) and flips the
  delegate to `status='PRESENT'`, which **Desmond's coach board counts by coach**
  and JQ's dashboard head-count reflects. The shared `qr_code` is the contract
  between onboarding and the scanner; the scanning/check-in itself is **not owned
  here**.
- **The chatbot reads a live snapshot assembled from everyone's data:** delegate
  roster + coach counts (JQ/Desmond), open exception tickets (Jayden), check-in
  method breakdown (`check_in_logs`, shared with Vimal/Jayden), and today's
  itinerary (Desmond). Every cross-feature read is `try/catch`-isolated, so a
  missing teammate table never breaks the chat. Only this developer-authored
  snapshot is sent to the model — it cannot query arbitrary rows.

## Additive schema (never drops/changes base tables)

Created lazily on first use by `ensureReady()` in `vance.js`:

- `delegates`: `ADD COLUMN IF NOT EXISTS` for `passport_no, nationality,
  passport_expiry, role, industry, email, phone, website, qr_code`
  (+ a partial unique index on `qr_code`). Reuses Desmond's existing `company`.
- `chat_sessions` (incl. `pinned`), `chat_messages` for saved assistant history.

## AI providers (deliberate, cost-aware split)

- **Document parsing — text-first, vision-fallback (hybrid):**
  1. PDFs are read as **text server-side** with `unpdf`. If real text is present
     (delegate directories, attendee lists, spreadsheet exports), it's structured
     by an LLM as text — cheap, fast, page-by-page, works on free Ollama.
  2. Scanned PDFs / images (no extractable text) fall back to **Claude vision**.
  Provider preference for structuring: **Claude if `ANTHROPIC_API_KEY` is set
  (best accuracy), else Ollama `OLLAMA_PARSE_MODEL`** (default `llama3.2`, the 3B
  model). Bilingual (中文/English) names are collapsed to the romanised name and
  placeholder/garbage names are dropped.
- **Chatbot — Ollama-first, Claude fallback** (mirrors JQ's `insights.js`). Uses
  `OLLAMA_MODEL` (set to `llama3.2:1b` for demo speed), replies **stream token by
  token** over SSE. Attendance numbers are given to the model pre-computed (a
  "ready-made summary" line in the snapshot) so a small model still reports exact
  figures — *AI handles language, code handles arithmetic*.

## Edge cases handled

- **Blurry / low-confidence extraction:** rows below the confidence threshold are
  flagged for review and editable inline; the model returns `null` rather than
  inventing an unreadable field.
- **Directory with no passport numbers:** missing passport fields don't force a
  review — a plain attendee directory imports cleanly.
- **Big documents:** async job with progress; the admin can leave the page and
  re-attach — parsing continues server-side.
- **Duplicates:** onboarding flags names already in the trip and skips them on
  confirm.
- **Unknown / already-scanned QR:** check-in returns a clear message (404 unknown,
  "already boarded" otherwise) instead of a bare status code.
- **AI busy vs not configured:** the assistant distinguishes "busy, try again"
  (Ollama running but slow) from "not configured" (nothing installed).
- **Ambiguous chatbot query:** the prompt tells the model to ask ONE clarifying
  question instead of guessing; out-of-scope questions are politely declined.

## Env (`backend/.env`, see `.env.example`)

```
DATABASE_URL=postgresql://...neon.tech/...?sslmode=require   # shared team Neon
OLLAMA_MODEL=llama3.2:1b        # chatbot model (fast). Omit for llama3.2 (3B, more accurate)
# OLLAMA_PARSE_MODEL=llama3.2   # parsing model (defaults to llama3.2 / 3B)
# ANTHROPIC_API_KEY=sk-ant-...  # optional: enables Claude vision (scanned docs) + higher-quality
```

The chatbot and text-based parsing work fully offline on Ollama; a Claude key is
only needed to read **scanned/image** documents (vision).
