# AI Workflow Log — TransitFlow (Desmond)

**Module:** Trip Booking · Trip Itinerary · Coach Assignment · Dynamic Coach
Management · Coach/Venue CRUD · Dynamic Grouping (drag-and-drop)
**AI tool:** Anthropic **Claude** (via Claude Code CLI)
**Purpose of this document:** evidence for **Section C1 – AI Workflow** (AI used
strategically across design, coding, testing and deployment, with precise,
iterative, context-specific prompts, and output consistently reviewed, edited
and improved).

> This is a curated, faithful log reconstructed from my working sessions. Each
> entry records **my prompt (intent)**, **what the AI did**, and — importantly —
> **how I reviewed / corrected / iterated on the output** (the AI was directed
> and checked, not blindly accepted).

---

## 1. How AI was used across ALL four phases (summary)

| Phase | Examples from this project |
|---|---|
| **Design & architecture** | Diffing two divergent code drops to pick the correct base; deciding a single global late-cutoff vs. JQ's per-checkpoint model; choosing a `coach_captains` many-to-many vs. a single `account_id`; defining the ownership boundary between my module and teammates'. |
| **Coding** | Point-to-point attendance + history, per-coach scoping, before/after audit, multi-captain, UI/UX redesign (KPIs, capacity bars, drag-and-drop, capacity override), 4 status tabs, delegate popup. |
| **Testing** | Standing up `tests/desmond/`, extracting pure functions so tests don't boot the DB pool, running teammates' suites (Vance 82 pass, JQ 31 pass) as reference. |
| **Deployment / DevOps** | Diagnosing a dead cloud DB (Neon quota `53000`), migrating to local PostgreSQL, fixing `28P01` auth, creating + re-seeding the database, verifying integration builds. |

**Key point for grading:** the most valuable moments were where I **rejected or
changed** the AI's first answer (Section 4 below), not where I accepted it.

---

## 2. Chronological session log

### 2.1 — Choosing the correct base version (Design)
- **My prompt:** "Read and understand both zip files [(4) and (5)]. Combine the best of everything into the best version."
- **AI did:** Extracted both, diffed my four owned files, established that zip (4) was the *newer superset* (more lines, the point-to-point checkpoint feature, bug fixes) and that (5) only added two docs + a runnable `.env`. Recommended: base = (4) + graft the two docs + env; verified with a production build (2432 modules, 0 errors).
- **My review:** Accepted the base decision after checking the diff evidence myself; confirmed no data loss from (5).

### 2.2 — Verifying claims instead of trusting docs
- **My prompt:** "Have you done all these completed features? … Is anything on MY part not done?"
- **AI did:** Instead of repeating the hand-off notes, it grepped the actual code to confirm each feature, and found that **point-to-point attendance was NOT surfaced on my board** (the data existed in JQ's checkpoints, but my `TripCoachPage` only read it for a scheduling buffer).
- **My review:** This corrected my assumption that the feature was "done." Directed the AI to build the missing board integration.

### 2.3 — Adopting a teammate's model over my own (Design decision)
- **My prompt:** "Link Trip Settings → itinerary: if JQ's approach is best use it, else recommend and do it."
- **AI did:** Compared my single trip-wide late-cutoff against JQ's per-checkpoint `applyCheckpointLateCutoff`; concluded JQ's was strictly better (every stop is its own cutoff, driven by my itinerary), and **removed my now-dead `/late-cutoff` route** rather than duplicating logic.
- **My review:** Agreed; this avoided two competing implementations.

### 2.4 — Per-coach scoping: I chose the harder, correct option
- **My prompt:** "Do I need different staff/admin views (staff sees only their coach)? Also live update + history before/after each event."
- **AI did:** Flagged a real blocker — logins live in `accounts`, coach staff in a separate `users` table, and they weren't linked — then offered 3 approaches. I chose **"proper account→coach link"** + **"full audit everywhere."**
- **AI implemented:** `coaches.account_id`, `/api/my-captain-coaches`, `/api/assignable-accounts`, a `trip_event_log` audit via `recordEvent()`, and a captain picker.
- **My review:** Chose the more ambitious option deliberately over the quick session-based hack.

### 2.5 — Debugging a real scoping bug (Coding/Testing)
- **My prompt:** (screenshot) "Logged in as Staff_1 but I can still see all coaches."
- **AI did:** Traced the login response and found it stores `{username, name, role, permissions}` with **no `id`**, so my scoping match `accountId === me.id` compared against `undefined`. Fixed it to match on **username**. Verified via a booted backend + API call that Coach 1 → Staff_1.
- **My review:** Confirmed the root cause was real (not guessed) before accepting the fix.

### 2.6 — Team comparison against the rubric (Design/analysis)
- **My prompt:** "Compare each teammate's work and who gets the highest mark per the rubric."
- **AI did:** Read the rubric + guide, built the whole INTv2 integration (2485 modules, 0 errors), **ran the test suites** (Vance 82/82, JQ 31/31), sized each backend, and ranked: Vance > JQ > Desmond ≈ Vimal > Jayden — with the reason being **tests (A3)**, which I had zero of.
- **My review:** Used this to reprioritise toward tests + non-code sections.

### 2.7 — Deployment crisis: dead DB → local Postgres (Deployment)
- **My prompts (iterative):** "I can't run the backend" → error `28P01 password authentication failed` → "I only have mysql" → "fix it."
- **AI did (step by step):** Diagnosed that `DATABASE_URL` wasn't being read (it fell back to `postgres`), found the `.env` had the Neon line **commented** and an unused **localhost** line active; tested Neon and got `53000 quota exceeded` (dead); detected that **PostgreSQL 18 was already installed and running** (so MySQL wasn't the issue); guided me to set my real password + `CREATE DATABASE mustergo`; then **re-seeded** the whole demo dataset locally.
- **My review:** I supplied the password (kept out of the AI), ran the admin commands, and confirmed the app came back with data.

