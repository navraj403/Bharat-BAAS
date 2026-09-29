/**
 * COU (DemoPay customer app backend): PUBLIC API. Owner: agent C.
 * Signatures are FINAL (P0). The COU reaches the switch only through `parties/nbbl/api.ts`.
 * COU id: `DEMOPAY`. Order ids: `DP-` + 10 [A-Z0-9].
 */
import { isUniqueViolation, sql } from "@/lib/db/client";
import type {
  BillerSummary,
  Category,
  CouComplaint,
  CouFetchRequest,
  CouOrder,
  CouPayRequest,
  FetchResult,
  NbblComplaint,
  PayResult,
  RaiseComplaintRequest,
} from "@/lib/domain/types";
import {
  ComplaintInputError,
  ComplaintNotFoundError,
  isComplaintReason,
  newCouTicketNo,
  normaliseDescription,
} from "@/lib/domain/complaints";
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

/** Demo helpers (simulated failure) are honoured only when the demo flag is on, server-side too. */
const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "1";

/** `POST /api/cou/pay`. simulateFailure (demo mode only) never calls NBBL. */
export async function pay(req: CouPayRequest): Promise<PayResult> {
  // NBBL issues `F-` + 10 [A-Z0-9]; the looser bound keeps test refs valid and rejects junk.
  if (!/^F-[A-Z0-9]{1,20}$/.test(req.fetchRef ?? "")) throw new BadRequestError("fetchRef is invalid");
  if (!Number.isInteger(req.amountPaise) || req.amountPaise <= 0) {
    throw new BadRequestError("amountPaise must be a positive integer");
  }
  if (!req.mode) throw new BadRequestError("mode is required");

  const couOrderId = newOrderId();
  await sql`insert into cou_payments (order_id, fetch_ref, amount_paise, mode, status)
    values (${couOrderId}, ${req.fetchRef}, ${req.amountPaise}, ${req.mode}, 'INITIATED')`;

  if (req.simulateFailure && DEMO_MODE) {
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

// ─── Complaints (Phase C, docs/COMPLAINTS_PLAN.md). STUBS: agent C implements. ───────────
//
// Table: cou_complaints (supabase/migrations/0002_complaints.sql). Status, pending-with and
// timeline live at NBBL: read them through nbbl.listComplaints({ couId: COU_ID }).
// Errors: the Complaint* classes from src/lib/domain/complaints.ts (re-exported by nbbl/api):
// ComplaintInputError → 400, ComplaintNotFoundError → 404 (unknown orderId).

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;
const iso = (d: unknown): string => (d instanceof Date ? d.toISOString() : String(d));

function toOrder(r: Row, billerNames: Map<string, string>): CouOrder {
  return {
    orderId: r.order_id,
    fetchRef: r.fetch_ref,
    bbpsTxnRef: r.bbps_txn_ref ?? null,
    billerId: r.biller_id ?? null,
    billerName: r.biller_id ? (billerNames.get(r.biller_id) ?? null) : null,
    vehicleRegNo: r.vehicle_reg_no ?? null,
    amountPaise: r.amount_paise,
    mode: r.mode,
    status: r.status,
    createdAt: iso(r.created_at),
  };
}

async function billerNameMap(): Promise<Map<string, string>> {
  return new Map((await nbbl.listBillers()).map((b) => [b.id, b.name]));
}

/**
 * `GET /api/cou/orders`. Every cou_payments row (single demo user), newest first, with
 * billerName resolved via nbbl.listBillers (null when unknown).
 */
export async function listOrders(): Promise<CouOrder[]> {
  const [rows, names] = await Promise.all([
    sql`select * from cou_payments order by created_at desc, id desc`,
    billerNameMap(),
  ]);
  return rows.map((r) => toOrder(r, names));
}

function toTicket(t: Row, c: NbblComplaint, order: Row | undefined): CouComplaint {
  return {
    ticketNo: t.ticket_no,
    complaintId: c.complaintId,
    orderId: t.order_id,
    bbpsTxnRef: order?.bbps_txn_ref ?? c.txnRef,
    billerId: c.billerId,
    billerName: c.billerName,
    vehicleRegNo: order?.vehicle_reg_no ?? null,
    amountPaise: c.amountPaise,
    reason: t.reason,
    description: t.description ?? null,
    status: c.status,
    pendingWith: c.pendingWith,
    resolution: c.resolution,
    dueAt: c.dueAt,
    overdue: c.overdue,
    createdAt: iso(t.created_at),
    updatedAt: c.updatedAt,
    closedAt: c.closedAt,
  };
}

/**
 * `POST /api/cou/complaints`. Validates reason/description (400), loads the order (404 if unknown),
 * generates a ticket no (complaints.newCouTicketNo), calls nbbl.raiseComplaint, and inserts
 * cou_complaints. Idempotent: if NBBL returns an existing OPEN complaint, returns the existing COU
 * ticket for it (no new row). Returns the merged ticket.
 */
export async function raiseComplaint(req: RaiseComplaintRequest): Promise<CouComplaint> {
  if (!isComplaintReason(req?.reason)) throw new ComplaintInputError("reason is not a valid complaint reason");
  const description = normaliseDescription(req.description);
  if (typeof req.orderId !== "string" || !req.orderId) throw new ComplaintInputError("orderId is required");
  const orders = await sql`select * from cou_payments where order_id = ${req.orderId}`;
  if (!orders.length) throw new ComplaintNotFoundError(`Order ${req.orderId} not found`);
  const order = orders[0];

  const ticketNo = newCouTicketNo();
  const c = await nbbl.raiseComplaint({
    couId: COU_ID,
    couTicketNo: ticketNo,
    orderId: order.order_id,
    bbpsTxnRef: order.bbps_txn_ref ?? null,
    billerId: order.biller_id ?? null,
    vehicleRegNo: order.vehicle_reg_no ?? null,
    amountPaise: order.amount_paise,
    reason: req.reason,
    ...(description ? { description } : {}),
  });

  const existing = await sql`select * from cou_complaints where complaint_id = ${c.complaintId}`;
  if (existing.length) return toTicket(existing[0], c, order);

  // New complaint (c.couTicketNo === ticketNo), or an NBBL-side one whose COU row is missing.
  try {
    const inserted = await sql`insert into cou_complaints (ticket_no, order_id, complaint_id, reason, description)
      values (${c.couTicketNo}, ${order.order_id}, ${c.complaintId}, ${req.reason}, ${description})
      on conflict (ticket_no) do update set ticket_no = excluded.ticket_no
      returning *`;
    return toTicket(inserted[0], c, order);
  } catch (err) {
    // Race: a concurrent raise already stored the ticket for this complaint (cou_complaints_complaint_uq, 0003).
    if (!isUniqueViolation(err)) throw err;
    const winner = await sql`select * from cou_complaints where complaint_id = ${c.complaintId}`;
    if (winner.length) return toTicket(winner[0], c, order);
    throw err;
  }
}

/** `GET /api/cou/complaints`. COU tickets, newest first, merged with live NBBL status. */
export async function listComplaints(): Promise<CouComplaint[]> {
  const [tickets, live, orders] = await Promise.all([
    sql`select * from cou_complaints order by created_at desc, id desc`,
    nbbl.listComplaints({ couId: COU_ID }),
    sql`select order_id, bbps_txn_ref, vehicle_reg_no from cou_payments`,
  ]);
  const byId = new Map(live.map((c) => [c.complaintId, c]));
  const byOrder = new Map(orders.map((o) => [o.order_id as string, o as Row]));
  const out: CouComplaint[] = [];
  for (const t of tickets) {
    const c = byId.get(t.complaint_id);
    if (c) out.push(toTicket(t, c, byOrder.get(t.order_id)));
  }
  return out;
}
