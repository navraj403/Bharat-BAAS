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
  ComplaintActionRequest,
  NbblComplaint,
  NbblComplaintDetail,
  NbblComplaintQuery,
  NbblComplaintStats,
  NbblRaiseComplaintRequest,
  NbblStats,
  NbblTxn,
  NbblTxnDetail,
  NbblTxnQuery,
  ResponseCode,
  ResponseMeta,
} from "@/lib/domain/types";
import { RESPONSE_MESSAGES } from "@/lib/domain/types";
import {
  ComplaintInputError,
  ComplaintNotFoundError,
  ComplaintTransitionError,
  applyAction,
  dueAt as complaintDueAt,
  initialAssignee,
  isComplaintParty,
  isComplaintReason,
  isComplaintStatus,
  newComplaintId,
  normaliseDescription,
  summariseComplaints,
  triageNote,
} from "@/lib/domain/complaints";
import { isUniqueViolation } from "@/lib/db/client";
import * as complaintsRepo from "./complaints-repo";
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

  // Idempotency per fetchRef: a retry (timeout, second tab) replays the earlier advice.
  const prior = await repo.latestLivePay(req.fetchRef);
  if (prior) return replayPay(prior.txn, prior.payReq, req, started);

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

  if (ack.ack && ack.receipt) {
    // The biller has collected: bookkeeping failures must not turn this into FAILED for the COU.
    await bestEffort(async () => {
      await logAck(bbpsTxnRef, ack);
      await repo.logEvent(bbpsTxnRef, "COU_RESP", { status: "SUCCESS", responseCode: "000" });
      await repo.closeTxn(bbpsTxnRef, "SUCCESS", "000", Date.now() - started);
    });
    return { status: "SUCCESS", bbpsTxnRef, receipt: ack.receipt, ...meta("000") };
  }
  await logAck(bbpsTxnRef, ack);
  return fail(ack.responseCode === "000" ? "BPR002" : ack.responseCode, ack.message);
}

type Ack = Awaited<ReturnType<typeof biller.paymentAdvice>>;

function logAck(ref: string, ack: Ack): Promise<void> {
  return repo.logEvent(ref, "ADVICE_ACK", {
    ack: ack.ack,
    responseCode: ack.responseCode,
    bbpsTxnRef: ack.bbpsTxnRef,
    billerPaymentId: ack.billerPaymentId,
  });
}

async function bestEffort(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.error("[nbbl] post-ack bookkeeping failed", e);
  }
}

/**
 * Re-sends the advice of an earlier SUCCESS/PENDING PAY txn under its own bbpsTxnRef. The biller
 * is idempotent on bbpsTxnRef, so an already-collected payment returns the same receipt.
 */
