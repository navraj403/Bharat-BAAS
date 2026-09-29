/**
 * Biller (BaaS financier: Demo Finance, Volt Leasing; BOU folded in): PUBLIC API. Owner: agent B.
 * Signatures are FINAL (P0). Implement the bodies; do not change the signatures.
 * NBBL may import ONLY this file from `parties/biller`. The biller reaches the OEM only through
 * `parties/oem/api.ts` (via its own client.ts).
 *
 * Rules (BUILD_PLAN §3.1, §3.2, §4):
 * - Vehicle numbers are normalised: uppercase, spaces and dashes removed.
 * - A receivable is OVERDUE when due_date < today and it is not PAID.
 * - Late fee: 2% (half-up) of an OVERDUE receivable's SUBTOTAL, applied ONCE, no GST.
 * - Presentment amount = latest unpaid cycle total + older unpaid totals (arrears) + late fees,
 *   shown as line items (see BillLineItem ordering in types.ts).
 * - Payment is exact-amount only; it clears every receivable in the presentment.
 * - Customer names in DTOs are masked (`Riya S****`); mobiles as `98XXXXXX01`.
 */
import type {
  BillerFetchRequest,
  BillerFetchResponse,
  BillerOverview,
  BillerSyncResponse,
  PaymentAdvice,
  PaymentAdviceAck,
} from "@/lib/domain/types";

/**
 * `POST /api/biller/bbps/fetch` (BOU-facing; called by NBBL).
 * 1. Normalise vehicleNo; find the customer by (billerId, vehicle_reg_no) AND mobile.
 *    No match (or wrong mobile) → NOT_FOUND / BFR002 with a generic message.
 * 2. syncFromOem: `oem/api.getBillsByRegNo`, upsert receivables by oem_bill_id (cycle, amounts,
 *    due_date; never downgrade PAID), mark past-due ones OVERDUE and set late_fee_paise once.
 * 3. Any UNPAID/OVERDUE → create a biller_presentments row (OPEN; breakdown = the BillPresentment
 *    JSON) and return BILL_DUE / 000. (May reuse the latest OPEN presentment if its
 *    receivable_ids and amount are unchanged.)
 *    None unpaid but a payment exists → ALREADY_PAID / BFR001 with the last payment's receipt.
 *    No bills at all → NOT_GENERATED / BFR001 with nextBillDate = 1st of next month.
 * Seed acceptance: Riya 672600, Arjun 1188962, Meera ALREADY_PAID 1218350, Kabir NOT_GENERATED.
 */
export async function fetchBill(req: BillerFetchRequest): Promise<BillerFetchResponse> {
  void req;
  throw new Error("NotImplemented");
}

/**
 * `POST /api/biller/bbps/payment-advice` (called by NBBL after it issues bbpsTxnRef). One transaction:
 * - A biller_payments row with this bbpsTxnRef exists → return the SAME ack (idempotent).
 * - Presentment unknown or already PAID → ack=false, BPR002.
 * - amountPaise ≠ presentment.amount_paise → ack=false, BPR001.
 * - Else: insert biller_payments, mark the presentment PAID and its receivables PAID
 *   (paid_payment_id), then `oem/api.markPaid(oemBillIds, bbpsTxnRef, paidAt)`; ack=true, 000,
 *   with the Receipt.
 */
export async function paymentAdvice(advice: PaymentAdvice): Promise<PaymentAdviceAck> {
  void advice;
  throw new Error("NotImplemented");
}

/** `GET /api/biller/overview?billerId=`. KPIs + customers + receivables + payments. Unknown id → throw (404). */
export async function overview(billerId: string): Promise<BillerOverview> {
  void billerId;
  throw new Error("NotImplemented");
}

/** `POST /api/biller/sync {billerId}`. Runs syncFromOem for every customer of the biller. */
export async function sync(billerId: string): Promise<BillerSyncResponse> {
  void billerId;
  throw new Error("NotImplemented");
}
