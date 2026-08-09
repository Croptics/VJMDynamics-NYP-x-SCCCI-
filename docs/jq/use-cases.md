# Use Cases — JQ (InsightMetrics)

Covers the MusterGo base platform that the rest of the team builds on: the
Admin Dashboard and analytics, authentication and sessions, accounts and the
permission system (RBAC), delegate management, the activity history with
rollback, multi-checkpoint attendance, emergency escalations, trip
announcements, data export, and the offline write queue.

## Actors
- **Admin** — full access. Manages accounts, permissions, trips and every
  destructive action. Bypasses individual permission checks by role.
- **Read-only Admin** — keeps every *view* permission, loses every *write*
  permission. For observers who must see everything and change nothing.
- **Staff** — signed-in operational user. Capabilities are exactly the
  permissions ticked on their account; nothing is implied by the role.
- **Coach captain** — Staff scoped to specific coaches; every roster, dashboard
  count and feed they see is filtered to those coaches.
- **Applicant** — someone who self-registers and cannot sign in until approved.
- **Entrance kiosk** — a passwordless, unattended scanner surface holding a
  narrowly-scoped token that grants only the two camera check-in endpoints.
- **System actors** — the 60-second trip-day sync tick, the rate limiter, the
  Cloudinary media store, and the SMTP escalation notifier.

## Cross-cutting design rules
- **Permissions are the single source of truth.** One file
  (`frontend/src/lib/permissions.js`) is imported by *both* the frontend and the
  backend, so adding a permission is a one-line change; enforcing it stays
  deliberately manual.
- **View permissions default open, action permissions default closed.** Adding
  a new page-level toggle can never silently lock out staff who could already
  reach that page; adding a new capability never silently grants it.
- **Nothing is trusted from the client.** Every write is re-checked server-side;
  hiding a button is a convenience, not a control.

---

### UC-1 — Sign in
**Actor:** Staff / Admin · **Trigger:** submits Staff ID + password.

**Main flow**
1. Credentials are verified against the stored hash.
2. A **new session** starts: the account's token version is bumped and embedded
   in the issued JWT.
3. The response carries the token plus the account's id, role, name, read-only
   flag and its **resolved permission set**, so the UI can render the correct
   navigation immediately without a second call.

**Alternative / edge flows**
- **A1 — Wrong ID or password:** `401 INVALID_CREDENTIALS`, deliberately
  identical for both cases so the response can't be used to enumerate accounts.
- **A2 — Awaiting approval:** `403 ACCOUNT_PENDING` — checked **after** the
  password verifies, so a wrong-password guess against a pending account still
  just looks like bad credentials rather than confirming the account exists.
- **A3 — Registration rejected:** `403 ACCOUNT_REJECTED`.
- **A4 — Brute force:** 10 attempts per 10 minutes per IP across login,
  register and reset; a successful login clears that IP's counter.
- **A5 — Signing in elsewhere:** the older browser's token no longer matches the
  stored token version, so it is force-logged-out by the session poll.
- **A6 — Legacy password hash:** transparently upgraded on a successful login.

### UC-2 — Stay signed in / be signed out
**Actor:** Any signed-in user · **Trigger:** the client polls the session
endpoint every 15 seconds.

**Main flow**
1. The poll returns the current identity and permission set — so a permission
   change by an admin takes effect within seconds, without a re-login.
2. The same call stamps `last_seen_at`, which powers the "active now" list on
   Staff Operations. It piggybacks on traffic that already exists rather than
   adding a second poll.

**Alternative / edge flows**
- **A1 — Token superseded or account deleted:** `401 UNAUTHENTICATED` and the
  client clears its own token.
- **A2 — Explicit logout:** `last_seen_at` is cleared immediately so the active
  list is accurate at once rather than after the 45-second window lapses.

### UC-3 — Self-register and be approved
**Actor:** Applicant, then Admin · **Trigger:** submits the sign-up form.

**Main flow**
1. Email, username and password are validated; the account is created as
   **`staff` / `pending`** — it exists but cannot sign in.
2. An admin reviews it under Account control and approves or rejects, singly or
   in bulk.
3. On approval the applicant can sign in with the default staff permission set.

**Alternative / edge flows**
- **A1 — Username or email already used:** `409 USERNAME_TAKEN` / `EMAIL_TAKEN`.
- **A2 — Admin creates the account directly:** that *is* the approval — it
  starts `approved`, never `pending`.
- **A3 — Bulk decisions:** approve-all / reject-all for a queue of applicants.

### UC-4 — Manage accounts and permissions
**Actor:** Admin (`manageAccounts`) · **Trigger:** opens Account control.

**Main flow**
1. The account list shows each account's role and permission chips, rendered
   automatically from the permission catalogue.
