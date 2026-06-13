# MusterGo — VJMDynamics × SCCCI

Real-time headcount & attendance reconciliation for SCCCI overseas delegations.
**SCCCI AI Challenge — Problem Statement #10.** *No one gets left behind.*

> **Build mode:** QR-primary. On-device facial recognition is deferred for this
> phase — QR code scanning is the sole high-speed check-in method, with manual
> override as the fallback.

## Deliverables in this package

| File | What it is |
|---|---|
| `HIGH_LEVEL_DESIGN.md` | Architecture, full PostgreSQL DDL, REST API table, folder structure |
| `PROJECT_IMPLEMENTATION_PHASE.md` | 4-phase sprint plan to the Sun 14 Jun 2026 target, tasks per member |
| `frontend/` | Runnable React (Vite) base — full Onboarding page + routing + scaffolds |

## Run the frontend

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
```

Sign in with any credentials (demo auth). Then open **Documents** in the sidebar
to use the fully built AI document-parsing / onboarding page — drag any files
onto the dropzone to watch the simulated Claude extraction, review low-confidence
rows, and confirm. **Chat assistant** is also fully interactive.

## Feature → owner map

| Sidebar item | Screen | Owner | Status |
|---|---|---|---|
| Documents (onboarding) | 4 | Vance | **Built** |
| Chat assistant | 6 | Vance | **Built** |
| Login | 1 | shared | **Built** |
| Dashboard | 2 | Jun Qi | scaffold |
| Trips & coaches | 3 | Desmond | scaffold |
| Exception inbox | 5 | Jayden | scaffold |
| QR check-in | mobile | Vimal | scaffold |

## Wiring the real backend

The frontend ships with simulated data so it runs standalone. To connect the
Express + PostgreSQL backend described in `HIGH_LEVEL_DESIGN.md`:

1. Set `VITE_API_URL` to your API origin.
2. In `src/lib/claudeParse.js`, set `USE_SIMULATION = false`.
3. Run migration `001_init.sql` (the DDL from the HLD) and seed dev data.

The Anthropic Claude API is called **server-side only** (document parsing +
trip assistant), so the shared team API seat / key never reaches the browser.
