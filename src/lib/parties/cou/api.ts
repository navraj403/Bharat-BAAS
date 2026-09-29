/**
 * COU (DemoPay customer app backend): PUBLIC API. Owner: agent C.
 * Signatures are FINAL (P0). The COU reaches the switch only through `parties/nbbl/api.ts`.
 * COU id: `DEMOPAY`. Order ids: `DP-` + 10 [A-Z0-9].
 */
import { sql } from "@/lib/db/client";
import type {
  BillerSummary,
  Category,
  CouFetchRequest,
  CouPayRequest,
  FetchResult,
  PayResult,
} from "@/lib/domain/types";
import * as nbbl from "@/lib/parties/nbbl/api";
import { newOrderId, normaliseVehicleNo } from "./util";

const COU_ID = "DEMOPAY";

/** Thrown for invalid input; routes map it to 400. */
export class BadRequestError extends Error {
  override name = "BadRequestError";
}

/** `GET /api/cou/billers?category=EV_BAAS`. Proxied from `nbbl/api.listBillers`. */
export async function listBillers(category: Category): Promise<BillerSummary[]> {
  return nbbl.listBillers(category);
}

/** `POST /api/cou/fetch`. Validates, normalises, and passes the NBBL response through. */
export async function fetchBill(req: CouFetchRequest): Promise<FetchResult> {
  const vehicleRegNo = normaliseVehicleNo(req.vehicleNo);
  if (!vehicleRegNo) throw new BadRequestError("Vehicle number is required");
  if (!/^\d{10}$/.test(String(req.mobile ?? ""))) {
    throw new BadRequestError("Mobile must be 10 digits");
  }
  if (!req.billerId) throw new BadRequestError("Biller is required");
  return nbbl.billFetch({
    couId: COU_ID,
    billerId: req.billerId,
    category: "EV_BAAS",
    customerParams: { vehicleRegNo, registeredMobile: req.mobile },
  });
}

/** `POST /api/cou/pay`. simulateFailure never calls NBBL. */
export async function pay(req: CouPayRequest): Promise<PayResult> {
  if (!req.fetchRef) throw new BadRequestError("fetchRef is required");
  if (!Number.isInteger(req.amountPaise) || req.amountPaise <= 0) {
    throw new BadRequestError("amountPaise must be a positive integer");
  }
  if (!req.mode) throw new BadRequestError("mode is required");

  const couOrderId = newOrderId();
  await sql`insert into cou_payments (order_id, fetch_ref, amount_paise, mode, status)
    values (${couOrderId}, ${req.fetchRef}, ${req.amountPaise}, ${req.mode}, 'INITIATED')`;

  if (req.simulateFailure) {
    await sql`update cou_payments set status = 'FAILED', updated_at = now() where order_id = ${couOrderId}`;
    return {
      status: "FAILED",
      couOrderId,
      failureReason: "PAYMENT_DECLINED",
      responseCode: null,
      bbpsTxnRef: null,
      message: "Payment declined by your bank (simulated)",
    };
  }

  let res;
  try {
    res = await nbbl.billPay({
      couId: COU_ID,
      fetchRef: req.fetchRef,
      amountPaise: req.amountPaise,
      mode: req.mode,
      couOrderId,
    });
  } catch {
    await sql`update cou_payments set status = 'FAILED', updated_at = now() where order_id = ${couOrderId}`;
    return {
      status: "FAILED",
      couOrderId,
      failureReason: "BILLER_UNAVAILABLE",
      responseCode: "SYS500",
      bbpsTxnRef: null,
      message: "Biller unavailable",
    };
  }

  if (res.status === "SUCCESS" && res.receipt) {
    await sql`update cou_payments set status = 'SUCCESS', bbps_txn_ref = ${res.bbpsTxnRef},
      biller_id = ${res.receipt.billerId}, vehicle_reg_no = ${res.receipt.vehicleRegNo},
      updated_at = now() where order_id = ${couOrderId}`;
    return {
      status: "SUCCESS",
      couOrderId,
      responseCode: "000",
      receipt: { ...res.receipt, couOrderId },
    };
  }

  await sql`update cou_payments set status = 'FAILED', bbps_txn_ref = ${res.bbpsTxnRef},
    updated_at = now() where order_id = ${couOrderId}`;
  return {
    status: "FAILED",
    couOrderId,
    failureReason: res.responseCode === "SYS500" ? "BILLER_UNAVAILABLE" : "BBPS_REJECTED",
    responseCode: res.responseCode,
    bbpsTxnRef: res.bbpsTxnRef,
    message: res.message,
  };
}
