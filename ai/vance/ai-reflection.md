# AI Reflection — Vance (Document Parsing + Trip Assistant)

> **Draft to personalise.** This is grounded in the real decisions I made on my
> two features; before submitting, read it through, correct anything that doesn't
> match your memory, and add your own voice and any moments I've missed. The
> rubric (C2) rewards *reasoning* about where AI helped and where you overrode it
> — not a list of chat logs.

## Where AI genuinely added value

AI was most useful as a **fast scaffolder and second pair of eyes**, not as an
author I trusted blindly.

- **Getting a working shape quickly.** For the document-parsing pipeline and the
  streaming chatbot, AI helped me stand up the boilerplate fast — the Express
  routes, the SSE token-streaming loop, the background parse-job pattern with
  polling, and the CSV export. That let me spend my time on the parts that
  actually needed judgement (data quality, trip scoping, speed) rather than
  wiring.
- **Working within a hard constraint.** My dev machine has no GPU, so the local
  model (Ollama) is slow (~40–90s a reply). AI helped me brainstorm mitigations
  that fit that reality: reading PDFs as text first so a small model can handle
  them, streaming replies so the user sees progress, and pre-computing the
  attendance numbers into the prompt so the model never has to do arithmetic.
- **Test coverage.** AI helped me turn my pure helper functions into a real unit
  suite quickly (57 tests), which then immediately paid off — see below.

## Where I rejected or significantly changed AI's suggestions

This is where most of the learning happened. AI is confident even when it's
wrong, so I treated its output as a draft to verify, not an answer.

1. **The trip-id resolution bug — I distrusted a query that "looked fine".**
   The original code resolved a trip with `SELECT uuid_id FROM trips WHERE id = $1`.
   It worked in every quick test — because every quick test used the seed trip
   `t-1`. When I checked the actual shared database, only `t-1` had that string
   id; the other 15 trips use UUID ids, so that query returned nothing for them
   and silently created delegates with a null trip (orphaned to no trip at all),
   while the UI still said "added". I replaced it with a `resolveTripUuid()`
   helper that matches **either** the string id or the `uuid_id`, and made the
   confirm endpoint **fail loudly** (`404`) rather than write orphans. Lesson: a
   green happy-path test is not evidence of correctness — I had to verify against
   real data.

2. **The junk-record guard — testing caught an AI blind spot with CJK names.**
   I added a guard to stop stray entries like `jq` (a 2-character name with no
   other detail) from becoming real delegates. My first version rejected any
   very short single-token name. When I ran it against test cases I'd written, it
   also rejected `陈伟` — a perfectly normal 2-character Chinese name. For a
   Singapore–China delegation that would be a serious bug. I changed the rule to
   exempt CJK names from the length check, because two characters *is* a complete
   Chinese name. Lesson: AI (and I) had an English-centric assumption baked in;
   the tests made it visible.

3. **Making the chatbot faster — I chose NOT to use the model.**
   The obvious AI-suggested path to "faster replies" is prompt/parameter tuning.
   But on a CPU the only reliably fast answer is one that never calls the model at
   all. So I built a deterministic fast-path that answers the common factual
   questions (attendance, who's missing, coach comparisons, company breakdowns,
   look-ups) straight from live data — instant, and impossible to hallucinate —
   and only falls through to the model for genuinely open-ended questions. This
   was a deliberate decision to *trust computed data over a language model where
   accuracy matters*, and to use the model only for what it's good at (phrasing
   and open-ended reasoning).

4. **Small correctness fixes AI would have left alone.** e.g. the chat auto-scroll
   originally used `scrollIntoView()`, which yanked the whole page; I changed it to
   scroll only the message list via `scrollTop`. And "Print all" on the boarding
   passes originally printed the whole trip even when the list was filtered — I
   changed it to print what's actually on screen. Small, but they're the
   difference between a demo that feels finished and one that doesn't.

## What I'd do differently / take forward
- Verify against **real, representative data** early, not just the seed row —
  the trip-id bug would have surfaced sooner.
- Write the **tests alongside** the feature; the ones I wrote caught the CJK issue
  the same session I introduced it.
- Keep using AI for scaffolding and review, but keep the **judgement calls**
  (data quality, when to trust computed values over the model) firmly mine.
