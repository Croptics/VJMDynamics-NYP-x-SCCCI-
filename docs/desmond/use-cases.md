# Use Cases — Desmond (Trip Booking & Dynamic Coach Management)

Covers **Screen 3 — Trip Management & Coach Assignment** (the "TransitFlow"
feature): planning trips, building itineraries, sizing and staffing coaches,
and — the enhanced capability — **live drag-and-drop coach reassignment** with
capacity limits, offline support, and concurrency safety.

## Actors
- **Trip coordinator** — signed-in staff/admin with the `manageTrips` permission.
  Creates and runs trips, edits the itinerary, manages the fleet, and reassigns
  delegates (desktop board, or the mobile board).
- **Coach captain** — a staff account assigned to one or more coaches on a trip.
  When not an admin, sees **only their own coach(es)** plus the Unassigned list
  (desktop or mobile). Edits within scope if they also hold `manageTrips`.
- **Any signed-in staff** — can *view* the board (view-for-all, edit-gated).
- **System actors** — the board's 2-second live refresh; the QR/manual check-in
  feed (Vimal/Jayden) that flips delegates to `ARRIVED`; the minute-by-minute
  Late-cutoff job.

---

### UC-1 — Create and run a trip through its life-cycle
**Actor:** Trip coordinator · **Trigger:** creates a trip, or opens an existing
one from the Trips list. **Preconditions:** signed in with `manageTrips`.

**Main flow**
1. From **Trips**, the coordinator sees trips grouped by status tab —
   **Planning · In progress · Completed · Cancelled** — each with a live count.
2. They create a trip (name, lead, start date, departure, from/to country) or
   open one. Each trip opens its own **coach board**.
3. The board adapts to the trip's phase: *Planning* = build the plan (itinerary +
   fleet, no live ops); *In progress* = the live cockpit (schedule, boarding, bus
   arrivals); *Completed / Cancelled* = a read-only record.

**Alternative / edge flows**
- **A1 — Itinerary drives the dates:** `totalDays` and the displayed date range
  are derived from the itinerary's own day span, not typed independently, so
  they can't drift out of sync when a day is added or removed.
- **A2 — Delete a trip:** removing a trip cascades to its coaches, delegates and
  itinerary, and its audit trail is purged with it.
- **A3 — Marking Completed** frees any still-`ASSIGNED` staff/delegates and
  records a one-line summary in the change history.

### UC-2 — Build the itinerary
**Actor:** Trip coordinator · **Trigger:** opens **Edit itinerary**.

**Main flow**
1. The coordinator adds stops per day: time, title, category (hotel / attraction
   / meal / factory / airport / transport / other), and optional location.
2. Stops are shown as the day's schedule; on the live board they render as a
   Now/Next timeline (see UC-5).
3. Stops can be edited, reordered by time, moved to another day, or deleted.

**Alternative / edge flows**
- **A1 — Minimum gap:** a new/edited stop must sit at least the trip's *buffer*
  (default 30 min) from another stop on the same day, or it's rejected with the
  conflicting stop named.
- **A2 — Required fields:** a stop with no title or no time is rejected (`400`).
- **A3 — 12-hour display:** times are shown as `2:30 PM` but stored as 24-hour
  `HH:MM`, so sorting and time maths stay correct.

### UC-3 — Size and staff the fleet
**Actor:** Trip coordinator · **Trigger:** uses the Capacity planner / **Add
coach** / a coach's **Switch staff** modal.

**Main flow**
1. On a *Planning* trip, the **Capacity planner** takes "how many delegates are
   coming?" and "seats per coach" and offers to generate the right number of
   coaches (named Coach N).
2. The coordinator can add a coach manually, set its **seat capacity**, name a
   **driver**, and assign up to **3 coach captains** (login accounts).
3. Capacity is per-coach and editable after creation.

**Alternative / edge flows**
- **A1 — Capacity below current load:** lowering a coach's capacity under its
  current head-count is allowed but the board flags it as *Over capacity*; no one
  is auto-removed.
- **A2 — Staff-only captains:** only `staff`/`admin` login accounts are offered
  as captains (an admin can already see every coach regardless).
- **A3 — Remove a coach:** its delegates fall back to Unassigned rather than
  disappearing.

### UC-4 — Assign and dynamically reassign delegates  ★ enhanced capability
**Actor:** Trip coordinator (or an in-scope captain with `manageTrips`)
· **Trigger:** drags a delegate card between coach columns, or uses a delegate's
**Move to coach** control.

**Main flow**
1. Delegates start in **Unassigned**. The coordinator **drags** a delegate card
   onto a coach — or opens the delegate and picks a coach — to assign them.
2. The move is applied optimistically; both the source and target coach
   head-counts recount immediately, with a subtle animation.
3. Status follows the coach: an `UNASSIGNED` delegate becomes `ASSIGNED`
   (expected, not yet checked in); a delegate who already has a real attendance
   status (`ARRIVED`/`LATE`/`MISSING`) keeps it through the move; releasing to no
   coach returns them to `UNASSIGNED`.
4. Every move is written to the change history (UC-8) and shows in the app-wide
   History Log as "moved from X to Y".

