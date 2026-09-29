# Agent E: Consoles + app shell UI

**Model:** Sonnet · **Phase:** P1 · **State:** DONE
**Last update:** P1

## Owns
src/app/layout.tsx, page.tsx, oem/**, biller/**, nbbl/**, admin/**, src/components/ui/**, src/components/consoles/**, globals.css (append only, unused)

## Done
- Top nav party switcher (active state), landing page (4-party diagram, demo script, in-page-confirm Reset demo data).
- /oem (per-row +100/+500/custom km, prominent Generate bill, bulk generate behind confirm, bills table), /biller, /nbbl (3s polling with pause, hop timeline with collapsible JSON, disabled Disputes tab), /admin/db (grouped tables, rows grid, Supabase link).
- UI primitives: Button, Card, DataTable, EmptyState/LoadingState, ErrorState, KpiTile, Money, StatusPill; consoles: useAsync, ConfirmBar, PageShell, TopNav.
- All data through src/lib/client/api.ts only; loading/empty/error states everywhere.

## Working on
- nothing

## Pending / cut
- Money uses a local formatter (src/components/ui/format.ts), not src/lib/domain/money.ts; swap if desired.
- Not visually verified in a browser (no dev server).

## Files touched
- listed under Owns

## Contract questions
- none. Assumed biller ids `demo-finance` / `volt-leasing` (from fixtures). NbblStats.successRate handled as 0-1 or 0-100.

## Verification
- typecheck: pass; lint: pass
- `NEXT_PUBLIC_USE_FIXTURES=1 npm run build`: my files compile; build fails type-check only in src/lib/parties/biller/repo.ts (agent B: string vs number args, lines 172/191/207)
- check-ownership E: my files clean (other violations are other lanes' in-flight files)
