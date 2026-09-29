<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Bharat BaaS: agent guide

This is the single source of truth for every coding agent on this repo: Claude Code (via `CLAUDE.md`, which imports this file) and OpenAI Codex (which reads this file directly). Tool-specific notes live in `CLAUDE.md`. Anything that applies to both agents goes here.

## What we are building

A **2-hour hackathon prototype**. It shows how **Battery-as-a-Service (BaaS) pay-per-km billing for 4-wheeler EVs** could run as a biller category on **Bharat Connect (BBPS)**, NPCI Bharat BillPay's bill-payment network.

**Four parties** exchange the bill. They live in one Next.js app but are isolated as separate modules with their own tables:

| Party | Route | Role |
|---|---|---|
| **COU** (customer payment app) | `/cou` | Customer picks category → biller → enters vehicle no + linked mobile → sees *bill due / not generated / already paid* → pays (mock UPI) → receipt |
| **OEM** (telematics) | `/oem` | Records km, **generates** the monthly per-km bill |
| **Biller** (BaaS financier) | `/biller` | **Fetches bills from the OEM**, validates vehicle + mobile, adds arrears and late fee, accepts payment advice |
| **NBBL** (Bharat Connect switch) | `/nbbl` | Routes fetch and pay between COU and biller, issues BBPS refs, **stores transaction data only** |
| DB explorer | `/admin/db` | Read-only view of every party's tables |

**The build plan is `docs/BUILD_PLAN.md`: flows, business rules, data model, API contract, phases and agent briefs. It overrides anything below that conflicts with it.** Domain background is in `docs/DOMAIN.md`. Read both before writing code.

Demo goal: fetch → pay → re-fetch shows *Already paid*, the NBBL log shows every hop, and the biller sees the money collected. All in under 3 minutes.

## Stack (decided; don't change without asking the user)

- **Next.js 16** (App Router, `src/` dir) + **React 19** + **TypeScript** (strict).
- **Tailwind CSS v4.** Configure it in CSS through `@import "tailwindcss"` and `@theme` in `src/app/globals.css`. There is no `tailwind.config.js`.
- **Data:** **Supabase Postgres**, reached through `postgres` (postgres.js) with plain SQL, using `DATABASE_URL` (the transaction pooler, `prepare:false`) in `.env.local`. No ORM and no supabase-js. The schema is in `supabase/migrations/`, the seed in `supabase/seed.sql`, and the reset route calls the same seed.
- **Deploy:** Vercel, with the env vars set in the Vercel project.
- **API:** Next.js Route Handlers under `src/app/api/**/route.ts`, returning JSON.
- **Tests:** Vitest, for pure domain logic only (the billing engine and BBPS message builders). No UI tests.
- **Package manager:** npm. Do not add pnpm or yarn lockfiles.
- **No new dependencies** without a one-line justification in the PR/commit message. Prefer the platform: `Intl.NumberFormat` for ₹ and `crypto.randomUUID()` for IDs. Charts are hand-rolled SVG or CSS.

## Commands

```bash
npm run dev         # http://localhost:3000
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run test        # vitest run
npm run check       # typecheck + lint + test; run before every commit
npm run build       # production build; run before the final demo
npm run test:int    # DB-backed service tests (needs .env.local); create only TEST- rows
npm run db:migrate  # apply supabase/migrations to DATABASE_URL
npm run db:seed     # truncate + seed; PM/integrator only
npm run smoke       # end-to-end API scenario (after integration)
```

## Architecture and file ownership

The full tree and per-file ownership are in `docs/BUILD_PLAN.md` §6.3. In short:

```
src/lib/domain/          # PURE TS: types.ts (THE CONTRACT), money.ts, billing.ts
src/lib/db/              # postgres.js client, resetAndSeed()
src/lib/parties/<party>/ # oem | biller | nbbl | cou | admin → api.ts (public), service.ts, repo.ts, client.ts
src/lib/client/          # typed browser fetch wrappers + fixtures (NEXT_PUBLIC_USE_FIXTURES)
src/app/api/<party>/**   # thin route handlers
src/app/{cou,oem,biller,nbbl,admin}/  # UI per party
```