**Alternative / edge flows**
- **A1 — Coach is full (capacity guard):** dropping onto a coach already at its
  seat limit shakes the card and opens a **Cancel / Override** dialog rather than
  silently overfilling. This is enforced **server-side** too — a move onto a full
  coach returns `409 CAPACITY_FULL` unless `override` is set (see
  [api-documentation.md](api-documentation.md), reassign endpoint).
- **A2 — Concurrent move (optimistic locking):** if a second coordinator moved
  the same delegate since this screen last read them, the server rejects the
  stale write with `409 CONFLICT` and the board resyncs — no silent overwrite.
- **A3 — Cross-trip / unknown coach:** the target coach must exist **and** belong
  to this trip, or the move is rejected (`404`/`400`) — the root guard against a
  delegate ending up on a coach from another trip.
- **A4 — Wrong-coach delegate ("UFO"):** a delegate whose stored coach isn't on
  this trip is surfaced under Unassigned with a red "Wrong coach" flag and a
  board banner, so it can be reassigned or removed instead of silently vanishing.
- **A5 — Touch path:** on a touchscreen the coordinator taps the delegate →
  **Move to coach** dropdown instead of dragging (same result, same rules).

### UC-5 — Run the live day
**Actor:** Trip coordinator / any staff watching · **Trigger:** opens an
*In progress* trip's board.

**Main flow**
1. A live KPI row shows *Checked in · Late · Missing · Unassigned · Coaches*.
2. **Today's itinerary** leads with a **NOW** card (current stop) and a **NEXT**
   card with a live countdown; finished stops collapse behind a "N done" pill.
3. The coordinator marks a stop **On time / Delayed / Moved / Cancelled** or ticks
   it **done**; watchers see it within ~2 seconds.
4. Each coach shows a **bus-arrival** badge (tap cycles Not arrived → En route →
   Arrived) and a boarding count.
5. On any stop, **Attendance & history** opens a per-stop head-count where staff
   mark each delegate Present / Late / Missing, with a full before→after log.

**Alternative / edge flows**
- **A1 — Live check-in feed:** when Vimal's QR scanner or Jayden's manual
  check-in marks someone `ARRIVED`, the board's "checked in" count updates on the
  next 2-second poll — no manual refresh.
- **A2 — Day switcher:** the coordinator can preview any other day's schedule;
  "Now/Next" only appears for the trip's actual current day.
- **A3 — Auto-late:** an `ASSIGNED` delegate past the trip's Late-cutoff time is
  auto-flipped to `LATE` by a background job and appears in the KPI count.

### UC-6 — Coach-captain scoped view (access control)
**Actor:** Coach captain (non-admin) · **Trigger:** opens a trip they captain.

**Main flow**
1. The board shows **only the coach(es) this account captains**, plus a banner
   ("You're the captain of C1. Other coaches are hidden. (1/4)").
2. The **Unassigned** list is **also shown** — an unassigned delegate is nobody's
   exclusive territory, and a captain must be able to spot a stray delegate who
   turns up at their coach door. The Unassigned head-count in the KPI row is the
   real count, not zeroed.
3. Every other coach is hidden.

**Alternative / edge flows**
- **A1 — Read-only captain:** a captain without `manageTrips` gets read-only
  visibility (no drag, no move) into their coach and Unassigned.
- **A2 — Admin bypass:** an admin is never scoped — they always see every coach.
- **A3 — Multi-coach captain:** an account captaining more than one coach sees
  all of theirs.

### UC-7 — Reassign with no signal (offline)
**Actor:** Trip coordinator / captain on the ground · **Trigger:** reassigns a
delegate while the connection is down.

**Main flow**
1. The move can't reach the server, so the **intent is queued on the device** and
   the UI stands (the delegate shows a "Pending" chip; a sync pill shows
   "N changes waiting to sync").
2. On reconnect the queue **replays automatically** (or via "Sync now").
3. Reloading while still offline keeps the queued move visible — it doesn't snap
   back to the stale server state.

**Alternative / edge flows**
- **A1 — Idempotent replay:** the reassign assigns state (it doesn't append), so a
  replayed or double-tapped move can't double-apply.
- **A2 — Last-write-wins:** a deferred offline move applies on reconnect without
  the optimistic-lock check (that check is for live concurrent edits, not a queued
  intent).
- **A3 — Genuine rejection:** a real refusal (capacity/permission) surfaces in the
  sync pill's "changes the server rejected" list rather than retrying forever.

### UC-8 — Review the change history (audit)
**Actor:** Trip coordinator · **Trigger:** opens **History** on the board.

**Main flow**
1. A newest-first log lists every trip-management change — reassignments, coach
   edits, itinerary edits — with **who, when, and a before → after** of each
   changed value.
2. Per-stop attendance changes are additionally logged in the app-wide History
   Log.

**Alternative / edge flows**
- **A1 — Survives restart:** the audit is a real table (`trip_event_log`), not an
  in-memory list, so it persists across backend restarts.
- **A2 — Best-effort:** an audit-write failure never blocks or fails the actual
  mutation it describes.
