# AI logs — Vimal (FaceCheck-Pro)

## Source

`claude-web-mustergo-2026-07-11_to_2026-07-15.jsonl` — my Claude conversation
history, obtained through **claude.ai → Settings → Privacy → Export data**
(the account-level export, `conversations.json`), converted to one JSON object
per line.

Each line is one message:

```json
{ "conversation": "...", "conversation_uuid": "...", "conversation_created": "...",
  "message_uuid": "...", "created_at": "...", "sender": "human" | "assistant",
  "text": "..." }
```

## What's included

3 conversations, 34 messages, all of them MusterGo work on my own feature:

| Date | Conversation | Messages |
| --- | --- | --- |
| 2026-07-11 | Preserving feature connections across files | 18 |
| 2026-07-14 | Privacy-first biometric scanner feature implementation | 4 |
| 2026-07-15 | Privacy-first facial vectorization for delegate check-in | 12 |

These cover the design and coding phases of the biometric check-in feature —
the zero-image face vectorization approach, the scanner implementation, and
keeping my module connected to my teammates' features without breaking them.

## What's excluded, and why

My raw account export also contained conversations that have nothing to do with
this assignment, and they are deliberately **not** committed here:

- **IT2212 coursework** (KNIME data-wrangling assignment, lecture transcription,
  exam revision) — a different module.
- **An unrelated January project** (an intergenerational learning platform).
- **Personal study chats** unrelated to any assignment.
- **`login_history.json` and `users.json`** from the export — these contain my
  email address and login IP addresses, which are personal data with no
  assessment value and no place in a shared repository.

Padding this folder with another module's coursework would misrepresent how much
AI I used on *this* project, so the filter is by relevance rather than by volume.

## An honest limitation

I did not keep logs continuously as I worked, and I did most of my later
implementation without recording it. What survives is the account-side history
of the sessions where I used Claude on the web, which is concentrated in the
design and early-build phase (11–15 July) rather than spread across the whole
project. I have not reconstructed or back-filled anything to cover the gap —
everything in this file is a verbatim record of a conversation that actually
happened.