2. The admin creates, edits or deletes accounts, and ticks capabilities
   individually. Unknown or stale keys in a stored set are cleaned on read;
   keys added since the account was created fall back to their declared default.
3. **Role templates** provide an "apply template" quick-fill. A template is a
   *preset only* — it is never stored as a tag on the account, and matching is
   computed fresh, so editing or deleting a template can never silently change
   what an existing account can do.

**Alternative / edge flows**
- **A1 — Read-only Admin:** keeps every view permission and loses every write
  permission. Only offered when the role is Admin, since Staff accounts never
  bypass their stored checkboxes anyway.
- **A2 — Staff tries an admin-only capability:** rejected server-side with
  `403`, regardless of what the UI showed.
- **A3 — Editing your own profile:** any account can change its own name,
  username, email and password without `manageAccounts` — and can **never**
  touch its own role or permissions. Changing a password requires the current
  one. A fresh token is always returned, because changing a username would
  otherwise invalidate the token in hand.

### UC-5 — Read the live dashboard
**Actor:** Staff / Admin (`viewDashboard`) · **Trigger:** opens the dashboard.

**Main flow**
1. One call returns trip meta, KPI counts, per-coach status and the recent
   activity feed.
2. KPIs distinguish states that are easy to conflate: `trackable` (everyone on a
   coach roster) is the denominator for "missing right now", and `cancelled` is
   its own count because a cancelled delegate is forced back to `UNASSIGNED`.
3. Per-coach cards show boarded / missing / late / total, severity-ranked.

**Alternative / edge flows**
- **A1 — Coach captain:** every count, coach card and roster is filtered to
  their own coaches, at the data layer rather than in the UI.
- **A2 — Multi-trip:** all of it is trip-scoped; an unscoped call falls back to
  the base trip.
- **A3 — Current day drifts:** a 60-second tick recomputes `dayOf` from the real
  calendar date — unless staff hand-edited it, which sets a manual flag so a
  deliberate override is never overwritten. "Use automatic day" clears it.

### UC-6 — Manage the delegate roster
**Actor:** Staff (`manageDelegates`) · **Trigger:** adds, edits or removes a
delegate.

**Main flow**
1. Add, edit inline, assign a coach, mark VIP, upload a photo, or delete.
2. Every write is diffed field-by-field and recorded in the activity log with
   the actor's name and the exact `{field: {from, to}}` change set.
3. Coach capacity, KPIs and the mobile screens all update from the same write.

**Alternative / edge flows**
- **A1 — Cancelling a delegate:** deliberately **not** a sixth status value —
  the five-status set is assumed by roughly five other subsystems. Cancelling
  forces the status back to `UNASSIGNED`, clears the coach to free the seat, and
  sets a flag plus a reason so the UI can tell "not coming" apart from "not
  assigned yet". The reason is cleared if they are un-cancelled.
- **A2 — Ownership and locking:** a delegate records the account id that created
  them, so ownership can be enforced. Locking blocks **everyone including the
  creator** until explicitly unlocked — a deliberate finalize step, not just a
  shield against other staff. Rows with no recorded owner stay editable by any
  staff with the permission, rather than retroactively locking everyone out.
- **A3 — Photos:** set only through the dedicated upload route, never through
  the plain JSON PATCH, so a client cannot inject an arbitrary external URL and
  skip upload validation. Replacing or removing a photo destroys the old
  Cloudinary asset, or it would be orphaned forever.
- **A4 — Late cutoff:** a per-trip cutoff time flips still-unboarded delegates
  to `LATE`, so "late" is a trip policy rather than a hardcoded hour.

### UC-7 — Review history and roll back a mistake
**Actor:** Staff (`manageDelegates`) · **Trigger:** opens the History page.

**Main flow**
1. The feed lists what changed, who did it and when — persisted in a table, so
   it survives restarts and accumulates instead of being the last few entries.
2. A delegate-edit entry carries its field-level change set, so it can be
   **rolled back** individually.
3. Entries can be deleted individually or cleared wholesale.

**Alternative / edge flows**
- **A1 — Non-rollbackable entries:** add and remove entries carry no change set
  and are not offered as rollbackable, rather than failing when clicked.
- **A2 — Unknown actor:** writes with no actor render as "you" rather than a
  guessed name.
- **A3 — Trip scoping:** older entries with no known trip stay visible under
  "All trips" instead of being silently dropped.

### UC-8 — Track attendance across multiple checkpoints
**Actor:** Staff / kiosk · **Trigger:** scans a delegate at an itinerary stop.

**Main flow**
1. Checkpoints are read from the **existing itinerary**, not a parallel list, so
   the selector shows exactly the stops staff already see on the Trips board.
