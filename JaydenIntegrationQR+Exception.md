# Integration Guide — Check-In Feature Area

This file is the teammate handoff for the shared **check-in screen** (`/checkin`)
and everything mounted inside it. The screen is a shared surface with two
owners, integrated so that neither can break the other:

- **Vimal — FaceCheck-Pro:** the face/voice biometric scanner, the reverse
  headcount, the coach overview, and the privacy/consent lifecycle.
- **Jayden — Check-in & Exceptions:** the QR scanner, manual attendance
  tracking, and exception logging (the Issues tab).

> Supersedes the earlier Vimal-only version of this file. Jayden's per-change
> log lives in `JAYDEN_FEATURES.md`.

## 1. Purpose

`/checkin` is the on-the-ground staff app (a phone frame rendered inside the
desktop layout). It offers several ways to register a delegate as present —
**Face**, **QR**, **Manual** — plus a **Trips/headcount** view, a **Me** consent
view, and an **Issues** tab for logging exceptions. Every check-in updates the
real shared delegate records through JQ's data layer, so JQ's dashboard, the
mobile Missing page and Desmond's coach boards all reflect changes live.

## 2. Ownership map

### Backend
| File | Owner | Role |
|---|---|---|
| `backend/routes/vimal.js` | Vimal | Face/voice scan + attendance overview APIs (`/api/attendance/*`). |
| `backend/routes/exceptions.js` | Jayden | Exception CRUD, live alerts (SSE), manual override, QR check-in. |
| `backend/data.js`, `server.js`, `auth.js`, `permissions.js` | JQ | Shared foundation — **not edited by either feature.** |

### Frontend
| File | Owner | Role |
|---|---|---|
| `frontend/src/pages/QRCheckInPage.jsx` | Vimal | The check-in **shell**: tabs, camera lifecycle, face/voice pipeline, headcount, consent. Hosts Jayden's panels in three reserved slots. |
| `frontend/src/components/QRScannerPanel.jsx` | Jayden | Live QR scanner (own camera + `jsqr`). |
| `frontend/src/components/ManualTrackingPanel.jsx` | Jayden | Mark delegates present by hand. |
| `frontend/src/components/IssuesPanel.jsx` | Jayden | Mobile exception logging form + open-ticket list. |
| `frontend/src/lib/exceptionsApi.js` | Jayden | Data layer for the above (built on the shared `lib/api.js`). |
| `frontend/src/pages/ExceptionInboxPage.jsx` / `.css`, `components/LogExceptionModal.jsx` | Jayden | The **desktop** exception inbox (sidebar → Exceptions). |

## 3. How the two features share the check-in screen

`QRCheckInPage.jsx` is Vimal's file. Jayden's modules are wired in with the
**minimum possible footprint**: three `import` lines, and swapping the three
placeholders the file already reserved ("QR", "Manual", and the Issues tab) for
self-contained panels:

```jsx
{scanMode === "qr"     && <QRScannerPanel … />}
{scanMode === "manual" && <ManualTrackingPanel … />}
// Issues tab:
const IssuesView = <IssuesPanel … />;
```

Nothing else in the file changes. Verified by diff, these remain byte-for-byte
identical to the original: `vimal.js`, `server.js`, `data.js`, `auth.js`,
`permissions.js`, `lib/api.js`, `App.jsx`.

### Why they don't interfere
- **Cameras never contend.** Vimal's camera effect starts the face camera only
  when `scanMode === "face"`. `QRScannerPanel` opens its **own** stream and is
  only mounted when `scanMode === "qr"`; it stops every track on unmount. The
  two camera modes are mutually exclusive.
- **No shared data re-fetch.** `ManualTrackingPanel` reads the roster from the
  `coach` prop the shell already loaded — it never re-queries or mutates
  Vimal's `/attendance/*` endpoints.
- **No style collisions.** Vimal's page-local CSS is `vimal-*`; Jayden's is
  `jayden-*` (or inline). No global rules are added.
- **No route collisions.** Jayden's new route is at a unique path
  (`/api/checkins/qr`) that clashes with nothing above the server TEAMMATE ZONE
  or in the other teammate routers.

## 4. API endpoints

### Vimal — `/api/attendance/*` (unchanged)
| Endpoint | Purpose |
|---|---|
| `GET /api/attendance/coaches` | Trip meta + coach list + live counts + unassigned count. |
| `POST /api/attendance/scan` | Face/voice token scan → matches a missing delegate → PRESENT. |
| `GET /api/attendance/:trip_id/coach/:coach_id` | Reverse headcount for one coach. |
| `GET /api/attendance/headcount` | Overall boarded/missing/unassigned stats. |
| `POST /api/attendance/consent` | Grant/revoke biometric consent. |
| `GET /api/attendance/history/:delegate_id` | Per-delegate check-in history. |
| `POST /api/attendance/assign-unassigned` | Muster unassigned delegates onto a coach. |
| `POST /api/attendance/demo-seed` | Seed a demo roster into an empty coach. |

