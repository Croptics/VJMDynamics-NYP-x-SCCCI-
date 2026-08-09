# Unit tests — Jayden (Exception Logging, Critical Alerts & QR Fallback)

Unit tests for my individual code contributions (Screen 5 — Exception Inbox,
Screen 10 — Log Exception, the mobile exception inbox, and the manual
attendance override / QR fallback). They exercise the **pure, side-effect-free
helpers** in `frontend/src/lib/exception/exceptionsApi.js` directly, so no
database, browser or HTTP server is needed and every run is deterministic.

## How to run

From the repository root:

```bash
node --test "tests/jayden/*.test.js"
```

Uses Node's **built-in test runner** (`node:test` + `node:assert`, Node 18+) —
no external test framework or extra dependencies. `tests/jayden/package.json`
sets `"type": "module"` so these files can import the ESM frontend modules.

Time is injected through each function's `now` parameter rather than mocked
globally, so nothing here depends on the wall clock or the order tests run in.

## What's covered

| File | Function under test | What it verifies |
| --- | --- | --- |
| `checked-in-status.test.js` | `isCheckedIn` | `ARRIVED` and the legacy `PRESENT` alias both count as boarded; `MISSING` / `LATE` / `ASSIGNED` / `UNASSIGNED` do not; case-sensitivity; null/garbage returns `false` instead of throwing. |
| | `CHECKED_IN_STATUSES` | The boarded set is exactly `ARRIVED` + `PRESENT`. |
| `ticket-ageing.test.js` | `ageMinutes` | Elapsed whole minutes with partial minutes floored; a future timestamp clamps to `0` rather than showing a negative age; `null` for missing/unparseable input. |
| | `fmtAge` | `just now` under a minute, plain minutes under an hour, `1h 35m` with zero-padding above it, whole days past 24h, empty string for `null`. |
| | `ageLevel` | No tint below 15 min, `warn` from 15, `late` from 30 (both boundaries inclusive); resolved tickets never age; bad input yields no tint. |
| | `resolveMinutes` | Elapsed minutes between raised and resolved, rounded; `null` for OPEN tickets, for a missing `resolvedAt`, and for a `resolvedAt` earlier than `createdAt` (clock skew). |
| `issue-label.test.js` | `issueLabel` | Each enum value maps to its human label; `OTHER` shows the staff member's own free-text label; falls back to `Other` when that label is missing; `typeOther` is ignored for other types; unknown types degrade to the raw value; `null` ticket returns `""`. |
| | `fmtTime` | Pre-formatted `HH:MM` passes through, ISO timestamps render as 24-hour `HH:MM`, empty input renders empty, unparseable input is returned as-is rather than `Invalid Date`. |
| `ticket-export.test.js` | `exportTicketsCsv` | Header row, one row per ticket, header-only file for an empty list, CRLF line endings, the UTF-8 BOM (without which Excel mangles CJK delegate names), filename handling, and that the object URL is revoked after download. |
| | *(escaping)* | Commas, embedded double quotes (doubled per RFC 4180) and newlines are quoted so a free-text note can never shift later columns into the wrong header. |
| | *(field mapping)* | `OTHER` exports its custom label; a delegate-less ticket exports `Unidentified`; nulls become empty cells rather than the text `null`; a resolved ticket exports how long it *took* while an open one exports its *live* age. |

## Why these functions

They are the ones where a quiet mistake produces wrong information rather than
a visible crash:

- **`isCheckedIn`** gates the manual **Override** action. Too permissive and a
  boarded delegate is offered a second override, writing a duplicate
  `check_in_logs` row; too strict and a genuinely missing delegate can never be
  marked present from the inbox. It also has to span two status vocabularies at
  once — the five-status model (`ARRIVED`) and the pre-migration `PRESENT`.
- **The ageing helpers** are the difference between "raised 14:08" and "open
  40 minutes" — the latter is what actually drives escalation on the ground.
- **`exportTicketsCsv`** produces a file opened in Excel, where bad escaping or
  a missing BOM corrupts the sheet silently instead of failing loudly.

## Not covered here

`parseBadge()` (QR badge format acceptance) lives in
`frontend/src/components/exception/QRScannerPanel.jsx`. It is pure and exported
for exactly this reason, but Node's test runner cannot parse JSX, so testing it
would mean moving it into its own module — a code change I did not want to make
against the integrated build this close to submission. Its behaviour is
exercised manually via the scanner's Manual-entry field, which routes typed
input through the same function.
