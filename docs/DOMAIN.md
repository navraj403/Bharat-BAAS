# Domain brief: BaaS pay-per-km on Bharat Connect

Condensed from the category research (Sep 2026). Figures marked **[S]** are sourced. Figures marked **[A]** are assumptions made for the prototype; in code, tag every **[A]** figure with a `// ASSUMPTION:` comment.

## 1. Why this category

- **What BaaS is:** the EV is sold without the battery, and the owner rents the battery and pays **per km driven**, billed monthly. That lowers the car's upfront price.
- **Why it suits Bharat Connect:** it recurs perfectly, with a monthly bill for a 5–8 year contract. The amount varies with usage, which fits BBPS's **bill fetch** model (the amount is looked up from the biller, not typed in by the payer).
- **Honest sizing:** about 35k per-km BaaS cars today, rising to about 380k by 2030. That is about 4.6 M bills a year worth about ₹2,500 cr, roughly 0.15% of BBPS volume **[S/E, research report]**. This is a strategic, early-mover category, not a volume play, and the demo should say so.
- **Market reality [S]:**
  - True per-km billing in India today is essentially one OEM's model. Its financiers meter km with a telematics device and bill monthly.
  - Other OEMs' "BaaS" is a separate battery loan paid as an EMI, which is already payable under BBPS's *Loan Repayment* category.
- **Proposed BBPS placement:** a new sub-type **"Loan Repayment → EV Battery (BaaS, usage-based)"**, with a variable-amount bill-fetch schema.

## 2. Actors

| Actor | BBPS role | In the prototype |
|---|---|---|
| EV owner | Customer | Customer app user |
| Payment app / bank app | **COU** (Customer Operating Unit) | `/cou` customer app |
| NBBL | **BBPCU** (the central switch) | `/nbbl` monitor; stores transaction data only |
| Financier's bank / aggregator | **BOU** (Biller Operating Unit) | Folded into the biller for simplicity |
| BaaS financier | **Biller** | `/biller` console; fetches bills from the OEM |
| OEM with telematics | Bill generator | `/oem` console; records km, **generates** the bill |

> Per the user's MVP definition: the **OEM generates** the bill, the **biller fetches** it from the OEM, **NBBL** integrates with the biller and relays to the COU, and the **COU** customer fetches and pays. The authoritative version is `docs/BUILD_PLAN.md` §2–§4.

## 3. Pricing (seed data)

Use generic names only (see Guardrails in `AGENTS.md`). **Bill model (user decision): Fixed + Variable.** A fixed monthly battery-subscription fee plus pay-per-use on **actual** km, with **no minimum-km commitment**. Per-km rates mirror real public ranges of ₹3.2–4.9/km **[S]**. The fixed fees are **[A]**.

| Plan ID | Name | Fixed / month | Rate / km | Notes |
|---|---|---|---|---|
| `STD` | Standard | ₹1,500 | ₹3.50 | Most common |
| `PRO` | Pro (long-range pack) | ₹2,000 | ₹4.50 | Bigger battery |
| `FLEX` | Flex | ₹999 | ₹4.00 | Low fixed fee, higher per-km rate: for low-mileage users |

## 4. Billing rules

Everything is in integer **paise**. Rounding happens once, at the line-item level, half-up.

```
cycle              = calendar month; bill generated on day 1 for the previous month   [A]
km_driven          = odometer_end − odometer_start   (from telematics readings in the cycle)
fixed              = plan.fixed_fee, full amount every cycle, even at 0 km, no pro-rating   [A]
variable           = km_driven × plan.rate          ← "pay per use"
subtotal           = fixed + variable
gst                = subtotal × 18%        [A]  keep the rate in one constant; verify before a real launch
late_fee           = if unpaid after due date: 2% of that bill's subtotal, one-time, no GST   [A]
total_due          = subtotal + gst (+ late_fee if overdue)
due_date           = bill_date + 10 days    [A]
presentment        = latest unpaid bill + older unpaid bills (arrears) + their late fees  (biller-side)
```

Example (Standard plan, 1,200 km driven):
- Fixed: ₹1,500.00.
- Variable: 1,200 × ₹3.50 = ₹4,200.00, giving a subtotal of ₹5,700.00.
- GST: ₹1,026.00.
- **Total: ₹6,726.00.**

Required test cases:
- 0 km (fixed + GST only: STD gives ₹1,770.00)
- Typical km on each plan (the §4 acceptance numbers in `BUILD_PLAN.md`)
- Overdue with late fee
- Arrears roll-up
- Paise rounding (GST on ₹5,399 = ₹971.82)

Bill statuses: `GENERATED → FETCHED → PAID`, or `GENERATED → OVERDUE → PAID`.

## 5. The Bharat Connect flow (simplified mock)

> This is a **simplified illustration** of the BBPS pattern, not the NPCI specification. Message names follow the public BBPS vocabulary. Field sets, codes and ID formats below are our own.

```
Customer app (COU)        Switch (NBBL/BBPCU)          Biller (financier)
      │ 1. BillFetchRequest ──▶│                               │
      │   {category, billerId,  │ ──── forward ──────────────▶ │ look up the open bill
      │    customerParams}      │ ◀─── BillFetchResponse ───── │ {amount, dueDate, breakdown}
      │ ◀── BillFetchResponse ──│                               │
      │ 2. user taps Pay (mock UPI)                             │
      │ 3. BillPaymentRequest ─▶│ assign bbpsTxnRef            │
      │                         │ ──── payment advice ───────▶ │ mark bill PAID
      │ ◀── BillPaymentResponse │ ◀─── ack ─────────────────── │
      │                         │ log: FETCH, PAY, CONFIRM      │
```

- **Customer params** for fetching a bill: `vehicleRegNo` (e.g. `MH-01-XX-0001`) **or** `contractId`, plus `registeredMobile` (masked in the UI).
- **bbpsTxnRef** (mock format): `BC` + 10 uppercase alphanumerics, e.g. `BC7K2P9QX4LM`.
- **Response codes** (mock):
  - `000` success
  - `BFR001` no bill due
  - `BFR002` invalid customer params
  - `BPR001` amount mismatch
  - `BPR002` bill already paid
  - `SYS500` biller unavailable (for a failure demo)
- **Payment modes** (all mocked): UPI, UPI AutoPay (mandate), net banking, debit card.
- **AutoPay:** a toggle on the customer app. When a bill is generated for a customer with AutoPay on, the switch runs FETCH → PAY → CONFIRM automatically and logs it with `initiatedBy: "AUTOPAY"`.

## 6. Demo storyline (≈3 min)

1. **Customer app:** Riya's EV drove 1,200 km in August. Her bill is ₹6,726: a fixed ₹1,500 battery fee plus ₹4,200 pay-per-use, each shown on its own line.
2. She taps **Pay via Bharat Connect**. The switch log lights up with FETCH → PAY → CONFIRM and a `BC…` reference.
3. **Biller console:** the bill shows as collected and reconciled against the same reference. Arjun (Flex plan) is **overdue**, so a late fee applies. Meera has AutoPay on, and her bill paid itself.
4. **Close:** why this matters for NBBL. It is the first usage-based mobility bill on the rail, with 2W/3W battery swapping as the next, bigger pool.
