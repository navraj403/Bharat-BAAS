/**
 * Biller persistence: plain SQL on biller_* tables ONLY (party isolation). Owner: agent B.
 * Every function takes a transaction handle (`withTx`), so callers control atomicity.
 */
import type { Tx } from "@/lib/db/client";
import type {
  BillPresentment,
  Category,
  IsoDate,
  OemBill,
  Paise,
  PaymentMode,
  PresentmentStatus,
  ReceivableStatus,
} from "@/lib/domain/types";
import { LATE_FEE_BPS } from "./rules";

export interface BillerRow {
  id: string;
  name: string;
  category: Category;
}

export interface CustomerRow {
  id: string;
  biller_id: string;
  name: string;
  mobile: string;
  vehicle_reg_no: string;
  contract_id: string;
}

export interface ReceivableRow {
  id: string;
  customer_id: string;
  oem_bill_id: string;
  cycle: string;
  subtotal_paise: number;
  gst_paise: number;
  total_paise: number;
  due_date: IsoDate;
  status: ReceivableStatus;
  late_fee_paise: number;
  synced_at: Date;
  paid_payment_id: string | null;
}

export interface PresentmentRow {
  id: string;
  biller_id: string;
  customer_id: string;
  receivable_ids: string[];
  amount_paise: number;
  breakdown: BillPresentment;
  status: PresentmentStatus;
}

/** A payment joined with what a Receipt needs. */
export interface PaymentReceiptRow {
  id: string;
  biller_id: string;
  presentment_id: string;
  bbps_txn_ref: string;
  amount_paise: number;
  mode: PaymentMode;
  paid_at: Date;
  biller_name: string;
  customer_name: string;
  vehicle_reg_no: string;
  cycles: string[];
  oem_bill_ids: string[];
}

export async function today(tx: Tx): Promise<IsoDate> {
  const [r] = await tx<{ d: string }[]>`select current_date as d`;
  return r.d;
}

export async function getBiller(tx: Tx, billerId: string): Promise<BillerRow | null> {
  const [r] = await tx<BillerRow[]>`select id, name, category from biller_billers where id = ${billerId}`;
  return r ?? null;
}

export async function findCustomer(
  tx: Tx,
  billerId: string,
  regNo: string,
  mobile: string,
): Promise<CustomerRow | null> {
  const [r] = await tx<CustomerRow[]>`
    select id, biller_id, name, mobile, vehicle_reg_no, contract_id
    from biller_customers
    where biller_id = ${billerId} and vehicle_reg_no = ${regNo} and mobile = ${mobile}`;
  return r ?? null;
}

export async function listCustomers(tx: Tx, billerId: string): Promise<CustomerRow[]> {
  return tx<CustomerRow[]>`
    select id, biller_id, name, mobile, vehicle_reg_no, contract_id
    from biller_customers where biller_id = ${billerId} order by vehicle_reg_no`;
}

/**
 * Upserts one receivable per OEM bill (keyed by oem_bill_id). New rows copy the OEM paid flag;
 * existing PAID rows are never touched (never downgrade); existing open rows get the OEM amounts
 * refreshed (status and late fee are the biller's own and are kept). Returns rows written.
 */
export async function upsertReceivables(tx: Tx, customer: CustomerRow, bills: OemBill[]): Promise<number> {
  let n = 0;
  for (const b of bills) {
    const status: ReceivableStatus = b.paymentStatus === "PAID" ? "PAID" : "UNPAID";
    const rows = await tx`
      insert into biller_receivables
        (biller_id, customer_id, oem_bill_id, cycle, subtotal_paise, gst_paise, total_paise, due_date, status)
      values
        (${customer.biller_id}, ${customer.id}, ${b.id}, ${b.cycle}, ${b.subtotalPaise}, ${b.gstPaise},
         ${b.totalPaise}, ${b.dueDate}::date, ${status})
      on conflict (oem_bill_id) do update set
        cycle = excluded.cycle,
        subtotal_paise = excluded.subtotal_paise,
        gst_paise = excluded.gst_paise,
        total_paise = excluded.total_paise,
        due_date = excluded.due_date,
        synced_at = now()
      where biller_receivables.status <> 'PAID'
      returning id`;
    n += rows.length;
  }
  return n;
}

