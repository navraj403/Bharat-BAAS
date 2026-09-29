/** NBBL persistence (nbbl_* tables only). */
import { sql } from "@/lib/db/client";
import type {
  BillerSummary,
  Category,
  JsonValue,
  NbblEvent,
  NbblEventStep,
  NbblStats,
  NbblTxn,
  NbblTxnStatus,
  NbblTxnType,
  ResponseCode,
} from "@/lib/domain/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const iso = (d: unknown): string => (d instanceof Date ? d.toISOString() : String(d));

function toTxn(r: Row): NbblTxn {
  return {
    ref: r.ref,
    type: r.type,
    couId: r.cou_id,
    billerId: r.biller_id,
    category: r.category,
    customerRefMasked: r.customer_ref_masked,
    amountPaise: r.amount_paise,
    status: r.status,
    responseCode: r.response_code,
    fetchRef: r.fetch_ref,
    billerRef: r.biller_ref,
    createdAt: iso(r.created_at),
    completedAt: r.completed_at ? iso(r.completed_at) : null,
    latencyMs: r.latency_ms,
  };
}

export async function findBiller(id: string): Promise<BillerSummary | null> {
  const rows = await sql`select id, name, category, status from nbbl_billers where id = ${id}`;
  return rows.length ? (rows[0] as unknown as BillerSummary) : null;
}

export async function listBillers(category?: Category): Promise<BillerSummary[]> {
  const rows = category
    ? await sql`select id, name, category, status from nbbl_billers where status = 'ACTIVE' and category = ${category} order by name`
    : await sql`select id, name, category, status from nbbl_billers where status = 'ACTIVE' order by name`;
  return rows as unknown as BillerSummary[];
}

export async function insertTxn(t: {
  ref: string;
  type: NbblTxnType;
  couId: string;
  billerId: string;
  category: string;
  customerRefMasked: string;
  amountPaise?: number | null;
  fetchRef?: string | null;
  billerRef?: string | null;
}): Promise<void> {
  await sql`insert into nbbl_transactions
    (ref, type, cou_id, biller_id, category, customer_ref_masked, amount_paise, fetch_ref, biller_ref)
    values (${t.ref}, ${t.type}, ${t.couId}, ${t.billerId}, ${t.category}, ${t.customerRefMasked},
      ${t.amountPaise ?? null}, ${t.fetchRef ?? null}, ${t.billerRef ?? null})`;
}

export async function closeTxn(
  ref: string,
  status: NbblTxnStatus,
  code: ResponseCode,
  latencyMs: number,
  amountPaise?: number | null,
  billerRef?: string | null,
): Promise<void> {
  await sql`update nbbl_transactions set status = ${status}, response_code = ${code},
    completed_at = now(), latency_ms = ${latencyMs},
    amount_paise = coalesce(${amountPaise ?? null}::int, amount_paise),
    biller_ref = coalesce(${billerRef ?? null}::text, biller_ref)
    where ref = ${ref}`;
}

export async function logEvent(
  ref: string,
  step: NbblEventStep,
  payload: JsonValue,
): Promise<void> {
  await sql`insert into nbbl_events (txn_ref, step, payload) values (${ref}, ${step}, ${sql.json(payload)})`;
}

export async function getTxn(ref: string): Promise<NbblTxn | null> {
  const rows = await sql`select * from nbbl_transactions where ref = ${ref}`;
  return rows.length ? toTxn(rows[0]) : null;
}

export async function listTxns(type: NbblTxnType | undefined, limit: number): Promise<NbblTxn[]> {
  const rows = type
    ? await sql`select * from nbbl_transactions where type = ${type} order by created_at desc, id desc limit ${limit}`
    : await sql`select * from nbbl_transactions order by created_at desc, id desc limit ${limit}`;
  return rows.map(toTxn);
}

export async function listEvents(ref: string): Promise<NbblEvent[]> {
  const rows =
    await sql`select id, txn_ref, step, payload, at from nbbl_events where txn_ref = ${ref} order by id`;
  return rows.map((r) => ({
    id: Number(r.id),
    txnRef: r.txn_ref,
    step: r.step,
    payload: r.payload,
    at: iso(r.at),
  }));
}

export async function computeStats(): Promise<NbblStats> {
  const [r] = await sql`select
    count(*) filter (where type = 'FETCH')::int as fetches,
    count(*) filter (where type = 'PAY')::int as payments,
    count(*) filter (where status = 'SUCCESS')::int as ok,
    count(*) filter (where status in ('SUCCESS','FAILED'))::int as done,
    coalesce(sum(amount_paise) filter (where type = 'PAY' and status = 'SUCCESS'), 0)::int as value
    from nbbl_transactions`;
  return {
    fetches: r.fetches,
    payments: r.payments,
    successRate: r.done ? r.ok / r.done : 0,
    valuePaise: r.value,
  };
}
