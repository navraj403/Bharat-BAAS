# Build status (PM log)

Phase-level log kept by the PM. Per-agent detail lives in `docs/agents/<id>.md`. The plan, contract, lanes and briefs are in `docs/BUILD_PLAN.md`.

## Gates

| Gate | Target time | State | Notes |
|---|---|---|---|
| G0 Foundation | 0:20 | **passed** (`e87b35b`) | check 10/10 green, ownership clean, DB seeded and verified to the paisa. PM added optional `vehicleIds` to generate bills |
| G1 Parallel build (A–E) | 1:05 | **passed** (`7a553c4`) | Lanes D `1db6d31`, E `a7faa4b`, A `4458fdc`, C `4ac99c9`, B `3441dcd`. check 27/27, test:int 26/26, build green. Live COU→NBBL→Biller→OEM fetch for Riya returns ₹6,726.00 |
| G2 Integration + smoke | 1:30 | **passed** | PM re-ran: check 29/29, build green, `npm run smoke` 22/22 (98 s). I fixed pooler hangs (no pipelining, reserved-connection tx) and the QA list |
| G3 QA walkthrough | 1:45 | **passed** | PM live walkthrough (Riya fetch ₹6,726.00 → pay → `BC…` receipt → NBBL log → OEM). Review R: 0 blocker, 2 high, 5 medium, 6 low; fixed: Tokyo region hnd1 + maxDuration 60, generic 500s, payment-mode validation, mobile masking in DB explorer, ASSUMPTION tags. check 29/29, smoke 22/22, build green |
| G4 Deployed URL | 2:00 | **passed** | https://bharat-baas.vercel.app (Vercel hnd1 next to the Supabase Tokyo pooler). `npm run smoke -- --base=<url>` 22/22 in 10 s; COU fetch 0.4–1.1 s (was 5–7 s locally) |

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
- post-G4 · Fixed R.md #7–#12: NBBL bill-pay is idempotent per fetchRef (a retry replays the advice under the same BC ref), post-ACK bookkeeping can't flip a collected payment to FAILED, biller sync repairs a missed OEM markPaid, UTC cycle in the consoles, simulateFailure only in demo mode plus fetchRef validation, formatINR plus a single source for the GST/late-fee constants. check 29/29, test:int 27/27, smoke 23/23 local · next: redeploy; #4 (public reset/explorer) is still the user's call
- post-G4 · Pushed 93983af and redeployed to production; smoke against https://bharat-baas.vercel.app 23/23 (DB left reset) · next: #4 decision, demo prep

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
- Vercel env vars must be added without a trailing newline (a PowerShell pipe appended one and caused `Invalid URL`). Re-added from temp files; see the deploy notes below.

## Deploy notes

- Project `navraj7/bharat-baas`, production https://bharat-baas.vercel.app, region hnd1 (`vercel.json`).
- Env (production): DATABASE_URL (sensitive), NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, NEXT_PUBLIC_USE_FIXTURES=0, NEXT_PUBLIC_DEMO_MODE=1.
- Redeploy: `npx vercel deploy --prod`. GitHub auto-deploy is not connected (Vercel's GitHub app lacks repo access); connect it in Vercel → Project → Git if wanted.

- post-G4 · User decision: OEM shown as Maruti Suzuki (e Vitara trims), biller demo-finance renamed to bajaj-finance / Bajaj Finance (contracts BF-BAAS-*); Volt Leasing and DemoPay stay generic. A disclaimer footer (prototype, not affiliated, no real payments) is in the root layout, and the AGENTS.md brand rule is updated. DB reseeded; check 29/29, smoke 23/23 local.
- post-G4 · COU redesigned (user-approved mockup, wallet-app style): indigo app bar, icon grid, biller search plus recent, and non-payable fetch results shown inline on the details form Paytm-style (already paid / not generated / not found / biller down). Only BILL_DUE goes to the bill screen. New pay sheet with UPI AutoPay, green success receipt with Share/Download. Site nav hidden on /cou below 480px so the sticky CTA stays on screen. No API changes. check 29/29; every state verified in the browser; DB reseeded.
- post-G4 · Merged PR #1 (COU redesign + frame zoom) into main as f44e019 and redeployed to production; prod smoke 23/23, DB left reset.
- complaints · PM wrote docs/COMPLAINTS_PLAN.md (COU Help → NBBL ticket with pending-with + SLA due date); branch feat/complaints · next: P0 contract (F, Opus), then C/D/E in parallel
- complaints · G0 passed (b191a50): F contract, migration 0002 applied + reseeded (PM moved Meera's seeded payment to 4d2h ago so the overdue ticket follows it); check 48/48 · next: C backend, D COU Help, E NBBL console in parallel (Sonnet)
- complaints · G1 passed: C (services/routes, test:int 34/34), D (COU Help), E (NBBL Complaints tab + biller card) committed; check 48/48, ownership clean · next: PM live integration (fixtures off) + smoke extension
