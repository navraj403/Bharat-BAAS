/**
 * NBBL (Bharat Connect switch, BBPCU): PUBLIC API. Owner: agent C.
 * Signatures are FINAL (P0). Implement the bodies; do not change the signatures.
 * The COU may import ONLY this file from `parties/nbbl`. NBBL reaches the biller only through
 * `parties/biller/api.ts` (via its own client.ts).
 *
 * NBBL stores TRANSACTION DATA ONLY (nbbl_transactions + nbbl_events): amounts, masked customer
 * refs, response codes and the biller's presentment id (`biller_ref`), never bills.
 * Refs: FETCH `F-` + 10 [A-Z0-9]; PAY = bbpsTxnRef `BC` + 10 [A-Z0-9].
 * Mask mobiles in every stored payload: `9800000001` → `98XXXXXX01`.
 */
import type {
  BillFetchRequest,
  BillFetchResponse,
  BillPaymentRequest,
  BillPaymentResponse,
  BillerSummary,
  Category,
  NbblStats,
  NbblTxn,
  NbblTxnDetail,
  NbblTxnQuery,
} from "@/lib/domain/types";

/** `GET /api/nbbl/billers?category=`. ACTIVE registry entries (all categories if omitted), by name. */
export async function listBillers(category?: Category): Promise<BillerSummary[]> {
  void category;
  throw new Error("NotImplemented");
}

/**
 * `POST /api/nbbl/bill-fetch`. Always creates a FETCH txn and returns its ref as `fetchRef`.
 * - Biller not in registry / inactive → BILLER_UNAVAILABLE, BFR003, txn FAILED.
 * - Log COU_REQ, BILLER_REQ; call `biller/api.fetchBill({nbblRef, billerId, vehicleNo, mobile})`;
 *   log BILLER_RESP, COU_RESP. Store amount_paise and biller_ref (= presentmentId) when BILL_DUE.
 * - Biller throws → BILLER_UNAVAILABLE, SYS500, log ERROR, txn FAILED.
 * - Otherwise txn SUCCESS with the biller's responseCode (000 / BFR001 / BFR002); latency_ms recorded.
 */
export async function billFetch(req: BillFetchRequest): Promise<BillFetchResponse> {
  void req;
  throw new Error("NotImplemented");
}

/**
 * `POST /api/nbbl/bill-pay`.
 * - fetchRef must be a FETCH txn with response_code '000' and a biller_ref; otherwise FAILED,
 *   BPR002, bbpsTxnRef null (no PAY txn issued).
 * - Create a PAY txn with a fresh bbpsTxnRef (fetch_ref, biller_ref, amount), log COU_REQ, PAY_REQ,
 *   call `biller/api.paymentAdvice({billerId, presentmentId: biller_ref, amountPaise, bbpsTxnRef,
 *   mode, paidAt})`, log ADVICE_ACK, COU_RESP. ack → SUCCESS/000 + receipt; nack → FAILED with
 *   the biller's code (BPR001/BPR002). Biller throws → FAILED, SYS500.
 */
export async function billPay(req: BillPaymentRequest): Promise<BillPaymentResponse> {
  void req;
  throw new Error("NotImplemented");
}

/** `GET /api/nbbl/transactions`. Newest first; default limit 50, max 200. */
export async function listTransactions(query?: NbblTxnQuery): Promise<NbblTxn[]> {
  void query;
  throw new Error("NotImplemented");
}

/** `GET /api/nbbl/transactions/:ref`. Txn + events (oldest first), or null (route → 404). */
export async function getTransaction(ref: string): Promise<NbblTxnDetail | null> {
  void ref;
  throw new Error("NotImplemented");
}

/**
 * `GET /api/nbbl/stats`. fetches = FETCH count, payments = PAY count,
 * successRate = SUCCESS / (SUCCESS + FAILED) over all txns (0 if none),
 * valuePaise = sum of SUCCESS PAY amounts.
 */
export async function stats(): Promise<NbblStats> {
  throw new Error("NotImplemented");
}