/**
 * UNPAID receivables past due → OVERDUE with the one-time late fee. The `status = 'UNPAID'` guard
 * makes this apply exactly once (an OVERDUE row is never re-charged, e.g. the seeded Arjun Jul row).
 * Late fee = round_half_up(subtotal × LATE_FEE_BPS / 10000), same formula as rules.lateFee().
 */
export async function markOverdue(tx: Tx, scope: { customerId?: string; billerId?: string }): Promise<number> {
  const rows = await tx`
    update biller_receivables
    set status = 'OVERDUE',
        late_fee_paise = ((subtotal_paise::bigint * ${LATE_FEE_BPS} + 5000) / 10000)::int
    where status = 'UNPAID'
      and due_date < current_date
      and (${scope.customerId ?? null}::uuid is null or customer_id = ${scope.customerId ?? null}::uuid)
      and (${scope.billerId ?? null}::text is null or biller_id = ${scope.billerId ?? null}::text)
    returning id`;
  return rows.length;
}

export async function receivablesForCustomer(tx: Tx, customerId: string): Promise<ReceivableRow[]> {
  return tx<ReceivableRow[]>`
    select id, customer_id, oem_bill_id, cycle, subtotal_paise, gst_paise, total_paise, due_date,
           status, late_fee_paise, synced_at, paid_payment_id
    from biller_receivables where customer_id = ${customerId} order by cycle`;
}

/** Receivables this biller settled itself, with the payment that settled them. */
export async function settledReceivables(
  tx: Tx,
  customerId: string,
): Promise<{ oem_bill_id: string; bbps_txn_ref: string; paid_at: Date }[]> {
  return tx<{ oem_bill_id: string; bbps_txn_ref: string; paid_at: Date }[]>`
    select r.oem_bill_id::text as oem_bill_id, p.bbps_txn_ref, p.paid_at
    from biller_receivables r
    join biller_payments p on p.id = r.paid_payment_id
    where r.customer_id = ${customerId} and r.status = 'PAID'`;
}

export async function latestOpenPresentment(tx: Tx, customerId: string): Promise<PresentmentRow | null> {
  const [r] = await tx<PresentmentRow[]>`
    select id, biller_id, customer_id, receivable_ids::text[] as receivable_ids, amount_paise, breakdown, status
    from biller_presentments
    where customer_id = ${customerId} and status = 'OPEN'
    order by created_at desc limit 1`;
  return r ?? null;
}

export async function insertPresentment(
  tx: Tx,
  p: { id: string; billerId: string; customerId: string; receivableIds: string[]; amountPaise: Paise; breakdown: BillPresentment },
): Promise<void> {
  await tx`
    insert into biller_presentments (id, biller_id, customer_id, receivable_ids, amount_paise, breakdown, status)
    values (${p.id}, ${p.billerId}, ${p.customerId}, ${tx.array(p.receivableIds)}::uuid[], ${p.amountPaise},
            ${tx.json(p.breakdown as unknown as Parameters<Tx["json"]>[0])}, 'OPEN')`;
}

/** Locks and returns the presentment (scoped to the biller). */
export async function lockPresentment(tx: Tx, billerId: string, presentmentId: string): Promise<PresentmentRow | null> {
  const [r] = await tx<PresentmentRow[]>`
    select id, biller_id, customer_id, receivable_ids::text[] as receivable_ids, amount_paise, breakdown, status
    from biller_presentments
    where id = ${presentmentId} and biller_id = ${billerId}
    for update`;
  return r ?? null;
}

export async function lockReceivables(tx: Tx, ids: string[]): Promise<ReceivableRow[]> {
  if (ids.length === 0) return [];
  return tx<ReceivableRow[]>`
    select id, customer_id, oem_bill_id, cycle, subtotal_paise, gst_paise, total_paise, due_date,
           status, late_fee_paise, synced_at, paid_payment_id
    from biller_receivables where id = any(${tx.array(ids)}::uuid[]) order by cycle
    for update`;
}

export async function insertPayment(
  tx: Tx,
  p: { id: string; billerId: string; presentmentId: string; bbpsTxnRef: string; amountPaise: Paise; mode: PaymentMode; paidAt: string },
): Promise<void> {
  await tx`
    insert into biller_payments (id, biller_id, presentment_id, bbps_txn_ref, amount_paise, mode, paid_at)
    values (${p.id}, ${p.billerId}, ${p.presentmentId}, ${p.bbpsTxnRef}, ${p.amountPaise}, ${p.mode}, ${p.paidAt}::timestamptz)`;
}

