# Plan: Customer Support Complaints (COU Help → NBBL ticket console)

## Context
BUILD_PLAN §11 left "Dispute and complaint raising and tracking at NBBL" for Phase 2, and the NBBL console has a disabled "Disputes — Phase 2" tab (`src/app/nbbl/page.tsx`). The user now wants that flow built:
- A customer opens **Help** in the COU (DemoPay), picks an **order** (a `cou_payments` row) and a **reason** (Duplicate payment, Payment deducted but transaction failed, Payment successful but bill still pending, and so on), then submits.
- That creates a **COU ticket** and a **BBPS complaint at NBBL**.
- NBBL opens the ticket, sees **where it is pending** (COU, NBBL or Biller), reassigns it, adds notes and closes it.
- Every ticket has a **status** (OPEN / CLOSED) and a **due date** (an SLA per reason).

I act as PM/orchestrator. Subagents execute the lanes, keep status files, and I verify each gate. On execution, the first step copies this plan into the repo as **`docs/COMPLAINTS_PLAN.md`**, the plan doc the user asked for.

## Design (contract, written first and then frozen)

**Domain types (additive to `src/lib/domain/types.ts`):**
- `ComplaintReason = DUPLICATE_PAYMENT | DEBITED_TXN_FAILED | PAID_BILL_PENDING | WRONG_AMOUNT | OTHER`, with `COMPLAINT_REASON_LABELS`.
- `ComplaintStatus = OPEN | CLOSED`.
- `ComplaintParty = COU | NBBL | BILLER` (pending with).
- `ComplaintResolution = RESOLVED | REJECTED | REFUNDED`.
- `ComplaintActionKind = RAISED | ASSIGNED | NOTE | CLOSED | REOPENED`.
- DTOs:
  - `CouOrder`
  - `RaiseComplaintRequest {orderId, reason, description?}`
  - `CouComplaint` (ticketNo, complaintId, order summary, reason, status, pendingWith, dueAt, overdue, resolution)
  - `NbblComplaint`
  - `NbblComplaintDetail = NbblComplaint & {events, linkedTxn: NbblTxn|null}`
  - `NbblComplaintQuery {status?, pendingWith?}`
  - `ComplaintActionRequest {action: ASSIGN|NOTE|CLOSE|REOPEN, assignTo?, resolution?, note?}`
  - `NbblComplaintStats {open, overdue, byParty, closed}`

**Pure rules, in the new file `src/lib/domain/complaints.ts` (Vitest, every rule tagged `// ASSUMPTION:`):**
- `slaDays(reason)`: DUPLICATE_PAYMENT 5, DEBITED_TXN_FAILED 5, PAID_BILL_PENDING 3, WRONG_AMOUNT 7, OTHER 7 calendar days. `dueAt(raisedAt, reason)`.
- `isOverdue(c, now)`: the ticket is OPEN and `now > dueAt`.
- `initialAssignee(reason, payTxnStatus | null)`, the auto-triage that makes "where is it pending" meaningful:
  - DEBITED_TXN_FAILED with no PAY txn at NBBL → **COU** (the money never reached the switch).
  - DEBITED_TXN_FAILED with a FAILED PAY txn → **NBBL**.
  - DUPLICATE_PAYMENT, PAID_BILL_PENDING and WRONG_AMOUNT → **BILLER**.
  - OTHER → **NBBL**.
- `canTransition(status, action)`: CLOSE only when OPEN, REOPEN only when CLOSED, ASSIGN only when OPEN.
- Ref generators: COU ticket `DPT-` + 8, NBBL complaint id `CC` + 10 [A-Z0-9] (the BBPS complaint ref).

**Tables (new migration `supabase/migrations/0002_complaints.sql`, idempotent):**
- `cou_complaints`: ticket_no uq, order_id, complaint_id (NBBL ref), reason, description, created_at. The COU keeps its own copy and reads live status from NBBL through `nbbl/api`.
- `nbbl_complaints`: complaint_id uq, cou_id, cou_ticket_no, order_id, txn_ref (bbps ref, nullable), biller_id (nullable), customer_ref_masked, amount_paise, reason, description, status, pending_with, resolution, due_at, created_at, updated_at, closed_at.
- `nbbl_complaint_events`: id, complaint_id, action, from_party, to_party, actor, note, at. This is the ticket timeline.
- Add all three to `APP_TABLES` (`src/lib/db/tables.ts`) and to the seed `truncate`.
- Seed extras for the demo:
  - One **FAILED** order for Riya (`DP-SEED000002`, no bbps ref, "debited but failed").
  - One pre-existing ticket on Meera's order that is **overdue and pending with the Biller**.
  - Then regenerate `seed-sql.generated.ts` (`npm run db:gen-seed`).

