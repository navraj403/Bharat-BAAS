# Agent C: NBBL switch + COU backend + Admin API

**Model:** Sonnet · **Phase:** P1 · **State:** DONE
**Last update:** 15:50

## Owns
- `src/lib/parties/nbbl/**`, `src/lib/parties/cou/**`, `src/lib/parties/admin/**`
- `src/app/api/nbbl/**`, `src/app/api/cou/**`, `src/app/api/admin/**`
- `docs/agents/C.md`

## Done
- NBBL: registry (BFR003), billFetch/billPay with events, masked mobiles, latency, listTransactions/getTransaction/stats. Calls biller only via `biller/api`.
- COU: listBillers, fetchBill (validation throws `BadRequestError` -> 400), pay (INITIATED -> SUCCESS/FAILED, simulateFailure skips NBBL). COU imports only `nbbl/api`.
- Admin: listTables, getTableRows (whitelist, 404 otherwise), reset.
- All BUILD_PLAN 6.5 routes for NBBL/COU/Admin (shared helper `src/app/api/nbbl/_http.ts`, used by cou/admin routes too).
- Tests: `util.test.ts` (unit), `nbbl.int.test.ts`, `cou.int.test.ts` (biller/api mocked; rows cleaned up).

## Working on
- nothing

## Pending / cut
- none

## Files touched
- src/lib/parties/nbbl/{api,repo,util,util.test,nbbl.int.test}.ts
- src/lib/parties/cou/{api,util,cou.int.test}.ts
- src/lib/parties/admin/api.ts
- src/app/api/nbbl/**, src/app/api/cou/**, src/app/api/admin/**

## Contract questions (for the PM; don't edit types.ts or api.ts signatures yourself)
- Assumption: a biller nack with code 000 is mapped to BPR002. A PAY txn is created (and FAILED) for nack/throw; none for a bad fetchRef.
- `cou_payments.bbps_txn_ref` is also stored on a FAILED NBBL rejection when NBBL issued one.

## Verification
- `npm run test:int` (nbbl + cou): 13 pass. Unit: 3 pass.
- typecheck/eslint on my files: clean. `check-ownership.mjs C`: only other lanes' files flagged.
