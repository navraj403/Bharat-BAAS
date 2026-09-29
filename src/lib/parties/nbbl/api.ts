/**
 * NBBL (Bharat Connect switch, BBPCU): PUBLIC API. Owner: agent C.
 * Signatures are FINAL (P0). The COU may import ONLY this file from `parties/nbbl`.
 * NBBL reaches the biller only through `parties/biller/api.ts`.
 *
 * NBBL stores TRANSACTION DATA ONLY (nbbl_transactions + nbbl_events): amounts, masked customer
 * refs, response codes and the biller's presentment id (`biller_ref`), never bills.
 * Refs: FETCH `F-` + 10 [A-Z0-9]; PAY = bbpsTxnRef `BC` + 10 [A-Z0-9].
 */
import * as biller from "@/lib/parties/biller/api";
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
  ResponseCode,
  ResponseMeta,
} from "@/lib/domain/types";
import { RESPONSE_MESSAGES } from "@/lib/domain/types";
import * as repo from "./repo";
import { maskMobile, newBbpsTxnRef, newFetchRef, normaliseVehicleNo } from "./util";

const meta = (code: ResponseCode): ResponseMeta => ({
  responseCode: code,
  message: RESPONSE_MESSAGES[code],
});

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** `GET /api/nbbl/billers?category=`. ACTIVE registry entries (all categories if omitted), by name. */
export async function listBillers(category?: Category): Promise<BillerSummary[]> {
  return repo.listBillers(category);
}

/**
 * `POST /api/nbbl/bill-fetch`. Always creates a FETCH txn and returns its ref as `fetchRef`.
 * Unknown/inactive biller -> BFR003; biller throws -> SYS500; otherwise the biller's code.
 */
export async function billFetch(req: BillFetchRequest): Promise<BillFetchResponse> {
  const started = Date.now();
  const ref = newFetchRef();
  const vehicleNo = normaliseVehicleNo(req.customerParams.vehicleRegNo);
  const mobile = req.customerParams.registeredMobile;
  const masked = maskMobile(mobile);

  await repo.insertTxn({
    ref,
    type: "FETCH",
    couId: req.couId,
    billerId: req.billerId,
    category: req.category,
    customerRefMasked: `${vehicleNo} / ${masked}`,
  });
  await repo.logEvent(ref, "COU_REQ", {
    couId: req.couId,
    billerId: req.billerId,
    category: req.category,
    customerParams: { vehicleRegNo: vehicleNo, registeredMobile: masked },
  });

  const reg = await repo.findBiller(req.billerId);
  if (!reg || reg.status !== "ACTIVE") {
    const resp: BillFetchResponse = {
      result: "BILLER_UNAVAILABLE",
      billerId: req.billerId,
      ...(reg ? { billerName: reg.name } : {}),
      ...meta("BFR003"),
      fetchRef: ref,
    };
    await repo.logEvent(ref, "ERROR", {
      code: "BFR003",
      reason: "Biller not registered or inactive",
    });
    await repo.logEvent(ref, "COU_RESP", { result: resp.result, responseCode: "BFR003" });
    await repo.closeTxn(ref, "FAILED", "BFR003", Date.now() - started);
    return resp;
  }

  await repo.logEvent(ref, "BILLER_REQ", {
    nbblRef: ref,
    billerId: req.billerId,
    vehicleNo,
    mobile: masked,
  });

  let bres;
  try {
    bres = await biller.fetchBill({ nbblRef: ref, billerId: req.billerId, vehicleNo, mobile });
  } catch (e) {
    const resp: BillFetchResponse = {
      result: "BILLER_UNAVAILABLE",
      billerId: req.billerId,
      billerName: reg.name,
      ...meta("SYS500"),
      fetchRef: ref,
    };
    await repo.logEvent(ref, "ERROR", { code: "SYS500", reason: errMsg(e) });
    await repo.logEvent(ref, "COU_RESP", { result: resp.result, responseCode: "SYS500" });
    await repo.closeTxn(ref, "FAILED", "SYS500", Date.now() - started);
    return resp;
  }

  const amount = bres.result === "BILL_DUE" ? bres.bill.amountPaise : null;
  const billerRef = bres.result === "BILL_DUE" ? bres.bill.presentmentId : null;
  await repo.logEvent(ref, "BILLER_RESP", {
    result: bres.result,
    responseCode: bres.responseCode,
    amountPaise: amount,
    billerRef,
  });
  await repo.logEvent(ref, "COU_RESP", {
    result: bres.result,
    responseCode: bres.responseCode,
    amountPaise: amount,
  });
  await repo.closeTxn(ref, "SUCCESS", bres.responseCode, Date.now() - started, amount, billerRef);
  return { ...bres, fetchRef: ref };
}