**API (thin route handlers, isolation preserved: COU → `nbbl/api` only):**

| Route | Behaviour |
|---|---|
| `GET /api/cou/orders` | `CouOrder[]` from `cou_payments`, newest first (single demo user) |
| `POST /api/cou/complaints` | Validates the order and reason, calls `nbbl.raiseComplaint`, inserts `cou_complaints`, returns `CouComplaint` |
| `GET /api/cou/complaints` | COU rows merged with live status from `nbbl.listComplaints({couId})` |
| `GET /api/nbbl/complaints?status=&pendingWith=` | `NbblComplaint[]` |
| `GET /api/nbbl/complaints/stats` | `NbblComplaintStats` |
| `GET /api/nbbl/complaints/[id]` | `NbblComplaintDetail` (events + linked PAY txn) |
| `POST /api/nbbl/complaints/[id]/actions` | `ComplaintActionRequest` → `NbblComplaintDetail`. Invalid transition → 409 `{error}` |

`nbbl.raiseComplaint` looks up the PAY txn by bbps ref, masks the customer, applies `initialAssignee` and `dueAt`, and logs the RAISED and ASSIGNED events. Duplicate raise (same order + reason while OPEN) → returns the existing ticket (idempotent).

## Lanes, agents and models (existing lane ids, so `ownership.json` barely changes)

| Phase | Agent | Model | Owns | Deliverable |
|---|---|---|---|---|
| **P0 Contract** (~15 min, blocking) | **F** | Opus | `types.ts`, new `src/lib/domain/complaints.ts` + `complaints.test.ts`, `supabase/**`, `src/lib/db/**`, `src/lib/client/**` (wrappers + fixtures for every new route), stubs in `parties/nbbl/api.ts` and `parties/cou/api.ts`, `ownership.json` (+ `src/lib/domain/complaints*.ts` for F) | Contract + migration + seed + fixtures, `npm run check` green |
| **P1 Build** (parallel, ~30 min) | **C** | Sonnet | `parties/nbbl/**`, `parties/cou/**`, `api/nbbl/**`, `api/cou/**` | Services, repo, routes, `complaints.int.test.ts` (TEST- rows only) |
| | **D** | Sonnet | `src/app/cou/**`, `src/components/cou/**` | Help entry on Home (header icon + "Help & support" card) → `HelpScreen`: *Raise complaint* (order picker → reason radios → optional note → submit → confirmation with ticket no, BBPS complaint id and due date) and *My tickets* (status pill, "Pending with Bajaj Finance / Bharat Connect / DemoPay", due date, overdue flag) |
| | **E** | Sonnet | `src/app/nbbl/**`, `src/components/ui/**`, `src/components/consoles/**` | Enable the tab as **Complaints**: KPI tiles (open, overdue, pending with Biller / NBBL / COU, closed), filters, table (complaint id, COU ticket, txn ref, biller, reason, pending with, status, due date + overdue pill), detail drawer (linked txn + link to its hop timeline, action timeline, action bar: Assign to COU/NBBL/Biller, Add note, Close with resolution, Reopen). 3 s polling like the txn view |
| **P2 Integrate** (~15 min) | **I** | Opus | anything, minimal edits | Fixtures off, PM applies the migration and seed, fix seams, extend `scripts/smoke.mjs` (raise on the failed order → pending with COU; assign → BILLER; close; COU sees CLOSED; duplicate raise is idempotent; bad transition → 409) |
| **P3 Review** | **R** | Sonnet | `docs/agents/R.md` | `/code-review` medium on the diff + isolation, masking and ASSUMPTION checks; the PM assigns fixes to I |

The Sonnet lanes are the well-specified CRUD and UI work. Opus takes the contract (everything else depends on it) and integration (cross-lane seams). A, B (biller) and OEM stay untouched. **Stretch, cut first:** a read-only "Complaints assigned to you" card on `/biller`, owned by E.

