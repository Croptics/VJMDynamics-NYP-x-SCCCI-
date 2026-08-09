# Unit tests — JQ (InsightMetrics: offline writes, trip/coach scoping, room parsing)

Unit tests for my individual code contributions. They exercise the **pure,
side-effect-free logic** behind the offline write queue, the coach and trip
scoping decisions, and the room-assignment parser — against a fake
`localStorage` and a fake sender, so no browser, no backend and no database is
needed and every run is deterministic.

## How to run

From the repository root:

```bash
node --test "tests/jq/*.test.js"
```

Uses Node's **built-in test runner** (`node:test` + `node:assert`, Node 18+) —
no external test framework or extra dependencies. `tests/jq/package.json` sets
`"type": "module"` so these files can import the ESM frontend and backend
modules.

## What's covered

| File | Module under test | What it verifies |
| --- | --- | --- |
| `outbox.test.js` | `frontend/src/lib/localstorage/outbox.js` | The property the whole offline feature rests on: **a queued write is applied exactly once**, however many times it is replayed. `isOfflineError` (only queue when the server was never reached — an HTTP error is not "offline"); enqueue keeps order, reuses the payload's `clientEventId` as the entry id, preserves the original timestamp rather than the sync time, and survives a "reload" because state lives in storage not memory; flush drains once, flushing twice re-sends nothing, a duplicate response still drains the entry, and every retry reuses the same `clientEventId`. Failure handling is split by cause: still-offline keeps the queue intact and stops early (order preserved), `403` moves to failed rather than retrying forever, `401` is **kept** for after re-login instead of discarded, `500` is kept as a server fault, and a missing sender keeps the entry rather than dropping it. Plus the subscription that drives the sync pill. |
| `delegateWrites.test.js` | `frontend/src/lib/localstorage/delegateWrites.js` | The mobile Attendance sheet's path — a status change ("missing, last seen at Gate 3") or a cancellation taken with **no signal** must survive a reload and replay in the order it was taken. Queued patches overlay the server's stale copy; the newest decision wins when a delegate was changed twice; an unqueued list is returned untouched; per-delegate queue introspection; re-applying the same patch is harmless (state assignment, not append); a still-offline flush keeps the change queued, while a genuine `403` refusal is surfaced rather than retried forever. |
| `mobileCoach.test.js` | `frontend/src/lib/mobileCoach.js` | `preferredCoachId()` — the single fallback chain now shared by Home, QR, Face and Manual. Pins the bug that motivated it: each scanner used to auto-pick "first coach with people" independently, so Home → Coach 2 → QR scanned into **Coach 1**, a wrong-coach check-in with nothing on screen to warn you. Covers remembered-coach precedence, both fallbacks, an empty coach list returning `null` rather than throwing, set/get round-trip and clearing, `localStorage` throwing in private mode — and the trip-switch case, where a remembered coach belongs to a **different trip** and must be ignored rather than selected. |
| `tripScope.test.js` | `frontend/src/lib/tripScope.js` | The account→trip filter and tie-break, after the mobile shell and desktop Dashboard were consolidated from two drifting copies into one pure function. An in-progress captaincy outranks a stale Planning leftover; Completed trips are dropped; several coaches on one trip is still one unambiguous scope; and every "don't guess" case returns `null` rather than a coin flip — no captaincies, all completed, two competing Planning trips, rows with a missing trip id, and a payload from an older backend with no trip status at all. |
| `roomAssignParser.test.js` | `backend/routes/dashboard/roomAssign.js` | `parseAssignmentList` — deterministic parsing of a pasted rooming list so the common shapes never reach the model at all: a roommate group sharing one room number, a group sharing a hotel only, two independent people on one comma-separated line, and a multi-line list. Includes a pinned regression (a bare room number must not leak into the hotel field) and the two cases that **must** fall through to the model instead of being guessed — a group containing a name that isn't on the roster, and plain fuzzy phrasing. |

Total: **48 tests**, all passing.

## Note on the fakes

`outbox.js` and `delegateWrites.js` read the global `localStorage`, and the
outbox takes a sender function. Both tests install a minimal in-memory
stand-in rather than mocking a library, so what is under test is the real
module and not a wrapper around it.
