# Submission index — IT2213 Full-Stack Application (VJMDynamics)

Where every assessed item lives. **Live app: https://mustergo.duckdns.org**

Integrated branch: `INTv2` (merged to `main` for submission). Individual
contribution is traceable through the Git history — each person's commits are
authored under their own name and email.

## Group items

| Item | File |
| --- | --- |
| System architecture | [`docs/architecture.md`](architecture.md) |
| Architecture diagram | [`docs/architecture-diagram.png`](architecture-diagram.png) |
| Live deployment + feature overview | [`README.md`](../README.md) |
| Ownership boundaries & integration history | [`README/INTEGRATION_NOTES.md`](../README/INTEGRATION_NOTES.md) |

## Per-student folders

Every student owns three folders, with the same layout:

```
docs/<name>/     use-cases.md · api-documentation.md · database-schema.md
tests/<name>/    *.test.js · README.md · package.json
ai/<name>/       ai-logs/ · ai-reflection.md
```

| Student | Feature module | Tests |
| --- | --- | --- |
| [Jun Qi](jq/) | InsightMetrics — Admin Dashboard, Auth, Accounts & RBAC, multi-checkpoint attendance, offline write queue | 48 |
| [Desmond](desmond/) | TransitFlow — Trip booking, coach management, reassignment, itinerary | 36 |
| [Jayden](jayden/) | SecureScan-Logs — Exception logging, critical alerts, QR fallback, manual override | 54 |
| [Vance](vance/) | DocuSync-AI — AI document parsing, boarding passes, MusterChat | 82 |
| [Vimal](vimal/) | FaceCheck-Pro — Face/voice biometric check-in, enrolment, mobile UI | 73 |

## Running the tests

All suites use Node's **built-in** test runner (`node:test`, Node 18+) — no
external framework, no database, no server, no browser. From the repo root:

```bash
node --test "tests/*/*.test.js"
```

**293 tests, all passing.** One person's suite alone:

```bash
node --test "tests/vimal/*.test.js"
```

Each `tests/<name>/README.md` documents what that suite covers, file by file.

## Running the app locally

Four processes, in order — database, then backend, then frontend (Ollama only if
you want to exercise AI document parsing, which needs a local model or an
`ANTHROPIC_API_KEY`):

```bash
npm run dev --prefix backend
```

```bash
npm run dev --prefix frontend
```

Then open `https://localhost:5173`. Demo logins are in each feature's
`demo-run-sheet.md`.
