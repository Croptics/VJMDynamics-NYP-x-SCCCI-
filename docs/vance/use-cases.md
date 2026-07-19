# Use Cases — Vance (Document Parsing + Trip Assistant)

Covers Screen 4 (Document Parsing / Onboarding, incl. QR boarding passes) and
Screen 6 (Trip Assistant).

## Actors
- **Secretariat organiser** — SCCCI staff with the `manageDelegates` permission;
  onboards delegates and prints boarding passes (desktop).
- **On-ground staff** — signed-in staff boarding delegates on-site by scanning QR
  badges (the scanner UI is shared/Jayden's; it calls my check-in endpoint).
- **Any signed-in staff** — asks the Trip Assistant about live trip status (desktop
  or mobile).
- **System actors** — the AI parser (Ollama/Claude) and the QR scanner.

---

### UC-1 — Read a delegate directory into structured rows
**Actor:** Secretariat organiser · **Trigger:** uploads a PDF/image on the
Document Parsing tab.
**Preconditions:** signed in with `manageDelegates`; a trip is selected.

**Main flow**
1. Organiser selects the target trip, then drops a delegate-directory PDF.
2. The system starts a **background parse job** and shows live progress
   (`Reading page 2/4 · 7 found so far`).
3. Pages are read text-first (`unpdf` → LLM); extracted people stream into a
   reviewable card list, each with a confidence score.
4. Job completes; organiser proceeds to UC-2.

**Alternative / edge flows**
- **A1 — Leaves the page mid-parse:** the job runs server-side; on return the page
  re-attaches to the same job by id and progress continues.
- **A2 — Scanned/image document with no text layer:** falls back to the vision
  path — Claude vision if a key is set, otherwise **local Tesseract OCR** for
  images, so passport/ID photos and photographed lists are read fully offline.
  (Scanned image-only PDFs aren't rasterised; the user uploads them as an image.)
- **A3 — Bilingual entries (`陈伟 / Reyes Tin`):** merged into one record with the
  romanised name; stray Chinese-only duplicate rows are dropped.
- **A4 — Unsupported file / empty upload:** rejected with `415`/`400` before any
  work starts.
- **A5 — No AI engine available:** job errors with guidance to start Ollama.

### UC-2 — Review and confirm extracted delegates
**Actor:** Secretariat organiser · **Trigger:** presses **Confirm & add** after
reviewing the parsed rows.

**Main flow**
1. Organiser edits any field inline, flags VIPs, and assigns a coach per row.
2. Duplicates (names already in the trip) and low-confidence rows are flagged.
3. On confirm, new rows are written to the shared `delegates` table; each gets a
   unique `qr_code`. Coach-assigned delegates become `MISSING`; the rest
   `UNASSIGNED`.
4. A summary reports how many were added, and how many were skipped.

**Alternative / edge flows**
- **A1 — Duplicates:** rows already in the trip are skipped and reported
  (`N duplicates skipped`); Confirm disables when nothing new remains.
- **A2 — Junk rows:** stray entries (e.g. `jq` — a 2-char name with no supporting
  field) are rejected by `isPlausibleDelegate` and reported as `invalid skipped`;
  genuine short names (`Wu`, `陈伟`) pass.
- **A3 — Needs review:** rows below the confidence threshold are highlighted; the
  organiser confirms an explicit "add anyway".
- **A4 — Dead/unknown trip:** if the trip can't be resolved, confirm returns
  `404 UNKNOWN_TRIP` instead of silently orphaning delegates.

### UC-3 — Print QR boarding passes
**Actor:** Secretariat organiser · **Trigger:** opens the Boarding passes tab.

**Main flow**
1. The organiser sees passes grouped by coach, with search and status filters
   (All / Not boarded / Boarded).
2. Clicking a delegate opens their QR pass to copy the code or print one pass.
3. **Print all** prints every pass — or, when a search/filter is active, only the
   **filtered** set (button reads "Print filtered (N)").

**Alternative / edge flows**
- **A1 — No delegates yet:** an empty state prompts onboarding first.
- **A2 — Delegate has no code yet:** codes are backfilled on load so every pass is
  printable.

### UC-4 — Board a delegate by scanning their QR badge
**Actor:** On-ground staff · **Trigger:** scans a delegate's QR at the coach.

**Main flow**
1. The scanner reads the `qr_code` and calls `POST /api/onboarding/checkin`.
2. The delegate is marked `PRESENT` (+coach) and a `check_in_logs` row is written.
3. The response returns updated `total`/`present` counts for the coach board.

**Alternative / edge flows**
- **A1 — Already boarded:** returns `alreadyBoarded: true` so the scanner shows a
  gentle "already checked in".
- **A2 — Unrecognised badge:** `404 UNKNOWN_CODE`.
- **A3 — Trip mismatch:** the trip is taken from the delegate's own record, so a
  wrong `tripId` in the request can't file against the wrong trip.

### UC-5 — Ask the Trip Assistant about live status
**Actor:** Any signed-in staff · **Trigger:** types a question (desktop or mobile).

**Main flow**
1. Staff asks, e.g. "who's missing?", "which coach has the most missing?", "what
   company is Dane Soh from?".
2. Common factual questions are answered **instantly** from a live snapshot
   (deterministic fast-path — exact numbers, no model call).
3. Otherwise the model answers, **streaming** token-by-token over SSE.

**Alternative / edge flows**
- **A1 — Open-ended / generative request** ("draft an email to the missing"):
  falls through to the model rather than a data lookup.
- **A2 — Chinese question:** answered by the model in Simplified Chinese.
- **A3 — Out of scope** ("what's the weather?"): the assistant says it only tracks
  trip data and redirects.
- **A4 — Model busy/cold** (a parse is running): a clear "busy, try again"
  message; the model is warmed up at startup to avoid a cold first answer.
- **A5 — Fresh data after a write:** onboarding a delegate or a QR check-in
  invalidates the snapshot cache, so the next answer reflects it immediately.

### UC-6 — Manage saved conversations
**Actor:** Any signed-in staff · **Trigger:** uses the chat sidebar.

**Main flow**
1. Staff starts a new chat, or reopens a saved one (chats are per-account).
2. They rename (double-click) or pin a chat, delete one, or regenerate the last
   answer.

**Alternative / edge flows**
- **A1 — Another user's session id:** every session endpoint checks ownership and
  returns `404` otherwise.
- **A2 — Nothing to regenerate:** `400 NOTHING_TO_REGENERATE` when there's no prior
  question.
