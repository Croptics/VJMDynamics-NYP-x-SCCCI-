# Database Schema — Jayden (Exception Logging, Critical Alerts & QR Fallback)

PostgreSQL. I own two tables from the High Level Design: **`exception_tickets`**
(§7) and **`check_in_logs`** (§6). Both are created by `initExceptions()` in
`backend/routes/exceptions.js`, which runs on every boot and is safe to re-run.

`check_in_logs` is **shared with the face/QR scanner work** — that module writes
the scan rows, mine writes the `MANUAL` rows. Both tables are created with
`CREATE TABLE IF NOT EXISTS` so whichever module boots first wins and the other
proceeds without a migration clash.

## Entity relationships

```
   accounts                trips                 coaches           delegates
      │                      │                      │                  │
      │ raised_by            │ trip_id              │ coach_id         │ delegate_id
      │ resolved_by          │                      │                  │
      ▼                      ▼                      ▼                  ▼
   ┌──────────────────────────────────────────────────────────────────────┐
   │                         exception_tickets                            │
   │  one open ticket per delegate · CRITICAL rows push to every device   │
   └──────────────────────────────────────────────────────────────────────┘

   accounts                trips                 coaches           delegates
      │ checked_in_by        │ trip_id              │ coach_id         │ delegate_id
      ▼                      ▼                      ▼                  ▼
   ┌──────────────────────────────────────────────────────────────────────┐
   │                          check_in_logs                               │
   │  append-only audit trail · method = QR | MANUAL · one row per event  │
   └──────────────────────────────────────────────────────────────────────┘
```

| From | To | Cardinality | On delete |
| --- | --- | --- | --- |
| `exception_tickets.trip_id` | `trips.id` | many‑to‑one | `CASCADE` — deleting a trip removes its tickets |
| `exception_tickets.delegate_id` | `delegates.id` | many‑to‑one, nullable | `SET NULL` — a ticket can outlive the delegate record |
| `exception_tickets.coach_id` | `coaches.id` | many‑to‑one, nullable | `SET NULL` |
| `exception_tickets.raised_by` | `accounts.id` | many‑to‑one | `RESTRICT` — an account that raised tickets cannot be deleted out from under the audit trail |
| `exception_tickets.resolved_by` | `accounts.id` | many‑to‑one, nullable | `SET NULL` |
| `check_in_logs.delegate_id` | `delegates.id` | many‑to‑one | `CASCADE` |
| `check_in_logs.trip_id` | `trips.id` | many‑to‑one | `CASCADE` |
| `check_in_logs.coach_id` | `coaches.id` | many‑to‑one, nullable | `SET NULL` |
| `check_in_logs.checked_in_by` | `accounts.id` | many‑to‑one | `RESTRICT` |

## Enum types

`CREATE TYPE` has no `IF NOT EXISTS`, so each is created inside a guarded block
that ignores the "already exists" case on re-boot.

| Type | Values | Used by |
| --- | --- | --- |
| `exception_type` | `MISSING_PERSON`, `LOST_BADGE`, `FACE_MATCH_FAILED`, `DEAD_PHONE`, `VIP_REQUEST`, `OTHER` | `exception_tickets.type` |
| `exception_priority` | `CRITICAL`, `NORMAL`, `LOW` | `exception_tickets.priority` |
| `exception_status` | `OPEN`, `RESOLVED` | `exception_tickets.status` |
| `checkin_method` | `QR`, `MANUAL` | `check_in_logs.method` |

---

## Table: `exception_tickets`

