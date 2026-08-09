# Use Cases — Vimal (FaceCheck-Pro)

Covers the biometric check-in feature (face + voice), delegate self-enrolment,
the staff enrolment-readiness view, the enrolment **email notification** to
delegates, the **manual** check-in fallback, and the **mobile staff UI** those
screens live in.

## Actors
- **Delegate** — a traveller on the trip. Enrols their own face/voice from a
  phone via a personal emailed link; no account, no login.
- **On-ground staff** — signed-in staff working a coach door on a phone. Runs
  Face / QR / Manual check-in. Needs the `manageScanner` permission for face
  scanning and `manageExceptions` for manual override.
- **Coach captain** — on-ground staff scoped to their own coach(es); sees and
  acts on only those delegates.
- **Secretariat organiser / admin** — sends enrolment invites (single or bulk)
  and monitors enrolment coverage before the trip.
- **System actors** — the on-device face engine (`@vladmandic/human`), the Web
  Audio voiceprint capture, and the SMTP mailer.

## Design constraint that shapes every flow: Zero-Image / PDPA
No image and no audio ever leaves the device or reaches the server. The client
derives an anonymous numeric embedding, and only that embedding — inside a
`face:v3:…` / `voice:v2:…` token — is transmitted and stored. A full database
leak therefore exposes no biometric imagery. Consent is explicit, and erasure
is self-service.

---

### UC-1 — Invite delegates to enrol (email notification)
**Actor:** Secretariat organiser · **Trigger:** presses **Send invites** on the
enrolment page, or invites one delegate from their row.
**Preconditions:** signed in; SMTP configured in `backend/.env`.

**Main flow**
1. Organiser opens the enrolment view and sees coverage ("34 of 42 enrolled").
2. They send to everyone not yet enrolled (`POST /api/enroll/invite-all`) or to
   one delegate (`POST /api/enroll/invite`).
3. Each delegate receives a branded email explaining what to do, why it is safe
   (Zero-Image / PDPA), and a **Start enrolment** button carrying a *signed,
   expiring* token personal to them (14 days).
4. The response reports how many were sent, previewed, failed, and who was
   skipped for having no email address.

**Alternative / edge flows**
- **A1 — Preview before sending:** `GET /api/enroll/invite/preview` renders the
  exact message without transmitting anything.
- **A2 — SMTP not configured, or `MAIL_DRY_RUN=true`:** the mailer fails
  **closed** — nothing is transmitted, and the response reports `dryRun: true`.
  A misconfigured dev box can never accidentally mail real delegates.
- **A3 — Missing email address:** staff can supply one in the same action; it is
  saved onto the delegate before sending. Bulk sends list everyone skipped.
- **A4 — Unreachable link:** if `PUBLIC_APP_URL` is a localhost/LAN/bare-IP
  address, the invite link would be dead in the delegate's inbox. The API
  returns a `linkWarning` (and the server warns at boot) so this is caught
  *before* 40 invites go out.
- **A5 — One address bounces:** sends run sequentially and never throw; the
  failure is reported per recipient and the run continues.
- **A6 — Coach-captain scoping:** a captain's bulk send only ever reaches their
  own coach's delegates; a trip filter keeps it to the trip on screen.

### UC-2 — Delegate enrols their face and voice
**Actor:** Delegate · **Trigger:** taps the button in the invite email.
**Preconditions:** a valid, unexpired invite token; a phone with a camera.

**Main flow**
1. The link opens the public `/enroll` page, already identified to them by the
   signed token (`GET /api/enroll/lookup?t=…`).
2. They read the plain-English privacy explanation and give explicit consent.
3. The camera opens. The on-device engine detects the face, checks quality,
   **liveness** and **anti-spoof**, and only then allows capture.
4. Several samples are averaged into one stable template; the raw pixel buffer
   is zeroed the instant the embedding is derived.
5. Optionally they record a ~2.5s voice passphrase, captured as a 64-band FFT
   voiceprint (frequency magnitudes only — audio is never recorded to a file).
6. `POST /api/enroll` stores only the embedding(s). They see confirmation of
   what is now enrolled (face, voice, or both).

**Alternative / edge flows**
- **A1 — Expired link:** `410 INVITE_EXPIRED` with "ask staff to send a new one",
  rather than a dead page.
- **A2 — Printed photo or a phone screen held up:** refused by the anti-spoof
  gate — "Use a live face — a photo or screen won't pass."
- **A3 — Too dark / too far / no face:** capture stays disabled with a specific
  hint; nothing is submitted.
- **A4 — Someone else steps in mid-capture:** the samples disagree
  (`sampleConsistency` drops), so the attempt is discarded rather than storing a
  smeared average of two people.
- **A5 — Silent microphone:** a near-silent recording returns no token, so
  silence is never enrolled as a voiceprint.
- **A6 — No microphone / unsupported browser:** falls back to a typed passphrase
  (`voice:v1`), matched by exact hash. This is honestly a *shared secret*, not a
  biometric, and is documented as such.
- **A7 — Self-test:** `POST /api/enroll/verify` scores a fresh sample against
  what is stored and reports the similarity **without** touching attendance —
  so a delegate confirms "the scanner will recognise me" at enrolment time
  instead of finding out at the coach door.

### UC-3 — Check a delegate in by face
**Actor:** On-ground staff · **Trigger:** points the phone at a delegate on the
mobile Face scanner (`/mobile/scan/face`).
**Preconditions:** signed in with `manageScanner` (or the kiosk token); the
delegate has enrolled.

**Main flow**
1. Staff pick the coach they are mustering ("CHECKING IN TO").
2. The camera runs the same on-device engine; a token is produced locally.
3. `POST /api/attendance/scan` scores that token against every **consented,
   enrolled** delegate on trips this account can see, using cosine similarity.
