# Database Schema — Vimal (FaceCheck-Pro)

Biometric check-in and delegate self-enrolment. PostgreSQL, accessed through
JQ's shared `pg` connection helpers (`backend/db/connection.js`).

My feature is **additive**. It owns exactly one table — `delegate_biometrics` —
and never alters the base tables owned by teammates; those are shown here only
to make the relationships clear. All my DDL is created lazily and idempotently
by `ensureBiometrics()` in `backend/routes/facescan.js` (`CREATE TABLE IF NOT
EXISTS` / `ADD COLUMN IF NOT EXISTS`), so it is safe to run on every request and
in any module order.

## Entity-relationship diagram

```mermaid
erDiagram
    trips ||--o{ delegates : "has (trip_id → uuid_id)"
    coaches ||--o{ delegates : "seats (delegates.coachId → coaches.id)"
    delegates ||--o| delegate_biometrics : "★ enrols one template set (delegate_id)"
    delegates ||--o{ check_in_logs : "boarded via (delegate_id)"
    delegates ||--o{ activity_log : "logged in (meta.delegateId)"
    accounts ||--o{ check_in_logs : "performed by (checked_in_by)"

    trips {
        varchar id PK "e.g. t-1"
        uuid uuid_id UK "real FK target"
        varchar name
    }
    coaches {
        varchar id PK
        varchar name
        varchar city
        int capacity
        uuid trip_id FK
    }
    delegates {
        varchar id PK
        varchar name
        varchar initials
        varchar coachId FK
        varchar status "UNASSIGNED | ASSIGNED | ARRIVED | LATE | MISSING"
        boolean vip
        varchar lastSeen
        uuid trip_id FK
        varchar email "shared (Vance) — invites are sent to it"
    }
    delegate_biometrics {
        varchar delegate_id PK_FK "★ mine — 1:1 with delegates"
        varchar consent "★ GRANTED | REVOKED"
        jsonb face_vector "★ anonymous embedding, never an image"
        jsonb voice_vector "★ 64-band FFT voiceprint"
        bigint voice_hash "★ legacy passphrase checksum"
        timestamptz updated_at "★"
    }
    check_in_logs {
        varchar id PK
        varchar delegate_id FK
        varchar method "FACE | VOICE | QR | MANUAL"
        varchar checked_in_by FK
    }
    activity_log {
        bigserial id PK
        text text "e.g. 'Wesley Wong checked in (Face)'"
        varchar kind "checkin"
        jsonb meta
    }
```

★ = created and owned by my module.

## `delegate_biometrics` — the one table I own