```sql
CREATE TABLE IF NOT EXISTS exception_tickets (
  id                VARCHAR(64) PRIMARY KEY,
  trip_id           VARCHAR(64) NOT NULL REFERENCES trips(id)     ON DELETE CASCADE,
  delegate_id       VARCHAR(64)          REFERENCES delegates(id) ON DELETE SET NULL,
  coach_id          VARCHAR(64)          REFERENCES coaches(id)   ON DELETE SET NULL,
  type              exception_type     NOT NULL,
  priority          exception_priority NOT NULL DEFAULT 'NORMAL',
  status            exception_status   NOT NULL DEFAULT 'OPEN',
  note              TEXT,
  raised_by         VARCHAR(64) NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  resolved_by       VARCHAR(64)          REFERENCES accounts(id) ON DELETE SET NULL,
  client_event_id   VARCHAR(64) NOT NULL UNIQUE,
  is_offline_origin BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at       TIMESTAMPTZ,
  CONSTRAINT chk_resolved CHECK (
    (status = 'RESOLVED' AND resolved_at IS NOT NULL)
    OR (status = 'OPEN'  AND resolved_at IS NULL)
  )
);

-- added later, additively, so a deployed database picks them up on next boot
ALTER TABLE exception_tickets ADD COLUMN IF NOT EXISTS type_other VARCHAR(20);
ALTER TABLE exception_tickets ADD COLUMN IF NOT EXISTS is_auto    BOOLEAN NOT NULL DEFAULT FALSE;
```

| Column | Type | Key | Null | Description |
| --- | --- | --- | --- | --- |
| `id` | `VARCHAR(64)` | **PK** | no | UUID generated in application code |
| `trip_id` | `VARCHAR(64)` | **FK** → `trips.id` | no | Owning trip |
| `delegate_id` | `VARCHAR(64)` | **FK** → `delegates.id` | yes | Who it concerns; null when the issue is not about one person |
| `coach_id` | `VARCHAR(64)` | **FK** → `coaches.id` | yes | Derived from the delegate when not supplied |
| `type` | `exception_type` | | no | Issue category |
| `type_other` | `VARCHAR(20)` | | yes | Free-text label, only when `type = 'OTHER'` |
| `priority` | `exception_priority` | | no | Default `NORMAL`; `CRITICAL` pushes to every device |
| `status` | `exception_status` | | no | Default `OPEN` |
| `note` | `TEXT` | | yes | Free-text detail |
| `raised_by` | `VARCHAR(64)` | **FK** → `accounts.id` | no | Who raised it |
| `resolved_by` | `VARCHAR(64)` | **FK** → `accounts.id` | yes | Who closed it |
| `client_event_id` | `VARCHAR(64)` | **UNIQUE** | no | Idempotency key for offline retries |
| `is_offline_origin` | `BOOLEAN` | | no | Raised while the device was offline |
| `is_auto` | `BOOLEAN` | | no | Auto-raised from a delegate's live status rather than by hand |
| `created_at` | `TIMESTAMPTZ` | | no | Defaults to `now()` |
| `resolved_at` | `TIMESTAMPTZ` | | yes | Set when resolved |

### Indexes

```sql
CREATE INDEX IF NOT EXISTS idx_exceptions_trip ON exception_tickets(trip_id, status);
CREATE INDEX IF NOT EXISTS idx_exceptions_pri  ON exception_tickets(trip_id, priority)
  WHERE status = 'OPEN';
```

- `idx_exceptions_trip` serves the inbox's main read, which is always scoped to
  a trip and usually to a status.
- `idx_exceptions_pri` is **partial** — restricted to `status = 'OPEN'` — because
  the only priority query that matters is "unresolved criticals on this trip",
  which drives the sidebar badge and the alert banner. Resolved rows would be
  dead weight in that index.

### Constraints and why they exist

- **`chk_resolved`** keeps status and timestamp honest at the database level: a
  `RESOLVED` row must carry a `resolved_at`, and an `OPEN` row must not. Without
  it, a partial update could produce a ticket that claims to be resolved with no
  record of when — and the average-resolve-time tile would silently skew.
- **`client_event_id UNIQUE`** is what makes creation idempotent. A submission
  replayed after a dropped connection collides here and returns the original
  ticket rather than writing a duplicate.
- **`raised_by … ON DELETE RESTRICT`** protects the audit trail. Tickets are
  evidence of what happened on a trip; deleting the account that raised one must
  not erase who raised it.

### Design deviations from the HLD (deliberate)

1. **`VARCHAR(64)` ids instead of `UUID`.** The HLD types ids as `UUID`, but the
   live base schema types `trips` / `coaches` / `delegates` / `accounts` ids as
   `VARCHAR(64)` (`"t-1"`, `"c1"`, `"d-1"`). A foreign key must match its
   parent's type, so these tables follow the live schema. Values are still
   generated with `randomUUID()`.
