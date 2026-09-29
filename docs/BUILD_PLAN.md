# Build plan: Bharat BaaS (pay-per-km EV battery bills on Bharat Connect)

**Owner:** PM (Claude, orchestrator). **Build window:** about 2 hours. **Status:** frozen at v1 once the user approves.
This is the one document every build agent works from. The PM hands each agent **its brief (§9)**. The agent reads this file, `AGENTS.md` and `docs/DOMAIN.md`, builds only what its brief owns, and reports status in `docs/agents/<agent-id>.md`.

---

## 1. What we are shipping

A working, deployed prototype of **four parties** exchanging a usage-based EV battery bill over a mock Bharat Connect rail. It runs on **Next.js 16 + Supabase Postgres** and is deployed on **Vercel**.

The demo, about 3 minutes, happens in the customer app (COU):
1. The customer picks **EV Battery (BaaS)**, then the financier **Demo Finance**, then enters the vehicle number and linked mobile.
2. The customer sees **one of three results**: bill due, bill not generated, or already paid.
3. They pay through mock UPI and get a receipt with a Bharat Connect reference (`BC…`).
4. **Fetch again** now shows *Already paid*.
5. The **NBBL monitor** shows the FETCH and PAY transactions with every hop.
6. The **biller console** shows the bill collected.
7. The **OEM console** adds km to a new vehicle and generates its bill, which flips that customer from *Not generated* to *Bill due* live.
8. The **DB explorer** (and Supabase Table Editor) shows the rows each party owns.

## 2. The four parties

| Party | Real-world role | Responsibilities in the MVP | Owns the tables | Does NOT |
|---|---|---|---|---|
| **OEM** (`Sample Motors`) | Car maker plus telematics | Tracks odometer and trips per vehicle, holds the battery plan (**fixed monthly fee + rate per km**), **generates the monthly bill** (fixed + km × rate + GST) | `oem_*` | Know about customers' mobiles or payments beyond a paid flag |
| **Biller** (`Demo Finance`, `Volt Leasing`) | BaaS financier, the biller on BBPS (BOU folded in) | Holds customer KYC (name, **linked mobile**, vehicle, contract). **Pulls bills from the OEM** and turns them into receivables. Adds **arrears and late fee** and presents one payable amount to NBBL. Accepts the **payment advice** and marks bills paid | `biller_*` | Talk to COUs directly |
| **NBBL** (Bharat Connect switch) | BBPCU | Keeps the **biller registry**. Routes bill-fetch and bill-pay between COU and biller. Issues **BBPS transaction refs**. **Captures transaction data only** (txn and event log, never bills). Disputes come in Phase 2 | `nbbl_*` | Store or compute bills |
| **COU** (customer app, `DemoPay`) | Customer Operating Unit, a payment app | Customer UI: category → biller → vehicle no + mobile → result → pay (mock UPI) → receipt. Records its own payment orders | `cou_*` | Talk to the biller or OEM directly |

**Isolation rule, enforced in review:** a party's code under `src/lib/parties/<party>/` may import **only** another party's public `api.ts`, never its `repo.ts` or tables. Every cross-party call goes through a `client.ts` that serialises the request to JSON. That keeps the hops real and lets us split parties into services later.

## 3. Flows

### 3.1 Bill fetch (COU → NBBL → Biller → OEM)
```
COU                         NBBL                          Biller                              OEM
POST /api/cou/fetch ──▶ billFetch(req)
{billerId, vehicleNo,      ├ validate biller in registry
 mobile}                   ├ create txn FETCH (ref F-…) ▶ fetchBill({vehicleNo, mobile})
                           │  log COU_REQ, BILLER_REQ     ├ find customer by vehicle+mobile ─ none ▶ NOT_FOUND
                           │                              ├ syncFromOem(vehicle) ───────────▶ getBills(regNo)
                           │                              │                                   ◀ bills[] (all cycles)
                           │                              ├ upsert receivables, mark OVERDUE past due_date
                           │                              └ build presentment:
                           │                                 unpaid? → BILL_DUE {latest cycle + arrears + late fee}
                           │                                 none unpaid, any paid? → ALREADY_PAID {last payment}
                           │                                 no bills at all? → NOT_GENERATED {nextBillDate}
                           ◀ log BILLER_RESP, close txn
◀ {result, bill|receipt, fetchRef}
```