export async function settle(tx: Tx, presentmentId: string, receivableIds: string[], paymentId: string): Promise<void> {
  await tx`
    update biller_receivables set status = 'PAID', paid_payment_id = ${paymentId}
    where id = any(${tx.array(receivableIds)}::uuid[])`;
  await tx`update biller_presentments set status = 'PAID' where id = ${presentmentId}`;
}

const PAYMENT_RECEIPT_SELECT = `
  select p.id, p.biller_id, p.presentment_id, p.bbps_txn_ref, p.amount_paise, p.mode, p.paid_at,
         b.name as biller_name, c.name as customer_name, c.vehicle_reg_no,
         coalesce((select array_agg(r.cycle order by r.cycle) from biller_receivables r where r.paid_payment_id = p.id),
                  '{}'::text[]) as cycles,
         coalesce((select array_agg(r.oem_bill_id::text order by r.cycle) from biller_receivables r where r.paid_payment_id = p.id),
                  '{}'::text[]) as oem_bill_ids
  from biller_payments p
  join biller_presentments pr on pr.id = p.presentment_id
  join biller_customers c on c.id = pr.customer_id
  join biller_billers b on b.id = p.biller_id`;

export async function paymentByRef(tx: Tx, bbpsTxnRef: string): Promise<PaymentReceiptRow | null> {
  const [r] = await tx.unsafe<PaymentReceiptRow[]>(`${PAYMENT_RECEIPT_SELECT} where p.bbps_txn_ref = $1`, [bbpsTxnRef]);
  return r ?? null;
}

export async function lastPaymentForCustomer(tx: Tx, customerId: string): Promise<PaymentReceiptRow | null> {
  const [r] = await tx.unsafe<PaymentReceiptRow[]>(
    `${PAYMENT_RECEIPT_SELECT} where pr.customer_id = $1 order by p.paid_at desc limit 1`,
    [customerId],
  );
  return r ?? null;
}

// ─── Overview ────────────────────────────────────────────────────────────────

export interface OverviewCustomerRow extends CustomerRow {
  outstanding_paise: number;
}

export async function overviewCustomers(tx: Tx, billerId: string): Promise<OverviewCustomerRow[]> {
  return tx<OverviewCustomerRow[]>`
    select c.id, c.biller_id, c.name, c.mobile, c.vehicle_reg_no, c.contract_id,
           coalesce(sum(r.total_paise + r.late_fee_paise) filter (where r.status in ('UNPAID', 'OVERDUE')), 0)::int
             as outstanding_paise
    from biller_customers c
    left join biller_receivables r on r.customer_id = c.id
    where c.biller_id = ${billerId}
    group by c.id
    order by c.vehicle_reg_no`;
}

export interface OverviewReceivableRow extends ReceivableRow {
  customer_name: string;
  vehicle_reg_no: string;
}

export async function overviewReceivables(tx: Tx, billerId: string): Promise<OverviewReceivableRow[]> {
  return tx<OverviewReceivableRow[]>`
    select r.id, r.customer_id, r.oem_bill_id, r.cycle, r.subtotal_paise, r.gst_paise, r.total_paise, r.due_date,
           r.status, r.late_fee_paise, r.synced_at, r.paid_payment_id, c.name as customer_name, c.vehicle_reg_no
    from biller_receivables r
    join biller_customers c on c.id = r.customer_id
    where r.biller_id = ${billerId}
    order by r.cycle desc, c.vehicle_reg_no`;
}

export interface OverviewPaymentRow {
  id: string;
  presentment_id: string;
  customer_name: string;
  vehicle_reg_no: string;
  bbps_txn_ref: string;
  amount_paise: number;
  mode: PaymentMode;
  paid_at: Date;
}

export async function overviewPayments(tx: Tx, billerId: string): Promise<OverviewPaymentRow[]> {
  return tx<OverviewPaymentRow[]>`
    select p.id, p.presentment_id, c.name as customer_name, c.vehicle_reg_no, p.bbps_txn_ref, p.amount_paise,
           p.mode, p.paid_at
    from biller_payments p
    join biller_presentments pr on pr.id = p.presentment_id
    join biller_customers c on c.id = pr.customer_id
    where p.biller_id = ${billerId}
    order by p.paid_at desc`;
}
