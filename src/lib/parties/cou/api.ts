/**
 * COU (DemoPay customer app backend): PUBLIC API. Owner: agent C.
 * Signatures are FINAL (P0). Implement the bodies; do not change the signatures.
 * Route handlers under src/app/api/cou/** call these. The COU reaches the switch only through
 * `parties/nbbl/api.ts` (via its own client.ts). COU id: `DEMOPAY`. Order ids: `DP-` + 10 [A-Z0-9].
 */
import type {
  BillerSummary,
  Category,
  CouFetchRequest,
  CouPayRequest,
  FetchResult,
  PayResult,
} from "@/lib/domain/types";

/** `GET /api/cou/billers?category=EV_BAAS`. Proxied from `nbbl/api.listBillers`. */
export async function listBillers(category: Category): Promise<BillerSummary[]> {
  void category;
  throw new Error("NotImplemented");
}

/**
 * `POST /api/cou/fetch`. Validate (vehicleNo non-empty after normalising, mobile /^\d{10}$/;
 * otherwise throw, and the route maps it to 400), normalise vehicleNo, call
 * `nbbl/api.billFetch({couId: 'DEMOPAY', billerId, category: 'EV_BAAS',
 * customerParams: {vehicleRegNo, registeredMobile: mobile}})` and return the response unchanged.
 */
export async function fetchBill(req: CouFetchRequest): Promise<FetchResult> {
  void req;
  throw new Error("NotImplemented");
}

/**
 * `POST /api/cou/pay`. Insert cou_payments INITIATED (new order id).
 * - simulateFailure → FAILED, failureReason PAYMENT_DECLINED, responseCode null; NBBL NOT called.
 * - Else `nbbl/api.billPay({couId, fetchRef, amountPaise, mode, couOrderId})`:
 *   SUCCESS → cou_payments SUCCESS (bbps_txn_ref, biller_id, vehicle_reg_no) and the receipt with
 *   `couOrderId` set; FAILED → cou_payments FAILED, failureReason BILLER_UNAVAILABLE if SYS500,
 *   else BBPS_REJECTED.
 * cou_payments.biller_id / vehicle_reg_no are nullable: fill them from the receipt on success.
 */
export async function pay(req: CouPayRequest): Promise<PayResult> {
  void req;
  throw new Error("NotImplemented");
}
