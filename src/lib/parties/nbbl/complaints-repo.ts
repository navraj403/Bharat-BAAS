/** NBBL complaint persistence (nbbl_complaints + nbbl_complaint_events only). */
import { sql, withTx, type Tx } from "@/lib/db/client";
import { isOverdue } from "@/lib/domain/complaints";
import type {
  ComplaintActionKind,
  ComplaintParty,
  ComplaintReason,
  ComplaintResolution,
  ComplaintStatus,
  NbblComplaint,
  NbblComplaintEvent,
} from "@/lib/domain/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const iso = (d: unknown): string => (d instanceof Date ? d.toISOString() : String(d));

const SELECT = `select c.*, b.name as biller_name from nbbl_complaints c
  left join nbbl_billers b on b.id = c.biller_id`;

export function toComplaint(r: Row, now: Date = new Date()): NbblComplaint {
  const c = {
    complaintId: r.complaint_id as string,
    couId: r.cou_id as string,
    couTicketNo: r.cou_ticket_no as string,
    orderId: r.order_id as string,
    txnRef: (r.txn_ref ?? null) as string | null,
    billerId: (r.biller_id ?? null) as string | null,
    billerName: (r.biller_name ?? null) as string | null,
    customerRefMasked: (r.customer_ref_masked ?? null) as string | null,
    amountPaise: r.amount_paise as number,
    reason: r.reason as ComplaintReason,
    description: (r.description ?? null) as string | null,
    status: r.status as ComplaintStatus,
    pendingWith: r.pending_with as ComplaintParty,
    resolution: (r.resolution ?? null) as ComplaintResolution | null,
    dueAt: iso(r.due_at),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    closedAt: r.closed_at ? iso(r.closed_at) : null,
  };
  return { ...c, overdue: isOverdue(c, now) };
}

function toEvent(r: Row): NbblComplaintEvent {
  return {
    id: Number(r.id),
    complaintId: r.complaint_id,
    action: r.action as ComplaintActionKind,
    fromParty: r.from_party ?? null,
    toParty: r.to_party ?? null,
    actor: r.actor,
    note: r.note ?? null,
    at: iso(r.at),
  };
}

export async function findOpenByOrder(
  couId: string,
  orderId: string,
  reason: ComplaintReason,
): Promise<NbblComplaint | null> {
  const rows = await sql.unsafe(
    `${SELECT} where c.cou_id = $1 and c.order_id = $2 and c.reason = $3 and c.status = 'OPEN'
     order by c.created_at desc limit 1`,
    [couId, orderId, reason],
  );
  return rows.length ? toComplaint(rows[0]) : null;
}

export interface NewComplaint {
  complaintId: string;
  couId: string;
  couTicketNo: string;
  orderId: string;
  txnRef: string | null;
  billerId: string | null;
  customerRefMasked: string | null;
  amountPaise: number;
  reason: ComplaintReason;
  description: string | null;
  pendingWith: ComplaintParty;
  dueAt: string;
  createdAt: string;
}

/** Inserts the complaint with its RAISED and ASSIGNED (initial triage) events in one transaction. */
export async function insertComplaint(c: NewComplaint, triageNote: string): Promise<void> {
  await withTx(async (tx) => {
    await tx`insert into nbbl_complaints (complaint_id, cou_id, cou_ticket_no, order_id, txn_ref, biller_id,
        customer_ref_masked, amount_paise, reason, description, status, pending_with, due_at, created_at, updated_at)
      values (${c.complaintId}, ${c.couId}, ${c.couTicketNo}, ${c.orderId}, ${c.txnRef}, ${c.billerId},
        ${c.customerRefMasked}, ${c.amountPaise}, ${c.reason}, ${c.description}, 'OPEN', ${c.pendingWith},
        ${c.dueAt}, ${c.createdAt}, ${c.createdAt})`;
    await tx`insert into nbbl_complaint_events (complaint_id, action, from_party, to_party, actor, note, at)
      values (${c.complaintId}, 'RAISED', null, null, ${c.couId}, ${c.description}, ${c.createdAt})`;
    await tx`insert into nbbl_complaint_events (complaint_id, action, from_party, to_party, actor, note, at)
      values (${c.complaintId}, 'ASSIGNED', null, ${c.pendingWith}, 'SYSTEM', ${triageNote}, ${c.createdAt})`;
  });
}

export async function listComplaints(f: {
  status?: ComplaintStatus;
  pendingWith?: ComplaintParty;
  couId?: string;
}): Promise<NbblComplaint[]> {
  const where: string[] = [];
  const params: string[] = [];
  const add = (col: string, v: string | undefined) => {
    if (v === undefined) return;
    params.push(v);
    where.push(`c.${col} = $${params.length}`);
  };
  add("status", f.status);
  add("pending_with", f.pendingWith);
  add("cou_id", f.couId);
  const rows = await sql.unsafe(
    `${SELECT}${where.length ? ` where ${where.join(" and ")}` : ""} order by c.created_at desc, c.id desc`,
    params,
  );
  const now = new Date();
  return rows.map((r) => toComplaint(r, now));
}

export async function getComplaint(complaintId: string): Promise<NbblComplaint | null> {
  const rows = await sql.unsafe(`${SELECT} where c.complaint_id = $1`, [complaintId]);
  return rows.length ? toComplaint(rows[0]) : null;
}

export async function listComplaintEvents(complaintId: string): Promise<NbblComplaintEvent[]> {
  const rows = await sql`select id, complaint_id, action, from_party, to_party, actor, note, at
    from nbbl_complaint_events where complaint_id = ${complaintId} order by id`;
  return rows.map(toEvent);
}

export interface ActionWrite {
  status: ComplaintStatus;
  pendingWith: ComplaintParty;
  resolution: ComplaintResolution | null;
  closedAt: string | null;
  event: {
    action: ComplaintActionKind;
    fromParty: ComplaintParty | null;
    toParty: ComplaintParty | null;
    actor: string;
    note: string | null;
    at: string;
  };
}

/**
 * Locks the row, lets `decide` compute the write from the CURRENT state (so concurrent actions
 * serialise), then updates the row and inserts the event. Returns false if the id is unknown.
 */
export async function applyLocked(
  complaintId: string,
  decide: (current: NbblComplaint) => ActionWrite,
): Promise<boolean> {
  return withTx(async (tx: Tx) => {
    const rows = await tx`select * from nbbl_complaints where complaint_id = ${complaintId} for update`;
    if (!rows.length) return false;
    const w = decide(toComplaint(rows[0]));
    await tx`update nbbl_complaints set status = ${w.status}, pending_with = ${w.pendingWith},
      resolution = ${w.resolution}, closed_at = ${w.closedAt}, updated_at = ${w.event.at}
      where complaint_id = ${complaintId}`;
    await tx`insert into nbbl_complaint_events (complaint_id, action, from_party, to_party, actor, note, at)
      values (${complaintId}, ${w.event.action}, ${w.event.fromParty}, ${w.event.toParty}, ${w.event.actor},
        ${w.event.note}, ${w.event.at})`;
    return true;
  });
}
