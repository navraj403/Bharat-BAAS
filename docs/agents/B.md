# Agent B: Biller service

**Model:** Opus · **Phase:** P1 · **State:** DONE
**Last update:** end of P1

## Owns
- `src/lib/parties/biller/**`
- `src/app/api/biller/**`
- `docs/agents/B.md`

## Done
- `biller/api.ts` bodies (signatures unchanged) → `service.ts`: fetchBill, paymentAdvice, overview, sync.
- `rules.ts` (pure): normaliseRegNo, maskName/maskMobile, lateFee (2% half-up), cyclePeriod, nextBillDate, `buildPresentment` (FIXED_FEE, USAGE, GST of latest cycle → ARREARS per older cycle → LATE_FEE per overdue cycle; amount = sum of lines).
- `repo.ts` (biller_* tables only), `client.ts` (the only door to the OEM: `oem/api` getBillsByRegNo, listPlans, markPaid), `errors.ts` (UnknownBillerError → 404).
- Routes: `POST /api/biller/bbps/fetch`, `POST /api/biller/bbps/payment-advice`, `GET /api/biller/overview?billerId=`, `POST /api/biller/sync` (+ `_http.ts`). Business outcomes 200; 400 bad body, 404 unknown biller, 500 otherwise.
- Tests: `rules.test.ts` (unit, 4) and `biller.int.test.ts` (10, OEM vi.mocked for TEST vehicles, real oem/api for seeded ones).

## Design decisions (for integration)
- **fetchBill**: biller + customer lookup (biller_id, normalised reg no, mobile). Unknown billerId → throws UnknownBillerError (NBBL should have rejected it via its registry; if it reaches the biller, NBBL sees a throw → SYS500). Malformed mobile / no match → NOT_FOUND BFR002 with a generic message.
- **syncFromOem**: OEM called OUTSIDE the DB tx; then one tx: upsert receivables by oem_bill_id (new rows copy the OEM paid flag; PAID rows never touched; open rows refresh amounts, keep status/late fee), then `UNPAID and due_date < current_date → OVERDUE + late fee` guarded by `status='UNPAID'`, so the fee is applied exactly once (seeded Arjun Jul row untouched). "Today" = DB `current_date`.
- **Presentment reuse**: latest OPEN presentment is reused when receivable ids + amount match (stored breakdown returned); otherwise a new OPEN row. Repeat fetches write only `synced_at`.
- If an open receivable's OEM bill is missing from the OEM response, fetch throws (→ SYS500). If the OEM call itself fails, fetch throws (→ SYS500).
- ALREADY_PAID = no open receivables and a biller payment exists (receipt of the latest payment, cycles = receivables with that paid_payment_id). No open receivables and no payment → NOT_GENERATED.
- **paymentAdvice**: one tx: lock presentment FOR UPDATE → existing payment with same bbpsTxnRef → same ACK (rebuilt deterministically from DB) → unknown/PAID presentment → BPR002 → amount ≠ → BPR001 → any included receivable already PAID (stale presentment) → BPR002 → insert payment (paid_at = advice.paidAt), receivables PAID, presentment PAID. **`oem.markPaid` is called AFTER commit, best-effort**: the biller has the money once it commits; an OEM failure is logged and repaired by any retry of the same advice (idempotent replay calls markPaid again; OEM ignores already-PAID bills).
- **overview** also runs the biller-internal overdue aging (no OEM call) before reading, so KPIs are current. Names in overview are full (biller's own console, matches fixtures); names in presentment/receipt are masked.
- Seeded DB now has OPEN presentments for Riya (672600) and Arjun (1188962) created by the int test's read-only acceptance check (amounts/receivables unchanged). A reseed clears them.

## Pending / cut
- none

## Files touched
- src/lib/parties/biller/{api.ts (bodies only), service.ts, repo.ts, rules.ts, client.ts, errors.ts, rules.test.ts, biller.int.test.ts}
- src/app/api/biller/{_http.ts, bbps/fetch/route.ts, bbps/payment-advice/route.ts, overview/route.ts, sync/route.ts}
- docs/agents/B.md

## Contract questions (for the PM; don't edit types.ts or api.ts signatures yourself)
- none. Note: `BillerFetchRequest.nbblRef` is accepted but not stored (no biller column for it).

## Verification
- `tsc --noEmit`: clean (whole project at time of run)
- `eslint src/lib/parties/biller src/app/api/biller`: clean
- `vitest run` (unit): 27/27 pass (biller 4)
- `vitest run --mode int src/lib/parties/biller`: 10/10 pass; TEST rows cleaned up (0 left)
- `node scripts/check-ownership.mjs B`: only B files; 2 flagged files are PM-owned (`.claude/launch.json`, `docs/STATUS.md`), not touched by B