/**
 * `POST /api/nbbl/bill-pay`. fetchRef must be a BILL_DUE FETCH txn, else BPR002 (no PAY txn).
 * Issues bbpsTxnRef, sends payment advice to the biller and closes the PAY txn.
 */
export async function billPay(req: BillPaymentRequest): Promise<BillPaymentResponse> {
  const started = Date.now();
  const fetchTxn = await repo.getTxn(req.fetchRef);
  if (
    !fetchTxn ||
    fetchTxn.type !== "FETCH" ||
    fetchTxn.responseCode !== "000" ||
    !fetchTxn.billerRef
  ) {
    return { status: "FAILED", bbpsTxnRef: null, receipt: null, ...meta("BPR002") };
  }

  const bbpsTxnRef = newBbpsTxnRef();
  const billerRef = fetchTxn.billerRef;
  await repo.insertTxn({
    ref: bbpsTxnRef,
    type: "PAY",
    couId: req.couId,
    billerId: fetchTxn.billerId,
    category: fetchTxn.category,
    customerRefMasked: fetchTxn.customerRefMasked,
    amountPaise: req.amountPaise,
    fetchRef: req.fetchRef,
    billerRef,
  });
  await repo.logEvent(bbpsTxnRef, "COU_REQ", {
    couId: req.couId,
    couOrderId: req.couOrderId,
    fetchRef: req.fetchRef,
    amountPaise: req.amountPaise,
    mode: req.mode,
  });

  const paidAt = new Date().toISOString();
  await repo.logEvent(bbpsTxnRef, "PAY_REQ", {
    billerId: fetchTxn.billerId,
    presentmentId: billerRef,
    amountPaise: req.amountPaise,
    bbpsTxnRef,
    mode: req.mode,
    paidAt,
  });

  const fail = async (code: ResponseCode, message?: string): Promise<BillPaymentResponse> => {
    await repo.logEvent(bbpsTxnRef, "COU_RESP", { status: "FAILED", responseCode: code });
    await repo.closeTxn(bbpsTxnRef, "FAILED", code, Date.now() - started);
    return {
      status: "FAILED",
      bbpsTxnRef,
      receipt: null,
      responseCode: code,
      message: message ?? RESPONSE_MESSAGES[code],
    };
  };

  let ack;
  try {
    ack = await biller.paymentAdvice({
      billerId: fetchTxn.billerId,
      presentmentId: billerRef,
      amountPaise: req.amountPaise,
      bbpsTxnRef,
      mode: req.mode,
      paidAt,
    });
  } catch (e) {
    await repo.logEvent(bbpsTxnRef, "ERROR", { code: "SYS500", reason: errMsg(e) });
    return fail("SYS500");
  }

  await repo.logEvent(bbpsTxnRef, "ADVICE_ACK", {
    ack: ack.ack,
    responseCode: ack.responseCode,
    bbpsTxnRef: ack.bbpsTxnRef,
    billerPaymentId: ack.billerPaymentId,
  });

  if (ack.ack && ack.receipt) {
    await repo.logEvent(bbpsTxnRef, "COU_RESP", { status: "SUCCESS", responseCode: "000" });
    await repo.closeTxn(bbpsTxnRef, "SUCCESS", "000", Date.now() - started);
    return { status: "SUCCESS", bbpsTxnRef, receipt: ack.receipt, ...meta("000") };
  }
  return fail(ack.responseCode === "000" ? "BPR002" : ack.responseCode, ack.message);
}

/** `GET /api/nbbl/transactions`. Newest first; default limit 50, max 200. */
export async function listTransactions(query?: NbblTxnQuery): Promise<NbblTxn[]> {
  const raw = query?.limit;
  const limit = Math.min(200, Math.max(1, Number.isFinite(raw) ? Math.floor(raw as number) : 50));
  return repo.listTxns(query?.type, limit);
}

/** `GET /api/nbbl/transactions/:ref`. Txn + events (oldest first), or null (route -> 404). */
export async function getTransaction(ref: string): Promise<NbblTxnDetail | null> {
  const txn = await repo.getTxn(ref);
  if (!txn) return null;
  return { ...txn, events: await repo.listEvents(ref) };
}

/** `GET /api/nbbl/stats`. */
export async function stats(): Promise<NbblStats> {
  return repo.computeStats();
}