### 3.2 Bill pay (COU → NBBL → Biller, then OEM flag)
```
COU                              NBBL                                 Biller                           OEM
POST /api/cou/pay ──────────▶ billPay({fetchRef, amountPaise, mode})
{fetchRef, amountPaise, mode,   ├ fetchRef must exist and be BILL_DUE, else BFR/BPR code
 simulateFailure?}              ├ create txn PAY, issue bbpsTxnRef "BC" + 10 [A-Z0-9]
 ├ cou_payments INITIATED       ├ log PAY_REQ ▶ paymentAdvice({presentmentId, amount, bbpsTxnRef, mode})
 │  (mock UPI; simulateFailure  │                                  ├ amount ≠ presentment → BPR001
 │   → FAILED, NBBL not called) │                                  ├ already paid → BPR002 (idempotent: same ref → same ACK)
                                │                                  ├ mark all included receivables PAID, insert payment
                                │                                  └ markPaid(oemBillIds, ref) ─────▶ oem_bills.payment_status = PAID
                                ◀ ACK, log ADVICE_ACK, txn SUCCESS
 ├ cou_payments SUCCESS ◀────────┘
◀ receipt {bbpsTxnRef, biller, amount, paidAt, vehicle}
```

### 3.3 Bill generation (OEM console)
`POST /api/oem/bills/generate {cycle:"YYYY-MM"}` creates, for every active vehicle without a bill in that cycle, a bill from the km recorded in the cycle. Before that, `POST /api/oem/vehicles/:id/trips {km}` adds telemetry. The biller picks new bills up **lazily on the next fetch** (§3.1 `syncFromOem`) and via a "Sync from OEM" button in its console.

## 4. Business rules (the billing engine is pure, in `src/lib/domain/billing.ts`)

All money is **integer paise**. Round half-up once per line item.

| Rule | Formula | Tag |
|---|---|---|
| **Fixed** (battery subscription) | `plan.fixed_fee` per cycle, charged in full even at 0 km, no pro-rating | from plan · `// ASSUMPTION:` no pro-rating |
| **Variable** (pay per use) | `km_driven × rate` on **actual** km, with **no minimum** | from plan |
| Subtotal | fixed + variable | |
| GST | `subtotal × 18%` | `// ASSUMPTION:` |
| Due date | bill_date + 10 days | `// ASSUMPTION:` |
| Late fee | 2% of each **overdue** bill's subtotal, once, no GST on it | `// ASSUMPTION:` |
| Presentment (Biller) | **latest unpaid cycle total + all older unpaid totals (arrears) + late fees** = one payable amount, shown as line items | user decision |
| Payment | **exact amount only** (no part-payment). Clears every receivable in the presentment | |

**Acceptance numbers** (the seed data must reproduce these exactly):

| Customer | Plan | Scenario | Expected result |
|---|---|---|---|
Plans (in seed data): **STD** Standard: ₹1,500 fixed + ₹3.50/km · **PRO** Pro (long-range pack): ₹2,000 fixed + ₹4.50/km · **FLEX** Flex: ₹999 fixed + ₹4.00/km.

