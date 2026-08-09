# AI Reflection — Jayden (Exception Logging, Critical Alerts & QR Fallback)

## Where AI genuinely helped

**Diagnosing a problem I would have blamed on the wrong thing.**
The backend kept failing with `ECONNRESET` connecting to our Neon database. My
instinct was that the database was down or the connection string was wrong — I
would have spent an hour asking JQ to re-issue it. Working through it with
Claude, we tested the layers separately: DNS resolved, the TCP connection to
port 5432 opened fine, but the Postgres handshake got no reply and was reset
after ~19 seconds. That signature pointed at the network, not the database. It
turned out the campus Wi-Fi (`nyp.edu.sg`) blocks outbound database ports. On a
phone hotspot it connected in 67 ms. The lesson I took wasn't about Postgres —
it was that "it doesn't work" has layers, and testing them one at a time beats
guessing at the most likely culprit.

**Turning a vague dissatisfaction into a concrete list.**
I knew my Exception Inbox looked plain next to my teammates' screens but I
couldn't articulate what was missing. Asking for suggestions produced something
more useful than decoration: it pointed out that `updatePriority()` was exported
in my own API layer and never called anywhere. I had built the ability to
escalate a ticket and then never wired up a button for it, so a ticket that got
worse had no path to critical. That was a real functional hole in my feature,
not a cosmetic one, and I'd been looking straight past it.

**Catching a bug I had already shipped.**
When I asked whether the Override button was even necessary, the answer included
evidence I hadn't thought to look for: two `MANUAL` rows in `check_in_logs` for
the same delegate, two seconds apart. The button never disappeared after being
clicked, so every extra click wrote another attendance row. I had tested that
the button *worked*; I had never tested what happened when someone pressed it
twice.

**Understanding the reasoning, not just getting the fix.**
One explanation actually changed how I think about a pattern, not just fixed a bug. I'd assumed a live "push a critical alert to every device" feature needed something like WebSockets, but the reasoning for using Server-Sent Events instead stuck with me: it's ordinary HTTP, so it survives the same restrictive campus proxies that had just blocked our database connection — it wasn't a shortcut, it was the right call given what I'd already learned that day. The clientEventId pattern on every check-in and ticket-create call taught me something similar. I'd been thinking about "what if the request fails," not "what if the response fails and the client retries the same request." Understanding that an idempotency key is what makes a retry safe — one write, not two — changed how I look at every mutation endpoint now, not just the ones I wrote.

## Where I rejected or changed what the AI produced

**The shared `.env` — I refused the "safer" version.**
JQ sent the team a `.env` to use as-is. It pointed at a local Postgres that
wasn't installed on my machine, and Claude proposed pointing it at a different
database so things would run. I said no: it's the team's shared configuration,
and if my build is configured differently from everyone else's then any bug I
hit becomes impossible to attribute — is it my code, or my config? I'd rather
install Postgres locally and match the team than run a setup nobody else has.
That call was mine and I'd make it again.

**The five-status migration — I pushed back on the premise.**
Claude flagged that some delegates in our database had status `ARRIVED` (JQ's
newer model) while my code only understood `PRESENT`, and proposed adopting the
new model in my code. When I asked how important that actually was, the honest
answer changed the plan: `ARRIVED` was only in the database because *running
JQ's build against our shared database had written it there* — my own code never
produced it. Worse, adopting `ARRIVED` on writes would have broken the dashboard
head-count, because `data.js`, `vance.js` and `vimal.js` all count `PRESENT`
only. Fixing that would have meant editing three teammates' files.

I set the constraint — keep everything inside my own files — and we landed on
reading all five statuses while continuing to write `PRESENT`, which both builds
accept. My priority (don't destabilise other people's work days before
submission) was the right one to optimise for, and it wasn't the first
suggestion.

**The wrong copy of the project.**
I asked for my improvements and they were built against my old branch folder
instead of the integrated build the team had moved to. I only noticed because
the UI I was looking at was the old one. Re-doing it properly turned out to
matter: JQ had extended my own files while I wasn't looking — a manual-override
undo route, an offline check-in queue, i18n on every string. A straight
copy-paste of my version would have deleted all of it. The fix was to merge
feature by feature and adopt his conventions (`t()` for translation, ticket
variables renamed to `tk` so they don't shadow the translator, `var(--surface)`
instead of hardcoded white for dark mode).

**AI doesn't know which copy of the code is real.**
The biggest thing I took from this project: AI will happily and competently work on whatever you point it at — it has no way of knowing on its own whether that's the current version of anything. I asked for improvements and got a genuinely well-built feature, applied to a copy of the project that no longer mattered. Nothing about the output looked wrong; it compiled, the logic was sound, and I could easily have shipped it without noticing. The mistake was mine — I hadn't been clear about which folder was live, and I didn't check before asking for changes. Now "which copy of the code am I actually looking at" is the first question I ask, not an assumption, especially once more than one person is touching the same project.

## What I'd watch out for next time

**It caused a problem while helping me.** Running JQ's build against our shared
database rewrote three delegates' status from `PRESENT` to `ARRIVED`, and
stripped `manageExceptions` from my own admin account — which quietly made my
Exception Inbox read-only. Both were side effects of testing against shared
infrastructure, and neither announced itself. **[your call]** — what's your rule
now for testing against a database your teammates are also using?

**A near-miss with credentials.** While swapping configurations, a backup file
`backend/.env.neon-backup` was created inside the repo. Our `.gitignore` only
matches exactly `.env`, so that backup was *not* ignored — one `git add -A`
would have committed our database password and SendGrid key to a public
repository. It was caught before the push, but it was caught by looking, not by
the tooling. That's why the submission guide's redaction step matters: these
logs contain the same secrets.

**Never test against a database everyone else depends on.**
My rule now for testing against a shared database: don't, unless it's disposable. Running a teammate's build against our real Neon database to see if it worked quietly rewrote delegate statuses and stripped a permission off my own account — nothing announced it had happened; I only noticed because my inbox had gone read-only. Next time I'd spin up a throwaway local database first and only touch the shared one once I trust the other build won't write anything unexpected to it.

**Where AI actually sat in this project.**
Overall, I don't think AI was what made this feature good. It wrote code quickly, but the code was rarely where I got stuck. The decisions that actually shaped the Exception Inbox — that the escalate button needed wiring up because I'd built the API for it and forgotten it, that the Override button had a real bug worth fixing rather than deleting, that no suggestion was allowed to touch three teammates' files two days before submission — those were judgment calls I had to make myself, usually by pushing back on the first answer I got. If anything, the most useful thing it did was force me to justify decisions out loud before making them, which is a habit worth keeping either way.