4. The best score above threshold wins. The delegate flips to boarded, and the
   write goes through the shared data layer, so the dashboard, the Missing page
   and the coach boards all update live.
5. The check-in is written to the History Log as "X checked in (Face)" and to
   the trip's durable audit trail. Round-trip time is returned and compared
   against the 1s target.

**Alternative / edge flows**
- **A1 — Face not enrolled / unknown person:** `404 SCAN_FAILED`. The matcher
  refuses rather than picking the closest missing delegate — the specific
  regression this engine was built to fix.
- **A2 — Ambiguous match:** two templates fitting equally well are rejected, not
  guessed (margin guard).
- **A3 — Right person, wrong coach:** `409 COACH_MISMATCH` names both coaches so
  staff don't rescan pointlessly.
- **A4 — Already boarded:** `409 ALREADY_BOARDED`. Statuses that merely mean "not
  yet boarded" (ASSIGNED / LATE / MISSING / UNASSIGNED) are all valid targets.
- **A5 — Delegate belongs to another trip:** filtered out of the pool, so they
  read as "not recognised" — deliberately indistinguishable from a stranger, so
  the response can't be used to confirm they exist elsewhere.
- **A6 — Consent revoked:** excluded from matching entirely; staff use QR or
  manual instead.
- **A7 — Unusable frame:** `400 INVALID_SCAN` — "try again in better light".

### UC-4 — Check a delegate in by voice
**Actor:** On-ground staff · **Trigger:** uses voice mode when a face scan can't
work — a dark coach bay, a delegate wearing a mask, glare on the camera.

**Main flow**
1. The delegate speaks the passphrase; the client captures the FFT voiceprint.
2. `POST /api/attendance/scan` compares it against enrolled voiceprints with a
   looser threshold than face (a speaker's spectrum varies more between
   utterances than a face does between frames).
3. On a match the delegate boards exactly as in UC-3, logged as "(Voice)".

**Alternative / edge flows**
- **A1 — Enrolled with the typed-passphrase fallback:** matched by exact hash.
- **A2 — Not recognised:** `404` with a voice-specific message — "has this
  delegate enrolled a voiceprint?"

### UC-5 — Manual check-in when no scan can work
**Actor:** On-ground staff (`manageExceptions`) · **Trigger:** opens
`/mobile/scan/manual` — no badge, flat phone battery, delegate never enrolled.

**Main flow**
1. The roster for the selected coach appears as a touch-first list on the phone.
2. Staff search or scroll, tap the delegate, and confirm the override.
3. The status flips immediately (optimistic), and the check-in is logged with
   the staff member as the actor, so a manual override is always attributable.

**Alternative / edge flows**
- **A1 — Offline / no signal:** the write is queued in the offline outbox and
  replayed on reconnect; the row shows as pending meanwhile.
- **A2 — Mistap:** an undo path reverses the check-in.
- **A3 — Coach-captain scoping:** the roster only ever contains their own coach.

### UC-6 — Track enrolment readiness before the trip
**Actor:** Secretariat organiser / coach captain · **Trigger:** opens the mobile
enrolment page.

**Main flow**
1. `GET /api/enroll/stats` shows coverage (total / face / voice / enrolled).
2. `GET /api/enroll/lookup` lists every delegate grouped by coach with their
   face and voice status, so staff can chase whoever is missing.
3. Tapping a delegate opens the enrolment flow pre-identified to them — useful
   for enrolling someone at the desk.

**Alternative / edge flows**
- **A1 — Anonymous request:** the lookup route is deliberately unauthenticated
  so the emailed link works with no account — but email addresses are returned
  **only** when a staff token is present, so a public request can't harvest the
  roster's contact details.
- **A2 — Coach captain:** sees only their own coach's delegates, signed in.

### UC-7 — Withdraw consent (PDPA right to erasure)
**Actor:** Delegate · **Trigger:** taps "erase my data" on the enrolment page.

**Main flow**
1. `POST /api/enroll/revoke` purges the stored face and voice vectors outright
   and marks consent `REVOKED`.
2. They can no longer be biometrically matched; staff check them in by QR or
   manually instead. The consent decision is kept as an auditable history entry.

**Alternative / edge flows**
- **A1 — Re-enrol later:** granting consent again with a fresh sample restores
  matching; the history shows both events.

### UC-8 — Reset a headcount between legs
**Actor:** On-ground staff · **Trigger:** the coach is moving to the next venue.

**Main flow**
1. `POST /api/attendance/reset-coach` flips every boarded delegate on one coach
   back to "expected, not yet boarded" in a single tap.
2. `POST /api/attendance/reset` does the same for one delegate who stepped off
   at a rest stop.
3. The auditable check-in history is **kept** — a reset is an operational status
   flip, not a data purge.

**Alternative / edge flows**
- **A1 — Nobody boarded yet:** `409 NOTHING_TO_RESET` instead of a silent no-op.

### UC-9 — Use the app one-handed at a coach door (mobile UI)
**Actor:** On-ground staff · **Trigger:** signs in on a phone.

**Main flow**
1. A bottom tab bar (Home · Ops · QR · Face · Me) puts every check-in path one
   thumb-tap away; the three scanner modes are separate routes so a tap lands
   directly in the right mode.
2. Each screen is single-column and touch-first, sized for a phone held at
   waist height in daylight, rather than a desktop panel scaled down.

**Alternative / edge flows**
- **A1 — Trip switcher:** the coach picker, roster and enrolment lists all follow
  the mobile trip selection instead of pooling every trip together.
- **A2 — Offline:** writes queue and sync status is shown rather than hidden.