`POST /api/attendance/scan` body example:
```json
{ "tripId": "t-1", "scanData": "face:v1:abc123:...", "timestamp": "2026-07-13T10:00:00.000Z", "coachId": "c2" }
```

### Jayden — check-in + exceptions
| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/checkins/qr` | signed-in | QR badge check-in → `method='QR'` row + delegate PRESENT. |
| `POST /api/checkins/manual` | `manageExceptions` | Manual override → `method='MANUAL'` row + delegate PRESENT. |
| `GET /api/trips/:id/exceptions` | signed-in | List tickets + counts (`?status=&priority=`). |
| `GET /api/trips/:id/exceptions/critical-count` | signed-in | Unresolved-critical count (sidebar badge). |
| `POST /api/trips/:id/exceptions` | `manageExceptions` | Raise a ticket; CRITICAL pushes to all devices. |
| `PATCH /api/exceptions/:id` | `manageExceptions` | Resolve / re-prioritise. |
| `DELETE /api/exceptions/:id` | `manageExceptions` | Remove a ticket raised in error. |
| `GET /api/exceptions/stream` | signed-in | Live alert channel (SSE). |

`POST /api/checkins/qr` body example:
```json
{ "tripId": "t-1", "delegateId": "d-1", "coachId": "c2", "clientEventId": "…", "clientTs": "2026-07-13T10:00:00.000Z" }
```

## 5. Permissions

`manageExceptions` gates **logging tickets and manual overrides** (see
`permissions.js`). QR and face check-ins are **not** gated — they use
`requireAuth()`, so any signed-in staff can scan.

**Fresh-database gotcha:** the seeded `staff_194` account is created *without*
`manageExceptions`. Grant it once, either way:
- `cd backend && npm run reset-login`  (gives `staff_194` full access), **or**
- sidebar → **Account control** → tick "Manage exceptions".

Without it, the Issues form and Manual panel show a read-only notice instead of
firing requests that would return 403.

## 6. QR badge format

The QR scanner accepts a MusterGo delegate badge:
```json
{"sys":"MUSTERGO","v":1,"typ":"DELEGATE_BADGE","tripId":"t-1","delegateId":"d-1","name":"Lim Wei Jie","sig":"…"}
```
Anything that isn't this shape → **"QR code invalid"**. Two ready-made test
codes are in `qr-test-codes/` (`qr-attendance-registered.png`,
`qr-code-invalid.png`). Decoding uses `jsQR` with `inversionAttempts:
"attemptBoth"`, so codes scanned off a screen still read reliably.

## 7. Expected data flow (any modality)

1. The shell loads trip + coach overview (`/api/attendance/coaches`).
2. Staff pick a coach, then choose Face, QR, or Manual — or open Issues.
3. A check-in posts to its endpoint (`/attendance/scan`, `/checkins/qr`, or
   `/checkins/manual`); an exception posts to `/trips/:id/exceptions`.
4. The backend updates the real delegate through JQ's shared helpers.
5. The shell refreshes the coach view + overview; the dashboard and mobile
   views pick up the change; CRITICAL tickets push over SSE.

## 8. Run + demo

```bash
cd backend && cp .env.example .env      # set DATABASE_URL=…
npm install && npm start
npm run reset-login                      # grants staff_194 manageExceptions
# second terminal
cd frontend && npm install && npm run dev # http://localhost:5173
```
Sign in `staff_194` / `password123!` → **Check-in** → **Trips** → tap a coach
(**Load demo roster** if empty, which creates `d-1`). Then try **Face**, **QR**
(scan `qr-test-codes/`), **Manual** (Mark present), and **Issues** (log a ticket).

## 9. Quick test checklist

- Both routers mount; overview loads.
- Face scan matches a missing delegate and updates status.
- QR: valid badge → "Attendance registered"; junk → "QR code invalid".
- Manual: "Mark present" flips a delegate to PRESENT.
- Issues: logging a ticket appears in the list; critical pushes live; resolve works.
- Dashboard head-count refreshes after every check-in.
- Consent + history endpoints still work.

## 10. Common issues

- **QR reads but says "invalid":** ensure the scanner uses
  `inversionAttempts: "attemptBoth"` (fixed) and that the badge JSON matches §6.
  The panel prints the raw scanned text on failure for quick diagnosis.
- **403 on logging / manual:** the account lacks `manageExceptions` — see §5.
- **Camera won't start in QR/Face:** only one mode uses the camera at a time;
  allow camera access, or use QR's manual-entry fallback / the Manual tab.
- **Backend not responding:** confirm both routers are mounted, the backend is
  running, and the frontend API URL is correct.
- **Scan fails unexpectedly (face):** the coach's missing pool may be empty, or
  the delegate is already present.

## 11. Summary

The check-in screen is a shared, modular surface. Vimal owns the shell and the
biometric pipeline; Jayden's QR, Manual and Issues modules plug into reserved
slots as self-contained panels with their own routes and styles. The shared
data layer stays the single source of truth. To extend either feature, keep the
same pattern: add your own files, mount them in your slot, and don't edit the
shared foundation.
