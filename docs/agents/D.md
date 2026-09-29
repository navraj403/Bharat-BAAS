# Agent D: Customer app UI

## Phase C: Complaints

**State:** WORKING
**Working on:** COU Help & support (HelpScreens.tsx, Home entry points, CouApp wiring)
**Done:** read contract and existing UI
**Pending:** build, check, ownership
**Files touched:** (see below at finish)
**Contract questions:** none

---

**Model:** Sonnet · **Phase:** P1 · **State:** DONE
**Last update:** P1

## Owns
- `src/app/cou/**`, `src/components/cou/**`, `docs/agents/D.md`

## Done
- `/cou` phone-frame DemoPay app: home, biller list, details form (validation, demo chips), result 4a-4d, pay sheet (UPI PIN pad, net banking, card, simulate failure in demo mode), processing (800ms), receipt / failure receipt, Done returns to details with values kept.
- All data via `src/lib/client/api.ts` (`getCouBillers`, `couFetch`, `couPay`).

## Pending / cut
- Local `formatINR` in `src/components/cou/format.ts`; integrator can swap for `src/lib/domain/money.ts` (now exists).
- Not exercised in a browser (PM owns dev server); verified by typecheck, lint, build only.

## Files touched
- src/app/cou/page.tsx; src/components/cou/{CouApp,Screens,ResultScreens,PaySheet,ui}.tsx, format.ts

## Contract questions
- none

## Verification
- typecheck pass, lint pass (0 errors), `NEXT_PUBLIC_USE_FIXTURES=1 npm run build` pass.