## Operating protocol (PM)
1. Write `docs/COMPLAINTS_PLAN.md` (this plan plus the verbatim agent briefs). Create branch `feat/complaints`. Log to `docs/STATUS.md`.
2. Each agent adds a **"Phase C: Complaints"** section at the top of its `docs/agents/<id>.md`, per `_TEMPLATE.md` (Working on / Done / Pending / Files touched / Contract questions), and updates it at start, at each milestone and at finish.
3. Agents don't run npm install, the dev server, seeds or commits. The PM runs `db:migrate` (additive, idempotent tables) and `db:seed`.
4. At each gate the PM checks: `node scripts/check-ownership.mjs <id>`, `npm run check`, and a read of the agent's status file and diff. Then one commit per lane (`complaints(F): contract …`).
5. P1 lanes launch in one message, in the background. The PM reviews each lane as it reports and sends fixes back to the same agent via SendMessage.

## Critical files
- Modify: `src/lib/domain/types.ts`, `src/lib/db/tables.ts`, `supabase/seed.sql`, `src/lib/db/seed-sql.generated.ts`, `src/lib/client/api.ts`, `src/lib/client/fixtures.ts`, `src/lib/parties/{nbbl,cou}/api.ts`, `src/lib/parties/nbbl/repo.ts`, `src/components/cou/{CouApp,Screens}.tsx`, `src/app/nbbl/page.tsx`, `scripts/smoke.mjs`, `docs/agents/ownership.json`.
- New: `supabase/migrations/0002_complaints.sql`, `src/lib/domain/complaints.ts` + test, `src/app/api/cou/{orders,complaints}/route.ts`, `src/app/api/nbbl/complaints/**`, `src/components/cou/HelpScreens.tsx`, `src/components/consoles/Complaints*.tsx` (or under `src/app/nbbl/`), `src/lib/parties/*/complaints.int.test.ts`.
- Reuse: `maskMobile` (`parties/nbbl/util.ts`), the `sql`/`withTx` pattern (`lib/db/client.ts`), `useAsync` polling + `DataTable`, `StatusPill`, `KpiTile` and `Card` (`components/ui`), `Screen`/`Card` from `components/cou/ui.tsx`, `formatINR`, the route `_http.ts` error helpers in `api/nbbl` and `api/cou`.

## Verification (end to end)
1. `npm run check` (includes the new `complaints.test.ts`) and `npm run test:int` green; `npm run build` green.
2. `npm run db:migrate && npm run db:seed`; the DB explorer lists the three new tables.
3. `npm run smoke`: the existing 23 steps plus the complaint steps, all green.
4. Browser walkthrough (preview_start):
   - `/cou` → Help → pick Riya's failed order → "Payment deducted, transaction failed" → the ticket shows *Pending with DemoPay* and a due date.
   - `/nbbl` → Complaints → the ticket is listed with overdue/KPI counts → open it → Assign to Biller → note → Close (Refunded).
   - Back in `/cou` → My tickets shows **Closed**.
   - The seeded Meera ticket shows as **overdue, pending with Biller**.
   - Screenshots as proof.
5. Reset demo data restores the seeded tickets.
6. Update `docs/STATUS.md`. Commit per lane on `feat/complaints`, then open a PR. Deploying to production (and running the migration against the shared Supabase used by prod) waits for the user's go-ahead.

---

## Agent briefs (the PM pastes these as the agent prompt)

Every brief starts with this: *"You are agent `<id>` on the Bharat BaaS **Complaints** phase. Read `AGENTS.md`, `docs/COMPLAINTS_PLAN.md` (this file), `docs/BUILD_PLAN.md` §2, §6 and §8, and `docs/DOMAIN.md`. Edit only the files you own. At the TOP of `docs/agents/<id>.md`, add a section `## Phase C: Complaints` (State, Working on, Done, Pending, Files touched, Contract questions) and keep it current at start, at each milestone and at finish. Don't run npm install, the dev server, DB migrate/seed/reset, or git commit. Finish with `npm run check` green and `node scripts/check-ownership.mjs <id>` clean."*

