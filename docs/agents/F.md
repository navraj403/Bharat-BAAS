# Agent F: Foundation

**Model:** Opus · **Phase:** P0 · **State:** DONE
**Last update:** 15:30 (end of P0)

## Owns
`src/lib/domain/types.ts`, `src/lib/db/**`, `src/lib/client/**`, `src/lib/parties/*/api.ts` (stubs), `supabase/**`, `scripts/db-*.mjs`, `scripts/check-ownership.mjs`, `docs/agents/ownership.json`, `docs/agents/{A,B,C,D,E,F,I,R}.md`, `package.json`, `package-lock.json`, `.env.example`, `next.config.ts`, `src/app/globals.css`, `vitest.config.mts`

## Done
- `postgres` installed. Scripts: `db:migrate`, `db:seed`, `db:gen-seed`, `db:verify`, `test` (excludes `*.int.test.ts`), `test:int` (`vitest --mode int`, loads `.env.local`, serial), `smoke` (script comes in P2).
- `types.ts`: the full contract (DTOs, enums, `ResponseCode` + `RESPONSE_MESSAGES`, line-item presentment, fetch outcome unions).
- `0001_init.sql` (13 tables, idempotent, indexes, RLS off) and `seed.sql` (deterministic, `now()`-relative, starts with a truncate).
- DB: migrated (twice, to prove idempotency), seeded (twice, to prove reset), verified. Counts: 3 plans, 4 vehicles, 4 oem_bills, 2 billers, 4 customers (plus 12 trips, 4 receivables, 1 presentment, 1 payment, 2 nbbl_billers, 2 txns, 8 events, 1 cou_payment). Bill totals match §4: 672600 · 542682 (past due) + 637082 · 1218350 PAID. Open receivables: Riya 672600, Arjun 1188962.
- `src/lib/db/client.ts` (lazy `sql` proxy, `getSql`, `withTx`, `closeSql`, date → string), `tables.ts` (`APP_TABLES` whitelist), `seed.ts` (`resetAndSeed`).
- Party `api.ts` stubs for oem, biller, nbbl, cou and admin, with final signatures and behavioural JSDoc.
- `src/lib/client/api.ts` (typed wrappers for every §6.5 route, `ApiError`) + a stateful `fixtures.ts` (fetch → pay → re-fetch works, OEM +km/generate works, NBBL log updates, reset).
- Theme tokens in `globals.css`, `.env.example`, `next.config.ts` (`serverExternalPackages: ['postgres']`), `ownership.json`, `check-ownership.mjs`, and status files A–E, I and R (NOT STARTED).

## Working on
- nothing

## Pending / cut
- none. `scripts/smoke.mjs` belongs to P2 (I).
- **PM action:** `.gitignore` has `.env*`, which ignores `.env.example`. Add `!.env.example` (a PM-owned file).

## Files touched
- package.json, package-lock.json, next.config.ts, vitest.config.mts, .env.example, src/app/globals.css
- src/lib/domain/types.ts
- src/lib/db/{client.ts, tables.ts, seed.ts, seed-sql.generated.ts, seed-sql.test.ts, client.int.test.ts}
- src/lib/parties/{oem,biller,nbbl,cou,admin}/api.ts
- src/lib/client/{api.ts, fixtures.ts, fixtures.test.ts}
- supabase/migrations/0001_init.sql, supabase/seed.sql
- scripts/{db-migrate.mjs, db-seed.mjs, db-gen-seed.mjs, db-verify.mjs, check-ownership.mjs}
- docs/agents/{ownership.json, A,B,C,D,E,F,I,R.md}

## Deviations from BUILD_PLAN (additive)
- `oem_bills.plan_id` (plan snapshot) and `oem_bills.created_at`, `biller_customers.created_at`.
- `nbbl_transactions.biller_ref`: the biller's presentmentId. NBBL needs it to route the payment advice from a fetchRef; it is a reference, not bill data.
- `cou_payments.biller_id` and `vehicle_reg_no` are nullable: they are filled on success, because the COU only has the fetchRef at INITIATED.
- No cross-party foreign keys. `biller_receivables.oem_bill_id` is a plain uuid (isolation).
- The seed also includes Meera's presentment, payment, NBBL FETCH+PAY txns with events, and a cou_payments row (AutoPay), so every console has data. The seed also adds current-month trips for Riya (180 km), Arjun (150 km) and Meera (320 km). Kabir has 0 km.
- Arjun's Jul receivable is seeded as **OVERDUE with late_fee 9198 already applied**. The biller's "apply once" logic must not add it again.
- Seed is embedded as `src/lib/db/seed-sql.generated.ts` (generated from `supabase/seed.sql` by `npm run db:gen-seed`). A unit test fails if the two drift. This makes it safe on Vercel serverless.
- Extra scripts `db:gen-seed` and `db:verify`.

## Contract notes for implementers
- Money is integer paise and km are integer. DB `date` → `'YYYY-MM-DD'` string; `timestamptz` → `Date` (convert with `.toISOString()`); `bigint`/`count(*)` → string (cast `::int`).
- Response codes: BILL_DUE→000, NOT_GENERATED→BFR001, ALREADY_PAID→BFR001, NOT_FOUND→BFR002, BILLER_UNAVAILABLE→SYS500 (or BFR003 for an unknown biller). `fetchRef` is present on every fetch response.
- The PAY txn ref **is** the bbpsTxnRef (`BC`+10). FETCH ref is `F-`+10. COU order is `DP-`+10. COU id is `DEMOPAY`.
- The biller receives a `billerId` in `BillerFetchRequest` (one module serves both billers).
- `BillPresentment.lines` order: FIXED_FEE, USAGE, GST (latest cycle), then ARREARS per older cycle, then LATE_FEE per overdue cycle. `amountPaise` = the sum of the lines.
- Business outcomes return HTTP 200. `{error:{code,message}}` is only for 400/404/500.
- OEM bill_no is `OEM-<YYYYMM>-<regNo>`.
- **Demo caveat (A/I):** `generateBills(currentMonth)` bills every active vehicle without a bill for that month. It also creates current-month bills for Riya, Arjun and Meera (fixed fee + current km), so Meera flips to BILL_DUE after generation. Kabir's bill is ₹8,378.00 as required. Smoke should check the Kabir step last, or accept this.
- Fixture-only trigger: vehicle `MH01AB9999` → BILLER_UNAVAILABLE.

## Contract questions
- none

## Verification
- `npm run check`: pass (typecheck, lint, 10 unit tests)
- `npm run test:int`: pass (read-only client test against Supabase)
- `npm run build`: pass
- `node scripts/check-ownership.mjs F`: clean