async function replayPay(
  txn: NbblTxn,
  payReq: { mode?: string; paidAt?: string } | null,
  req: BillPaymentRequest,
  started: number,
): Promise<BillPaymentResponse> {
  const ref = txn.ref;
  const mode = (payReq?.mode ?? req.mode) as BillPaymentRequest["mode"];
  await bestEffort(() =>
    repo.logEvent(ref, "COU_REQ", { retry: true, couOrderId: req.couOrderId, fetchRef: req.fetchRef }),
  );

  let ack: Ack;
  try {
    ack = await biller.paymentAdvice({
      billerId: txn.billerId,
      presentmentId: txn.billerRef ?? "",
      amountPaise: txn.amountPaise ?? req.amountPaise,
      bbpsTxnRef: ref,
      mode,
      paidAt: payReq?.paidAt ?? new Date().toISOString(),
    });
  } catch (e) {
    await bestEffort(() => repo.logEvent(ref, "ERROR", { code: "SYS500", reason: errMsg(e) }));
    return { status: "FAILED", bbpsTxnRef: ref, receipt: null, ...meta("SYS500") };
  }

  const ok = ack.ack && ack.receipt;
  const code: ResponseCode = ok ? "000" : ack.responseCode === "000" ? "BPR002" : ack.responseCode;
  await bestEffort(async () => {
    await logAck(ref, ack);
    await repo.logEvent(ref, "COU_RESP", { status: ok ? "SUCCESS" : "FAILED", responseCode: code });
    if (txn.status === "PENDING") {
      await repo.closeTxn(ref, ok ? "SUCCESS" : "FAILED", code, Date.now() - started);
    }
  });
  if (ok && ack.receipt) return { status: "SUCCESS", bbpsTxnRef: ref, receipt: ack.receipt, ...meta("000") };
  return { status: "FAILED", bbpsTxnRef: ref, receipt: null, responseCode: code, message: ack.message };
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

// ─── Complaints (Phase C, docs/COMPLAINTS_PLAN.md). STUBS: agent C implements. ───────────
//
// Tables: nbbl_complaints + nbbl_complaint_events (supabase/migrations/0002_complaints.sql).
// Pure rules (SLA, triage, transitions, refs) are in src/lib/domain/complaints.ts: use
// dueAt, initialAssignee, applyAction, summariseComplaints, isOverdue, newComplaintId.
//
// Error convention (routes map these via err.status / err.code → { error: { code, message } }):
// - ComplaintInputError      → 400 BAD_REQUEST        (bad/missing field)
// - ComplaintNotFoundError   → 404 NOT_FOUND          (unknown complaint id on a MUTATION)
// - ComplaintTransitionError → 409 INVALID_TRANSITION (action not allowed in current state)
// Getters (getComplaint) return null for an unknown id instead of throwing; the route returns 404.
export {
  ComplaintError,
  ComplaintInputError,
  ComplaintNotFoundError,
  ComplaintTransitionError,
} from "@/lib/domain/complaints";

/**
 * COU → NBBL (server-side only). Opens a BBPS complaint for a COU order.
 * - Looks up the PAY txn by `bbpsTxnRef` (if any): its status drives `initialAssignee`, its
 *   `customerRefMasked` is copied (else the vehicle reg no, else null). Stores MASKED refs only.
 * - billerName is resolved from nbbl_billers.
 * - dueAt = complaints.dueAt(now, reason). Writes RAISED (actor = couId, note = description)
 *   then ASSIGNED (from null → initial party, actor SYSTEM) events.
 * - Idempotent: an OPEN complaint for the same (couId, orderId, reason) is returned unchanged
 *   (no new rows; the caller should reuse its couTicketNo).
 * Throws ComplaintInputError for an invalid reason/description/amount.
 */
export async function raiseComplaint(req: NbblRaiseComplaintRequest): Promise<NbblComplaint> {
  if (!isComplaintReason(req?.reason)) throw new ComplaintInputError("reason is not a valid complaint reason");
  const description = normaliseDescription(req.description);
  if (!req.couId || !req.orderId || !req.couTicketNo) {
    throw new ComplaintInputError("couId, couTicketNo and orderId are required");
  }
  if (!Number.isInteger(req.amountPaise) || req.amountPaise < 0) {
    throw new ComplaintInputError("amountPaise must be a non-negative integer");
  }

  const existing = await complaintsRepo.findOpenByOrder(req.couId, req.orderId, req.reason);
  if (existing) return existing;

  const payTxn = req.bbpsTxnRef ? await repo.getTxn(req.bbpsTxnRef) : null;
  const pay = payTxn && payTxn.type === "PAY" ? payTxn : null;
  const pendingWith = initialAssignee(req.reason, pay?.status ?? null);
  const createdAt = new Date().toISOString();
  const complaintId = newComplaintId();
  try {
    await complaintsRepo.insertComplaint(
      {
        complaintId,
        couId: req.couId,
        couTicketNo: req.couTicketNo,
        orderId: req.orderId,
        txnRef: pay?.ref ?? null,
        billerId: pay?.billerId ?? req.billerId,
        // NBBL stores masked refs only: the PAY txn's, else the (non-sensitive) vehicle reg no.
        customerRefMasked: pay?.customerRefMasked ?? (req.vehicleRegNo ? normaliseVehicleNo(req.vehicleRegNo) : null),
        amountPaise: req.amountPaise,
        reason: req.reason,
        description,
        pendingWith,
        dueAt: complaintDueAt(createdAt, req.reason),
        createdAt,
      },
      triageNote(req.reason, pay?.status ?? null),
    );
  } catch (err) {
    // Race: a concurrent raise inserted the OPEN complaint first (nbbl_complaints_open_uq, 0003).
    if (!isUniqueViolation(err)) throw err;
    const winner = await complaintsRepo.findOpenByOrder(req.couId, req.orderId, req.reason);
    if (winner) return winner;
    throw err;
  }
  const created = await complaintsRepo.getComplaint(complaintId);
  if (!created) throw new Error("Complaint vanished after insert");
  return created;
}

/**
 * `GET /api/nbbl/complaints?status=&pendingWith=`. Newest first. `couId` (server-side only, used
 * by the COU to read its own tickets' live status) filters to one COU. `overdue` derived at read.
 */
export async function listComplaints(
  query?: NbblComplaintQuery & { couId?: string },
): Promise<NbblComplaint[]> {
  if (query?.status !== undefined && !isComplaintStatus(query.status)) {
    throw new ComplaintInputError("status must be OPEN or CLOSED");
  }
  if (query?.pendingWith !== undefined && !isComplaintParty(query.pendingWith)) {
    throw new ComplaintInputError("pendingWith must be COU, NBBL or BILLER");
  }
  return complaintsRepo.listComplaints({
    status: query?.status,
    pendingWith: query?.pendingWith,
    couId: query?.couId,
  });
}

/** `GET /api/nbbl/complaints/:id`. Complaint + events (oldest first) + linked PAY txn. Null if unknown. */
export async function getComplaint(complaintId: string): Promise<NbblComplaintDetail | null> {
  const c = await complaintsRepo.getComplaint(complaintId);
  if (!c) return null;
  const [events, txn] = await Promise.all([
    complaintsRepo.listComplaintEvents(complaintId),
    c.txnRef ? repo.getTxn(c.txnRef) : Promise.resolve(null),
  ]);
  return { ...c, events, linkedTxn: txn && txn.type === "PAY" ? txn : null };
}

/**
 * `POST /api/nbbl/complaints/:id/actions`. Validates + applies via complaints.applyAction, updates
 * the row (status, pending_with, resolution, closed_at, updated_at) and inserts the event in one
 * transaction. Returns the fresh detail.
 * Throws ComplaintNotFoundError (404), ComplaintInputError (400), ComplaintTransitionError (409).
 */
export async function complaintAction(
  complaintId: string,
  req: ComplaintActionRequest,
): Promise<NbblComplaintDetail> {
  let found: boolean;
  try {
    found = await complaintsRepo.applyLocked(complaintId, (current) => {
      const { next, event } = applyAction(current, req);
      return { ...next, event };
    });
  } catch (err) {
    // REOPEN while a newer OPEN complaint exists for the same (COU, order, reason): nbbl_complaints_open_uq.
    if (isUniqueViolation(err)) {
      throw new ComplaintTransitionError("Another open complaint already exists for this order and reason");
    }
    throw err;
  }
  if (!found) throw new ComplaintNotFoundError(`Complaint ${complaintId} not found`);
  const detail = await getComplaint(complaintId);
  if (!detail) throw new ComplaintNotFoundError(`Complaint ${complaintId} not found`);
  return detail;
}

/** `GET /api/nbbl/complaints/stats`. KPIs over all complaints (complaints.summariseComplaints). */
export async function complaintStats(): Promise<NbblComplaintStats> {
  return summariseComplaints(await complaintsRepo.listComplaints({}));
}
