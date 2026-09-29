# Agent I: Integrator

**Model:** Opus · **Phase:** P2 · **State:** DONE
**Last update:** 16:40 (end of P2)

## Owns
- `**` (minimal, targeted edits; every cross-lane change is listed below)

## Done
- `scripts/smoke.mjs` (plain Node ESM, no deps, `--base=<url>`, default `http://localhost:3000`; wired to `npm run smoke`). 22 steps, each printed ✓/✗, exit 1 on any failure: reset → billers → Riya (also `mh-01 ab 1001`) 672600 → Arjun 1188962 (arrears 542682, late fee 9198) → Meera ALREADY_PAID BCSEEDPAID01 → Kabir NOT_GENERATED → wrong mobile NOT_FOUND/BFR002 → unknown biller BILLER_UNAVAILABLE/BFR003 → pay Riya (BC ref) → re-fetch ALREADY_PAID same ref → NBBL FETCH+PAY hop timelines, masked mobile, no raw mobile in events → biller payments/collected +672600 → OEM Aug bill PAID with the ref → double pay BPR002, payment count unchanged → Arjun wrong amount BPR001 → Arjun simulateFailure PAYMENT_DECLINED, still due → (last) Kabir +1600 km, generate `[kabirId]` → 1 bill 837800 → Kabir BILL_DUE 837800, Meera still paid → reset.
- **Root-cause fix: the dev server hung with every DB route stalled** (`/api/nbbl/stats` 60 s+, `/api/oem/vehicles` 11+ min). `pg_stat_activity` showed 5 Supavisor backends `active / ClientRead` for 5 to 12 minutes, one per pool slot. Cause: postgres.js with `prepare:false` runs every parameterised query as Parse/Describe/**Flush**, then Bind/Execute/Sync. When all 5 connections are busy it **pipelines** the next query behind an in-flight one. The transaction pooler releases the server connection on the first query's ReadyForQuery, which strands the second query halfway. The backend waits forever for Bind and the client waits forever for ParameterDescription. Fix in `src/lib/db/client.ts`:
  - `max_pipeline: 0` (one in-flight query per connection; the rest queue).
  - `withTx` now uses `sql.reserve()` + explicit `begin`/`commit`/`rollback`. `sql.begin()` breaks with `max_pipeline: 0`: postgres.js skips the hook that marks the connection reserved, so it fails with `UNSAFE_TRANSACTION`.
  - The pool's global key is versioned (`__bharatBaasSqlV2`), so the running dev server swapped to a fresh pool on hot reload. The legacy pool is closed. No restart was needed.
  - A stress probe (96 mixed concurrent queries/transactions incl. a failing tx, max 5) ran clean. I terminated the 5 stranded backends once (`pg_terminate_backend`, Supavisor + `ClientRead` + >60 s only).
- `src/lib/db/seed.ts`: `resetAndSeed` uses `withTx` (it called `sql.begin` directly).
- PM QA fix list (all 5), verified live in the Browser pane on `/cou` (Arjun):
  1. One "Fetch bill" button: the footer button is `type=submit form=cou-details-form`, and the hidden sr-only submit was removed. Enter still submits.
  2. One "Bill breakdown" heading: the `h2` labels the table through `aria-labelledby`, and the sr-only caption was removed.
  3. Cycle labels read `Arrears (Jul 2026)` / `Late fee (Jul 2026)`: new pure `src/lib/domain/cycle.ts` `formatCycle()` + `cycle.test.ts`, used in biller `rules.ts` (source of the labels) and in `fixtures.ts`.
  4. Pay-mode radios have `value` + `aria-label` (UPI / Net banking / Debit card), and the simulate-failure checkbox has an `aria-label`. The a11y tree now shows the names.
  5. Local ₹ formatters removed from `src/components/cou/format.ts` and `src/components/ui/format.ts`. `PaySheet`, `ResultScreens` and `ui/Money` import `formatINR` from `src/lib/domain/money.ts`.
- UI live-data shapes checked against `types.ts` for `/api/oem/vehicles`, `/api/oem/bills`, `/api/biller/overview`, `/api/nbbl/transactions` (+`/:ref` with events), `/api/nbbl/stats` (successRate 0..1), `/api/admin/tables` (+`/:name` with columns/rows) and `/api/cou/*`. All match; no fixes needed.
- DB: reseeded with `npm run db:seed` after all runs (seed truncates, so no TEST- rows remain).

## Cross-lane changes (file → why)
- `src/lib/db/client.ts` (F): pooler hang fix (above).
- `src/lib/db/seed.ts` (F): reset goes through `withTx` (UNSAFE_TRANSACTION otherwise).
- `src/lib/domain/cycle.ts`, `src/lib/domain/cycle.test.ts` (A, new): `formatCycle` for QA item 3.
- `src/lib/parties/biller/rules.ts` (B): ARREARS/LATE_FEE labels use `formatCycle`.
- `src/lib/client/fixtures.ts` (F): same label format in fixture mode.
- `src/components/cou/{Screens,ResultScreens,PaySheet}.tsx`, `src/components/cou/format.ts` (D): QA items 1, 2, 4, 5.
- `src/components/ui/{Money.tsx,format.ts}` (E): QA item 5.
- `scripts/smoke.mjs` (new, I).
(The PM already committed the smoke, cycle and QA edits as 777e468 / 1f05029. Only `client.ts` and `seed.ts` are uncommitted.)

## Pending / cut
- none.

## Notes for the PM
- **Latency:** every parameterised query costs 2 round trips to the Tokyo pooler (`prepare:false` → describe first). A COU fetch takes about 2.3 to 5 s and a pay about 3.5 to 5.5 s on the dev server. That is fine for a demo, but it is the main slowness. Possible later fixes: a pooler region closer to the user, or session mode.
- **Smoke needs exclusive use of the DB.** One early run failed because someone clicked bulk **Generate bills** + **Sync** in the OEM/biller console mid-run, which billed Riya for 2026-09 (923940). Don't click around while `npm run smoke` runs.
- `docs/STATUS.md` (PM-owned): the gates table rows G2–G4 are duplicated under the QA fix list.
- The `supabase/seed.sql` presentments for Riya/Arjun are created lazily on the first fetch. That is expected.

## Contract questions
- none (no `types.ts` or `api.ts` signature changes).

## Verification
- `npm run check`: pass (typecheck, lint, 29 unit tests in 6 files)
- `npm run test:int`: pass (26 tests in 5 files)
- `npm run smoke` against :3000: **22/22 green, 5 consecutive runs** after the fix (runs 5–9). The pre-fix failures were the pooler hang, then UNSAFE_TRANSACTION (fixed), then concurrent console clicks.
- `npm run db:seed`: done after the last smoke and int run.
- `node scripts/check-ownership.mjs`: `M src/lib/db/client.ts [F]`, `M src/lib/db/seed.ts [F]` → "OK: 2 changed file(s), all within owned lanes." (the other edits were already committed by the PM)
- `npm run build`: not run (dev server is live; the PM runs it at the gate).

## P3 fixes
- R HIGH-1: `vercel.json` (regions hnd1); `export const maxDuration = 60;` added to every `src/app/api/**/route.ts` (Next 16 route segment config).
- R #3: `nbbl/_http.ts` `handle()` now returns generic "Internal error" on 500 (still `console.error`). oem/biller `_http` already generic; left as is.
- R #6: `PAYMENT_MODES` const added (additive) to `domain/types.ts`; `paymentMode()` helper in `nbbl/_http.ts` used by `cou/pay` and `nbbl/bill-pay` routes -> 400 BAD_REQUEST.
- R #5: `admin/api.ts` masks `mobile` column (local helper; no cross-party import).
- R #13/#12: ASSUMPTION tags (MAX_TRIP_KM in oem/service.ts, PRO/FLEX in seed.sql, nextBillDate in biller/rules.ts); source-of-truth comments for GST/late-fee in biller/rules.ts and client/fixtures.ts.