### 2.8 — UI/UX redesign, iteratively (Coding, many rounds)
- **My prompts (paraphrased across rounds):** "Make it a premium live-operations dashboard, keep the palette"; "keep Checked-in simple, no dark theme"; "'All in' vs '4/6 boarded' — which is correct?"; "'en route' should be consistent"; "add the captain's name"; "remove the trips count and the KPI row — not important"; "the Move button doesn't work but drag does"; "delegate details should be a popup not a sidebar"; "remove the redundant Completed/Mark-not-done."
- **AI did:** Command-centre KPI row, capacity bars, status accents, 4 status tabs, delegate popup, Move-close-on-success, history field-label prettifying, and the drag-and-drop / capacity-override phases — each with an explain-before-change rationale, and a `npm run build` check after every batch.
- **My review:** Every item above is a **correction or trim of the AI's prior output** — evidence of directed, critical iteration rather than acceptance.

### 2.9 — Testing set-up (Testing)
- **My prompt:** (following the rubric gap) start `tests/desmond/`.
- **AI did:** Noted that importing `desmond.js` directly hangs the test runner (it opens a `pg` pool), so it **extracted the pure reassign logic** into a testable core module and wrote `node --test` suites mirroring the teammates' convention → 36 passing tests.
- **My review:** Approved the extract-for-testability approach.

---

## 3. Representative prompts (verbatim intent)

These show the prompts were **precise, iterative, and context-specific**, not generic "write me code":

- "First read and understand both zip files. Combine the best of everything for the best version."
- "Check the backend & frontend and see if everything integrated with my part correctly… all the logic makes sense for every button, UI and UX. If there's an update on my part check if it's an improvement or not."
- "Is JQ taking any part of my work? If yes which part. How do I differentiate his part from mine?"
- "For the capacity warning: don't show a blocking modal immediately — shake the coach, flash the bar, then a confirm dialog (bottom sheet on mobile) with Cancel / Override."
- "Do venues presentation-only (option b) — no new table."
- "Before making each change explain: (1) the issue, (2) why it hurts UX, (3) how the solution helps, (4) files modified, (5) why it won't break existing functionality."

---

## 4. Where I **rejected or significantly modified** the AI's output (for the C2 reflection)

> These are the highest-value entries — they show judgment, not just usage.

1. **Kept a teammate's model, deleted my own.** When the AI could have kept my trip-wide late-cutoff, I directed it to adopt JQ's per-checkpoint cutoff and **remove my duplicate** route — cleaner ownership, no competing logic.
2. **Chose the harder architecture.** The AI offered a quick "pick your coach on entry" session hack for scoping; I rejected it for the **proper `account_id` link** (which later grew into a `coach_captains` many-to-many).
3. **Rejected a dark "command-centre" tile.** The AI's first Checked-in KPI was a bold dark card; I told it to match the other tiles' style — palette discipline over flash.
4. **Caught a data-integrity contradiction.** I flagged that a coach showed **"All in"** while also **"4/6 boarded"**; the AI's badge logic only checked *missing*, ignoring un-boarded. Fixed to show "N not in."
5. **Insisted the Move bug was real.** The AI first theorised the move "worked but was hidden by the sidebar"; I pushed back ("it does not work"), which led to converting the sidebar to a popup that **closes on success** so the result is visible.
6. **Trimmed features the AI added.** I had it **remove** the trips-count and a KPI row it had previously added, and **remove** a redundant Completed toggle — less is more.
7. **Scope enforcement.** I repeatedly constrained the AI to **only my files** and had it flag when a request (offline queue, Venue CRUD) would touch a teammate's file or need a new DB table — and to present those as decisions, not silently build them.

---

## 5. Outcome

AI accelerated design decisions, implementation, a live database-outage recovery,
and test set-up — but every consequential choice was **reviewed and, where
needed, overruled** by me. The result is a fully-integrated, building, seeded,
tested-in-part module, with a clear record of *human-in-the-loop* judgment.

*(Companion document: `AI_REFLECTION_Desmond.md` — expand Section 4 into the C2
reflection.)*