2. A check-in is recorded per (checkpoint, delegate). Re-scanning the same
   delegate at the same checkpoint **updates** that row rather than creating a
   duplicate.
3. A matrix view shows every delegate against every checkpoint, and each
   delegate has their own checkpoint timeline.

**Alternative / edge flows**
- **A1 — Same delegate, different checkpoints:** arrived at 10am and missing at
  4pm coexist. The live `delegates.status` stays authoritative for the dashboard;
  this is a parallel history that never overwrites it.
- **A2 — Approaching the next stop:** delegates who already arrived reset to
  `ASSIGNED` a configurable number of minutes before the next itinerary stop, so
  they can be re-scanned there.
- **A3 — Itinerary spacing:** a minimum gap between two same-day stops is
  enforced, and is deliberately a *separate* setting from the reset window —
  shrinking the reset window for testing must not shrink the itinerary gap.
- **A4 — Kiosk:** the unattended scanner can record check-ins with its scoped
  token and no login, and its writes resolve to a dedicated kiosk account so
  foreign keys onto the accounts table still hold.

### UC-9 — Raise an emergency escalation
**Actor:** Staff (`manageDelegates`) · **Trigger:** clicks "alert the office"
about a delegate.

**Main flow**
1. An escalation is created `open`, optionally tied to a trip and a delegate.
2. Every signed-in account polls for open escalations, so the banner is
   unmissable regardless of which page they are on.
3. Recipients are notified out-of-app by email.
4. It moves `open` → `acknowledged` → `resolved`, each step recording who and
   when.

**Alternative / edge flows**
- **A1 — Never automatic:** escalation is always a deliberate, staff-clicked
  action by design — an automatic alarm would train people to ignore it.
- **A2 — SMS / WhatsApp:** written and ready, but deliberately **stubbed**,
  because the provider charges per message. The calls log what would have been
  sent, so the flow is testable end-to-end at zero cost. This is documented
  rather than hidden.
- **A3 — Email not configured:** the notifier no-ops; the in-app banner, which
  is the primary channel, still works.
- **A4 — Acknowledge all:** a single action for a burst of related alerts.

### UC-10 — Post a trip announcement
**Actor:** Admin (`manageAnnouncements`) · **Trigger:** posts an update.

**Main flow**
1. Title, message, optional photos and videos, optionally tagged to the
   itinerary stop it is about.
2. Any signed-in account viewing that trip sees it; only **posting** is
   restricted, so information reaches everyone while authorship stays
   controlled.

**Alternative / edge flows**
- **A1 — Trip-wide notice:** the itinerary tag is left empty.
- **A2 — Legacy single-image posts:** older rows still render through the
  original single-image columns alongside the newer multi-asset array.
- **A3 — Delete:** removes the Cloudinary assets too, from the announcements
  folder only, so account and delegate photos can never be affected.

### UC-11 — Export the attendance report
**Actor:** Staff (`exportData`) · **Trigger:** opens the export dialog.

**Main flow**
1. Available columns and filters are fetched, the selection is made, and an
   Excel workbook is generated and downloaded.
2. An AI-assisted filter accepts a plain-English description ("VIPs still
   missing on coach 2") and turns it into the equivalent filter selection.

**Alternative / edge flows**
- **A1 — No AI engine available:** the manual filter UI is unaffected; only the
  natural-language shortcut is unavailable.
- **A2 — Empty result:** reported before a workbook is built.
- **A3 — Not permitted:** `exportData` defaults **closed** — downloading the
  full roster is a data-egress action, so it is opt-in per account.

### UC-12 — Keep working with no signal
**Actor:** Staff on a phone · **Trigger:** acts while offline.

**Main flow**
1. The write is queued locally in an outbox with a client event id, and the UI
   updates optimistically.
2. On reconnect the queue is replayed in order; the client event id makes the
   server side **idempotent**, so a replayed write cannot double-apply.
3. A sync indicator shows pending writes rather than hiding them.

**Alternative / edge flows**
- **A1 — App closed before sync:** the queue is persisted locally and replayed
  on next launch.
- **A2 — A queued write conflicts:** the server's state wins on replay and the
  optimistic row corrects itself.

### UC-13 — Manage uploaded media
**Actor:** Admin (`manageAccounts`) · **Trigger:** opens Settings → Image
storage.

**Main flow**
1. Lists assets in a specific Cloudinary folder with usage detail.
2. Selected assets can be deleted, or the folder purged.

**Alternative / edge flows**
- **A1 — Folder isolation:** each surface (delegates, accounts, announcements,
  the guide video) uses its **own** folder, so a purge in one can never delete
  another's images — the media manager is deliberately hardcoded to a single
  folder rather than accepting an arbitrary path.
