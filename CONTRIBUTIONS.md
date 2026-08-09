# Contributions

Who built what, and how to verify it from the code itself.

## Why this file exists

Our Git history under-represents two team members, and we would rather say so
than have it look like an oversight.

During integration, work from the `TransitFlow-(Desmond)` and
`SecureScan-Logs-(Jayden)` branches was pushed into the shared branch centrally
rather than by its authors, and a run of those commits carries the generic
message `New file`. The result is that on `INTv2` Desmond shows 2 commits and
Jayden shows 1, even though each of them owns several thousand lines of the
application.

We have not rewritten the history to correct the attribution. Reattributing
40-odd commits after the fact would falsify the exact record being submitted as
evidence, so the history stands as it is and this file records what it doesn't
capture.

**Every claim below is checkable in the source.** Each file listed carries an
`OWNED BY:` header naming its author, written during development, not added for
submission.

## Verifying ownership

```bash
head -12 backend/routes/trip.js          # Owner: Desmond - TransitFlow
head -12 backend/routes/exceptions.js    # OWNED BY: Jayden - Exception Logging
head -12 backend/routes/facescan.js      # OWNED BY: FaceCheck-Pro (Vimal)
head -12 backend/db/schema.js            # OWNED BY: InsightMetrics (JQ)
head -12 backend/routes/document.js      # OWNED BY: Vance - DocuSync AI
```

Ownership boundaries and the integration history are documented further in
[`README/INTEGRATION_NOTES.md`](README/INTEGRATION_NOTES.md).

---

## Jun Qi (JQ) — InsightMetrics

The base platform the other four modules are built on: Admin Dashboard, auth and
sessions, accounts and the permission system, delegate management, activity
history with field-level rollback, multi-checkpoint attendance, escalations,
announcements, export, and the offline write queue.

**~102 source files**, including `backend/db/` (the entire schema and data
layer), `backend/lib/auth.js`, `backend/routes/dashboard/*`, `routes/auth.js`,
`routes/accounts.js`, `routes/announcements.js`, and the desktop dashboard,
account-control and mobile-attendance pages.

`frontend/src/lib/permissions.js` is his and is imported by **both** the frontend
and the backend — the single source of truth every other module's authorisation
depends on.

Docs: [`docs/jq/`](docs/jq/) · Tests: [`tests/jq/`](tests/jq/) — 48 passing

## Desmond — TransitFlow

Trip booking, trip itinerary, coach assignment and dynamic coach management,
including drag-and-drop reassignment with server-side capacity enforcement and
an offline reassignment queue.

**5 files, ~5,250 lines:**

| File | What it is |
| --- | --- |
| `backend/routes/trip.js` | Trip / coach / itinerary CRUD, reassignment endpoint, coach captains, trip audit log |
| `backend/routes/reassign-core.js` | The pure reassignment decision logic, extracted so it can be unit-tested without a database |
| `frontend/src/pages/desktop/trip/TripCoachPage.jsx` | The coach board — capacity bars, drag-and-drop, itinerary strip |
| `frontend/src/pages/desktop/trip/TripsListPage.jsx` | Trips list |
| `frontend/src/lib/trip/reassignQueue.js` | Offline reassignment queue |

Docs: [`docs/desmond/`](docs/desmond/) · Tests: [`tests/desmond/`](tests/desmond/) — 36 passing

## Jayden — SecureScan-Logs

Exception logging, critical alerts, the QR check-in fallback and manual
attendance override.

**9 files, ~3,700 lines:**

| File | What it is |
| --- | --- |
| `backend/routes/exceptions.js` | Exception tickets, check-in logs, QR and manual check-in endpoints |
| `frontend/src/pages/desktop/ExceptionInboxPage.jsx` | Exception inbox |
| `frontend/src/pages/mobile/ops/MobileExceptionsPage.jsx` | Mobile exceptions |
| `frontend/src/components/exception/QRScannerPanel.jsx` | QR scanner, reused by the desktop, mobile and kiosk scanners |
| `frontend/src/components/exception/ManualTrackingPanel.jsx` | Manual override panel |
| `frontend/src/components/exception/IssuesPanel.jsx`, `LogExceptionModal.jsx` | Issue list and logging modal |
| `frontend/src/lib/exception/exceptionsApi.js` | Client API layer |
| `backend/scripts/seed-demo.js` | Demo seeding |

He owns two tables — `exception_tickets` and `check_in_logs` — the latter shared
with the biometric check-in module.

Docs: [`docs/jayden/`](docs/jayden/) · Tests: [`tests/jayden/`](tests/jayden/) — 54 passing

## Vimal — FaceCheck-Pro

Privacy-first biometric check-in: on-device face and voice matching where no
image or audio ever leaves the device, delegate self-enrolment, enrolment invite
emails, manual check-in and the mobile UI shell.

**~12 files, ~6,500 lines,** including `backend/routes/facescan.js`,
`backend/lib/biometricMatch.js`, `backend/lib/mailer.js`,
`frontend/src/lib/scanner/{faceScan,humanFace}.js`, `EnrollPage.jsx`,
`MobileScannerPage.jsx`, `MobileEnrolmentPage.jsx` and `MobileManualCheckIn.jsx`.

Owns the `delegate_biometrics` table.

Docs: [`docs/vimal/`](docs/vimal/) · Tests: [`tests/vimal/`](tests/vimal/) — 73 passing

## Vance — DocuSync-AI + MusterChat

AI document parsing for delegate onboarding, QR boarding passes and digital
badges, and MusterChat (staff-to-staff messaging, group chat, video calls and
the AI Trip Assistant). Also carried the integration of the five branches into
`INTv2` and the deployment.

**~16 files**, including `backend/routes/document.js`, the `mchat` component
set, `BadgePage.jsx` and `ChatAssistantPage.jsx`. Owns the assistant and chat
tables.

Docs: [`docs/vance/`](docs/vance/) · Tests: [`tests/vance/`](tests/vance/) — 82 passing

---

## Summary

| Member | Module | Owned files | Tests |
| --- | --- | --- | --- |
| Jun Qi | InsightMetrics — base platform | ~102 | 48 |
| Vance | DocuSync-AI + MusterChat | ~16 | 82 |
| Vimal | FaceCheck-Pro | ~12 | 73 |
| Jayden | SecureScan-Logs | 9 | 54 |
| Desmond | TransitFlow | 5 | 36 |

**293 tests, all passing** — `node --test "tests/*/*.test.js"`
