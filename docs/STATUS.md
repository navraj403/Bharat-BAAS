# Build status (PM log)

Phase-level log kept by the PM. Per-agent detail lives in `docs/agents/<id>.md`. The plan, contract, lanes and briefs are in `docs/BUILD_PLAN.md`.

## Gates

| Gate | Target time | State | Notes |
|---|---|---|---|
| G0 Foundation | 0:20 | **passed** (`e87b35b`) | check 10/10 green, ownership clean, DB seeded and verified to the paisa. PM added optional `vehicleIds` to generate bills |
| G1 Parallel build (A–E) | 1:05 | **passed** (`7a553c4`) | Lanes D `1db6d31`, E `a7faa4b`, A `4458fdc`, C `4ac99c9`, B `3441dcd`. check 27/27, test:int 26/26, build green. Live COU→NBBL→Biller→OEM fetch for Riya returns ₹6,726.00 |
| G2 Integration + smoke | 1:30 | **passed** | PM re-ran: check 29/29, build green, `npm run smoke` 22/22 (98 s). I fixed pooler hangs (no pipelining, reserved-connection tx) and the QA list |
| G3 QA walkthrough | 1:45 | **passed** | PM live walkthrough (Riya fetch ₹6,726.00 → pay → `BC…` receipt → NBBL log → OEM). Review R: 0 blocker, 2 high, 5 medium, 6 low; fixed: Tokyo region hnd1 + maxDuration 60, generic 500s, payment-mode validation, mobile masking in DB explorer, ASSUMPTION tags. check 29/29, smoke 22/22, build green |
| G4 Deployed URL | 2:00 | **waiting on user** | Vercel CLI 61 ready; user must run `npx vercel login` |

## PM QA notes (fixture-mode walkthrough on :3001) → for Integrator (P2)

The Arjun journey passed in full: ₹11,889.62 breakdown correct → UPI PIN → receipt `BC…` → re-fetch shows ALREADY_PAID. The landing page, `/oem` and the other consoles return 200 with no console errors. Fix list:
1. `/cou` details screen has **two "Fetch bill" buttons** (form submit and a footer button). Keep one.
2. Bill screen shows the heading **"Bill breakdown" twice** (a visible caption plus a heading).
3. Arrears and late-fee labels show the raw cycle `2026-07`. Format them as `Jul 2026`.
4. Pay-sheet mode radios and the simulate-failure checkbox have **no accessible names** (they read as "on"). Add labels.
5. D and E each wrote a local ₹ formatter (`src/components/cou/format.ts`, `src/components/ui/format.ts`). Swap both to `formatINR` from `src/lib/domain/money.ts`.

All 5 were fixed by agent I (`777e468`, `1f05029`).

## Log

<!-- newest at the bottom: `- HH:MM · phase · done · next` -->
- setup · Scaffolded Next.js 16 + TS + Tailwind v4 + Vitest; wrote AGENTS.md, CLAUDE.md, DOMAIN.md
- setup · Moved the repo to C:\Interview-LC\bharat-baas; typecheck runs `next typegen` first
- plan · Wrote docs/BUILD_PLAN.md v1 (4 parties, Supabase from the start, category → biller → details, arrears rolled into the latest bill, Vercel deploy) and aligned AGENTS.md and DOMAIN.md with it · next: user approval, then P0

## Decisions

- Supabase Postgres from the start, via postgres.js and plain SQL (the user chose this over a local DB).
- COU flow: category → biller → vehicle no + linked mobile (the real BBPS pattern).
- Multiple unpaid bills: the latest bill plus arrears plus late fee, as one payable amount.
- Sharing: deploy to Vercel + Supabase.
- NBBL stores transaction data only. Disputes are Phase 2.
- **Bill model is Fixed + Variable:** a fixed monthly battery fee (STD ₹1,500, PRO ₹2,000, FLEX ₹999) plus km × rate on actual km. No minimum km. The acceptance numbers were recomputed (Riya ₹6,726.00, Arjun ₹11,889.62, Meera ₹12,183.50, Kabir ₹8,378.00).
- Supabase project `widcwzssxwffnulrajgx`: URL, publishable key and `DATABASE_URL` (transaction pooler, Tokyo) are in `.env.local`.
- **DB client runs one query per connection** (`max_pipeline: 0`), and `withTx` uses a reserved connection with explicit BEGIN/COMMIT. Pipelining through the Supabase transaction pooler caused stuck connections, and the dev server hung for 60 s–14 min (found and fixed by agent I).
- Latency: COU fetch ≈2.3–5 s and pay ≈3.5–5.5 s, because of multiple round trips to the Tokyo pooler. Acceptable for the demo; mention it when presenting.
- Demo rule: seed dates are relative to reset time (Riya due reset+5 days). **Press Reset demo data before every demo**, or Riya picks up a late fee.
