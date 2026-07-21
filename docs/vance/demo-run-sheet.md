# Demo Run-Sheet — Vance (Document Parsing + Trip Assistant)

My part of the live review: **Screen 4 (Onboarding / Document Parsing + Boarding
Passes)** and **Screen 6 (Trip Assistant)**. Keep this open during the demo.

---

## Pre-flight (do ~10 min before)

- [ ] **Backend up** — `cd backend && npm start` (`:4000`). Wait for "PostgreSQL connected".
- [ ] **Frontend up** — `cd frontend && npm run dev` (`:5173`).
- [ ] **Ollama running**, and **warm the chat model** — ask the assistant one question a minute before you start, so `llama3.2:1b` is resident (keep-alive 30 min). This makes your first live answer instant, not a ~30s cold load.
- [ ] **Database reachable** — Neon can suspend/hit quota; confirm it's up *before* you present. This is the single biggest risk — the whole app needs it. Have a fallback plan if it drops.
- [ ] **Log in as `vance`** (NOT `staff_194`) — logging in kicks any other session on that account; using your own account avoids booting a teammate mid-demo.
- [ ] **Clean data state** — remove the stray `jq` test delegate; make sure the Beijing trip has a realistic mix (some present/missing, a VIP, an open exception, itinerary items) so the assistant has rich data.
- [ ] **Pre-parse delegates** so the boarding-pass and assistant parts already have data — don't depend on a live parse finishing on stage.
- [ ] **Sample file ready** — `Delegation-sample-2pages.pdf` in Downloads (short = fast parse).
- [ ] **Decide the deployment story** — the AI features (parsing, chatbot) need **local Ollama**, which a normal cloud host can't run. Be ready to say: "the AI runs on a local machine; the rest is on the deployed URL." Tutors will ask.

---

## The demo (aim ~4–5 min, lead with what's instant)

### Act 1 — Onboarding / Document parsing
1. Open **/onboarding**. Point out the **Trip Pulse** widget top-right — live onboarding progress (passes issued → boarded → to board).
2. Pick the **Beijing** trip, then **drop the sample PDF** on the uploader.
3. While it reads: *"The AI reads it page-by-page in the background — I can even leave this page and it keeps going."* (Show leave/return if it's smooth.)
4. Extracted **delegate cards** appear with confidence scores. Point out the **Needs review** flag and **duplicate detection**.
5. **⭐ Passport beat (20s):** click a card's **passport expiry** field, type a near date (e.g. `2026-09-01`) → the **"Passport expiring" pill appears live**. *"For an overseas trip we validate passport validity — expired or expiring within 6 months gets flagged before they're even added."*
6. *(One line on OCR)* *"If this were a scanned photo instead of a text PDF, it falls back to local OCR — fully offline, no cloud key needed."*
7. Set a **coach** + **VIP** on a card → **Confirm & add**. *"They're now in the shared trip, each with a unique QR boarding pass."*

### Act 2 — Boarding passes
8. Switch to the **Boarding passes** tab — the organiser workspace: **search**, **status filter tabs**, **grouped by coach**.
9. Click a delegate → **QR pass** modal (copy / print). Note **"Print filtered"** respects the active filter.
10. *(Cross-team)* *"These QR passes are exactly what the on-site scanner reads to board delegates — that check-in flips them to present on the coach board."*

### Act 3 — Trip Assistant ⭐ (the highlight)
11. Open **/assistant**. Point out the **"What to watch"** widget — a **ranked priority list** (missing VIPs, critical exceptions, coach furthest from boarded, passport issues).
12. **Lead with fast-path questions — these are INSTANT** (answered from live data, no model call, never hallucinated):
    - "Give me an attendance summary."
    - "Who's missing?"
    - "Which coach has the most missing?"
    - "Who should I worry about right now?"
    - "Any passport issues?" (ties back to Act 1)
    - "What company is [name] from?"
13. Then **one streamed, open-ended question** to prove the model works: *"Draft a short note to chase the missing delegates."* — watch it **stream token-by-token**.
14. Toggle **中文** and ask one question — bilingual answer.
15. Closing line: *"Even where the AI text engine isn't available, the common questions still answer instantly — the fast-path needs no model at all."*

---

## Fallbacks (if something's slow/broken on stage)
- **Model cold/slow?** Lead with the **fast-path** questions (instant). You pre-warmed it, so this shouldn't happen.
- **Live parse dragging?** You **pre-parsed data**, so boarding passes + assistant already work — the parse is "here's *how* it reads," not a dependency.
- **Neon down?** The whole app needs it — this is why you check it in pre-flight and have a plan.

---

## Likely questions + your answers
- **Why Ollama, not Claude?** Runs offline on a free local model, no API key/cost — important for a firewalled/low-budget context.
- **Why is inference slow?** CPU-only, no GPU. Mitigated with: background async parse jobs, SSE streaming, a **deterministic fast-path** (no model for common questions), pre-computed numbers ("AI handles language, code handles arithmetic"), and model warm-up.
- **What did you learn?** The **trip-id bug** — a query that passed every quick test because they all used the seed trip, but silently orphaned delegates on every other trip against real data. *A green happy-path test isn't proof of correctness.*
- **A time AI was wrong?** The junk-guard first rejected `陈伟` (a normal 2-char Chinese name) — an English-centric assumption my **tests** caught.
- **Scanned docs?** Local **Tesseract OCR** replaced the unavailable Claude vision — one uploader now handles directories *and* photos, offline.
- **Security?** Auth + protected routes (`manageDelegates`), API keys server-side only, single-active-session enforcement.

## Differentiators to name-drop
- Deterministic fast-path = **instant + impossible to hallucinate**.
- Risk scoring = a **proactive advisor**, not just Q&A.
- Local OCR + offline chatbot = **works without the cloud**.
- 63+ unit tests, docs, and clean Git history behind it.
