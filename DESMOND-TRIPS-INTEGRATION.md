# TransitFlow — Trip Booking & Dynamic Coach Management

Desmond's feature, merged into JQ's `InsightMetrics-(JQ)` branch of VJMDynamics/MusterGo. **v3** turns the redesign into an "operational workspace" — the tool a coordinator actually works from during a trip, not an executive KPI dashboard. It keeps the v2 hero/journey-timeline/fleet/activity-feed structure but reworks each piece around that goal. This file documents everything that changed and how to get it running — it won't collide with `README.md` / `HIGH_LEVEL_DESIGN.md` / `PROJECT_STRUCTURE.txt` already at the project root.

## What this delivery is

The whole project — JQ's branch, byte-for-byte, with this feature merged in. Extract it over (or in place of) your local checkout. `.git/` was intentionally left out so it doesn't clobber your real history; copy the files listed below into your working checkout instead of replacing the whole folder if you want to keep your git log intact.

## What changed in v3 ("operational workspace" pass)

The brief was explicit: this page must NOT look like a KPI-heavy management dashboard — it should answer "where are we / how are delegates distributed / what needs attention now" at a glance. Three decisions were confirmed before building this version:

1. **Scope** — a full revision of the real files (not a separate spec-only exercise), delivered the same way as v1/v2: updated files + a refreshed zip.
2. **Styling** — kept extending the existing plain-CSS `.tf-` design system in `TripCoachPage.css` rather than introducing Tailwind. The real project has no build step for it and the "zero new npm packages" rule has held since v1; every requirement below is met with plain CSS (custom properties, CSS Grid, `:hover`/`:focus-within`) instead.
3. **KPI row** — removed entirely, not just shrunk. The five stat cards (Total delegates / Coaches / Checked in / Missing / Capacity) are gone. Their numbers now live where they're contextually useful instead of in their own row:
   - a red **"N missing"** pill appears next to the LIVE badge in the hero, but *only* when N > 0 — the header stays quiet when nothing needs attention;
   - a **Fleet** meta item in the hero folds in coach + delegate counts;
   - **checked-in** and **capacity%** moved into the Fleet section's own heading, next to the section title.

Other concrete changes, component by component:

- **Journey timeline** — clicking a stop now expands an inline detail panel *below* the whole track (time, category, location, fleet context) instead of a small floating popover, so it reads as part of the page rather than an overlay.
- **Fleet / coach workspace** — was a horizontally-scrolling row of fixed-width cards on every screen size (literally "isolated floating cards," which the brief calls out directly). It's now a CSS Grid on desktop: cards wrap, align to a shared baseline, and stretch to equal height — one coherent workspace instead of a filmstrip. The horizontal swipe/filmstrip behavior is now mobile-only (`≤720px`), where that pattern is expected.
- **Delegate cards** — unchanged compact height. Company/accessibility/notes text that would've been silently truncated now also surfaces in full via a hover/focus tooltip (progressive disclosure) — a tap still opens the full detail panel as before.
- **Activity feed** — visually quieter now (flatter background, no shadow) so it reads as a supporting side panel rather than competing with the Fleet workspace; plain colour dots became small kind-coloured icon badges (check/bus/people/pin/activity) for more concrete context.
- **Trips list cards** — each card now shows a real progress bar (`Day X of Y`) for trips **In progress**, or a filled grey bar for **Completed** ones; Planning/Cancelled trips don't show a bar (there's nothing meaningful to show yet). The empty state got a small illustration (built from existing `lucide-react` icons + CSS — no new dependency, no hand-authored SVG).