```sql
CREATE TABLE IF NOT EXISTS delegate_biometrics (
  delegate_id  VARCHAR(64) PRIMARY KEY REFERENCES delegates(id) ON DELETE CASCADE,
  consent      VARCHAR(16) NOT NULL DEFAULT 'GRANTED',
  face_vector  JSONB,
  voice_vector JSONB,
  voice_hash   BIGINT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

| Column | Type | Null | Description |
| --- | --- | --- | --- |
| `delegate_id` | `VARCHAR(64)` | no | **PK and FK** → `delegates.id`. One row per delegate, so the relationship is 1:1 (optional on the delegate side — most delegates have no row until they enrol). `ON DELETE CASCADE`: removing a delegate erases their biometrics automatically, which is the PDPA-correct behaviour and not something that should depend on application code remembering. |
| `consent` | `VARCHAR(16)` | no | `GRANTED` or `REVOKED`. Default `GRANTED` — delegates consent at onboarding. `REVOKED` hard-excludes them from all matching. |
| `face_vector` | `JSONB` | yes | The anonymous face embedding as a JSON number array — a ~1024-float deep embedding (`v3`), or a ~40-value legacy descriptor (`v2`). **Never an image.** |
| `voice_vector` | `JSONB` | yes | 64-band FFT voiceprint as a JSON number array. **Never audio.** |
| `voice_hash` | `BIGINT` | yes | Checksum of a typed passphrase — the legacy no-microphone fallback. A shared secret, not a biometric. |
| `updated_at` | `TIMESTAMPTZ` | no | Last enrolment or consent change. |

**Why `JSONB` rather than a `float8[]` or `vector` column:** the vectors are only
ever read back whole and scored in application code, never queried
element-wise, so an array type would buy nothing; `JSONB` round-trips straight
through the `pg` driver as a JS array with no custom parser. A real production
system doing 1:N search at scale would use `pgvector` with an ANN index —
that's the honest upgrade path, and the matcher code would not have to change.

### Consent states

| State | `face_vector` / `voice_vector` | Matchable? |
| --- | --- | --- |
| No row at all | — | No. Consented at onboarding but **not enrolled** — this is what stops the scanner "recognising" someone who never gave a sample. |
| `GRANTED`, vectors present | stored | Yes. |
| `GRANTED`, vectors null | null | No — consent without a sample. |
| `REVOKED` | **purged to NULL** | No. Erasure, not just a flag flip. |

### Writes

| Operation | Endpoint | Effect |
| --- | --- | --- |
| Enrol / re-enrol | `POST /api/enroll` | `INSERT … ON CONFLICT (delegate_id) DO UPDATE`, with `COALESCE` per column so enrolling a voice later doesn't wipe an existing face template. |
| Staff consent change | `POST /api/attendance/consent` | Same upsert, optionally enrolling a supplied token. |
| Erasure | `POST /api/enroll/revoke` | Sets `consent='REVOKED'` and all three vector columns to `NULL` in one statement. |

### Reads

| Query | Used by |
| --- | --- |
| `SELECT * FROM delegate_biometrics` (whole map) | Every scan, and the roster/coverage views — the enrolled set is small enough (tens per trip) that one read beats N per-delegate lookups. |
| `SELECT * … WHERE delegate_id = $1` | `/enroll/verify`, and the consent write-back. |

## Why this table exists at all

Enrolments originally lived in an in-process `Map`. Every backend restart
silently wiped every delegate's template: someone would enrol, the server would
restart under `node --watch`, and the scanner would then report "not recognised"
for a delegate who *had* enrolled — a bug that looks exactly like a bad match
and is almost impossible to diagnose from the UI. Moving the vectors into
Postgres makes them survive restarts and be shared across processes. It is still
PDPA-safe: the columns hold only the anonymous embedding.

## Shared tables I read or write, but do not own

| Table | Owner | My interaction |
| --- | --- | --- |
| `delegates` | JQ (base) | **Read** the roster for matching; **write** `status` and `lastSeen` on a successful check-in — always through JQ's `updateDelegate()` helper, never with my own SQL, so every other screen stays in sync. |
| `coaches`, `trips` | JQ / Desmond | Read-only, via `getDashboard()`, so coaches added later (c5, c6, …) work in my scanner automatically with no change here. |
| `check_in_logs` | Jayden (§6) | Shared table; his module writes the QR/manual rows, mine records face/voice check-ins through the shared logging helpers. |
| `activity_log` | JQ (`db/history.js`) | I call `logActivity()` so a face/voice scan reads as *"Wesley Wong checked in (Face)"* on the History Log page, exactly like a QR check-in — before this it only produced a generic "delegate UPDATED" line. |
| `trip_event_log` | Desmond (`routes/trip.js`) | I call `recordEvent()` for the trip board's durable audit trail. Best-effort by design: a logging failure must never undo a check-in that already succeeded. |

### A defensive migration in my module

`ensureBiometrics()` also runs `ALTER TABLE delegates ADD COLUMN IF NOT EXISTS`
for eight profile columns (`email`, `role`, `industry`, `phone`, `website`,
`passport_no`, `nationality`, `passport_expiry`).

These are **Vance's** columns, added by his module's lazy initialiser. The
enrolment-invite flow is built on `delegates.email`, and `updateDelegate()`
writes the whole profile field set on every call — so on a *fresh* database,
inviting a delegate died with `column "email" of relation "delegates" does not
exist` unless somebody had happened to open the Documents page first that boot.
The declarations are byte-identical to his, and `IF NOT EXISTS` makes the order
irrelevant in both directions: whichever module runs first wins, the other
no-ops. It belongs in `db/schema.js` with the rest of the delegates columns, but
that file is JQ's foundation and off-limits to teammate modules, so FaceCheck
guarantees its own preconditions instead.

## State deliberately kept in memory

Two things are *not* persisted, and that is a considered trade-off rather than
an oversight:

| Structure | Contents | Why it's fine to lose |
| --- | --- | --- |
| `consents` | Sequence of consent events per delegate (`GRANTED` → `REVOKED` → …) | The **authoritative** consent flag and the vectors live in the table above; this is only the display-level event trail. |
| `checkinHistory` | Per-delegate venue/method/latency records | The durable record of a check-in is `activity_log` + `trip_event_log`; this is a convenience feed for one screen. |

If this were going to production, both would become tables — the consent history
in particular is exactly the kind of record a PDPA audit would ask for.
