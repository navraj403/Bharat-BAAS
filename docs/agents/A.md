# Agent A: OEM service + billing engine

**Model:** Sonnet · **Phase:** P1 · **State:** DONE
**Last update:** 15:40

## Owns
- `src/lib/domain/money.ts`, `src/lib/domain/billing.ts`, `src/lib/domain/*.test.ts`
- `src/lib/parties/oem/**`, `src/app/api/oem/**`, `docs/agents/A.md`

## Done
- `money.ts`: `formatINR`, `pct` (half-up bps), `divRoundHalfUp`, `sumPaise`.
- `billing.ts`: `computeBill`, `lateFee` (2%), `dueDate` (+10d), constants tagged `// ASSUMPTION:`.
- `billing.test.ts`: 0 km, Riya, Arjun Jul/Aug, Meera, Kabir 1600 km, late fee 9198, GST rounding 97182, formatINR (10 tests).
- OEM `api.ts` bodies (signatures untouched) → `service.ts` → `repo.ts`. `generateBills` honours `vehicleIds`, is idempotent, runs in `withTx`. `addTrip` is transactional.
- Routes: GET `/api/oem/vehicles`, POST `/api/oem/vehicles/[id]/trips`, POST `/api/oem/bills/generate`, GET `/api/oem/bills[?regNo=]`. Errors `{error:{code,message}}` 400/404/500 (`_http.ts`).
- `oem.int.test.ts`: TEST0001 vehicle, +1,600 km → 837800, idempotency, regNo normalisation, markPaid; cleaned up.

## Working on
- nothing

## Pending / cut
- none

## Files touched
- src/lib/domain/{money.ts,billing.ts,billing.test.ts}
- src/lib/parties/oem/{api.ts,service.ts,repo.ts,oem.int.test.ts}
- src/app/api/oem/{_http.ts,vehicles/route.ts,vehicles/[id]/trips/route.ts,bills/route.ts,bills/generate/route.ts}

## Contract questions (for the PM; don't edit types.ts or api.ts signatures yourself)
- none. Assumptions: bill_date = today (UTC); cycle month boundaries use the DB session timezone (UTC on Supabase); malformed vehicle ids in `vehicleIds` are ignored, a malformed id in `addTrip` → 404.

## Verification
- unit tests (domain): pass; `test:int` (oem): pass; typecheck + eslint on my files: clean
- `node scripts/check-ownership.mjs A`: my files clean (other lanes' in-progress files are listed as violations, not mine)