| Customer | Plan | Scenario | Expected result |
|---|---|---|---|
| Riya, `MH01AB1001`, mobile `9800000001`, Demo Finance | STD | Aug: 1,200 km, due in future | **BILL_DUE ₹6,726.00** = fixed ₹1,500 + variable ₹4,200 (1,200 × ₹3.50) = ₹5,700 + GST ₹1,026 |
| Arjun, `MH01AB1002`, `9800000002`, Demo Finance | FLEX | Jul 900 km **overdue**, Aug 1,100 km due | **BILL_DUE ₹11,889.62** = Aug ₹6,370.82 (₹999 + ₹4,400 = ₹5,399 + GST ₹971.82) + arrears Jul ₹5,426.82 (₹999 + ₹3,600 = ₹4,599 + GST ₹827.82) + late fee ₹91.98 (2% × ₹4,599) |
| Meera, `MH01AB1003`, `9800000003`, **Volt Leasing** | PRO | Aug 1,850 km, **paid** (ref `BCSEEDPAID01`) | **ALREADY_PAID ₹12,183.50** = ₹2,000 + ₹8,325 = ₹10,325 + GST ₹1,858.50 |
| Kabir, `MH01AB1004`, `9800000004`, Demo Finance | STD | Activated this month, no bill yet | **NOT_GENERATED**. After the OEM adds 1,600 km and generates: **BILL_DUE ₹8,378.00** = ₹1,500 + ₹5,600 = ₹7,100 + GST ₹1,278 |
| Wrong mobile for Riya | – | – | **NOT_FOUND** (a generic message that doesn't reveal which field was wrong) |

Seed dates are **relative to `now()`**, so the statuses hold whenever the seed runs: Aug bill_date = now − 5 days, Jul bill_date = now − 35 days.
Vehicle numbers are **normalised** to uppercase with spaces and dashes removed (`mh-01 ab 1001` → `MH01AB1001`) at the COU and again at the biller. They are displayed as `MH 01 AB 1001`.

## 5. Customer (COU) UX, mobile-first, rendered in a phone frame on desktop

| # | Screen | Content | Notes |
|---|---|---|---|
| 1 | **Home** | DemoPay header, category grid (Electricity, Mobile, FASTag… disabled, with **EV Battery (BaaS)** highlighted as "New") | Only EV Battery works |
| 2 | **Choose biller** | List from NBBL registry for category `EV_BAAS`: Demo Finance, Volt Leasing | Bharat Connect logo-mark placeholder (generic "B" mark, no real logo) |
| 3 | **Enter details** | **Vehicle registration no** (placeholder `MH 01 AB 1001`, uppercase as typed) and **Linked mobile no** (10 digits, `+91` prefix). "Fetch bill" button | Inline validation. Button disabled until valid. A "Demo numbers" helper chip fills the seed values |
| 4a | **Bill due** | Customer name (masked: `Riya S****`), vehicle, bill period, **Fixed battery fee · Pay-per-use (km driven × rate/km) · arrears · late fee · GST · total**, due date (red "Overdue" pill if applicable), "Pay ₹6,726.00" | The breakdown is the hero: this is what makes the category legible |
| 4b | **Not generated** | "No bill generated yet for this vehicle. Bills are generated on the 1st of each month." + "Check again" | Neutral state, not an error |
| 4c | **Already paid** | "Paid ₹12,183.50 on 24 Sep 2026", BBPS ref, mode. "View receipt" | Green state |
| 4d | **Not found / biller unavailable** | "We couldn't find an account for this vehicle and mobile number with Demo Finance." / "Biller is not responding, try again" | Error states with retry |
| 5 | **Pay** | Bottom sheet: UPI (default), Net banking, Debit card. Mock UPI PIN pad (any 4–6 digits). "Simulate failure" toggle, visible in demo mode | No real payment |
| 6 | **Processing → Receipt** | Spinner (≈800 ms), then a receipt: ✓ Paid, amount, biller, vehicle, **Bharat Connect ref BC…**, COU order id, time. "Done" returns to screen 3 with values kept | "Fetch again" demo shows 4c |

**Console screens** (desktop; top nav switches party: `Customer app · OEM · Biller · NBBL · Database`):

| Route | Content |
|---|---|
| `/` | Landing: a 4-party diagram with one link per party plus the demo script. **Reset demo data** button |
| `/cou` | The customer app above, in the phone frame |
| `/oem` | Vehicles table (reg no, model, plan, odometer, **km this cycle**, last bill status). "+100 km" / "+500 km" / custom km per row, plus a per-row **Generate bill** button (calls generate with `[vehicleId]`; **this is the button used in the demo**). A bulk **Generate bills for {cycle}** (cycle picker, defaults to the current month) sits behind a confirm, because it also bills Riya, Arjun and Meera for the current month. Bills table |
| `/biller` | Biller switcher (Demo Finance / Volt Leasing). KPI tiles (receivables due, collected, overdue count). Customers table. Receivables table (status pills UNPAID / OVERDUE / PAID). Payments table with BBPS ref. **Sync from OEM** |
| `/nbbl` | KPI tiles (fetches, payments, success rate, value processed). Transactions table (ref, type, biller, COU, masked customer ref, amount, response code, latency). Click a row to see the **hop timeline** (COU_REQ → BILLER_REQ → BILLER_RESP → COU_RESP with JSON payloads). Auto-refresh every 3 s. "Disputes: Phase 2" tab (disabled) |
| `/admin/db` | Table list grouped by party with row counts. Click a table to see its rows (read-only, newest first, 100 max). Link to the Supabase Table Editor |

## 6. Technical design

### 6.1 Stack additions (Phase 0 installs them; nobody else runs `npm install`)
- `postgres` (postgres.js): SQL client for Supabase through the **transaction pooler**, with `prepare: false`. One dependency and plain SQL.
- No ORM, no supabase-js (no auth or realtime needed), and no `tsx`. Scripts are `.mjs` run with `node --env-file=.env.local`.
- `next.config.ts`: `serverExternalPackages: ['postgres']` if bundling complains.

### 6.2 Environment (`.env.local`, never committed; `.env.example` is committed)
```
NEXT_PUBLIC_SUPABASE_URL=https://widcwzssxwffnulrajgx.supabase.co     # set (links to Supabase from the DB explorer)
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…                 # set; not used by the server path
DATABASE_URL=postgresql://postgres.widcwzssxwffnulrajgx:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
NEXT_PUBLIC_USE_FIXTURES=0     # 1 = UI uses local fixtures instead of the API (Phase 1 UI agents)
NEXT_PUBLIC_DEMO_MODE=1        # shows demo helpers (demo-number chips, simulate-failure toggle)
```

### 6.3 Folder layout and file ownership
```
supabase/
  migrations/0001_init.sql        # all tables (P0)
  seed.sql                        # deterministic, now()-relative seed (P0)
scripts/
  db-migrate.mjs  db-seed.mjs     # apply migrations / truncate+seed (P0)
  smoke.mjs                       # end-to-end API scenario (P2)
  check-ownership.mjs             # verifies agents stayed in their lanes (P0)
src/lib/
  domain/  types.ts (P0) · money.ts · billing.ts · *.test.ts (A)
  db/      client.ts (P0: sql tag, withTx) · seed.ts (P0: resetAndSeed())
  parties/
    oem/    api.ts · repo.ts · service.ts                 (A)
    biller/ api.ts · repo.ts · service.ts · client.ts     (B; client.ts calls oem/api)
    nbbl/   api.ts · repo.ts · service.ts · client.ts · txnref.ts (C; client.ts calls biller/api)
    cou/    api.ts · repo.ts · service.ts · client.ts     (C; client.ts calls nbbl/api)
    admin/  api.ts (tables list/rows, reset)              (C)
  client/  api.ts (P0: typed browser fetch wrappers + fixture switch) · fixtures.ts (P0)
src/app/
  api/oem/** (A) · api/biller/** (B) · api/nbbl/** api/cou/** api/admin/** (C)
  cou/** + src/components/cou/** (D)
  layout.tsx · page.tsx · oem/** · biller/** · nbbl/** · admin/** · src/components/ui/** src/components/consoles/** (E)
  globals.css (P0 writes theme tokens; E may extend)
```
P0 writes `api.ts` in each party folder with **final function signatures and stub bodies that throw `NotImplemented`**. The implementing agent fills in the bodies and must not change the signatures.

### 6.4 Data model (`0001_init.sql`)
```
oem_plans           (id text pk, name, fixed_fee_paise int, rate_paise_per_km int)
oem_vehicles        (id uuid pk, reg_no text unique, vin, model, plan_id → oem_plans, odometer_km int, activated_on date)
oem_trips           (id uuid pk, vehicle_id → oem_vehicles, km int, recorded_at timestamptz)
oem_bills           (id uuid pk, bill_no text unique, vehicle_id, cycle text 'YYYY-MM', km_driven int, fixed_fee_paise, rate_paise_per_km,
                     variable_paise, subtotal_paise, gst_paise, total_paise, bill_date date, due_date date,
                     payment_status text default 'UNPAID', paid_ref text, paid_at timestamptz, unique(vehicle_id, cycle))
biller_billers      (id text pk, name, category 'EV_BAAS')
biller_customers    (id uuid pk, biller_id → biller_billers, name, mobile text, vehicle_reg_no text, contract_id text,
                     unique(biller_id, vehicle_reg_no))
biller_receivables  (id uuid pk, biller_id, customer_id, oem_bill_id uuid unique, cycle, subtotal_paise, gst_paise, total_paise,
                     due_date, status 'UNPAID'|'OVERDUE'|'PAID', late_fee_paise int default 0, synced_at, paid_payment_id)
biller_presentments (id uuid pk, biller_id, customer_id, receivable_ids uuid[], amount_paise, breakdown jsonb, created_at, status 'OPEN'|'PAID')
biller_payments     (id uuid pk, biller_id, presentment_id, bbps_txn_ref text unique, amount_paise, mode, paid_at)
nbbl_billers        (id text pk, name, category, status 'ACTIVE')     -- registry (NBBL's copy)
nbbl_transactions   (id uuid pk, ref text unique, type 'FETCH'|'PAY', cou_id, biller_id, category, customer_ref_masked,
                     amount_paise, status 'PENDING'|'SUCCESS'|'FAILED', response_code, fetch_ref, created_at, completed_at, latency_ms)
nbbl_events         (id bigserial pk, txn_ref, step text, payload jsonb, at timestamptz)
cou_payments        (id uuid pk, order_id text unique, fetch_ref, bbps_txn_ref, biller_id, vehicle_reg_no, amount_paise,
                     mode, status 'INITIATED'|'SUCCESS'|'FAILED', created_at, updated_at)
```
RLS stays **off**. The app connects server-side only, with no anon access. Before sharing the URL publicly, enable RLS with no policies on every table (the service connection bypasses it). P4 does this.

### 6.5 API contract (all JSON; errors are `{error:{code,message}}`)
| Party | Method + route | Request → Response |
|---|---|---|
| COU | `GET /api/cou/billers?category=EV_BAAS` | → `BillerSummary[]` (proxied from NBBL) |
| COU | `POST /api/cou/fetch` | `{billerId, vehicleNo, mobile}` → `FetchResult` |
| COU | `POST /api/cou/pay` | `{fetchRef, amountPaise, mode, simulateFailure?}` → `PayResult` |
| NBBL | `GET /api/nbbl/billers?category=` | → `BillerSummary[]` |
| NBBL | `POST /api/nbbl/bill-fetch` | `BillFetchRequest` → `BillFetchResponse` |
| NBBL | `POST /api/nbbl/bill-pay` | `BillPaymentRequest` → `BillPaymentResponse` |
| NBBL | `GET /api/nbbl/transactions` / `GET /api/nbbl/transactions/:ref` | → `NbblTxn[]` / `NbblTxn & {events}` |
| NBBL | `GET /api/nbbl/stats` | → `{fetches, payments, successRate, valuePaise}` |
| Biller | `POST /api/biller/bbps/fetch` | `BillerFetchRequest` → `BillerFetchResponse` (BOU-facing) |
| Biller | `POST /api/biller/bbps/payment-advice` | `PaymentAdvice` → `PaymentAdviceAck` |
| Biller | `GET /api/biller/overview?billerId=` | → `BillerOverview` |
| Biller | `POST /api/biller/sync` | `{billerId}` → `{synced:number}` |
| OEM | `GET /api/oem/vehicles` | → `OemVehicleRow[]` |
| OEM | `POST /api/oem/vehicles/:id/trips` | `{km}` → `OemVehicleRow` |
| OEM | `POST /api/oem/bills/generate` | `{cycle, vehicleIds?}` → `{generated: OemBill[]}`. With `vehicleIds`, only those vehicles are billed (per-row button; the demo uses this for Kabir) |
| OEM | `GET /api/oem/bills?regNo=` | → `OemBill[]` (for the biller pull, and for the console) |
| Admin | `GET /api/admin/tables` / `GET /api/admin/tables/:name` | → `{party, table, rows:number}[]` / `{columns, rows}` (whitelisted table names only) |
| Admin | `POST /api/admin/reset` | → `{ok:true}` (truncate + seed) |

`FetchResult.result` is one of `BILL_DUE | NOT_GENERATED | ALREADY_PAID | NOT_FOUND | BILLER_UNAVAILABLE`. NBBL response codes follow `docs/DOMAIN.md` §5, with `BFR003` added for "biller not registered". **Exact TypeScript shapes live in `src/lib/domain/types.ts`**. P0 writes it and it is then frozen; changes are additive only.

---

## 7. Phases, timeline and parallelism

```
0:00 ─ P0 Foundation (1 agent, Opus) ─────────────── 0:20  GATE 0
0:20 ─ P1 Build: 5 agents in parallel ────────────── 1:05  GATE 1
        A OEM+billing (Sonnet)   B Biller (Opus)   C NBBL+COU+Admin API (Sonnet)
        D Customer app UI (Sonnet)                 E Consoles + shell UI (Sonnet)
1:05 ─ P2 Integration (1 agent, Opus) ────────────── 1:30  GATE 2
1:30 ─ P3 QA & polish (PM walkthrough + review agent, Sonnet) ─ 1:45  GATE 3
1:45 ─ P4 Ship: Vercel + Supabase hardening (PM + user) ─ 2:00  GATE 4
```

| Phase | Agents (model) | Depends on | Output | Gate check (PM runs it) |
|---|---|---|---|---|
| **P0 Foundation** | F (Opus): contract-critical, everything else builds on it | Supabase `DATABASE_URL` from the user by ~0:10 | `types.ts`, migration, seed, db client, scripts, party `api.ts` stubs, typed browser client + fixtures, theme tokens, `.env.example`, ownership map | `npm run check` green · `npm run db:migrate && npm run db:seed` succeed · row counts match §4 · PM commits `p0: foundation` |
| **P1 Build** | A (Sonnet), B (**Opus**, because arrears, presentment and idempotency logic is the hardest), C (Sonnet), D (Sonnet), E (Sonnet) | Gate 0 | Party services and routes, customer app, consoles | Every `docs/agents/*.md` says **DONE** · `node scripts/check-ownership.mjs` clean · `npm run check` green · PM commits one commit per lane |
| **P2 Integration** | I (Opus) | Gate 1 | `NEXT_PUBLIC_USE_FIXTURES=0`; fix seams; `scripts/smoke.mjs` covering all §4 scenarios plus pay, re-fetch, double-pay and failure | `npm run smoke` green against the local dev server · `npm run build` green |
| **P3 QA** | PM (browser walkthrough of §1 demo) + R (Sonnet) review of the diff for bugs and lane violations | Gate 2 | Fix list, applied by I, or by R if small | Demo script passes twice in a row after **Reset demo data** |
| **P4 Ship** | PM + **user** | Gate 3 | Vercel project, env vars set, RLS enabled, deployed URL | `npm run smoke -- --base=https://<url>` green |

**Parallelism map (P1).** Nothing blocks anything else, because every lane codes against the frozen contract:
- **A, B and C** each call the next party through the stubbed `api.ts`, and each ships its own party's service. The chain only runs end to end after P2.
- **B** can finish before **A**: `syncFromOem` calls `oem/api.getBillsByRegNo`, which reads seeded `oem_bills`.
- **D and E** build entirely on `src/lib/client/api.ts` with `NEXT_PUBLIC_USE_FIXTURES=1`, and never touch the DB.
- **Critical path:** P0 → B → P2. If B slips, the PM moves the late-fee and arrears line items to P2 and B ships the single-bill presentment first.

**Fallbacks if time runs short (cut in this order):** OEM custom-km input (keep ±100/500 buttons) → biller switcher (Demo Finance only) → NBBL auto-refresh (manual refresh button) → DB explorer rows view (keep counts plus a Supabase link). **Never cut:** the COU fetch/pay flow, the three result states, the NBBL txn log, or reset.

---

## 8. Agent operating protocol (how the PM keeps agents from overwriting each other)

1. **One working tree, disjoint ownership.** Each agent edits only the globs in its brief. `scripts/check-ownership.mjs` compares `git status` against `docs/agents/ownership.json`, and the PM runs it at every gate and when any agent reports.
2. **Status files.** Each agent keeps `docs/agents/<id>.md` current, using the template in `docs/agents/_TEMPLATE.md`: state (WORKING / BLOCKED / DONE), done, pending, files touched, contract questions. It updates the file **when it starts, at each milestone, and when it finishes**. The PM reads these files instead of guessing.
3. **Contract changes.** Don't edit `types.ts` or any `api.ts` signature. Write the request in your status file under *Contract questions*. The PM decides and makes the change, additive only.
4. **Shared resources.**
   - Only P0 runs `npm install`.
   - Only the PM runs the dev server.
   - Only the PM (or I in P2) runs `db:seed` or reset.
   - P1 backend agents verify with Vitest service tests (`*.int.test.ts`, run with `npm run test:int`) against Supabase. Those tests may create rows **only with the prefix `TEST-`** (vehicle `TEST…`, bill_no `TEST-…`) and delete them afterwards.
5. **Git.** Agents do **not** commit. The PM commits per lane at gates (`p1(A): oem service + billing engine`), after the ownership check and `npm run check`.
6. **Definition of done per agent:** brief acceptance checks pass, `npm run check` passes, and the status file says DONE with *pending: none*, or lists what was cut.
7. **Codex option.** Any P1 lane brief is self-contained. To hand a lane to Codex instead of a Claude subagent, give Codex the same brief. It reads `AGENTS.md` automatically and follows the same status-file protocol.

---

## 9. Agent briefs (paste as the agent prompt)

> Every brief implicitly starts with this: *"You are agent `<id>` on the Bharat BaaS build. Read `AGENTS.md`, `docs/DOMAIN.md` and `docs/BUILD_PLAN.md` (§2–§6 and §8) first. Edit only the files you own. Keep `docs/agents/<id>.md` updated per the protocol. Don't run npm install, the dev server, or DB resets. Finish with `npm run check` green."*

### F: Foundation (Opus) · P0 · 20 min
**Owns:** `src/lib/domain/types.ts`, `src/lib/db/**`, `src/lib/client/**`, `src/lib/parties/*/api.ts` (stubs), `supabase/**`, `scripts/db-*.mjs`, `scripts/check-ownership.mjs`, `docs/agents/ownership.json`, `package.json`, `package-lock.json`, `.env.example`, `next.config.ts`, `src/app/globals.css`, `vitest.config.mts`.
**Build:**
1. Install `postgres`. Add scripts: `db:migrate`, `db:seed` (both `node --env-file=.env.local scripts/…`), `test:int` (vitest on `*.int.test.ts`, loads `.env.local`), `smoke` (placeholder). Keep `test` for pure tests only (exclude `*.int.test.ts`).
2. Write `types.ts`: every DTO in §6.5, the enums, `ResponseCode`, and the domain rows. Pick km as an **integer** and money as **integer paise**.
3. Write `0001_init.sql` (§6.4) and a `seed.sql` that reproduces §4 exactly with `now()`-relative dates. Add `src/lib/db/client.ts` (a singleton `sql` with `prepare:false`, reused across hot reloads via `globalThis`) and `src/lib/db/seed.ts` (`resetAndSeed()`, which truncates all tables and runs the seed SQL string, shared with `db-seed.mjs`).
4. Write `api.ts` stubs for oem, biller, nbbl, cou and admin with final signatures matching §3 and §6.5, and bodies that `throw new Error('NotImplemented')`.
5. Write `src/lib/client/api.ts`: typed fetch wrappers for every route. When `NEXT_PUBLIC_USE_FIXTURES=1`, return `fixtures.ts` data, which covers all 4 COU result states, 4 vehicles, both billers and ~6 NBBL txns with events.
6. Write theme tokens in `globals.css` (`@theme`): a neutral console palette plus a Bharat Connect-ish accent. Generic, no real logos.
7. Write `ownership.json` (agent id → globs, from §9) and `check-ownership.mjs`.
8. Create `docs/agents/_TEMPLATE.md` copies for A–E, I and R with state `NOT STARTED`.
**Acceptance:** Gate 0 row in §7. `select count(*)` per table matches the seed: 3 plans, 4 vehicles, 4 OEM bills (Jul Arjun, Aug Riya, Arjun and Meera), 2 billers, 4 customers.

### A: OEM service + billing engine (Sonnet) · P1
**Owns:** `src/lib/domain/money.ts`, `src/lib/domain/billing.ts`, `src/lib/domain/*.test.ts`, `src/lib/parties/oem/**`, `src/app/api/oem/**`.
**Build:**
- `money.ts`: `formatINR(paise)` giving `₹11,889.62` with Indian grouping, plus `pct(paise, bps)` rounding half-up.
- `billing.ts`: `computeBill(plan, kmDriven)` returning `{fixed, variable, subtotal, gst, total}`, plus `lateFee(subtotal)` and `dueDate(billDate)`, with `// ASSUMPTION:` tags.
- Vitest covering 0 km (fixed + GST only), typical km per plan, late fee and paise rounding (e.g. GST on ₹5,399 = ₹971.82), including all §4 numbers.
- OEM service: list vehicles with km-this-cycle, `addTrip`, `generateBills(cycle)` (idempotent per vehicle and cycle), `getBillsByRegNo` and `markPaid(billIds, ref)`.
- OEM route handlers.
**Acceptance:** tests green. An int test shows that generating for Kabir after +1,600 km yields ₹8,378.00 (on a `TEST-` vehicle).

### B: Biller service (Opus) · P1
**Owns:** `src/lib/parties/biller/**`, `src/app/api/biller/**`.
**Build:**
- `fetchBill({vehicleNo, mobile})`: normalise the vehicle number, match the customer, and return NOT_FOUND on a mismatch. Then `syncFromOem`, which pulls through `oem/api` and upserts receivables. Mark past-due receivables OVERDUE and apply the late fee once. Build a presentment (§4) with a line-item `breakdown`.
- Results: BILL_DUE, ALREADY_PAID with the last payment, or NOT_GENERATED with the next bill date (the 1st of next month).
- `paymentAdvice(...)`: exact-amount check (BPR001). Idempotency: the same `bbpsTxnRef` returns the same ACK, and a different ref on a PAID presentment returns BPR002. Mark receivables PAID, insert the payment, and call `oem/api.markPaid`. Wrap it in a transaction.
- `overview(billerId)` and `sync(billerId)`. Route handlers for §6.5 Biller.
**Acceptance:** int tests (`TEST-` data) for due, arrears plus late fee (reproduce ₹11,889.62 logic on test rows), already paid, not found, exact-amount mismatch and double-pay idempotency.

### C: NBBL switch + COU backend + Admin API (Sonnet) · P1
**Owns:** `src/lib/parties/nbbl/**`, `src/lib/parties/cou/**`, `src/lib/parties/admin/**`, `src/app/api/nbbl/**`, `src/app/api/cou/**`, `src/app/api/admin/**`.
**Build:**
- **NBBL:**
  - Registry lookup, returning BFR003 if the biller isn't registered.
  - `billFetch` creates a FETCH txn (`F-` + 10 chars), logs COU_REQ, BILLER_REQ, BILLER_RESP and COU_RESP events with payloads (mask the mobile as `98XXXXXX01`), and records latency.
  - `billPay` validates the fetch ref, issues `BC` + 10 [A-Z0-9], calls `biller/api.paymentAdvice`, logs the events and closes the txn.
  - If the biller throws, return BILLER_UNAVAILABLE (SYS500).
  - Also `listTransactions`, `getTransaction(ref)` and `stats`. NBBL stores **no bill data** beyond amount and masked references.
- **COU:** `listBillers`, `fetch` and `pay`. `pay` creates `cou_payments` INITIATED; with `simulateFailure` it marks FAILED without calling NBBL; otherwise it calls NBBL and marks SUCCESS or FAILED and returns the receipt.
- **Admin:** a whitelisted table list with counts, rows, and `reset` (calls `resetAndSeed`).
**Acceptance:** int tests with `biller/api` mocked through `vi.mock` for fetch→pay happy path, unknown biller, biller down, and pay with a bad fetch ref.

### D: Customer app UI (Sonnet) · P1
**Owns:** `src/app/cou/**`, `src/components/cou/**`.
**Build:**
- All §5 COU screens 1–6 as client components in a phone frame, using only `src/lib/client/api.ts` with fixtures on.
- The state machine is `home → biller → details → result(4a–4d) → pay → processing → receipt`.
- Use `formatINR` for all money. The breakdown table labels the fixed battery fee, pay-per-use (km × rate), arrears, late fee and GST explicitly.
- Demo chips fill the seed vehicle and mobile pairs. There is a simulate-failure toggle.
- Accessible labels, visible focus, and it works at 360 px.
**Acceptance:** every fixture state is reachable by clicking. `npm run check` and `npm run build` green.

### E: Consoles + app shell (Sonnet) · P1
**Owns:** `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/oem/**`, `src/app/biller/**`, `src/app/nbbl/**`, `src/app/admin/**`, `src/components/ui/**`, `src/components/consoles/**`. It may extend `globals.css` (append only).
**Build:**
- The top nav (the party switcher) and the landing page with the 4-party diagram, demo script and **Reset demo data** button.
- The OEM, Biller, NBBL and DB explorer screens per §5, using only `src/lib/client/api.ts` with fixtures on.
- Status pills, KPI tiles, tables, and the NBBL hop timeline with collapsible JSON. Polling at 3 s on NBBL.
**Acceptance:** all 5 routes render fixture data. `npm run check` and `npm run build` green.

### I: Integrator (Opus) · P2
**Owns:** everything, but prefers minimal edits and records each cross-lane fix in `docs/agents/I.md`.
**Build:**
- Set fixtures off, run `db:seed`, and let the PM run the dev server.
- Write `scripts/smoke.mjs`, which takes a `--base` URL, covers every §4 row, then pays Riya, re-fetches (expecting ALREADY_PAID), double-pays (expecting idempotent/BPR002), and runs simulate-failure and Kabir's generate-then-fetch. It resets at the end.
- Fix whatever breaks. `npm run build` green.
**Acceptance:** Gate 2.

### R: Reviewer (Sonnet) · P3
Run `/code-review` against the P0→P2 diff at medium effort. Also check the party isolation rule (§2): no cross-party repo imports, money as floats, missing `// ASSUMPTION:` tags, and unmasked mobiles in NBBL. Report fixes needed; the PM assigns them.

---

## 10. What the user needs to do

| When | What | Why |
|---|---|---|
| **Now (P0, by ~0:10)** | Create a Supabase project and paste the **Transaction pooler URI** (Project → Connect → Transaction pooler, port 6543) into `.env.local` as `DATABASE_URL`, or give it to the PM to write | P0 runs the migrations and seed. Don't paste the password in chat if you'd rather not; write the file yourself |
| P4 (~1:45) | Sign in to Vercel (`npx vercel login`, in your own terminal), then approve the deploy | The PM can't enter credentials. The PM sets env vars through the CLI once you're signed in |
| Any time | Answer any contract question the PM escalates | Keeps agents unblocked |

## 11. Phase 2 (explicitly out of scope for the 2-hour build)
Dispute and complaint raising and tracking at NBBL (`nbbl_disputes`, the COU "Raise complaint" button, biller response SLA) · UPI AutoPay mandates for BaaS bills · reminders and notifications · partial payments · real telematics ingestion · auth per party · a reconciliation report (NBBL settlement vs biller collections) · separate deployables per party.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Supabase credentials are late | P0 writes the SQL and runs everything else. A/B/C int tests wait; D/E are unaffected (fixtures). |
| Agents clobber shared DB rows | Only `TEST-` rows in tests, only the PM seeds, and the seed runs again at Gate 2 |
| postgres.js with the pooler (prepared statements) | `prepare:false`. A single client via `globalThis` avoids exhausting connections in dev |
| Next 16 API drift | Agents read `node_modules/next/dist/docs/` before using route-handler params (`params` is a Promise) |
| Biller logic overruns | Ship single-bill presentment first; add arrears and late fee in P2 (§7 fallback) |
| Public URL exposes the DB | Server-only connection, RLS on with no policies, admin routes whitelisted, demo data only |
