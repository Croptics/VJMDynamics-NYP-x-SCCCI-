# Integration Notes — DocuSync AI + Trip Assistant (Vance)

**Screens:** 4 (Document Parsing / Onboarding) and 6 (Trip Assistant).
**Use cases:** UC1 Automated Attendee Onboarding via AI Document Parsing · UC2 Real-Time Attendance & Exception Tracking via AI Chatbot.

This feature is a **self-contained module**. It does not modify JQ's base files
(`server.js` beyond the two-line mount in the TEAMMATE ZONE, `data.js`,
`auth.js`, `permissions.js`). Everything lives in:

```
backend/routes/vance.js                 ← both features' API
frontend/src/lib/claudeParse.js         ← parse + confirm bridge
frontend/src/pages/OnboardingPage.jsx   ← Screen 4 (wired to real backend)
frontend/src/pages/ChatAssistantPage.jsx← Screen 6 (real AI + saved history)
frontend/src/pages/mobile/MobileAssistantPage.jsx ← mobile chat (real AI)
```

Mounted with two lines in `server.js`'s TEAMMATE ZONE, exactly like
`desmond.js` and `exceptions.js`.

## API endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/documents/parse` | `manageDelegates` | Raw file body → Claude reads it → structured rows + confidence |
| POST | `/api/trips/:id/onboarding/confirm` | `manageDelegates` | Commit reviewed rows into the shared `delegates` table |
| POST | `/api/chat/messages` | signed-in | Stateless Q&A over live data (used by mobile) |
| GET | `/api/chat/sessions` | signed-in | List this account's saved chats |
| POST | `/api/chat/sessions` | signed-in | Start a new chat |
| GET | `/api/chat/sessions/:id` | signed-in | Load one chat's messages |
| POST | `/api/chat/sessions/:id/messages` | signed-in | Ask inside a saved chat; auto-titles it |
| DELETE | `/api/chat/sessions/:id` | signed-in | Delete one of your chats |

## How this connects to the rest of the team (why it's the "connective tissue")

- **Document parsing writes to the SHARED `delegates` table** via JQ's own
  `createDelegate()`. So a parsed delegate immediately appears on JQ's
  dashboard, Desmond's coach board, and Jayden's exception delegate-picker —
  no separate table, no sync step. Parsed rows are also linked to the trip
  (`trip_id`) so they show on Desmond's board right away.
- **The chatbot reads a live snapshot assembled from everyone's data:**
  delegates + coach counts (JQ/Desmond), open exception tickets (Jayden),
  check-in method breakdown QR/Face/Manual (Vimal/Jayden's `check_in_logs`),
  and today's itinerary (Desmond). Each cross-feature read is wrapped in
  try/catch, so if a teammate's table isn't present yet the chat still works —
  it just omits that section. Only this developer-authored snapshot is ever
  sent to the model; it cannot query arbitrary rows.

## Additive schema (never drops/changes base tables)

Created lazily on first use by `ensureReady()` in `vance.js`:

- `delegates`: `ADD COLUMN IF NOT EXISTS passport_no / nationality / passport_expiry`
  (reuses Desmond's existing `company` column, doesn't recreate it).
- new tables `chat_sessions`, `chat_messages` for saved assistant history.

## AI providers (deliberate split)

- **Parsing → Claude only.** It must *see* the document. Local Ollama
  (llama3.2) is text-only and can't read PDFs/images, so parsing goes straight
  to the Anthropic API. Needs `ANTHROPIC_API_KEY` in `backend/.env`; without
  it the route returns a clear "not configured" message instead of erroring.
- **Chatbot → Ollama first, then Claude.** It reasons over a text snapshot, so
  it mirrors JQ's `routes/insights.js`: try local Ollama (free), fall back to
  the Anthropic API, else a clear "not configured" message.

## Edge cases handled (maps to rubric "edge cases handled gracefully")

- **Blurry / low-confidence extraction (UC1 alternative flow):** rows below the
  confidence threshold are flagged for manual review and are editable inline;
  the model is instructed to return `null` rather than invent a passport
  number it can't read.
- **Directory with no passport numbers:** a missing passport/expiry does not
  force a review — only low confidence or an unreadable name does — so a plain
  attendee directory imports cleanly.
- **Ambiguous chatbot query (UC2 alternative flow):** the system prompt tells
  the model to ask ONE clarifying question (e.g. "Coach 2A or 2B?") instead of
  guessing.
- **No trip selected before confirm:** blocked with a friendly message.
- **Missing permission / missing API key / unreadable file:** each returns a
  specific message the UI surfaces, not a bare status code.

## Env

Add to `backend/.env` (see `.env.example`):

```
ANTHROPIC_API_KEY=sk-ant-...          # required for document parsing
# ANTHROPIC_MODEL=claude-sonnet-4-5-20250929   # optional override
```

For the chatbot, either the same Anthropic key works, or run Ollama locally
(`ollama pull llama3.2`) for a free, offline option.
