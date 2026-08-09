# Use Cases — Jayden (Exception Logging, Critical Alerts & QR Fallback)

Covers Screen 5 (Exception Inbox), Screen 10 (Log Exception), the mobile
exception inbox (the **Exceptions** segment of the Ops screen), and the manual
attendance override that acts as the fallback when a scan cannot be completed.

## Actors
- **Secretariat organiser** — SCCCI staff with the `manageExceptions`
  permission; raises, escalates, resolves and deletes tickets, and performs
  manual attendance overrides (desktop or mobile).
- **On-ground staff** — signed-in staff working a coach. Any signed-in account
  can *view* the inbox and receive critical alerts; acting on a ticket needs
  `manageExceptions`, so a viewer sees the list read-only rather than buttons
  that would 403.
- **Any signed-in staff device** — a passive actor for critical alerts: every
  connected device holds an SSE stream and is pushed to when a critical ticket
  is raised.
- **System actors** — the QR scanner (delegate badge check-in) and
  `db/exceptionSync.js` (JQ's bridge, which auto-raises a ticket when a
  delegate's live status turns MISSING).

---

### UC-1 — Raise an exception on the ground
**Actor:** Organiser / on-ground staff · **Trigger:** presses **Log exception**
on the inbox, or the Issues form on mobile.
**Preconditions:** signed in with `manageExceptions`; a trip is selected.

**Main flow**
1. Staff pick an issue type from the tile grid — *Missing person, Lost badge,
   Face match failed, Dead phone, VIP request, Others*.
2. They optionally attach the delegate and coach it concerns, and a free-text
   note.
3. They set a priority — **Normal** or **Low** — or flip the **Critical**
   switch, which overrides the choice.
4. On submit the ticket is written and appears immediately in every open inbox
   (desktop and mobile) over the live stream.

**Alternative / edge flows**
- **A1 — "Others" chosen:** a short free-text label is revealed and required.
  It is capped at 20 characters in the UI, in the API and in the column width,
  so the client is never trusted alone. The ticket then displays that label
  instead of the generic word "Other".
- **A2 — Marked critical:** the ticket is broadcast as `exception:critical`
  rather than `exception:created`, which is what makes every connected staff
  device raise the red banner rather than just refresh its list.
- **A3 — The delegate already has an open ticket:** rejected with
  `DELEGATE_ALREADY_HAS_OPEN_TICKET`, so one missing person does not accumulate
  a pile of duplicate tickets from several staff noticing at once.
- **A4 — Offline / flaky signal:** creation carries a `clientEventId`; a retry
  of the same submission is recognised and returns the original ticket instead
  of writing a second one.
- **A5 — Missing or unknown issue type:** rejected with `TYPE_REQUIRED` /
  `INVALID_TYPE` before anything is written.

### UC-2 — Triage the inbox
**Actor:** Organiser · **Trigger:** opens the Exception Inbox.

**Main flow**
1. Summary tiles show the shape of the situation at a glance — open count,
   critical open, average resolve time, oldest open ticket, and a breakdown of
   open tickets by issue type.
2. Staff filter with the **All / Critical / Open / Resolved** tabs and narrow
   further by typing a delegate, coach, issue or note into the search box.
3. Each open row shows how long it has been sitting, tinted amber past 15
   minutes and red past 30, so the queue self-sorts by urgency visually.
4. Resolved rows show who closed them, when, and how long they took.

**Alternative / edge flows**
- **A1 — Filtering is client-side:** the trip's tickets are fetched once and
  sliced in the browser, so tabs switch without a spinner, search filters as
  you type, and the tiles stay computed over *every* ticket rather than only
  the tab in view.
- **A2 — A ticket changes on another device:** the live stream refreshes the
  list in place; the summary tiles and tab counts follow.
- **A3 — Search matches nothing:** an explicit "No tickets match …" state with
  a Clear action, distinct from the "All clear" empty state, so staff can tell
  "nothing here" apart from "nothing matches".
- **A4 — Backend unreachable:** the table shows the error with a Retry button
  rather than an empty list that would read as "no exceptions".

### UC-3 — Escalate a ticket that has got worse
**Actor:** Organiser · **Trigger:** presses **Escalate** on an open,
non-critical ticket.

**Main flow**
1. The ticket's priority is raised to CRITICAL.
2. It is broadcast to every connected device, exactly as if it had been raised
   critical in the first place.
3. The Escalate button disappears from that row — there is nowhere further to
   escalate to.

**Alternative / edge flows**
- **A1 — Already critical:** the action is not offered.
- **A2 — Ticket was resolved by someone else first:** the update is rejected
  with `CONFLICT` (only an OPEN ticket can be modified) and the list refreshes.

### UC-4 — Resolve tickets
**Actor:** Organiser · **Trigger:** presses **Resolve** on a row, **Resolve
now** on the critical banner, or selects several rows and presses **Resolve N**.

**Main flow**
1. The ticket is stamped RESOLVED with the resolving account and timestamp.
2. The row moves to the Resolved tab and now reports who closed it and how long
   it took.
3. Bulk resolve applies the same operation to each selected ticket in turn and
   reports a combined outcome ("3 resolved · 1 already done").

**Alternative / edge flows**
- **A1 — Someone else resolved it first:** the server rejects the second
  attempt with `ALREADY_RESOLVED` rather than silently overwriting who resolved
  it; the UI reports "That ticket was already resolved".
- **A2 — Bulk selection goes stale:** selections are dropped on refresh for
  tickets that are no longer open, so a bulk action cannot act on rows the user
  can no longer see.
- **A3 — Partial failure in a bulk run:** each ticket is attempted
  independently and the summary distinguishes resolved / already done / failed.

### UC-5 — Manual attendance override (the QR fallback)
**Actor:** Organiser · **Trigger:** presses **Override** on a ticket that has a
delegate attached.
**Preconditions:** `manageExceptions`; the delegate is not already checked in.

**Main flow**
1. Staff confirm a delegate is physically present who cannot be scanned — a
   lost badge, a failed face match, a dead phone.
2. The delegate is marked as checked in, a `MANUAL` row is written to
   `check_in_logs` recording who did it, and the previous status is stored so
   the action can be undone.
3. The override is broadcast so the head-count on every other screen agrees.
4. The Override button is replaced by a **Present** marker on that row.

**Why this is separate from Resolve.** Resolving a ticket closes an
administrative task; it does not — and must not — mark attendance. A VIP
request or a lost-luggage ticket has no attendance meaning at all, so folding
the two together would corrupt the head-count. Equally, without Override there
would be no way to check in a delegate whose badge is lost, since every other
route into `check_in_logs` requires a successful scan.

**Alternative / edge flows**
- **A1 — Delegate already checked in:** the Override action is not rendered at
  all; a **Present** marker takes its place. This is deliberate — the earlier
  version left the button up permanently, and each further click wrote another
  `MANUAL` row for a delegate who was already boarded.
- **A2 — Two status vocabularies:** "already checked in" accepts both `ARRIVED`
  (the five-status model) and the legacy `PRESENT` alias, so a delegate last
  touched by either code path is recognised.
- **A3 — Ticket has no delegate attached:** Override is not offered, since
  there is nobody to mark present.
- **A4 — Mistaken override:** an undo route restores the delegate's previous
  status from the stored `prev_status` rather than guessing.
- **A5 — Offline:** the override is queued in the browser's outbox and replayed
  when the connection returns; the `clientEventId` guarantees it applies once.

### UC-6 — Receive a critical alert
**Actor:** Any signed-in staff device · **Trigger:** a critical ticket is raised
or escalated anywhere on the trip.

**Main flow**
1. Every device holds an open Server-Sent Events stream to the server.
2. On a critical ticket the server pushes `exception:critical` to all of them.
3. Each device raises the red banner naming the issue, delegate, coach and time
   raised, with a **Resolve now** action for staff who can act.
4. The sidebar's exception badge count updates on every device.

**Alternative / edge flows**
- **A1 — Connection drops:** the header's live indicator switches from **Live**
  to **Connecting…** so staff know the screen may be stale rather than quiet.
  The browser reconnects automatically and the list reloads.
- **A2 — Restrictive network:** SSE was chosen over WebSockets precisely
  because it is ordinary HTTP and survives proxies that block upgrades. It
  needs no extra dependency.
- **A3 — Token cannot be sent as a header:** `EventSource` cannot set an
  `Authorization` header, so the stream accepts the token as a query parameter
  and authenticates it the same way.

### UC-7 — Work the inbox from a phone
**Actor:** On-ground staff · **Trigger:** opens **Ops → Exceptions** on mobile.

**Main flow**
1. The mobile inbox opens on the **Open** tab, since that is what needs action
   in the field.
2. Compact tiles show open, critical and oldest-open; the same tabs, search,
   ageing and resolved-by information are present as on desktop.
3. Each ticket card carries the same Resolve / Escalate / Override / Delete
   actions, sized for touch.
4. **Log exception** opens the same creation form, which becomes a bottom sheet
   at phone width.

**Alternative / edge flows**
- **A1 — Placement:** Exceptions sits between **Delegates** and **Trips** on the
  Ops screen because the on-ground sequence is *who is missing → raise or clear
  the issue → back to the coach*.
- **A2 — Viewer without `manageExceptions`:** the cards render without action
  buttons instead of showing controls that would fail.

### UC-8 — Check a delegate in by QR badge
**Actor:** On-ground staff · **Trigger:** scans a delegate badge in the QR
check-in screen.

**Main flow**
1. The scanner decodes the badge from the camera feed.
2. A valid badge is registered as a check-in: the delegate is marked as
   checked in and a `QR` row is written to `check_in_logs`.
3. The result card confirms the delegate's name; the head-count updates
   everywhere.

**Alternative / edge flows**
- **A1 — Two badge formats:** both the self-describing MusterGo JSON badge and
  the boarding passes generated on the Documents screen (which encode only an
  opaque `MG-XXXXXXXX` code) are accepted. The opaque code carries no delegate
  information, so it is resolved server-side rather than parsed in the browser.
- **A2 — Anything else scanned:** rejected as "QR code invalid", with the
  decoded text shown so a mis-scan can be diagnosed.
- **A3 — Same badge re-scanned:** a cooldown ignores the repeat, and the server
  reports the delegate as already boarded rather than double-counting.
- **A4 — No camera / camera denied:** the panel falls back to manual entry of
  the badge contents, which routes through exactly the same validation.
- **A5 — Unknown code:** rejected with "Badge not recognised on this trip".

### UC-9 — Delete a ticket raised in error
**Actor:** Organiser · **Trigger:** presses **Delete**.

**Main flow**
1. The ticket is removed and the deletion broadcast, so it disappears from
   every open inbox.

**Alternative / edge flows**
- **A1 — Already deleted elsewhere:** rejected with `NOT_FOUND`.
- **A2 — Distinct from Resolve:** delete is for tickets that should never have
  existed; resolve is the record that something real was dealt with. Resolved
  tickets are kept deliberately — they are what the average-resolve-time tile
  and the CSV export are computed from.

### UC-10 — Export the inbox for reporting
**Actor:** Organiser · **Trigger:** presses **Export**.

**Main flow**
1. The tickets currently in view — after tab and search filtering — are written
   to a CSV named for the active tab and today's date.
2. The file carries priority, issue, delegate, coach, note, status, raised
   at/by, resolved at/by, and an age column.

**Alternative / edge flows**
- **A1 — Free text containing commas, quotes or newlines:** quoted and escaped,
  so a note can never shift later columns into the wrong header.
- **A2 — Chinese delegate names:** the file is written with a UTF-8 BOM,
  without which Excel decodes it as the local ANSI codepage and mangles them.
- **A3 — Nothing in view:** the export is skipped with a message rather than
  downloading an empty file.
- **A4 — Age column:** a resolved ticket exports how long it *took*; an open
  one exports how long it has been *waiting*.
