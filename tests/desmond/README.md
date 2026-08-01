# tests/desmond

Unit tests for **TransitFlow** (Trip Booking & Dynamic Coach Management — Desmond).

All tests use Node's built-in runner (`node:test` + `node:assert/strict`) — no
extra dependencies, no database, no server, no browser. They pin the *logic*, so
they run in milliseconds and exit cleanly.

## Run

From the repo root:

```bash
node --test "tests/desmond/*.test.js"
```

(or a single file, e.g. `node --test tests/desmond/reassign-logic.test.js`)

## What's covered

| File | Unit under test | Focus |
|------|-----------------|-------|
| `reassign-logic.test.js` | `backend/routes/reassign-core.js` → `evaluateReassign()` | The server-side guards on `PATCH /api/trips/:tripId/reassign`: delegate/coach must be real and on this trip (no cross-trip "wrong coach"), seat **capacity** (409 unless overridden), **optimistic locking** vs. concurrent moves (409 CONFLICT), captain scoping, and the "status follows the coach" rule. |
| `reassign-queue.test.js` | `frontend/src/lib/reassignQueue.js` | Offline reassignment via the shared outbox: a move is **queued** when offline (and resolves so the optimistic UI stands), **survives a reload** (`applyQueuedReassigns` overlay), **replays in order** on reconnect, and a genuine refusal (capacity/conflict) still **throws** instead of being swallowed. |

## Why these two modules exist

The tested logic was deliberately pulled into small, dependency-light modules so
it *can* be unit-tested the same way the rest of the team's suites are:

- `reassign-core.js` — pure decision logic extracted from `desmond.js` (which
  opens a Postgres pool at import time, so importing it directly hangs the
  runner). The route imports this and does only the I/O around it.
- `reassignQueue.js` — the offline queue helpers, shared by the desktop and
  mobile boards, built on JQ's `lib/outbox.js` exactly like `lib/delegateWrites.js`.