Rules:
1. **Dependencies flow one way:** `app` → `lib/parties` + `lib/db` → `lib/domain`. `lib/domain` imports nothing from the app. **Party isolation:** a party imports only another party's `api.ts`, never its `repo.ts` or tables.
2. **Route handlers stay thin.** Business rules live in `lib/`, never in components or route files.
3. **Money is integer paise** (`number`) everywhere in code. Convert to ₹ only at display, via `formatINR()` in `lib/domain/money.ts`. Never use floats for money.
4. **Distances are integer metres or a 1-decimal km number.** Pick one in `types.ts` and stick to it.
5. **Server vs client components:** default to Server Components. Add `"use client"` only for interactivity (Pay button, AutoPay toggle, live log polling).

## Parallel work: Claude Code + Codex

Two agents may work at the same time. To avoid merge conflicts:

- **Contract first.** `src/lib/domain/types.ts` and the API route shapes (listed in `docs/STATUS.md`) are written and committed **before** the lanes split. After that, change them only additively (new optional fields or new types). Record any breaking change in `docs/STATUS.md` and tell the user.
- **Lanes own directories.** An agent edits only files in its own lane. If you need a change in someone else's lane, write it under "Requests" in `docs/STATUS.md` instead of editing their files.
- **Lanes and ownership** are defined per agent in `docs/BUILD_PLAN.md` §9 and machine-checked by `scripts/check-ownership.mjs` against `docs/agents/ownership.json`. Any lane can be handed to Codex with the same brief.
- **Unblock with stubs.** UI lanes build against `src/lib/client/api.ts` with `NEXT_PUBLIC_USE_FIXTURES=1`. Backend lanes call other parties through the stubbed `api.ts`.
- **Status:** each agent keeps `docs/agents/<id>.md` current (template: `docs/agents/_TEMPLATE.md`). The PM appends phase-level lines to `docs/STATUS.md`.
- **Git:** agents don't commit. The PM commits per lane at each gate, after the ownership check and `npm run check`. Don't commit `.next/`, `node_modules/` or `.env*`.
- **Shared resources:** only the PM runs `npm install`, the dev server and DB seed/reset.

## Coding conventions

- TypeScript strict; no `any` (use `unknown` and narrow). Export types from `lib/domain/types.ts`.
- Use named exports. Components and types use `PascalCase`; functions and variables use `camelCase`; route segments use `kebab-case`.
- Keep functions small and pure in `lib/domain`. Every billing rule gets a Vitest case, including edge cases: 0 km (fixed fee only), typical km, late payment, arrears, and paise rounding.
- API errors return `{ error: { code, message } }` with a proper HTTP status. The BBPS simulator uses BBPS-style response codes (see `docs/DOMAIN.md`).
- UI copy is plain English with ₹ amounts in Indian digit grouping (₹1,23,456.00). Label km, rate and GST explicitly on every bill.
- Accessibility basics: semantic buttons and links, visible focus, sufficient contrast.

## Guardrails

- **Everything is mock.** No real payment gateways, UPI intents, NPCI/BBPS endpoints or bank APIs. No network calls to third parties at all.
- **No real personal data.** Use obviously fake names, `MH-01-XX-0000`-style dummy registrations and dummy mobile numbers (`98XXXXXX01`). Don't store or log anything resembling real Aadhaar, PAN or card numbers.
- **Brand names only as illustration.** The user chose to show real names for the OEM (Maruti Suzuki) and one biller (Bajaj Finance). Keep the "prototype, not affiliated, no real payments" disclaimer visible on every page (root layout). Don't use their logos, colours or real product data. Every other party name stays generic (Volt Leasing, DemoPay).
- Mark every assumed number in the code with a `// ASSUMPTION:` comment (for example the GST rate or the late-fee rule), so the demo can say what is real and what is illustrative.

## Definition of done (for the 2-hour build)

- [ ] `npm run check` and `npm run build` pass.
- [ ] The seed reproduces the §4 acceptance table in `docs/BUILD_PLAN.md` (Riya ₹6,726.00 due, Arjun ₹11,889.62 with arrears, Meera ₹12,183.50 paid, Kabir not generated, then ₹8,378.00 after the OEM generates).
- [ ] The COU shows all result states: bill due, not generated, already paid, not found.
- [ ] Pay → receipt with a `BC…` ref; re-fetch → already paid.
- [ ] The NBBL monitor shows FETCH and PAY txns with a hop timeline; the biller console shows the payment collected.
- [ ] Reset demo data returns everything to the seed state; `npm run smoke` passes locally and against the deployed URL.
