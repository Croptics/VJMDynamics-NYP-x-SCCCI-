# Jayden's Check-in Features — Integration Notes

Three Jayden-owned features are integrated into the `/checkin` staff app, all
isolated so no other module is affected (Vimal's face/voice recognition in
particular is byte-for-byte unchanged):

1. **QR check-in** — Scan tab → **QR** pill (live camera scanner).
2. **Exception logging** — **Issues** tab (Figma Screen 10).
3. **Manual attendance tracking** — Scan tab → **Manual** pill.

## Files

| File | Owner | Change |
|---|---|---|
| `frontend/src/components/QRScannerPanel.jsx` | **Jayden (new)** | Live QR scanner. |
| `frontend/src/components/IssuesPanel.jsx` | **Jayden (new)** | Mobile exception logging form + open-ticket list. |
| `frontend/src/components/ManualTrackingPanel.jsx` | **Jayden (new)** | Mark delegates present by hand. |
| `frontend/src/lib/exceptionsApi.js` | Jayden | Added `checkInByQR()` (QR path). Existing `createException` / `resolveException` / `manualOverride` reused. |
| `backend/routes/exceptions.js` | Jayden | Added `POST /api/checkins/qr`. |
| `frontend/package.json` | shared | Added `jsqr`. |
| `frontend/src/pages/QRCheckInPage.jsx` | Vimal | **3 minimal edits only** — 3 import lines, and swapping the QR / Manual / Issues *placeholders* (slots the file already reserved for Jayden) for the panels above. |

Verified by diff — unchanged: `vimal.js`, `server.js`, `data.js`, `auth.js`,
`permissions.js`, `lib/api.js`, `App.jsx`, and the desktop
`ExceptionInboxPage.jsx` / `LogExceptionModal.jsx`.

## Why nothing else is affected

- `ManualTrackingPanel` and `QRScannerPanel` only mount in their own scanner
  modes; the QR panel opens its **own** camera and Vimal's face camera only
  runs in face mode, so the two never contend.
- `ManualTrackingPanel` reads the roster from the `coach` prop the page already
  loads — it does not re-fetch or modify Vimal's `/attendance/*` data.
- All new CSS is namespaced (`jayden-*`) or inline; no global rules.
- The one new backend route lives in Jayden's own router at a unique path.

## ⚠️ Permission needed for logging & manual overrides

Logging a ticket and manual overrides are gated on the **`manageExceptions`**
permission (see `permissions.js`: "Log, resolve, delete tickets and perform
manual attendance overrides"). On a **fresh** database, the seeded
`staff_194` account is created **without** it.

Grant it once, either way:
- **Run the provided reset tool** (gives `staff_194` full access):
  `cd backend && npm run reset-login`
- **or** open **Account control** in the sidebar and tick “Manage exceptions”.

Without it, the Issues form and Manual panel show a read-only notice instead of
firing requests that would 403. (QR check-in is **not** gated — like the face
scan it uses `requireAuth()`, so any signed-in staff can scan.)

## Run + demo

```bash
cd backend && cp .env.example .env      # set DATABASE_URL=…
npm install && npm start
npm run reset-login                      # <-- grants staff_194 manageExceptions
# second terminal
cd frontend && npm install && npm run dev # http://localhost:5173
```

1. Sign in `staff_194` / `password123!`.
2. **Check-in → Trips →** tap a coach (Load demo roster if empty — creates `d-1`).
3. **Issues tab:** pick an issue type, a delegate, add a note, optionally flip
   *Mark as critical*, then **Submit** — the ticket appears in the list below
   and (if critical) is pushed live to every device.
4. **Scan → Manual:** search a delegate, tap **Mark present** — they flip to
   PRESENT on the dashboard head-count.
5. **Scan → QR:** point at `qr-test-codes/qr-attendance-registered.png`.
