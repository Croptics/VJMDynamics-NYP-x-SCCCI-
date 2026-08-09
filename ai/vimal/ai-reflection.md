# AI Reflection — Vimal (FaceCheck-Pro)

My feature was the biometric check-in: face and voice matching that runs on the
device, delegate self-enrolment, the enrolment invite emails, manual check-in
and the mobile scanner UI. I used Claude throughout, mostly on the web, and my
logs for the design and build phase are in `ai/vimal/ai-logs/`.

## Where AI genuinely helped

**Building the real matcher instead of a fake one.** When I got to the face
matching, I was offered a choice: mock it out and wrap something that looked
like it worked, or build the actual pipeline. I picked the full version —
landmark extraction, vector embeddings, and cosine distance to compare them.
The reason was that I wanted to actually understand how vector-based
identification works underneath, not just call something and trust the output. I
would not have known where to start on my own, and the AI walking me through
that is the main reason `backend/lib/biometricMatch.js` exists as a real matcher
with a threshold and a margin check rather than something that always says yes.

The same conversation is where I decided to leave the honest disclaimer in that
file, which says outright that this is not production face recognition. I could
have written it up as if it were, and it probably would have sounded more
impressive. But it would fall apart the moment anyone tested it properly, and I
would rather say what it actually is. There are real things it does not handle
well — proper liveness detection, privacy compliance at scale, and what happens
when the number of enrolled people gets large. Saying that is more useful than
pretending.

**Explaining my own system back to me.** At one point I asked Claude how to
explain the flow to my teacher, and it walked me through it: camera frame,
quality check, vector, compare, match. I am being honest that I needed that. It
did help me understand my own feature better, and I went back through the code
afterwards so I could follow it myself.

## Where I rejected or changed what it gave me

**It kept rewriting my teammates' files.** This was the biggest problem I had all
project. Whenever an import did not line up, the AI would "fix" it by rewriting
the shared file or a teammate's module to match its own assumptions, instead of
keeping the fix inside my own code. I had to keep telling it not to. My first
message on this was asking it to connect to other features without destroying
them, and by the end I was writing the rule in capital letters: it was forbidden
from modifying or outputting code for any file that belonged to someone else.
When it asked me to confirm, I told it that it could add new files but nothing
shared.

If I had let it run, it would have overwritten work my teammates had not
committed yet, introduced small breaking changes across their features, and
created merge conflicts that would have cost the team hours. It also changed how
I built my own module. Because I could not touch shared code, I put the matching
logic in a new file of its own, `biometricMatch.js`, instead of burying it
somewhere central. That turned out better anyway, because it is a plain function
with no database in it, so it can be tested directly.

**A bug that only showed up on real data.** My scanner worked fine on the seed
data. Then a real delegate list went in and it stopped matching anyone. What had
happened was that all 29 delegates came in as UNASSIGNED with no coach, and my
scanning logic was only looking at delegates marked MISSING within an existing
coach assignment. With nobody assigned, there were no coaches to scan and the
pool it searched was empty. I added an endpoint to assign unassigned delegates
onto a coach first, so there is actually something to muster. The lesson I took
from it is that seed data only tests the path you expected. Real data tests
whether the code holds up, and I had not tested against it early enough.

**A silent failure that reported success.** There was a bug where the interface
said the scan worked, but nothing was actually updating. Nothing crashed and
there was no error to follow. I found it by comparing what the client was
sending against what the server would accept: my code was producing `face:v2:`
tokens, but the validator was hardcoded to only accept `v1`, so every real scan
was being thrown away before it got anywhere. It is now written to accept any
version number. What I learned is that a silent rejection is much harder to
catch than a crash, and that pinning an exact version inside a validator is a
trap when the thing it is checking is still changing.

## What I would do differently

I worked by uploading zip files and pasting the updated code back in by hand.
There was no diff and no version control in the loop, so I could not see what had
actually changed. At one point a file ended up duplicated and broke with two
`export default` statements in it. Next time I would keep everything in Git on my
own branch and never move files around manually.

The part of my own feature I would struggle to explain under pressure is the
maths inside the face library itself — the spatial alignment of the landmarks
and the projection into the high-dimensional vector. I understand what the
embeddings represent and how cosine similarity compares them, and I can explain
my own matching code. But the actual matrix transformations happening inside the
library are something I have taken on trust, and I would not want to claim
otherwise.