### F: Complaints contract (Opus) · P0
Build exactly the **Design** section above:
1. `types.ts`: additive types and DTOs, `COMPLAINT_REASON_LABELS` and `COMPLAINT_PARTY_LABELS`.
2. `src/lib/domain/complaints.ts` (pure) + `complaints.test.ts`.
3. `0002_complaints.sql`.
4. `tables.ts` whitelist.
5. `seed.sql` (truncate the new tables, a FAILED Riya order `DP-SEED000002`, a seeded overdue Meera ticket pending with BILLER, with events). Then run `npm run db:gen-seed`.
6. Stubs (throw `NotImplemented`) with final signatures in `parties/nbbl/api.ts` (`raiseComplaint`, `listComplaints`, `getComplaint`, `complaintAction`, `complaintStats`) and `parties/cou/api.ts` (`listOrders`, `raiseComplaint`, `listComplaints`).
7. Typed wrappers in `src/lib/client/api.ts` for every new route, plus fixtures (≥3 orders incl. a FAILED one, ≥3 complaints covering each pendingWith, OPEN/CLOSED and overdue) with working in-memory raise and action so fixture-mode UIs are clickable.
8. Add `src/lib/domain/complaints*.ts` to F's globs in `ownership.json`.

### C: Complaints backend (Sonnet) · P1
Fill the stubs in `parties/nbbl/**` and `parties/cou/**` (repo functions in each party's repo; COU calls only `nbbl/api`). Add route handlers under `src/app/api/nbbl/complaints/**` and `src/app/api/cou/{orders,complaints}/**`, using the `_http.ts` helpers. Invalid transition → 409 `INVALID_TRANSITION`; unknown complaint/order → 404; bad input → 400.

Rules:
- Raise is idempotent on (order, reason) while OPEN.
- Triage comes from `initialAssignee`, the due date from `dueAt`.
- Every action writes an `nbbl_complaint_events` row.
- CLOSE needs a resolution and sets `closed_at`. REOPEN clears it and resets pendingWith to NBBL.
- NBBL stores only masked customer refs.

Add `src/lib/parties/nbbl/complaints.int.test.ts`, using `TEST-` order ids and cleaning up after itself.

### D: COU Help UI (Sonnet) · P1
Work in `src/components/cou/**` and `src/app/cou/**` against `src/lib/client/api.ts` (with fixtures on it must work fully).
1. Add a Help entry on Home: the header icon and a "Help & support" card.
2. Build `HelpScreen` with two tabs: **Raise a complaint** and **My tickets**.
   - **Raise a complaint** has three steps:
     - (1) Order list: biller, vehicle, amount via `formatINR`, date, status pill, order id / BBPS ref.
     - (2) Reason radios with labels from `COMPLAINT_REASON_LABELS`, an optional note (max 280 chars).
     - (3) Submit → a confirmation screen showing the ticket no, BBPS complaint id, "Pending with …", the due date and "We'll resolve this by {date}".
   - **My tickets**: status pill (Open/Closed), reason, pending-with in plain words (Biller name / Bharat Connect / DemoPay), due date, a red "Overdue" flag, and the resolution when closed. Include a refresh.
3. Match the existing wallet-app look (`ui.tsx`). It must be accessible (labelled radios, focus) and work at 360 px.

### E: NBBL Complaints console (Sonnet) · P1
In `src/app/nbbl/**` (plus `components/ui` / `components/consoles` if needed), replace the disabled "Disputes — Phase 2" tab with a working **Complaints** tab (tab state in the page; the Transactions tab is unchanged).
- **KPI tiles:** Open, Overdue, Pending with Biller / NBBL / COU, Closed.
- **Filters:** status, pending-with.
- **Table:** Complaint id, COU ticket, Txn ref, Biller, Reason, Pending with, Status, Due (with an overdue pill), Age.
- **Row click → detail panel:**
  - Linked txn summary (ref, status, amount), plus a button that switches to Transactions with that ref selected.
  - Event timeline (action, from→to, actor, note, time).
  - Action bar: Assign to COU / NBBL / Biller (disable the current one), Add note (textarea), Close with a resolution select plus note, and Reopen when closed. Show a 409 error inline.
- Poll every 3 s (`useAsync`). Only against `src/lib/client/api.ts`.
- **Stretch:** a read-only "Complaints pending with you" card on `/biller`.

### I: Integration (Opus) · P2 and R: Review (Sonnet) · P3
Covered in the table above. I extends `scripts/smoke.mjs` with the complaint steps and fixes any seams. R reviews the diff and writes its findings to `docs/agents/R.md`.
