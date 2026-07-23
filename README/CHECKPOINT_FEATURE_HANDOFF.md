# Multi-Checkpoint Attendance — Handoff for Desmond, Vimal & Jayden

_Written 2026-07-23 by JQ, updated same day as the feature grew — for whoever
picks up Desmond's TransitFlow branch, Vimal's FaceCheck-Pro branch, or
Jayden's Exception Logging branch next. Hand this file to your own Claude
session so it has the context without re-deriving it from scratch. Sections
below are grouped by owner so you can jump straight to what's relevant to you._

## What this feature is

A new, additive layer: instead of a delegate having ONE global status for the
whole day, they now get an **independent status per scheduled itinerary
stop** (10am Arrival, 12pm Lunch, 4pm Assembly — whatever's on the Trip
page's itinerary). "Arrived at Lunch" and "Missing at the 4pm Assembly" can
both be true for the same delegate at the same time.

**New table**: `checkpoint_checkins` (id, itinerary_item_id, delegate_id,
status, method, scanned_by, created_at, updated_at) — one row per
(checkpoint, delegate) pair, upserted on re-scan. Lives in
`backend/db/schema.js`. A "checkpoint" **is** one of your `itinerary_items`
rows — no new checkpoint-definition table, no changes to your schema or
itinerary CRUD needed. It reads `itinerary_items` read-only, the same way
`vimal.js` already reads the shared `delegates` table without touching
`data.js`.

**New route file**: `backend/routes/checkpoints.js` (JQ-owned). Key exports:
- `GET /api/trips/:id/checkpoints` — every itinerary stop, tagged with a
  computed `timeState`: `"past"` / `"current"` / `"upcoming"`, based on
  wall-clock time vs. the trip's active day (`trips.dayOf`). **No grace
  window** (removed 2026-07-23 — a stop flips to "past"/auto-late the instant
  its scheduled time passes; the earlier 5-min grace made "late" too
  forgiving). Response also includes `resetWindowMinutes` (see below).
- `POST /api/checkpoints/:id/checkins` — record one delegate's status at one
  stop (upsert).
- `GET /api/checkpoints/:id/checkins` — stats scoped to one stop.
- `GET /api/delegates/:id/checkpoint-timeline` — one delegate's full
  cross-checkpoint history.
- `PATCH /api/trips/:id/checkpoint-reset-window` — set
  `trips.checkpointResetMinutes` (1–120) for one trip. Defaults to 5.
- `PATCH /api/trips/:id/itinerary-buffer` — set `trips.itineraryBufferMinutes`
  (0–120) for one trip. **Deliberately a SEPARATE setting from the reset
  window above** (split 2026-07-23 — they used to share one value, but
  tightening the reset window for testing shouldn't also force the itinerary
  gap to shrink). Defaults to 30. Both are configurable per-trip from the
  **Settings page** (`SettingsPage.jsx`, JQ's own — "Checkpoint reset window"
  card, `manageDelegates`-gated, with a trip picker + two independent minute
  dropdowns), so either can be dialed down for testing and back up for a real
  trip without a code change.
- `applyCheckpointLateCutoff()` — every stop is its own late-cutoff (auto-
  marks LATE the instant a stop's scheduled time passes with no scan).
- `resetArrivedBeforeNextCheckpoint()` — within `checkpointResetMinutes` of
  each non-first stop of the day starting, any delegate globally ARRIVED gets
  reset to ASSIGNED so they can be freshly scanned in again for the next
  stop. Both run on the existing 60s scheduler in `server.js`.
- `syncCurrentCheckpointStatus(delegateId, tripUuid, status, actor)` —
  **exported for OTHER files to call**, not a route. Whenever a delegate's
  GLOBAL status is set by hand (not through a scan) to ARRIVED/LATE/MISSING,
  this upserts that same status into whichever checkpoint is "current" right
  now for that trip, so the checkpoint-scoped stats widget never shows a
  stale value after a manual correction. Currently called from **two other
  teammates' files** — see their sections below. Never throws (best-effort,
  silently no-ops if the trip has no itinerary or the status isn't one of the
  3 valid checkpoint statuses) — a sync failure must never block the actual
  status update it's piggybacking on.

---

## For Desmond — what changed in your files

**`frontend/src/pages/desktop/TripCoachPage.jsx`** was edited directly (with
JQ's user's explicit go-ahead each time, not silently):

1. **"Trip settings" button + `TripSettingsModal` removed entirely.** It only
   ever held one field — the single trip-wide Late-cutoff time
   (`trips.lateCutoffTime`, saved via your `PATCH /api/trips/:id/late-cutoff`
   endpoint). That's now fully superseded by the itinerary-based per-stop
   cutoff above, so the button/modal/state (`showTripSettings`) and the now-
   unused `Settings` icon import were deleted. **Your backend endpoint
   (`desmond.js`'s `PATCH /trips/:id/late-cutoff`) was NOT touched** — it's
   just an orphaned, still-functional endpoint with no frontend caller
   anymore. Your `trips.lateCutoffTime` column and its DB migration are also
   untouched.
2. **Day-tab switcher added** to the "Today's itinerary" card — a row of
   `Day 1` / `Day 2 (Today)` / etc. buttons when a trip has more than one
   day, so a different day's schedule can be previewed without opening Edit
   itinerary. New `viewDay` state + a `displayDay`/`isToday` prop threaded
   into `JourneyTimeline` (the Now/Next/status-pill summary is suppressed
   when previewing a non-today day, since it's wall-clock-derived and would
   be misleading for a future/past day).
3. **Minimum-gap validation added to `EditItineraryModal`'s add/edit form** —
   a new stop can no longer be saved within `checkpointResetMinutes` of
   another stop on the same day (fetches the trip's current value from
   `GET /api/trips/:id/checkpoints` on modal mount). This intentionally
   tracks whatever the reset window is set to on the Settings page, rather
   than a fixed number, so tightening the window for testing also lets stops
   be added closer together.
4. **Two real bugs fixed**, unrelated to the checkpoint feature but found
   while testing it:
   - `ConfirmDialog` (delete confirmations) could render **hidden behind**
     whichever other modal opened after it in the DOM — both shared the same
     z-index (`tf-modal-overlay`, `3000`), so later DOM siblings painted on
     top. Fixed with a dedicated `tf-modal-overlay--confirm` class at
     `z-index: 3100`.
   - Dragging to select text inside any modal input, and releasing the mouse
     **outside** the modal (over the dark backdrop), closed the whole modal —
     a native `click` fires wherever the mouse is *released*, not where the
     drag started, so the backdrop's `onClick={onClose}` fired unintentionally.
     Fixed in both `Modal` and `ConfirmDialog`: a backdrop click now only
     dismisses if the *entire* gesture (mousedown AND click) started on the
     backdrop itself.

If your own branch/AI session has independently touched `TripCoachPage.jsx`
since 2026-07-23, **diff carefully** before merging — don't let an older
snapshot silently reintroduce the Trip Settings button or the two bugs above.

### 2026-07-24 — "Current day" now auto-advances at midnight

Unrelated to the checkpoint feature — a separate request from JQ's user, who
noticed a real trip created on 2026-07-23 was still showing "Day 1 of 2" after
midnight had passed into 2026-07-24. Root cause: `trips."dayOf"` was — and for
trips without a start date, still is — a plain static integer, only ever
changed by hand (Edit trip's "Current day" field). Fixed for any trip that
opts in with a real start date, rather than changing the underlying model
(**edited your files, `routes/desmond.js` and `TripsListPage.jsx`, with the
user's go-ahead** — same pattern as the earlier itinerary-buffer/min-gap
work above):

- **New columns** (`backend/db/schema.js`, JQ's): `trips."startDate"`
  (plain `"YYYY-MM-DD"` text, not a Postgres `DATE` — sidesteps `pg`'s
  DATE-as-JS-Date timezone-shift footgun) and `trips."dayOfIsManual"`
  (`BOOLEAN DEFAULT false`).
- **New function** `syncTripDayOf(tripUuid?)` (`backend/db/dashboard.js`,
  JQ's): recomputes `dayOf = clamp(daysSinceStart + 1, 1, totalDays)` for
  every trip with a `startDate` set and no manual override. **Uses
  `Asia/Singapore`, not the DB session's default (Neon = UTC)** — every
  delegation is Singapore-organised and travelling within China, both UTC+8;
  using `CURRENT_DATE` would roll the day over 8 hours late, at 8am local
  instead of actual local midnight. Caught and fixed via a live test against
  the real Neon DB (School Field Trip Test, `startDate` 2026-07-23): with the
  UTC version, at 01:08am Singapore time on 2026-07-24 it was still computing
  Day 1 because `CURRENT_DATE` (UTC) hadn't rolled over yet — the
  `AT TIME ZONE 'Asia/Singapore'` fix corrected it to Day 2 immediately.
- **Scheduled**: `server.js`'s existing 60s scheduler tick now also calls
  `syncTripDayOf()` (JQ's file, one new line) — every trip with a start date
  self-corrects every tick, no cron/migration needed.
- **`routes/desmond.js`** (your file): `POST /api/trips` accepts an optional
  `startDate` and computes the real `dayOf` immediately on create (doesn't
  wait for the next tick). `PATCH /api/trips/:tripId` accepts `startDate`,
  and treats an explicit `dayOf` in the body as a **deliberate manual
  override** — sets `dayOfIsManual = true` so auto-sync stops touching that
  trip (e.g. for a delayed departure). A new `resetDayOfAuto: true` flag
  clears the override and immediately recomputes.
- **`TripsListPage.jsx`** (your file, Edit/New trip modal): added a "Start
  date" picker under Status/Trip lead, and reworked the "Current day" field —
  editing the number marks it as a manual override (shows a "↺ Use automatic
  day" link to clear it); leaving it alone with a start date set shows
  "Auto-calculated from start date" instead.
- **Live-tested** against the real Neon DB (not just build-checked): create
  → immediate correct day; manual override → survived a full 65s scheduler
  tick untouched; clearing the override → recomputed correctly. Trip left in
  a clean auto state (Day 2 of 2) afterward, not stuck mid-test.
- **Not covered**: trips with no `startDate` set (including every pre-
  existing demo trip) keep behaving exactly as before — static `dayOf`,
  manual edits only. This was deliberately opt-in per-trip, not a backfill of
  every existing trip's start date (their `dateRange` text is often a
  multi-day range like "3–7 Sep 2026", not reliably machine-parseable into a
  single date without risking a wrong guess).

## For Vimal — what changed in your files

`faceScan.js` was NOT touched. **`backend/routes/vimal.js` WAS edited
directly** (2026-07-23, additive only — every change below is
backward-compatible, nothing removed or restructured):

1. **`liveDashboard()` now accepts an optional `tripUuid`** (was always
   `getDashboard()` with no args, i.e. always the default/base trip
   regardless of which trip a caller actually meant). Omitting it keeps the
   exact original behavior.
2. **`GET /api/attendance/coaches` now accepts an optional `?tripId=`** query
   param, resolved via `resolveTripUuid()` and threaded into `liveDashboard()`
   — needed so the desktop scanner's new trip switcher (see below) can list a
   DIFFERENT trip's coaches instead of always the base trip's.
3. **`GET /api/attendance/:trip_id/coach/:coach_id` now actually USES
   `trip_id`** — it used to accept the param but silently ignore it (the
   header comment literally said "the base app is single-trip... trip_id is
   accepted verbatim"). It's now resolved via `resolveTripUuid()` and used to
   scope both the coach lookup and `listDelegates(tripUuid)`. `"t-1"` still
   resolves to the same base trip as before, so any single-trip caller is
   unaffected.
4. **`POST /api/attendance/scan` (face/voice biometric matching) was
   DELIBERATELY NOT touched** — it still scores every enrolled delegate
   globally, not scoped to a selected trip. Widening the coach/roster reads
   above was low-risk and additive; scoping the actual biometric match by
   trip is a bigger change to your core feature and wasn't part of this.

**`GET /api/trips/:id/checkpoints` and `POST /api/checkpoints/:id/checkins`
also accept your kiosk token** (`requireKioskOrAuth` / `requireKioskOrPermission`
in `auth.js`) — a deliberate, narrow widening so the passwordless kiosk
scanner can also record a checkpoint-scoped check-in after a face/QR scan
succeeds there. Every OTHER checkpoint route (stats, delegate timeline) stays
session-only.

**The scanner pages' second write reads `res.delegateId` and `res.method`
from your `/api/attendance/scan` response** — both fields were already there
(`{ delegateId, name, status, method, processedInMs }`), so no response-shape
change was needed on your end. If you ever change that response shape, the
Checkpoint Selector's second write (`UnifiedScannerPage.jsx`/
`MobileScannerPage.jsx`/`KioskScannerPage.jsx`, all JQ-owned) would need
updating to match.

**Desktop scanner (`UnifiedScannerPage.jsx`) also got, same day:**
- A **Trip** dropdown (own persisted choice, `mg_scanner_trip` localStorage
  key) — picking a trip refetches its coaches/checkpoints via the widened
  `vimal.js` endpoints above.
- The separate arrived/late/missing badge row under the Checkpoint selector
  was removed and merged into the existing stat-card row, now 3 cards:
  **Boarded / Late / Missing** — checkpoint-scoped when a checkpoint is
  selected, else falls back to the coach's overall counts (Late computed
  client-side from the roster, since `vimal.js`'s coach payload has no
  aggregate late count of its own).
- "Still missing" → **"Still missing / late"** — now includes LATE
  delegates too (was MISSING-only), each with a status badge, sorted
  missing-first.
- Both the coach roster and checkpoint stats now poll every 3s — this used
  to only refetch after a scan, so a status changed elsewhere (e.g. the
  Dashboard's Edit delegate form, or a manual override — see Jayden's section
  below) could sit stale on this page indefinitely.

## For Jayden — what changed in your files

**`backend/routes/exceptions.js` was edited directly** (2026-07-23) — the
Manual attendance path (`POST /api/checkins/manual` and its
`/checkins/manual/undo` counterpart):

1. **Checkpoint sync on manual mark-present.** A manual "Mark present" used
   to only flip the delegate's GLOBAL status — an earlier auto-inserted LATE
   (or a stale scan) at the CURRENT checkpoint kept showing on the scanner's
   Boarded/Late/Missing KPIs even after staff manually checked someone in by
   hand. Now calls `syncCurrentCheckpointStatus()` (JQ's, `routes/checkpoints.js`)
   right after the delegate's status update.
2. **A real bug this surfaced and fixed**: `check_in_logs.trip_id` has a
   foreign key to `trips`' LEGACY `id` column ("t-1"-style), NOT
   `trips.uuid_id` — only the original Beijing trip has that legacy column
   populated; every trip created since is `NULL` there. The scanner's new
   trip switcher (Vimal's section above) meant `manualOverride()` started
   sending a REAL trip's uuid as `tripId`, which violated that FK and
   500'd on every manual check-in for any non-Beijing trip. **Fixed by
   decoupling the two purposes**: `tripId` (written to `check_in_logs.trip_id`)
   stays its historical `"t-1"` default always; a new, separate
   `checkpointTripId` field carries the real selected trip, used ONLY to
   resolve which checkpoint to sync (via `uuid_id`, which every trip has).
   See the big comment on the route for the full explanation if this needs
   touching again.
3. **New `check_in_logs.prev_status` column** — captures the delegate's
   status right before a manual override flips it to ARRIVED. `Undo` used to
   unconditionally reset to `ASSIGNED`, which lost a real prior LATE/MISSING
   status; it now restores whatever `prev_status` says (falls back to
   ASSIGNED only for older rows from before this column existed). Undo also
   now accepts an optional `checkpointTripId` and mirrors the restored status
   into the checkpoint sync too.
4. **Frontend**: `lib/exceptionsApi.js`'s `manualOverride(delegateId, checkpointTripId)`
   and `undoManualOverride(delegateId, checkpointTripId)` both gained that
   second optional param; `ManualTrackingPanel.jsx` (yours, unmodified logic
   otherwise) now passes its `tripId` prop through to both calls.

---

## For Vance — what changed in your files

**Unrelated to the checkpoint feature above** — a separate request from JQ's
user (2026-07-23) to make the Onboarding screen's Boarding Passes tab work
across trips, not the base trip only. All changes below were made with the
user's explicit go-ahead each time (Vance's files, not JQ's own).

**Update, later same day**: the underlying API surface (badges/QR generation,
`GET /api/onboarding/badges`) was live-tested against the real Neon DB via
direct API calls (dev server was already running; see "Testing done" below
for the full pass) — a real delegate was onboarded to the School Field Trip
Test trip, its `qr_code` fetched from this exact endpoint, and successfully
scanned in via `/api/onboarding/checkin`, confirming the boarding-pass QR
generation → scan round-trip works end to end. **The trip-switcher dropdown,
KPI-card wiring, and `TripPulse` `data`-prop override themselves are still
only build/syntax-checked** — no browser was available in that session to
click through the actual UI (the in-app Browser pane couldn't reach
localhost, and no Chrome extension was connected), so a fresh pair of eyes
should still click through both Onboarding tabs once before fully trusting
the frontend wiring, even though the API they call is now proven live.

1. **`frontend/src/pages/desktop/BoardingPassesView.jsx`** — added a trip
   switcher: a `<select>` (populated via your existing `getTrips()`) replacing
   the page's reliance on whatever `tripId` the parent passed in. Local
   `selectedTrip` state drives `getBadges(selectedTrip)`, so switching trips
   here reloads that trip's delegates/QR codes/print list — no new delegates,
   no new DB rows, purely a different read. Also added an optional
   `onKpiChange` callback prop (no-op if the parent doesn't pass one) that
   reports `{ trip: {name, dayOf}, kpis: {total, present} }` for the currently
   selected trip, so the page header's stat card can stay in sync (see next
   item). *(An earlier version of this change added an "Add existing
   delegate" cross-trip clone feature — two new backend routes on
   `vance.js` plus a modal here. That was reverted in full at the user's
   request in favor of the simpler trip-switcher approach; `vance.js` has NO
   net changes from that work.)*
2. **`frontend/src/components/TripPulse.jsx`** — added one optional `data`
   prop. If omitted, behaves exactly as before (polls `/api/assistant/pulse`
   every 15s, used as-is everywhere else it's already mounted). If passed, it
   skips its own poll and renders that data directly instead — purely
   additive, no existing caller's behavior changes.
3. **`frontend/src/pages/desktop/OnboardingPage.jsx`** — the header's
   `<TripPulse mode="onboarding" />` (same position, same styling, untouched
   layout) now receives `data={view === "passes" ? passesKpi : parseKpi}`:
   - `passesKpi` is fed by `BoardingPassesView`'s new `onKpiChange` above, so
     on the Boarding passes tab the header card reflects whichever trip is
     picked in ITS OWN dropdown.
   - `parseKpi` is a new state, refreshed via a new `getBadges(tripId)` effect
     keyed on the existing `tripId`/`trips` state, so on the Document parsing
     tab the header card reflects whichever trip is picked in the existing
     "Assign to trip" dropdown (previously it always showed the global
     assistant snapshot's trip regardless of that selection — this fixes that
     mismatch).
   - `frontend/src/lib/claudeParse.js`'s `getBadges` import was added to this
     file; no existing export in that file was changed.

None of the above touches `/api/assistant/pulse`, `buildSnapshot()`/
`getSnapshot()`, or the chat assistant's cached snapshot — that shared,
5-second-TTL cache (used by the chat assistant and the "what to watch" risk
panel elsewhere) was deliberately left alone given how many other things read
it.

---

## For whoever owns the Mobile shell — trip switcher across mobile pages

New shared `frontend/src/lib/mobileTrip.js` (`getMobileTripId()`/
`setMobileTripId()`, localStorage key `mg_mobile_trip`). `MobileHomePage.jsx`
got a trip picker restricted to trips with status **"In progress" only**
(a Planning/Completed trip has nothing live to track from a phone) — auto-
falls back to the first in-progress trip if the previously-picked one no
longer qualifies. Every other mobile page that used to hardcode its own
`TRIP_ID = "t-1"` now reads `getMobileTripId()` instead, so switching trips on
Home actually changes what the whole mobile app shows:
`MobileAttendancePage.jsx`, `MobileScannerPage.jsx` (Vimal's — mobile UI
shell work), `MobileOpsPage.jsx` (Vimal's), `MobileIssuesPage.jsx`,
`MobileLayout.jsx` (JQ's shell). All read it fresh on mount/each poll tick,
not once at module-load time, so a switch on Home shows up without a full
app reload.

**Known gap, NOT fixed**: `MobileIssuesPage.jsx`'s delegate picker still
reads from `exceptionsApi.js`'s own internal hardcoded trip constant
(`getDelegates()` has no tripId param at all) — it'll keep showing the
Beijing roster regardless of the mobile trip switcher. Fixing it means
widening a shared library function used by several other desktop features
too; flagged as a comment in the file rather than attempted here.

Also same day: `MobileAttendancePage.jsx`'s map-pin icon is now fully hidden
(not just disabled) for Assigned/Arrived/Late — only rendered for Missing,
since a location is only ever recorded for a Missing delegate.

---

## Cross-cutting fixes (JQ's own base, no teammate files touched)

- **Trip detail page dark theme** (`TripCoachPage.css`) — `CoachBoardView`
  used to deliberately NEVER apply dark mode (a documented v4 design-brief
  choice: "removes dark mode from the coach board itself"), so it always
  rendered white/light regardless of the rest of the app's theme. Now applies
  the same `useTfTheme()` hook `TripsListPage.jsx` already used. Colors
  reference the SAME app-wide tokens (`var(--bg)`/`var(--surface)`/`var(--ink)`/
  `var(--line)`) instead of a separately hand-picked dark palette, so it's
  guaranteed pixel-identical to the Dashboard/every other page.
- **Sidebar "Trips" nav item remembers the last-open trip board** — ~~used to
  always drop back to the trip listing when switching tabs and back; now
  persists the last `?tripId=` (`mg_last_trip_id` localStorage key,
  `TripCoachPage.jsx`) and only resets on the board's own "Back to trips"
  button.~~ **Reverted 2026-07-24** — the persistence was too sticky: it
  survived a deliberate navigation away (e.g. to Dashboard) and back, so
  clicking "Trips" from the sidebar kept jumping straight into whichever trip
  board was last open instead of the listing, unless you specifically used
  that board's own "Back to trips" button first. That's not what a nav-rail
  link should do. Removed entirely: `Sidebar.jsx`'s `tripsLinkTarget()`
  helper (link is now always the plain `/trips`) and `TripCoachPage.jsx`'s
  `LAST_TRIP_ID_KEY` persistence effect + its use in both "Back to trips"
  buttons. **`TripCoachPage.jsx` is Desmond's file** (mislabeled above as
  "no teammate files touched" — it wasn't, and neither is this revert); this
  was a straight logic fix to a bug in the exact feature already added there
  with his go-ahead, not new functionality.
- **Settings page trip picker persistence bug** — the new "Checkpoint reset
  window" card's own trip picker reset to Beijing on every page navigation
  (it read the Dashboard's persisted choice with no persistence of its own);
  fixed with a dedicated `mg_settings_reset_trip` key.

---

## 2026-07-24 — App-wide fix: drag-to-select-text closing every modal

**Unrelated to the checkpoint feature** — the user found that dragging to
select text inside a modal's field, then releasing the mouse outside the
modal (over the dark backdrop), closed the whole modal. A native browser
"click" fires wherever the mouse is *released* (the mouseup target), not
where the drag started, so a naive `<div className="overlay" onClick={() =>
close()}>` backdrop closes any time a text-selection drag ends outside the
card — a very easy thing to do while editing any field.

**The fix had already been applied in exactly TWO places** (`Modal` and
`ConfirmDialog`, both in `TripCoachPage.jsx`) but was never rolled out
anywhere else. A full audit found it was actually present in **22 more
locations across nearly every page in the app** (only 2 of ~24 modals in the
whole codebase were protected). Fixed all 22 with the same small guard
pattern everywhere — a `useRef` tracking whether the mousedown ALSO started
on the backdrop, checked again on click, e.g.:
```jsx
const downOnBackdrop = useRef(false);
<div
  onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
  onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) close(); }}
>
```
No behavior changed for a genuine backdrop click (mousedown AND click both
on the backdrop) — only a drag that started inside the modal and ended on
the backdrop no longer closes it.

**Files touched** (all with the user's go-ahead given the scope; teammates'
files flagged explicitly):
- **Desmond's**: `TripCoachPage.jsx` (`DelegateDetailPanel`'s side-panel
  overlay — a THIRD, previously-unguarded overlay in the same file as the
  already-fixed `Modal`/`ConfirmDialog`), `TripsListPage.jsx` (`TripFormModal`
  — has its own modal markup, does NOT reuse `TripCoachPage.jsx`'s `Modal` —
  and `DeleteTripDialog`), `MobileTripsPage.jsx` (`DelegateSheet`).
- **Jayden's**: `LogExceptionModal.jsx`.
- **Vance's**: `BoardingPassesView.jsx` (single-pass modal),
  `ChatAssistantPage.jsx` (delegate info card).
- **Vimal's**: `MobileScannerPage.jsx` (reset-headcount confirmation).
- **JQ's own** (no cross-teammate risk): `AccountControlPage.jsx`,
  `DashboardPage.jsx` (4 separate overlays — headcount, add/edit delegate,
  checkpoint timeline, last-known-location map), `LoginPage.jsx`
  (`ForgotPasswordModal`), `Layout.jsx` (mobile sidebar backdrop — not a
  modal exactly, but the same click-outside-to-close bug shape),
  `MobileChatBubble.jsx`, `MobileAttendancePage.jsx` (4 overlays: map modal,
  timeline modal, and both steps of `StatusSheet` — including the "Last
  known location" field asked right before marking someone Missing, a very
  plausible drag-select spot), `ExportModal.jsx`, `MediaManager.jsx` (the
  "type DELETE ALL to confirm" purge dialog — the one truly destructive,
  no-undo action in the app, so this was a meaningfully higher-stakes
  instance of the bug than most).

**Verification**: every touched file was individually rebuilt with `esbuild`
after each edit (no syntax/type errors), then a full `vite build` of the
entire frontend was run at the end — clean, only a pre-existing/unrelated
chunk-size warning. **Not covered**: the actual drag gesture itself wasn't
clicked through live in a browser this session (no browser access was
available) — a fresh pair of hands should still try the drag-select-then-
release-outside gesture on a couple of these to visually confirm, though the
logic is identical to the two already-proven-working cases in
`TripCoachPage.jsx`.

---

## 2026-07-24 — Dashboard: AI Insights was trip-blind (real bug, not just UX)

**JQ's own files, no teammate impact.** The user asked whether "AI Insights"
(Dashboard → Analytics tab) was worth keeping since it "felt useless." Root
cause found on inspection, not guessed: it was trip-blind on BOTH ends —
`AnalyticsPanel.jsx` hardcoded `const TRIP_ID = "t-1"` for every call, AND
`backend/routes/insights.js`'s `POST /api/trips/:id/insights` completely
ignored `req.params.id`, calling `getTrip()`/`getDashboard()`/`getMissing()`
with no arguments (always the base/default trip). So "Generate Insights"
always described the base Beijing trip's data, no matter which trip's
Analytics tab you were actually viewing.

Fixed both ends: `insights.js` now resolves `req.params.id` via
`resolveTripUuid()` and threads it through all three calls;
`AnalyticsPanel.jsx` takes a `tripId` prop (default `"t-1"`, backward-
compatible) instead of the hardcoded constant; `DashboardPage.jsx` passes its
existing `selectedTripId` in. **Live-tested** against the real Neon DB/Ollama
on School Field Trip Test — response correctly named "Test Student" and the
real 1-of-2 missing count for that trip, not Beijing's 42-delegate roster.
Side note (not a code bug): the local Ollama model's own phrasing was
slightly inconsistent in that test ("out of 40 boarded" vs. the real total of
2) — a model-quality quirk worth knowing about if local-model output looks
off; the Anthropic fallback would likely be more reliable.

Also added `backend/seed-stress-test.js` — a repeatable (not idempotent,
re-running adds MORE) script that adds 100 realistic delegates to a named
trip (defaults to "School Field Trip Test"), auto-creating coaches up to 3 if
fewer exist, with a weighted status mix (55% Arrived / 20% Assigned / 12%
Missing / 8% Late / 5% Unassigned) and varied company/industry/role, for
checking the UI at real-world scale instead of 1-2-delegate test trips. Run
with `cd backend && node seed-stress-test.js`. Live-run once already — School
Field Trip Test now has 102 delegates across 3 coaches (27/32/42, matching
their 40/35/35 capacities); every read endpoint (`dashboard`, `missing`,
`delegates`, `all-trips`, `onboarding/badges`) still returns 200 under that
load.

---

## 2026-07-24 — Dashboard visual/UX pass (Coach status, Roster breakdown, Reverse headcount, History tracker)

**JQ's own files, except one line in `routes/vance.js` (Vance's — a real bug
fix, flagged below), no other teammate impact.**

1. **Coach status bar now shows composition, not just red-or-green**
   (`CoachBar` in `DashboardPage.jsx`). Used to be a single flat fill —
   red if the coach had ANY Missing/Late, green otherwise — so two coaches
   both "in trouble" looked identical whether one was mostly Late and the
   other mostly Missing. Now a real stacked bar: green (boarded) → orange
   (late) → red (missing), against capacity. Independent per-segment
   rounding can sum to just over 100% (e.g. 34+33+34) — the excess is shaved
   off the last segment so it can't poke past the track's rounded end.
   Corner radius is applied explicitly to the actual first/last segment
   (not left to the track's `overflow:hidden` alone), and every segment uses
   an explicit pixel height rather than a `%`-based one, so segments can't
   render at visibly different heights from each other.
2. **Roster breakdown's 3 stats (Arrived/Assigned/Unassigned) get a hover
   effect** matching the KPI tiles' own treatment — border highlights to the
   stat's own status color + a subtle lift + shadow on hover, via a
   `--roster-tone` CSS var set per-button (same pattern the `Kpi` component
   already used for `--kpi-tone`). First version used a plain background-fill
   hover; replaced after the user said it didn't match the KPI tiles' look.
3. **"Reverse headcount" modal gets search/filter/sort** — with a large
   roster, each coach's "still missing" list could run to 8-9+ names with no
   way to narrow it down. Added a search box (by name), a status filter
   (All/Missing/Late/VIP), and a sort (Name/Status) — all client-side, no
   new endpoint needed since this modal's data was already fully loaded.
4. **History tracker was completely global — now scoped by trip.** Real
   design gap, not a UI nit: `activity_log` had no trip reference at all, so
   every trip's add/edit/remove events mixed into one feed — noticed after
   the 100-delegate stress-test seed (see above) buried everything else.
   Added `activity_log.trip_id` (nullable UUID, additive), threaded a
   `tripUuid` through `logActivity()`'s `meta` param and all 4 call sites in
   `db/delegates.js` (create/update/delete/delete-all — each already had the
   relevant trip_id in scope), `getActivity(limit, tripUuid)` and
   `deleteAllActivity(tripUuid)` now filter/scope when given one,
   `GET`/`DELETE /api/activity` accept `?tripId=`. Dashboard card defaults to
   "This trip" with an "All trips" toggle to fall back to the old global view.
   Older rows (and any write from before this) have `trip_id = NULL` and only
   show up under "All trips", not retroactively attributed.
   - **A real bug this surfaced**: `routes/vance.js`'s onboarding confirm
     route (`POST /api/trips/:id/onboarding/confirm`, **Vance's file**)
     called `createDelegate({...})` with NO `tripUuid`, then separately
     `UPDATE`d `trip_id` on afterward — so `logActivity()` (which fires
     *inside* `createDelegate`) always recorded `trip_id = NULL` for every
     delegate onboarded through the document-parser flow, meaning the
     per-trip History tracker would never have shown that activity at all.
     Fixed by passing the already-resolved `tripUuid` straight into
     `createDelegate()` (it already accepts one) — one line, the trailing
     `UPDATE`'s own `trip_id` write is now a harmless no-op via `COALESCE`.
   - **Live-tested** against the real Neon DB: created a delegate via the
     confirm endpoint, confirmed its activity entry showed up when filtered
     to School Field Trip Test; confirmed the unscoped `/api/activity` still
     returns everything. Full `vite build` clean.

## 2026-07-24 — Coach composition bar fix + All-delegates table UX pass

**JQ's own file only (`DashboardPage.jsx`), no teammate impact.**

- **Coach composition bar rewritten as a single-element CSS gradient**, not
  stacked flex children — user reported the multi-div flex version had
  segments that looked visually different heights/misaligned rounded
  corners. A single `<div>` with `background: linear-gradient(...)` and hard
  color-stops can't have a per-segment height mismatch (there's only one
  box), and its own `border-radius` + `overflow:hidden` rounds both ends
  without needing per-segment corner logic. New shared helpers
  `coachBarSegments(coach, {includeBoarded})` / `coachBarGradient(segs)` —
  used by both the Coach status card (green+orange+red) and the Reverse
  headcount modal (orange+red only, per a follow-up request to drop the
  green boarded segment there specifically). Verified the underlying math
  against live data (Coach 1: 38% boarded vs 20% late+missing combined,
  computed correctly) — added `backgroundClip: "padding-box"` as an extra
  safeguard, but couldn't visually confirm in a real browser (none available
  this session); if it's still off after a hard refresh, needs a fresh look.
- **All-delegates table**: pagination (replacing "Show all"), a page-size
  selector (10/25/50/100), a sticky `<thead>` inside a `max-height: 640px`
  scroll container, a result count + "Clear filters" button, and auto-hiding
  the Last-seen/Created-by columns when every row on the current page is
  empty in that column. All client-side, no new endpoints.

## 2026-07-24 — Trip pickers restricted to "In progress" everywhere

**JQ's own files, no teammate impact.** `MobileHomePage.jsx` already
restricted its trip picker to status "In progress" (2026-07-23); extended the
same restriction to every other trip picker that was still showing
Planning/Completed trips with nothing live to do:
- `lib/claudeParse.js`'s `getTrips()` — the ONLY two callers are
  `OnboardingPage.jsx`'s "Assign to trip" picker and
  `BoardingPassesView.jsx`'s trip switcher, so filtering inside `getTrips()`
  itself covers both "Document parsing" and "Boarding passes" tabs in one
  change. Both already reset their selection if the previously-picked trip
  id disappears from the list, so a trip finishing mid-session falls back
  cleanly.
- `DashboardPage.jsx`'s trip switcher — same filter, but **keeps the
  currently-selected trip in the list even if its own status isn't "In
  progress"**, so switching TO an in-progress trip doesn't make whatever
  you're currently looking at vanish out from under you. Verified live this
  matters: the user's own Dashboard had "Bangkok Business Exchange"
  (status **Completed**) selected at the time — it stays visible while
  selected, just doesn't appear if you reopen the dropdown from elsewhere.
- `UnifiedScannerPage.jsx`'s Trip dropdown — same filter (fetches
  `/all-trips` directly rather than through `getTrips()`, so needed its own
  fix).
- Mobile scanner (`MobileScannerPage.jsx`) and the kiosk scanner
  (`KioskScannerPage.jsx`) don't fetch their own trip list at all — they
  read whatever's picked on `MobileHomePage.jsx` (mobile) or use a fixed
  base trip (kiosk) — so both were already correctly scoped, no change
  needed.
- **Live-verified** against the real Neon DB: exactly 3 of 16 trips are
  actually "In progress" (Beijing study mission, Manila Innovation Summit,
  School Field Trip Test) — the other 13 (mostly "Planning") are now
  correctly excluded from every picker above. Full `vite build` clean.

---

## 2026-07-24 — Custom chart builder, Account control role templates, misc fixes

**JQ's own files only, no teammate impact.**

**Analytics tab restructured into 2 tabs** (`AnalyticsPanel.jsx`) — "Overview"
(the original 4 fixed widgets + AI Insights, unchanged) and "Custom chart"
(new). Custom chart builder: pick a chart type (bar/pie/donut/line) and a
group-by field (status/coach/company/industry/VIP), rendered live from the
same `delegates` list the fixed widgets already read — no new data fetch.
Plus a bounded AI-assist box: a plain-language request ("missing delegates
by company") gets translated to `{chartType, groupBy}` by a new endpoint,
`POST /api/trips/:id/analytics/ai-chart` (`routes/insights.js`, same
Ollama-then-Anthropic fallback and `extractJson()` pattern as `export.js`'s
existing ai-filter) — the model only ever picks from the same fixed enum the
dropdowns use, never sees/writes delegate data, and its answer lands in
those same editable dropdowns rather than rendering anything hidden.
Live-tested: correctly mapped "missing by company" → `{bar, company}`; one
other prompt picked a slightly-off field (same "AI guesses reasonably, not
perfectly" caveat as Insights) — acceptable since it's fully overridable.

**Account control: named access-role templates + filter.** User's own
framing: "headcount staff (onsite) — mostly mobile, but web can see trip/
dashboard/delegate" vs "admin staff — everything except the admin right".
Added `ROLE_TEMPLATES` (`AccountControlPage.jsx`) — **Onsite Headcount
Staff** (manageDelegates + manageScanner; web: Dashboard/Delegate/Trips only;
mobile: everything) and **Admin Staff (Web)** (every non-adminOnly permission
true — full operational access without Account control itself). "Apply"
buttons quick-fill the New/Edit modal's checkboxes (still fully editable
after, nothing saved until Save is clicked) — this is a convenience preset,
NOT a stored tag; a new "Access role" filter/dropdown in the Accounts list
computes which template (if any) each staff account's CURRENT permissions
exactly match (`matchRoleTemplate()`), showing "Custom" for anything that
doesn't match either — so it can never drift out of sync with what's
actually enforced. Also split the existing role filter into proper Admin/
Staff tabs with counts (was a single "All roles" dropdown).
- Added `backend/reassign-staff-templates.js` — one-off migration that
  realigned the 51 `staff_%` accounts (50 from `seed-staff.js` + the
  pre-existing `staff_demo`) onto these 2 templates (~1-in-6 Admin Staff,
  rest Onsite Headcount), so the new filter has real, meaningful data
  instead of everything showing "Custom". Live-run: 51 reassigned.

**Reverse headcount modal**: each coach's "still missing" list now scrolls
within a fixed `max-height: 340px` instead of an unbounded list — with 100+
delegates, one coach's list could run to 15+ names, making that card far
taller than its neighbours and the whole grid look messy.

**Bar rendering fixes** (`DashboardPage.jsx`):
- The composition bars (Coach status card + Reverse headcount) and the
  Roster breakdown bar all got a subtle `border: 1px solid var(--line)`.
  Root cause of the "corners aren't rounded" reports across several rounds:
  the trailing grey portion (remaining capacity / Unassigned) is close in
  luminosity to the card's own background, so the TRUE rounded edge was
  always there but visually invisible — what looked "square" was actually
  the flat cut between the last *visible* color and that low-contrast grey
  sliver. The border makes the rounded shape visible regardless of fill
  contrast.
- Per your request, Reverse headcount's bar now omits the green "boarded"
  segment (orange/red only — `coachBarSegments(c, {includeBoarded: false})`);
  the main Coach status card keeps all 3 (green/orange/red) — same
  `coachBarSegments`/`coachBarGradient` helpers, different `includeBoarded`
  flag per call site.
- Fixed a real "Departure in null" bug (same class as the earlier
  MobileHomePage fix) — the Missing KPI tile's footer interpolated
  `trip.departsIn` directly into a template literal with no truthiness
  guard, so a trip with no `departsIn` value rendered the literal text
  "null" instead of omitting the line.

**Seed data**: ran `seed-stress-test.js` again — School Field Trip Test now
has 204 delegates (2 rounds of 100 + originals). Bulk-set all 3 coaches to
capacity 50 via the new "Max delegates per coach" trip field (see below).

**New: "Max delegates per coach" field in Edit trip** (`TripsListPage.jsx` +
`routes/desmond.js` — Desmond's files, flagged, same pattern as this
session's earlier edits there). New `PATCH /api/trips/:tripId/coaches/
capacity` bulk-sets EVERY coach on a trip to one seat count in a single call
(separate from the existing per-coach `PATCH /api/coaches/:id`, which is for
adjusting one coach individually) — only sent if the field is actually
filled in (blank = leave each coach's own capacity alone). Live-tested:
School Field Trip Test's 3 coaches (40/35/35) all set to 50 in one call.

---

## 2026-07-23 — Custom chart builder, Analytics tab split, full Role Template CRUD, Reverse Headcount at scale (JQ)

**Files touched (all JQ-owned unless noted):**
`frontend/src/components/AnalyticsPanel.jsx`, `backend/routes/insights.js`,
`frontend/src/pages/desktop/DashboardPage.jsx`,
`frontend/src/pages/desktop/AccountControlPage.jsx`, `backend/db/schema.js`,
`backend/db/accounts.js`, `backend/routes/accounts.js`,
`frontend/src/lib/i18n.jsx`.

**1. Analytics: Overview / Custom chart tabs + AI chart-builder**
- Split the Analytics panel into two pill tabs: "Overview" (the original
  Filter/Sort/Customize header + AI Insights card + 4-widget grid, unchanged)
  and "Custom chart" (new).
- Custom chart tab: pick chart type (Bar/Line/Pie-donut) and a group-by field
  (status/coach/company/industry/vip) via dropdowns, renders live via
  Recharts. Also has an AI-assist box — type a request like "missing
  delegates by company" and it calls a new bounded AI endpoint that only
  returns one of the fixed chart types + group-by fields (never sees/writes
  raw delegate data).
- New backend route: `POST /api/trips/:id/analytics/ai-chart` in
  `insights.js` (Ollama-then-Anthropic fallback, same pattern as AI
  Insights). Live-tested: "missing delegates by company" →
  `{chartType: bar, groupBy: company}` correctly.
- Also fixed while in this file: **AI Insights was trip-blind** —
  `getTrip()/getDashboard()/getMissing()` were being called with no args
  anywhere insights.js touches them, so Insights always analyzed whichever
  trip happened to be default/first instead of the selected trip. Now all
  three take the resolved `tripUuid`.

**2. Full Role Template system (Account Control → "Manage roles")**
Per request: *"give me option to choose which default page/function should
this role do, and allow me to create new role etc."*
- New `role_templates` table (`schema.js`): `id, label, permissions (JSON
  text), createdAt`. Seeded with 2 defaults: "Onsite Headcount Staff"
  (delegates/scanner focused, no documents/export/trips/exceptions) and
  "Admin Staff (Web)" (everything except `manageAccounts`).
  - **Bug caught + fixed during seeding**: the original seed check was a
    single "does any role_template row exist" gate wrapping two sequential
    inserts. A `node --watch` restart mid-edit landed between the two
    inserts, leaving only "Onsite" ever inserted, and the table-wide gate
    then permanently skipped both on every future boot. Rewrote as a
    per-row idempotent check (`WHERE id = $1`) so a partial seed always
    self-heals on next boot. Manually backfilled the missing row once via
    curl to unblock testing immediately.
- New CRUD in `db/accounts.js` (`listRoleTemplates`, `createRoleTemplate`,
  `updateRoleTemplate`, `deleteRoleTemplate`) + 4 routes in `routes/
  accounts.js`, all gated on `manageAccounts` like the rest of Account
  Control. Live-tested full create → rename (patch) → list → delete cycle
  via curl against the running backend — all correct, final state back to
  just the 2 defaults.
- `AccountControlPage.jsx`: role templates are now fetched from the backend
  instead of hardcoded (`roleTemplates` state + `loadRoleTemplates()`).
  `matchRoleTemplate()`, `templateCounts`, the filter dropdown, and the
  account modal's "quick-fill" buttons all now derive from this list instead
  of a fixed object, so any role you create/edit immediately shows up
  everywhere without a code change.
  - Extracted the entire permission-checkbox-groups block (used by both the
    account modal and the new role editor) into a shared
    `PermissionCheckboxGroups` component so the two UIs can never drift out
    of sync.
  - New "Manage roles" button + `RoleTemplatesModal` (list / create / edit /
    delete a role's name + permission set, reusing the shared checkbox
    component above).

**3. Reverse Headcount at scale (20+ coaches) + phone required**
Per request re: what to do once there are ~20 coaches:
- Each coach card is now collapsible once there are >4 coaches AND that
  coach has missing/late delegates — collapsed shows "Show N missing/late",
  click to expand. Coaches with 0 missing (fully arrived) or 0 delegates are
  never collapsed (nothing to hide).
- Added a working **Call button** (`tel:` link) next to each missing
  delegate's name, next to the existing map-pin button. Only shown if the
  delegate has a phone number.
- **Phone number is now a required field** on the delegate form (moved out
  of the collapsed "More details" section to always-visible, red asterisk,
  `type="tel"`, blocks Save if empty) — this is what makes the Call button
  reliably available.
- **Bug fix**: a coach with 0 delegates assigned was showing a green
  "Arrived" badge (100% of nothing = vacuously "complete"). Added an
  explicit `total === 0` → neutral "No delegates yet" state, checked before
  the missing-count logic, in both the badge and the body text.
- Renamed "missing" → "not boarded" specifically in the Coach status card's
  attention badge and the Reverse Headcount coach badge, matching Vance's
  own wording in `BoardingPassesView.jsx`. Did NOT touch the shared
  lowercase `"missing"` i18n key used elsewhere (mobile pages, Desmond's
  `TripCoachPage.jsx`) — out of scope / cross-teammate risk.
- Added search box + status filter (all/missing/late/vip) + sort (name/
  status) to the Reverse Headcount modal's delegate list, and a coach-status
  composition bar (orange/red only, no green, per earlier request) matching
  the Coach status card's bar rendering.

**Testing:** `node --check` on all backend files, `esbuild` bundle check +
full `vite build` on all frontend files (clean, only the pre-existing
unrelated chunk-size warning). Full live curl testing of the AI chart
endpoint and the complete role-template CRUD cycle against the running dev
backend (port 4000) using the saved Vance auth token — no live browser was
available this session.

**Cross-teammate impact:** none — every file above is JQ-owned. No
teammate files were touched in this batch.

### Follow-up same day: Account Control layout tweaks (JQ)
Per feedback right after the above landed:
- **"Manage roles" moved out of the New/Edit account modal** onto the main
  Accounts page, next to the Search/Access-role/Sort row — it's a
  standalone admin task (create/edit/delete named roles), not something
  that should require opening an account form first. The account modal
  still has its "Quick-fill from a role template" buttons (unchanged),
  just without the redundant "Manage roles" button next to them.
- **Access column now shows the matched role template's name** (e.g.
  "Onsite Headcount Staff") instead of a wrapped row of individual
  permission chips — same `matchRoleTemplate()` computation already used
  by the Access-role filter, so the column and the filter always agree.
  Falls back to a neutral "Custom" badge if the account's permissions
  don't exactly match any current template. Admin rows unchanged ("Full
  access" badge).
- Verified via `esbuild` bundle check + full `vite build` (clean, same
  pre-existing chunk-size warning as before).

---

## 2026-07-24 — Delegate profile view, pagination everywhere, photo crop, History Log filters (JQ)

**Files touched (all JQ-owned unless noted):**
`frontend/src/pages/desktop/DashboardPage.jsx`,
`frontend/src/pages/desktop/AccountControlPage.jsx`,
`frontend/src/pages/desktop/HistoryLogPage.jsx`,
`frontend/src/components/AnalyticsPanel.jsx`, `backend/db/history.js`,
`frontend/src/lib/i18n.jsx`.

**1. Delegate profile view** — per request: *"make the existing modal a
richer 'profile view'... combine what's already there (photo, contact,
passport) with what currently lives in separate popups (checkpoint
timeline, location map) into one scrollable panel."*
- Clicking a delegate's name (or the new eye icon) in the All-delegates
  table, or a name in the Reverse Headcount coach cards, now opens ONE
  scrollable panel: photo/status/VIP header, contact info (phone with a
  Call icon button, not the number itself as a disguised link — fixed after
  feedback that a plain-looking phone number secretly being a `tel:` link
  read as a stray focus outline), coach/company/industry/nationality,
  passport number/expiry, notes/accessibility notes, last-known-location +
  map (shown for ANY delegate with a recorded location/last-seen, not just
  Missing ones — needed once this view was reused from Reverse Headcount,
  which also lists Late delegates), and the checkpoint timeline, all in one
  place. An "Edit" button opens the existing Create/Edit modal for actual
  changes.
- The old separate Clock (timeline) / MapPin (location) icon buttons on the
  main delegates table are gone, replaced by the one profile view entry
  point. Reverse Headcount's own quick map popup is untouched.
- **Photo enlarge**: the profile photo is bigger (84px, was 56px) and now
  clickable — opens a full-size lightbox overlay (click anywhere or the X
  to close).
- **Photo crop before upload**: picking a file in the Edit-delegate modal no
  longer uploads it straight away — it opens a crop/zoom modal first (drag
  to pan, slider to zoom, circular preview matching the final avatar shape),
  per *"if i upload a photo it should let me resize and choose how my pic
  gonna be like — common stuff in other websites"*. Pure `<canvas>`
  implementation, no new library dependency — exports a square JPEG blob
  that uploads through the existing photo endpoint unchanged.

**2. Pagination + filters added to 3 previously-unpaginated lists**
Same recurring "too messy with real volume" complaint, same fix pattern
(search + filter dropdown(s) + a bounded/paginated list) applied to:
- **Account Control's Accounts table** — sticky-header scroll area +
  full pagination (rows-per-page, prev/next), a "Clear filters" button, and
  "select all" now scoped to the current page only (was silently
  selecting every filtered row across all pages). Also: "Manage roles"
  moved out of the New/Edit account modal onto the main page next to the
  filter row (it's a standalone admin task, not tied to editing one
  account); the Access column now shows the matched role template's name
  instead of a wrapped row of permission chips; renamed "Quick-fill from a
  role template" → "Apply an access role" for clarity.
- **History Log page** (the full "every trip mixed together" view) — added
  a search box (matches delegate name/actor) + "All trips"/"All coaches"
  filter dropdowns + a trip-name tag on every entry, since this page has no
  other way to tell which trip an entry belongs to. Required a backend
  change: `getActivity()` in `db/history.js` now LEFT JOINs `trips` (via
  `trips.uuid_id`, the real FK target — `activity_log.trip_id` does NOT
  reference `trips.id`) and `delegates`→`coaches`, so each entry carries
  `tripName`/`coachName`. Live-curl-verified against the running backend.
- **Staff Operations' Active sessions list** — search + role filter, and
  the list itself changed from one name per row (a lot of wasted
  horizontal space) to a 4-up responsive grid of compact cards. Note:
  `auto-fit` was tried first and rejected — it collapses unused grid
  tracks and lets the real ones stretch to fill the row, so a single
  filtered result stretched across the whole width; switched to
  `auto-fill`, which leaves the empty tracks in place instead.
- Both the All-delegates table and the Accounts table now default to
  **10 rows per page** (was 25).

**3. Analytics panel — Filter/Sort/Customize visual + layout fixes**
- The three control panels now sit side-by-side in one row (a CSS grid,
  `auto-fit`, stretched to equal height) instead of stacking as three
  full-width cards — was pushing the actual charts far down the page with
  all 3 open.
- Restyled with a tinted background + dashed border + a small icon per
  panel (Filter/Sort-arrows/BarChart) matching the button that opened it —
  per feedback that they were visually indistinguishable from the chart
  cards below ("look the same as the chart... can be confuse"). These are
  controls, not data, and now read as such.

**4. Housekeeping** — deleted two stray scratch files that had ended up
committed to the wrong place instead of a scratchpad: `README/
_dates_tmp.txt` (leftover `grep -n` output against this very handoff doc)
and `frontend/out.tmp.css` (a leftover `esbuild` bundle-check artifact).
Neither was ever referenced by any source file; both were untracked.

**Testing:** `vite build` clean after every change in this batch (only the
pre-existing chunk-size warning). History Log's backend join
live-curl-verified. No live browser available this session (localhost
unreachable from the in-app Browser pane) — verification is build-level
plus curl for the backend; screenshots from the user confirmed the actual
rendered UI at each step.

**Cross-teammate impact:** none — every file above is JQ-owned.

---

## 2026-07-24 — Backend scripts folder reorg + docs sync (JQ)

- Moved all 6 one-off backend scripts (`seed-demo.js`, `reset-login.js`,
  `seed-team.js`, `seed-staff.js`, `seed-stress-test.js`,
  `reassign-staff-templates.js`) out of the `backend/` root into a new
  `backend/scripts/` folder — they were mixed in alongside the real app
  files (`server.js`, `auth.js`, `data.js`, `cloudinary.js`). Fixed each
  script's relative imports (`./data.js` → `../data.js`,
  `../permissions.js` → `../../permissions.js`) and updated
  `package.json`'s `seed:demo`/`reset:login`/`seed:team` script paths to
  match. Syntax-checked every moved file with `node --check`.
- **Deleted 3 of those scripts** at the user's request, once their one-off
  job was done: `seed-staff.js` (created the 50 `staff_001`–`050` test
  accounts used to test Staff Operations this session — the accounts
  themselves stay in the DB, only the generator script is gone),
  `seed-stress-test.js` (100/200-delegate stress-test generator, pure UI
  scale-testing tool), and `reassign-staff-templates.js` (one-off migration
  that already ran and realigned those 50 accounts onto the 2 named role
  templates). None were wired into `package.json` or imported by any other
  file — confirmed via a repo-wide grep before deleting.
- **`README/` housekeeping**: renamed `AI Log for claude.md` →
  `Jun Qi - AI Log.md` for clear submission ownership; deleted the stale,
  superseded `AI Log for claude - backup.md` (narrative log that stopped at
  2026-07-14, fully covered by the condensed log's coverage of that period
  plus everything since) and a broken cross-reference in the renamed log's
  intro text that pointed at a nonexistent `AI Log for claude - full.md`.
  `PROJECT_STRUCTURE.md` and `INTEGRATION_NOTES.md` both updated (via
  focused review passes) to fold in this session's full batch of changes —
  the delegate profile view, the 3 pagination/search/filter retrofits, the
  Analytics panel rework, the full Role Template CRUD system, and the
  157-key Chinese translation sweep — plus 2 leftover scratch files deleted
  (`README/_dates_tmp.txt`, `frontend/out.tmp.css`), neither ever referenced
  by any source file.

**Cross-teammate impact:** none — every file above is JQ-owned or a
JQ-authored one-off script; no teammate's routes/pages were touched.

---

## Testing done

The original checkpoint feature build (table/routes/scanner UI/dashboard
indicator, everything up through the 3-event walkthrough) was live-tested
against the real Neon DB, not just read/reasoned about.

Original build's testing: checkpoint list auto-creates correctly, upsert
behavior, the kiosk security boundary (200/201 on the 2 allowed routes,
401 everywhere else), the late-cutoff/reset scheduler interaction (a real
bug was caught and fixed — the OLD global `applyLateCutoff()` was still
running and immediately re-flipping a delegate the new reset had just set to
ASSIGNED back to LATE; it's now retired from the scheduler, though the
function itself is untouched in `db/delegates.js`), and a full 3-event
walkthrough (Morning muster → Late, Afternoon check → Missing then Arrived,
Evening dismissal → Arrived on time) proving each checkpoint's history stays
completely independent.

### 2026-07-23, later same day — live re-verification against real Neon DB

The dev servers (backend :4000, frontend :5173) were already running from the
user's own session, so this pass hit the real running API directly (curl),
not just build-checks. **Note on how this was authenticated**: `jq`'s and
`vimal`'s dev-account passwords had already been changed from the seed
default, so logging in as either failed; `vance`'s, `desmond`'s and
`jayden`'s had NOT been changed yet, and — importantly — **every login
attempt on this app invalidates that account's currently active session
elsewhere** (single-session-per-account, see `seed-team.js`/`auth.js`), so
trying all three to find a way in silently logged out whoever might have
been signed into `vance`, `desmond` or `jayden` on their own device at that
moment. No data was lost, but it's worth knowing about if one of them gets
mysteriously signed out around this timestamp. All testing below then ran
under the `vance` token only (all-permissions dev account, matches the
Boarding Passes feature under test anyway). **If a fresh session picks this
up again, use a real password from the user rather than probing default
credentials.**

Trip used: **School Field Trip Test**
(`5ae2b57f-357e-46f2-8c81-859c889a3268`), which already had 3 real itinerary
checkpoints on Day 1 (two in the past, one "current" at test time) and 1
upcoming Day 2 checkpoint — reused as-is rather than fabricating new ones.

- **Created a new delegate** ("QA Test Delegate", `d-72`) via
  `POST /api/trips/:id/onboarding/confirm` — the same endpoint the document
  parser's confirm step uses.
- **Boarding-pass QR generation → scan round-trip, live**: fetched the new
  delegate's `qr_code` (`MG-36E05FED`) from `GET /api/onboarding/badges`
  (exactly what `BoardingPassesView.jsx` calls), then POSTed it to
  `/api/onboarding/checkin` as a scanner would — delegate boarded correctly,
  trip's `present` count went 0→1. Confirms the "get the QR code to scan in
  the QR code scanner" flow the user asked about actually works end to end.
- **Per-checkpoint independence / "every different event needs a re-scan"**:
  the new delegate had never been scanned at either already-past checkpoint,
  and their timeline (`GET /api/delegates/:id/checkpoint-timeline`) showed
  the scheduler had already auto-inserted **LATE** at both (`scannedBy:
  "System"`) — proving a delegate is NOT carried over as "fine" just because
  they're fine elsewhere; each stop tracks itself. Manually scanning them
  **ARRIVED** at the current checkpoint left the two past LATE rows
  untouched, confirming one stop's status never overwrites another's.
- **Manual mark-present → checkpoint sync, live**: an existing delegate
  (`d-70`) was **MISSING** at the current checkpoint; calling
  `POST /api/checkins/manual` flipped their GLOBAL status to ARRIVED AND
  correctly synced the CURRENT checkpoint's record from MISSING → ARRIVED
  (previously only reasoned about via code reading — now proven).
- **Undo → prev_status restore, live**: immediately after,
  `POST /api/checkins/manual/undo` restored `d-70` to **MISSING** (their real
  prior status) both globally and at the checkpoint — not the old buggy
  blanket `ASSIGNED` fallback. Confirms the `prev_status` column fix works.
- **Nothing else broke**: smoke-tested `/api/trips/:id/dashboard`,
  `/api/trips/:id/missing`, `/api/trips/:id/delegates`, `/api/delegates`,
  `/api/trips/:id/exceptions`, `/api/activity`, `/api/attendance/coaches`,
  `/api/assistant/pulse`, `/api/all-trips` — all returned 200 with no server
  errors.

**Still not covered by this pass** (no browser available in this session —
the in-app Browser pane couldn't reach `localhost`, and no Chrome extension
was connected): the actual frontend click-through of the Boarding Passes trip
switcher, the KPI card on both Onboarding tabs, the mobile trip switcher UI,
and the reset-window scheduler's ~5-minute ARRIVED→ASSIGNED transition
(not re-triggered live this pass — timing-dependent, needs a real wait or a
clock-adjusted test). A fresh session with real browser access should close
that gap.
