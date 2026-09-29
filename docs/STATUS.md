# Build status (PM log)

Phase-level log kept by the PM. Per-agent detail lives in `docs/agents/<id>.md`. The plan, contract, lanes and briefs are in `docs/BUILD_PLAN.md`.

## Gates

| Gate | Target time | State | Notes |
|---|---|---|---|
| G0 Foundation | 0:20 | **passed** (`e87b35b`) | check 10/10 green, ownership clean, DB seeded and verified to the paisa. PM added optional `vehicleIds` to generate bills |
| G1 Parallel build (Aâ€“E) | 1:05 | **passed** (`7a553c4`) | Lanes D `1db6d31`, E `a7faa4b`, A `4458fdc`, C `4ac99c9`, B `3441dcd`. check 27/27, test:int 26/26, build green. Live COUâ†’NBBLâ†’Billerâ†’OEM fetch for Riya returns â‚¹6,726.00 |
| G2 Integration + smoke | 1:30 | **passed** | PM re-ran: check 29/29, build green, `npm run smoke` 22/22 (98 s). I fixed pooler hangs (no pipelining, reserved-connection tx) and the QA list |
| G3 QA walkthrough | 1:45 | â€“ | |
| G4 Deployed URL | 2:00 | â€“ | |

## PM QA notes (fixture-mode walkthrough on :3001) â†’ for Integrator (P2)

The Arjun journey passed in full: â‚¹11,889.62 breakdown correct â†’ UPI PIN â†’ receipt `BCâ€¦` â†’ re-fetch shows ALREADY_PAID. The landing page, `/oem` and the other consoles return 200 with no console errors. Fix list:
1. `/cou` details screen has **two "Fetch bill" buttons** (form submit and a footer button). Keep one.
2. Bill screen shows the heading **"Bill breakdown" twice** (a visible caption plus a heading).
3. Arrears and late-fee labels show the raw cycle `2026-07`. Format them as `Jul 2026`.
4. Pay-sheet mode radios and the simulate-failure checkbox have **no accessible names** (they read as "on"). Add labels.
5. D and E each wrote a local â‚¹ formatter (`src/components/cou/format.ts`, `src/components/ui/format.ts`). Swap both to `formatINR` from `src/lib/domain/money.ts`.

All 5 were fixed by agent I (`777e468`, `1f05029`).

## Log

<!-- newest at the bottom: `- HH:MM Â· phase Â· done Â· next` -->
- setup Â· Scaffolded Next.js 16 + TS + Tailwind v4 + Vitest; wrote AGENTS.md, CLAUDE.md, DOMAIN.md
- setup Â· Moved the repo to C:\Interview-LC\bharat-baas; typecheck runs `next typegen` first
- plan Â· Wrote docs/BUILD_PLAN.md v1 (4 parties, Supabase from the start, category â†’ biller â†’ details, arrears rolled into the latest bill, Vercel deploy) and aligned AGENTS.md and DOMAIN.md with it Â· next: user approval, then P0

## Decisions

- Supabase Postgres from the start, via postgres.js and plain SQL (the user chose this over a local DB).
- COU flow: category â†’ biller â†’ vehicle no + linked mobile (the real BBPS pattern).
- Multiple unpaid bills: the latest bill plus arrears plus late fee, as one payable amount.
- Sharing: deploy to Vercel + Supabase.
- NBBL stores transaction data only. Disputes are Phase 2.
- **Bill model is Fixed + Variable:** a fixed monthly battery fee (STD â‚¹1,500, PRO â‚¹2,000, FLEX â‚¹999) plus km Ã— rate on actual km. No minimum km. The acceptance numbers were recomputed (Riya â‚¹6,726.00, Arjun â‚¹11,889.62, Meera â‚¹12,183.50, Kabir â‚¹8,378.00).
- Supabase project `widcwzssxwffnulrajgx`: URL, publishable key and `DATABASE_URL` (transaction pooler, Tokyo) are in `.env.local`.
- **DB client runs one query per connection** (`max_pipeline: 0`), and `withTx` uses a reserved connection with explicit BEGIN/COMMIT. Pipelining through the Supabase transaction pooler caused stuck connections, and the dev server hung for 60 sâ€“14 min (found and fixed by agent I).
- Latency: COU fetch â‰ˆ2.3â€“5 s and pay â‰ˆ3.5â€“5.5 s, because of multiple round trips to the Tokyo pooler. Acceptable for the demo; mention it when presenting.
