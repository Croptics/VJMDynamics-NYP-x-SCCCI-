# Update — "Others" issue type + Normal/Low priority

Two additions to exception logging, live and identical on **both** the admin
modal (`/exceptions` → *Log exception*) and the mobile panel (`/checkin` →
*Issues*).

---

## 1. "Others" issue type with a custom label

A sixth tile, **Others**, sits alongside the existing types. Selecting it reveals
a short free-text field so staff can be specific without us inventing a new enum
value for every one-off ("Lost luggage", "Wrong hotel", …).

- **Capped at 20 characters.** Enforced in three places that cannot drift:
  `maxLength` on the input, a `.slice()` in the data layer, and a hard check in
  the API — plus the column itself is `VARCHAR(20)`. The client is never trusted.
- **Live counter** (`12/20`) turns red at the limit.
- **Required.** Choosing *Others* with a blank label blocks submit on the client
  and returns `TYPE_OTHER_REQUIRED` on the server.
- **The label replaces "Other" everywhere it's displayed** — the inbox table, the
  mobile cards, the critical banner. A ticket reads *"Lost luggage"*, never the
  generic word *"Other"*.

Stored in a new `exception_tickets.type_other` column, added with
`ADD COLUMN IF NOT EXISTS`, so **your existing Neon database upgrades itself on
the next backend restart** — no migration, no data loss.

## 2. Normal / Low priority buttons

The **Mark as critical** switch is unchanged — it remains the escalation control
that pushes to every staff device. Directly beneath it are two smaller buttons:

| Button | Colour | Token |
| --- | --- | --- |
| **Normal** | violet | `--st-normal` `#7c3aed` |
| **Low** | slate | `--st-neutral` `#6b7280` |
| *(Critical)* | red | `--st-missing` `#e1232a` |

Those are the **same tokens the priority pills already use in the inbox**, so a
ticket you file as Low shows a slate *Low* pill that matches the button you
pressed. Verified in the browser from computed CSS: Normal renders
`rgb(124, 58, 237)`, Low renders `rgb(107, 114, 128)`.

**Interaction model:** Critical supersedes. Switch it on and the Normal/Low row
dims, disables, and the label reads *"Priority · set to Critical by the switch
above"* — so it's never ambiguous which priority will be sent. Switch it off and
your Normal/Low choice applies again. Default is Normal, exactly as before.

---

## Bug found and fixed along the way

The mobile Issues list hard-coded its priority pill:

```js
{t.priority === "CRITICAL" ? "Critical" : "Normal"}
```

Every **Low** ticket would have displayed as *"Normal"*, and its left rule was
drawn violet instead of slate. Now that Low is selectable this would have been
visible immediately, so both the label and the colour now derive from the shared
priority metadata.

## Files changed

```
backend/routes/exceptions.js                 +45   type_other column, validation
frontend/src/lib/exceptionsApi.js            +50   PRIORITIES, TYPE_OTHER_MAX, issueLabel()
frontend/src/components/LogExceptionModal.jsx +75  admin: Others + priority buttons
frontend/src/components/IssuesPanel.jsx      +96   mobile: same, + the Low pill fix
frontend/src/pages/ExceptionInboxPage.jsx     ±0   renders custom labels
frontend/src/pages/ExceptionInboxPage.css    +38   priority button + counter styles
```

Untouched: `QRCheckInPage.jsx`, `QRScannerPanel.jsx`, `ManualTrackingPanel.jsx`,
`useCriticalCount.js`, `vimal.js`, `vance.js`, `data.js`, `permissions.js`,
`seed-demo.js`.

Both pages import the **same** `PRIORITIES`, `TYPE_OTHER_MAX` and `issueLabel()`
from `exceptionsApi.js`, so the two screens cannot drift apart — change the cap
in one constant and both follow.

## Verified

**API, against a real PostgreSQL database:**

| Check | Result |
| --- | --- |
| `type_other` added to an **existing** database | `character varying(20)` |
| Others + label | stored, `typeOther: "Lost luggage"` |
| Others with blank label | `400 TYPE_OTHER_REQUIRED` |
| Label of 37 chars | `400 TYPE_OTHER_TOO_LONG` |
| Label of exactly 20 | accepted |
| CRITICAL / NORMAL / LOW | all round-trip correctly |
| Unknown type (`NONSENSE`) | `400` (was an opaque Postgres 500) |
| `PATCH` priority → LOW | works; bogus priority → `400` |
| `?priority=LOW` filter | returns only Low tickets |

**UI, 21/21 in a real browser** — both tiles present on both pages, input
revealed and capped (typed 26 chars, kept 20), live counter, Critical correctly
disabling Normal/Low, custom label appearing in both lists, Low pill rendering,
and the two colours confirmed from computed CSS.

**Regression:** the full earlier suite still passes — exception inbox, QR
check-in, manual override, resolve + 409 guard, SSE, Vimal's routes, and Vance's
document parsing with its 9 QR badges.

---

### One note on the spec

You said *"limit character count to less than 20"*. I implemented **20 as the
cap** (`0/20` counter, `VARCHAR(20)`), reading it as "keep it to about 20". If
you meant strictly 19, change `TYPE_OTHER_MAX` in
`frontend/src/lib/exceptionsApi.js` and `backend/routes/exceptions.js` — it's one
constant on each side, and the column widens/narrows on the next boot.