Concrete interpretations worth knowing about (simplifications, not oversights, unchanged from v2):
- The animated "bus" is a styled 2D icon whose position is computed from the itinerary and animated with a CSS transition — not a 3D/WebGL model (no 3D library was added).
- A coach's "current location" / "ETA" is derived from the trip's *shared* itinerary (the timeline's current/next stop) — the schema has one itinerary per trip, not a separate route per coach, so the new inline stop-detail panel shows fleet-wide coach/delegate counts rather than inventing per-stop coach assignment.
- The activity feed is a live, ephemeral, in-memory list (resets if the backend restarts) — deliberately mirroring `data.js`'s own `ACTIVITY` pattern for JQ's Dashboard, not a new persisted audit table.

## File manifest

**New files** (unchanged since v2 — nothing new in v3):
- `backend/routes/desmond.js` — all of this feature's API routes.
- `frontend/src/pages/TripsListPage.jsx` — the trip grid (also owns the shared `useTfTheme` dark-mode hook).
- `frontend/src/pages/TripCoachPage.css` — the design system.
- `database/003_desmond_trips_coaches.sql` — base schema migration.
- `database/004_desmond_dashboard_extras.sql` — v2's schema additions.
- `backend/run-migration.js` — optional one-command way to apply either migration file.

**Modified files** (only these two, only in the ways described):
- `backend/server.js` — JQ's file, unchanged except 4 lines in the existing "TEAMMATE ZONE" (next to the pre-existing `insightsRouter` mount):
  ```js
  import desmondRouter from "./routes/desmond.js";
  app.use(desmondRouter);
  ```
- `frontend/src/pages/TripCoachPage.jsx` — replaces the structural placeholder with the full board. `App.jsx`'s existing `/trips` route already points here.

**v3 touched two of the "new" files above further** (still no new files, no new endpoints' shape changes — additive only):
- `backend/routes/desmond.js` — `GET /api/all-trips` now also selects `dayOf`/`totalDays` so the trip list can show a real per-trip progress bar (previously only the per-trip summary endpoint returned those two columns).
- `frontend/src/pages/TripCoachPage.css` / `.jsx` / `TripsListPage.jsx` — see "What changed in v3" above.

**Everything else** (JQ's `data.js`, `auth.js`, `App.jsx`, `Sidebar.jsx`, `tokens.css`, `permissions.js`, `api.js`, `insights.js`, mobile UI, etc.) — untouched, verified byte-identical against your uploaded branch.

## Setup (Neon)

1. **Run both migrations, in order**, in the Neon SQL Editor (or via `node backend/run-migration.js` — see that file's header if you want to point it at 004 as well; by default it runs 003, so run 004 the same way or paste it manually):
   - `database/003_desmond_trips_coaches.sql` — adds `trips.uuid_id`, the `users` staff directory, `coaches.trip_id/staff_user_id/sort_order`, `delegates.trip_id/notes`, `itinerary_items`. Seeds 6 staff, backfills the existing Beijing trip.
   - `database/004_desmond_dashboard_extras.sql` — adds `itinerary_items.category`, `coaches.driver_name`, `delegates.company`/`accessibility_notes`. All nullable/defaulted — nothing breaks if you skip this one, the board just shows "—" / hides those badges.
   Both are transactional and idempotent — safe to re-run.
2. **No new npm packages** in either `package.json` — everything used (`pg`, `express`, `dotenv`, `react-router-dom`, `lucide-react`) was already there. v3 stayed plain-CSS on purpose (see "What changed in v3" above) specifically to keep this true.
3. **No `.env` changes** beyond what's already documented in `backend/.env.example` (`DATABASE_URL`, `JWT_SECRET`).
4. **Seed demo data.** Visit `/trips` → if empty, click **Seed demo trips**.

## Auth

Unchanged from v1 — `desmond.js` reuses JQ's `requireAuth()` from `auth.js` (the same signed-JWT check every other route uses). Any signed-in account can use it.

## Route map (why each path is where it is)

Express runs the *first* matching route and stops — a same-shaped route registered here would silently never run. That's why:

| This feature | Path used | Why not the "obvious" path |
|---|---|---|
| List all trips | `GET /api/all-trips` | `GET /api/trips` always returns the one hardcoded Beijing trip |
| Trip detail | `GET /api/trips/:tripId/summary` | `GET /api/trips/:id` ignores `:id`, same hardcoded trip |
| List a trip's delegates | `GET /api/delegates?tripId=...` | `GET /api/trips/:id/delegates` returns *every* delegate regardless of `:id` |
| Create a delegate | `POST /api/delegates` | `POST /api/trips/:id/delegates` doesn't know about `trip_id`/`notes`/`company`/etc. |

No collision risk (new ground): `GET/POST /api/trips/:tripId/activity`, `PATCH /api/delegates/:id/details`.

**Reused as-is** (frontend calls JQ's existing endpoints directly): `PATCH /api/delegates/:id` (drag-and-drop / "Move to" reassignment), `DELETE /api/delegates/:id` (remove a delegate). See `desmond.js`'s header comment for why the activity feed can't log these two server-side and instead has the frontend report them via `POST /api/trips/:tripId/activity` right after they succeed.

## Design decisions (v1, still true)

- Staff → coach isn't exclusive; the coach modals just flag if someone's already assigned elsewhere.
- No capacity-override modal — dragging onto a full coach still moves the delegate; capacity is informational (shown as the fleet card's Available/Nearly Full/Full status), not enforced.
- Reassigning out of Unassigned sets status to `MISSING`, not `PRESENT` — matches the app's "prove they boarded" model.
- `dayOf` (an integer on `trips`) drives "today," not real calendar-date math.
- No `@dnd-kit` — plain Pointer Events (see the comment block at the top of `TripCoachPage.jsx`).

## i18n

Both pages use the app's `useLang()`/`t()` pattern (`frontend/src/lib/i18n.jsx`, not edited). Already-translated strings that carry over unchanged: *Cancel, Save changes, Mark as VIP, Full name, Add delegate, Present, Missing, Unassigned, Empty, boarded, coaches, missing, added, removed*, and the *Trip management / Trips & coaches / Manage itineraries…* placeholder copy. Everything else introduced by the redesign is new and currently falls back to English — add these to `DICT` in `i18n.jsx` for full Chinese coverage: hero labels (*Current location, Next destination, Local time, Trip progress, LIVE, Fleet*), the journey timeline (*Journey timeline, Day, NOW, Add one →, Assigned coaches, Delegates*, category names *Hotel/Attraction/Meal/Factory visit/Airport/Transport/Stop*), fleet card copy (*Fleet, seats, guide, driver, No staff assigned, No driver set, Needs a coach, ETA, checked in, capacity*), the delegate panel's fields (*Company, Accessibility notes, Move to coach, Move*), the search/filter/sort toolbar (*Search delegates or company…, All statuses, Sort: Name/VIP first/Status*), toasts and confirm dialogs (*Confirm, Remove delegate?, Remove coach?, Delete this item?*), trip list copy (*Open board, of, Completed*), and a handful of smaller labels (*Coach label, Capacity (seats), Driver name, Staff member, Switch staff, Category, Time, Location, Lead, Live activity, No activity yet.*). Native browser dialogs were removed entirely (replaced by the in-app `ConfirmDialog`), so everything destructive is translatable — it just needs the Chinese strings added.

## Manual test checklist

1. Run both migrations, start both servers, sign in (`staff_194` / `password123!`).
2. **Trips** in the sidebar → grid loads (skeleton cards while loading). Seed demo trips if empty. Try the search box. A trip **In progress** shows a blue/purple progress bar with "Day X of Y"; a **Completed** trip shows a full grey bar; Planning/Cancelled trips show no bar.
3. Empty state (before seeding, or after deleting all trips at the database level) shows the small illustrated badge, not just plain text.
4. Open a trip → hero loads with LIVE badge, day counter, current/next stop, a **Fleet** meta item (coach/delegate counts), live clock, progress bar. There is **no KPI card row** below the hero. If any delegate is Missing, a red "N missing" pill appears next to LIVE; it disappears once nobody's missing.
5. Toggle dark mode (top-right) — only this page changes, reload the Dashboard to confirm it's unaffected.
6. Journey timeline shows today's stops with the bus icon positioned between the current and next stop, moving as time passes (or edit the trip's itinerary to place a stop near the current time to see it live). Click a stop → an inline panel expands **below the track** (not a floating popover) showing time/category/location/fleet counts; click again (or the × ) to close it.
7. Fleet section: on a normal-width desktop window, coach cards **wrap into a grid** and align to equal height — there should be no persistent horizontal scrollbar unless the window is narrow. The section heading shows "`X/Y checked in · Z% capacity`" (and "· N missing" when relevant) instead of separate stat cards.
8. Hover a delegate card with a company/accessibility note/notes set → a dark tooltip reveals the full text without the card growing. Tab to a card with the keyboard → the same tooltip should appear (`:focus-within`).
9. Drag a delegate card between fleet cards (mouse) → reassigns, status flips to Missing if it left Unassigned; a toast confirms it; the activity feed on the right logs it with a small icon badge (not a plain dot).
10. Tap a delegate card → detail panel opens; use **Move to coach** + **Move** as the no-drag alternative; edit Company/Accessibility notes/Notes → **Save changes**.
11. **Add delegate** / **Add coach** (with driver name) / switch a coach's staff+driver from the fleet card.
12. Remove a delegate and a coach → styled confirm dialog (not a browser popup) appears first.
13. **Edit itinerary** → add/edit/delete items with a category; delete asks for confirmation via the same styled dialog.
14. Shrink the window below ~720px → the Fleet grid becomes a swipeable, snap-scrolling filmstrip (this is the one place horizontal scrolling is intentional); a floating add-delegate/add-coach button appears bottom-right.
15. Toggle EN/中文 in the sidebar → strings listed as "already covered" above switch; new strings stay English until added to `DICT` (expected).

## Verification performed

Both SQL migrations were validated with a real Postgres parser (`libpg-query`) — zero syntax errors. All JS/JSX files (`desmond.js`, `run-migration.js`, `TripCoachPage.jsx`, `TripCoachPage.css` brace-balance, `TripsListPage.jsx`) were checked with `esbuild`/`node --check` — zero syntax errors. Every route in `desmond.js` was diffed against every route already registered in `server.js`/`insights.js` (exact path AND verb+shape, ignoring `:param` names) — zero collisions. Every file outside this feature's own list was diffed byte-for-byte against your uploaded branch to confirm nothing else changed.
