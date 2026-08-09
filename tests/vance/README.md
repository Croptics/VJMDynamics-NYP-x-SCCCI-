# Unit tests — Vance (Document Parsing + Trip Assistant)

Unit tests for my individual code contributions (Screen 4 — Document Parsing /
Onboarding, and the confirm-time data-quality guard). They exercise the **pure,
side-effect-free helpers** in `backend/routes/document.js` directly, so no database
or HTTP server is needed and every run is deterministic.

## How to run

From the repository root:

```bash
node --test "tests/vance/*.test.js"
```

Uses Node's **built-in test runner** (`node:test` + `node:assert`, Node 18+) —
no external test framework or extra dependencies. `tests/vance/package.json`
sets `"type": "module"` so these files can import the ESM backend modules.

## What's covered

| File | Function under test | What it verifies |
| --- | --- | --- |
| `document-parsing.test.js` | `extractRecords` | Pulls a records array out of a raw LLM reply — bare array, ```` ```json ```` fence, `{records:[…]}` wrapper, prose around the array, stray-bracket fallback, and `null` for unparseable/empty input. |
| | `cleanName` | Keeps the romanised half of a bilingual `陈伟 / Reyes Tin` name, leaves pure romanised/pure-CJK names alone, and rejects placeholders (`N/A`, `Not specified`, `unknown`). |
| | `dedupeByName` | Collapses the same person (case-insensitively) keeping the record with more fields; drops nameless rows. |
| | `preferRomanised` | Drops stray Chinese-only duplicate rows when a romanised name exists; keeps a wholly-CJK batch intact. |
| | `finalizeRecords` | The full clean → dedupe → prefer pipeline on a realistic bilingual batch. |
| | `toRow` | Confidence clamping (0–1), the `0.6` default, the `needsReview` flag, id prefixing, and empty→`null` coercion. |
| `confirm-guard.test.js` | `isPlausibleDelegate` | Rejects junk rows (`jq`, single char, symbols, digits, bare short names) while keeping genuine short and CJK names, and any row with a supporting field. |

Total: **38 tests**, all passing.