2. **`raised_by` / `resolved_by` reference `accounts`, not `users`.** The HLD's
   `users` table does not exist; the live base uses `accounts`.
3. **Real-time push is not in the HLD.** The "alert all staff devices"
   requirement needed a transport, so the module adds Server-Sent Events —
   ordinary HTTP, no new dependency, and it survives restrictive proxies.
4. **`type_other` and `is_auto` were added with `ALTER TABLE … IF NOT EXISTS`**
   rather than a migration file, so an already-deployed database picks them up
   on its next boot. `type_other` is capped at 20 characters in the column as
   well as in the UI and the API — the client is never trusted alone.

---

## Table: `check_in_logs`

Append-only audit trail of every attendance event. Shared with the scanner
module: it writes `QR` rows from scans, this module writes `MANUAL` rows from
overrides and `QR` rows from badge check-ins.

```sql
CREATE TABLE IF NOT EXISTS check_in_logs (
  id                VARCHAR(64) PRIMARY KEY,
  delegate_id       VARCHAR(64) NOT NULL REFERENCES delegates(id) ON DELETE CASCADE,
  trip_id           VARCHAR(64) NOT NULL REFERENCES trips(id)     ON DELETE CASCADE,
  coach_id          VARCHAR(64)          REFERENCES coaches(id)   ON DELETE SET NULL,
  method            checkin_method NOT NULL,
  checked_in_by     VARCHAR(64) NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  client_event_id   VARCHAR(64) NOT NULL UNIQUE,
  is_offline_origin BOOLEAN     NOT NULL DEFAULT FALSE,
  client_ts         TIMESTAMPTZ NOT NULL,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE check_in_logs ADD COLUMN IF NOT EXISTS prev_status VARCHAR(16);
```

| Column | Type | Key | Null | Description |
| --- | --- | --- | --- | --- |
| `id` | `VARCHAR(64)` | **PK** | no | UUID from application code |
| `delegate_id` | `VARCHAR(64)` | **FK** → `delegates.id` | no | Who was checked in |
| `trip_id` | `VARCHAR(64)` | **FK** → `trips.id` | no | Owning trip |
| `coach_id` | `VARCHAR(64)` | **FK** → `coaches.id` | yes | Coach at the time |
| `method` | `checkin_method` | | no | `QR` or `MANUAL` |
| `checked_in_by` | `VARCHAR(64)` | **FK** → `accounts.id` | no | Which staff account did it |
| `client_event_id` | `VARCHAR(64)` | **UNIQUE** | no | Idempotency key |
| `is_offline_origin` | `BOOLEAN` | | no | Recorded while offline |
| `prev_status` | `VARCHAR(16)` | | yes | The delegate's status *before* a manual override, so it can be undone |
| `client_ts` | `TIMESTAMPTZ` | | no | When it happened on the device |
| `synced_at` | `TIMESTAMPTZ` | | no | When the server stored it |

### Why two timestamps

`client_ts` and `synced_at` differ whenever a check-in is made offline and
replayed later. Attendance has to be reported at the time it actually happened,
but sync order still needs to be traceable — keeping both means a delayed
upload cannot rewrite when a delegate boarded.

### Why `prev_status`

A manual override is the one attendance action a human takes on a hunch, so it
is the one most likely to need reversing. Storing the delegate's previous status
on the log row means undo restores exactly what was there — rather than guessing
a sensible-looking default and quietly losing whether they had been `MISSING`,
`LATE` or `ASSIGNED`.

### Note on delegate status values

`prev_status` holds values from the delegate status model:
`UNASSIGNED → ASSIGNED → ARRIVED / LATE / MISSING`. The pre-migration value
`PRESENT` is still written by some check-in paths and is treated throughout as a
legacy alias for `ARRIVED` — anything asking "is this delegate checked in?"
accepts both. That is why the column is a plain `VARCHAR(16)` rather than an
enum: it has to tolerate both vocabularies during the transition without a
failed insert.
