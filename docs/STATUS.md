# Build status (PM log)

Phase-level log kept by the PM. Per-agent detail lives in `docs/agents/<id>.md`. The plan, contract, lanes and briefs are in `docs/BUILD_PLAN.md`.

## Gates

| Gate | Target time | State | Notes |
|---|---|---|---|
| G0 Foundation | 0:20 | **in progress** | Plan approved; baseline commit `9a4eba8`. Agent F (Opus) running. `DATABASE_URL` set and verified (PG 17.6, Tokyo pooler); F told to migrate and seed |
| G1 Parallel build (A–E) | 1:05 | – | |
| G2 Integration + smoke | 1:30 | – | |
| G3 QA walkthrough | 1:45 | – | |
| G4 Deployed URL | 2:00 | – | |

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
- Supabase project `widcwzssxwffnulrajgx`: URL and publishable key are in `.env.local`. **Waiting on `DATABASE_URL`** (transaction pooler), which the user will add.
