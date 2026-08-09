# Demo Run-Sheet — Desmond (Trip Booking & Dynamic Coach Management)

My part of the live review: **Screen 3 — Trip Management & Coach Assignment**
("TransitFlow"). Keep this open during the demo.

---

## Pre-flight (do ~10 min before)

- [ ] **Backend up** — `cd backend && npm start` (`:4000`). Wait for "PostgreSQL connected".
- [ ] **Frontend up** — `cd frontend && npm run dev`.
- [ ] **Database reachable** — the whole app needs it; confirm *before* you present.
- [ ] **Log in as `desmond`** (not `staff_194`) — using your own account avoids booting a teammate mid-demo.
- [ ] **Have the captain login ready** — `Staff_1` / `password1` (captains Coach 1).
- [ ] **Use the Beijing trip** (In progress, Day 3 of 5) — it has a realistic mix: some present/missing/late, an unassigned delegate (Yeo Pei Lin), a delayed + a cancelled itinerary stop.
- [ ] **Rehearse the offline beat once** (Act 4) — it's the most impressive but has the most steps.
- [ ] **Deployment story** — if asked: offline works over **HTTPS** (which the cloud host gives); set `FRONTEND_URL` + `DATABASE_URL` for the cloud env.

---

## The demo (aim ~5 min, lead with the drag-and-drop)

### Act 1 — The live board (30s)
1. **Trips** → tabs **Planning / In progress / Completed / Cancelled** → open **Beijing** → **Open board**.
2. Point at the **live KPI row** (Checked in · Late · Missing · Unassigned · Coaches). *"This is the coordinator's cockpit — and 'checked in' updates live as the QR scanner boards people, within 2 seconds."*

### Act 2 — Dynamic reassignment ⭐ (the highlight — the enhanced capability)
3. In **Coach assignments**, point at each coach's **capacity badge** (Available / Almost full / Full / Over).
4. **Drag a delegate from one coach to another.** *"I rebalance coaches live — both head-counts recount instantly."*
5. **⭐ Capacity beat:** drag a delegate onto a **full** coach → it **shakes** and the **"Coach is full" → Cancel / Override** dialog appears. *"It won't silently overfill — and this is enforced on the server, not just here."*
6. *(Optional, 20s)* Open the board in a **second tab**, move the same delegate in tab A, then in tab B → *"was moved by someone else"*. *"Two coordinators can't clobber each other — optimistic locking."*

### Act 3 — The live day: itinerary (45s)
7. **Today's itinerary → Day 3 (Today).** Point at the **NOW** card and the **NEXT** card with its **live countdown**; the **"N done"** pill hides finished stops.
8. Click a stop → mark it **Delayed** (or Cancelled) → *"everyone watching sees the day slip in real time."*
9. On a stop, **Attendance & history** → mark a delegate present/missing → *"per-stop attendance, with a full before→after log."*

### Act 4 — Offline ⭐ (works with no signal)
10. **F12 → Network → Offline.** Move a delegate → it sticks, shows a **"Pending" chip**, and the pill reads **"1 change waiting to sync"**. *(Reload while offline — it's still there.)*
11. **Network → Online** → the pill flushes and the move saves. *"On the ground the signal drops; the move is queued on the device and replays automatically — nothing lost, nothing double-applied."*

### Act 5 — Coach-captain scoping (30s)
12. **Log out → log in as `Staff_1`** → open the Beijing trip. *"A captain only sees their own coach — Coach 1 — plus the Unassigned list so they can catch a stray delegate. Every other coach is hidden."* *(Log back in as `desmond`.)*

### Closing line
13. **History** button → the before→after audit. *"Every change is recorded — who moved whom, and when."*

---

## Fallbacks (if something's slow/broken on stage)
- **Can't drag on a trackpad?** Tap the delegate → **Move to coach** dropdown — same result, same rules.
- **Offline beat glitches?** You may still be in DevTools **Offline** — set Network back to **Online**; it syncs.
- **Board looks stale?** It auto-refreshes every 2s — reload; make sure it's the **Beijing (In progress)** trip.
- **Data messy from a rehearsal?** Re-run the seed scripts in `backend/` to reset the Beijing trip.

## Likely questions + your answers
- **What's your enhanced capability?** Live **drag-and-drop coach reassignment** — with real capacity limits, offline support, and concurrency safety.
- **What happens offline?** The move is **queued on the device** and **replays on reconnect**; an idempotency key means it never double-applies (last-write-wins for queued moves).
- **Two people edit the same delegate?** **Optimistic locking** — the stale edit is rejected (409) and that screen refreshes; no silent overwrite.
- **Is capacity just a UI warning?** No — the **server** enforces it (409 unless override); the dialog is the friendly front for a real rule.
- **Why can a captain see Unassigned but not other coaches?** An unassigned delegate is nobody's exclusive coach; a captain must be able to spot one at their door. It matches the backend's own dashboard KPI logic.
- **A time AI was wrong?** It first put the reassignment logic inside the route file — importing it in a test **hung the runner** on the DB pool; I had it extract a **pure module** (`reassign-core.js`) so tests run in ~200ms.

## Differentiators to name-drop
- **Server-enforced** capacity + optimistic locking — not just UI politeness.
- **Offline-first** reassignment on the shared outbox — works with no signal.
- **Live** board — check-ins, delays and bus arrivals all update within 2s.
- **36 unit tests**, A1 docs, and clean Git history behind it.
