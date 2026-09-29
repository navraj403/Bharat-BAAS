/**
 * Biller service: fetch (sync from OEM + presentment), payment advice, overview, sync. Owner: agent B.
 * The public surface is `api.ts`; this file holds the orchestration.
 *
 * Design notes (see docs/agents/B.md):
 * - The OEM is called OUTSIDE any DB transaction (it is another party); biller writes that follow
 *   are atomic in one `withTx`.
 * - "Today" is the DB's `current_date` (same clock as the seed's `now()`-relative dates).
 * - paymentAdvice commits the biller side first, THEN calls `oem.markPaid` best-effort. The money is
 *   collected once the biller commits; an OEM failure is logged and repaired by a retry of the
 *   same advice (idempotent replay re-sends markPaid) or by the next `sync` (repairOemPaidFlags).
 *   The OEM ignores already-PAID bills, so both are harmless.
 */
import { withTx } from "@/lib/db/client";
import {
  RESPONSE_MESSAGES,
  type BillerFetchResponse,
  type BillerOverview,
  type BillerSyncResponse,
  type OemBill,
  type PaymentAdvice,
  type PaymentAdviceAck,
  type Receipt,
  type ResponseCode,
} from "@/lib/domain/types";
import { oemBillsFor, oemMarkPaid, oemPlanNames } from "./client";
import { UnknownBillerError } from "./errors";
import * as repo from "./repo";
import { buildPresentment, maskMobile, maskName, nextBillDate, normaliseRegNo, type OpenCycle } from "./rules";

const NOT_FOUND_MESSAGE = "No account matches the vehicle number and mobile number entered";

function toReceipt(p: repo.PaymentReceiptRow): Receipt {
  return {
    bbpsTxnRef: p.bbps_txn_ref,
    billerId: p.biller_id,
    billerName: p.biller_name,
    vehicleRegNo: p.vehicle_reg_no,
    customerName: maskName(p.customer_name),
    amountPaise: p.amount_paise,
    mode: p.mode,
    paidAt: p.paid_at.toISOString(),
    cycles: p.cycles,
  };
}

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort();
  const y = [...b].sort();
  return x.every((v, i) => v === y[i]);
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

export async function fetchBill(billerId: string, vehicleNo: string, mobile: string): Promise<BillerFetchResponse> {
  const regNo = normaliseRegNo(vehicleNo ?? "");
  const mob = (mobile ?? "").trim();

  const { biller, customer } = await withTx(async (tx) => {
    const b = await repo.getBiller(tx, billerId);
    if (!b) throw new UnknownBillerError(billerId);
    const c = regNo && /^\d{10}$/.test(mob) ? await repo.findCustomer(tx, billerId, regNo, mob) : null;
    return { biller: b, customer: c };
  });

  if (!customer) {
    return {
      result: "NOT_FOUND",
      billerId: biller.id,
      billerName: biller.name,
      responseCode: "BFR002",
      message: NOT_FOUND_MESSAGE,
    };
  }

  // syncFromOem: pull through oem/api only (party isolation), outside the transaction.
  const [bills, planNames] = await Promise.all([oemBillsFor(customer.vehicle_reg_no), oemPlanNames()]);
  const ownBills = bills.filter((b) => normaliseRegNo(b.regNo) === customer.vehicle_reg_no);

  return withTx(async (tx): Promise<BillerFetchResponse> => {
    await repo.upsertReceivables(tx, customer, ownBills);
    await repo.markOverdue(tx, { customerId: customer.id });
    const receivables = await repo.receivablesForCustomer(tx, customer.id);
    const open = receivables.filter((r) => r.status !== "PAID");

    if (open.length > 0) {
      const byId = new Map<string, OemBill>(ownBills.map((b) => [b.id, b]));
      const cycles: OpenCycle[] = open.map((r) => {
        const bill = byId.get(r.oem_bill_id);
        if (!bill) throw new Error(`OEM bill ${r.oem_bill_id} (receivable ${r.id}) not returned by the OEM`);
        return { receivableId: r.id, status: r.status, lateFeePaise: r.late_fee_paise, bill };
      });
      const receivableIds = open.map((r) => r.id);
      const ctx = {
        billerId: biller.id,
        billerName: biller.name,
        customerName: customer.name,
        vehicleRegNo: customer.vehicle_reg_no,
        planNames,
      };

      // Reuse the latest OPEN presentment when it covers the same receivables for the same amount.
      const existing = await repo.latestOpenPresentment(tx, customer.id);
      const fresh = buildPresentment({ ...ctx, presentmentId: existing?.id ?? crypto.randomUUID() }, cycles);
      if (existing && existing.amount_paise === fresh.amountPaise && sameIds(existing.receivable_ids, receivableIds)) {
        return { result: "BILL_DUE", bill: existing.breakdown, responseCode: "000", message: RESPONSE_MESSAGES["000"] };
      }
      const bill = existing ? { ...fresh, presentmentId: crypto.randomUUID() } : fresh;
      await repo.insertPresentment(tx, {
        id: bill.presentmentId,
        billerId: biller.id,
        customerId: customer.id,
        receivableIds,
        amountPaise: bill.amountPaise,
        breakdown: bill,
      });
      return { result: "BILL_DUE", bill, responseCode: "000", message: RESPONSE_MESSAGES["000"] };
    }

    const last = await repo.lastPaymentForCustomer(tx, customer.id);
    if (last) {
      return { result: "ALREADY_PAID", receipt: toReceipt(last), responseCode: "BFR001", message: "Bill already paid" };
    }

    // No bills (or only bills settled outside this biller): nothing to pay yet.
    return {
      result: "NOT_GENERATED",
      billerId: biller.id,
      billerName: biller.name,
      vehicleRegNo: customer.vehicle_reg_no,
      customerName: maskName(customer.name),
      nextBillDate: nextBillDate(await repo.today(tx)),
      responseCode: "BFR001",
      message: "Bill not generated yet",
    };
  });
}

// ─── Payment advice ──────────────────────────────────────────────────────────

function reject(advice: PaymentAdvice, code: ResponseCode, message: string): PaymentAdviceAck {
  return {
    ack: false,
    responseCode: code,
    message,
    bbpsTxnRef: advice.bbpsTxnRef,
    presentmentId: advice.presentmentId,
    billerPaymentId: null,
    receipt: null,
  };
}

function accept(p: repo.PaymentReceiptRow): PaymentAdviceAck {
  return {
    ack: true,
    responseCode: "000",
    message: RESPONSE_MESSAGES["000"],
    bbpsTxnRef: p.bbps_txn_ref,
    presentmentId: p.presentment_id,
    billerPaymentId: p.id,
    receipt: toReceipt(p),
  };
}

export async function paymentAdvice(advice: PaymentAdvice): Promise<PaymentAdviceAck> {
  const paidAtMs = Date.parse(advice.paidAt);
  const paidAt = Number.isNaN(paidAtMs) ? new Date().toISOString() : new Date(paidAtMs).toISOString();

  const outcome = await withTx(async (tx) => {
    // Lock first so concurrent advices for the same presentment serialise.
    const presentment = await repo.lockPresentment(tx, advice.billerId, advice.presentmentId);

    // Idempotency: this bbpsTxnRef was already applied → the same ACK.
    const prior = await repo.paymentByRef(tx, advice.bbpsTxnRef);
    if (prior) return { ack: accept(prior), oemBillIds: prior.oem_bill_ids };

    if (!presentment) return { ack: reject(advice, "BPR002", "Bill not found or not payable") };
    if (presentment.status === "PAID") return { ack: reject(advice, "BPR002", RESPONSE_MESSAGES.BPR002) };
    if (advice.amountPaise !== presentment.amount_paise) {
      return { ack: reject(advice, "BPR001", RESPONSE_MESSAGES.BPR001) };
    }

    const receivables = await repo.lockReceivables(tx, presentment.receivable_ids);
    // A stale presentment whose receivables were settled by another presentment is not payable.
    if (receivables.length !== presentment.receivable_ids.length || receivables.some((r) => r.status === "PAID")) {
      return { ack: reject(advice, "BPR002", RESPONSE_MESSAGES.BPR002) };
    }

    const paymentId = crypto.randomUUID();
    await repo.insertPayment(tx, {
      id: paymentId,
      billerId: presentment.biller_id,
      presentmentId: presentment.id,
      bbpsTxnRef: advice.bbpsTxnRef,
      amountPaise: advice.amountPaise,
      mode: advice.mode,
      paidAt,
    });
    await repo.settle(tx, presentment.id, presentment.receivable_ids, paymentId);
    const row = await repo.paymentByRef(tx, advice.bbpsTxnRef);
    if (!row) throw new Error("payment row vanished inside its own transaction");
    return { ack: accept(row), oemBillIds: row.oem_bill_ids };
  });

  if (outcome.ack.ack && outcome.oemBillIds && outcome.oemBillIds.length > 0) {
    try {
      await oemMarkPaid(outcome.oemBillIds, advice.bbpsTxnRef, outcome.ack.receipt?.paidAt ?? paidAt);
    } catch (err) {
      // Biller has collected; the OEM flag is repaired by a retry of this advice or the next sync.
      console.error("[biller] oem.markPaid failed; will be retried by an identical advice or sync", err);
    }
  }
  return outcome.ack;
}

// ─── Overview / sync ─────────────────────────────────────────────────────────

export async function overview(billerId: string): Promise<BillerOverview> {
  return withTx(async (tx) => {
    const biller = await repo.getBiller(tx, billerId);
    if (!biller) throw new UnknownBillerError(billerId);
    // Biller-internal bookkeeping (no OEM call): age past-due receivables before reporting.
    await repo.markOverdue(tx, { billerId });
    const [customers, receivables, payments] = await Promise.all([
      repo.overviewCustomers(tx, billerId),
      repo.overviewReceivables(tx, billerId),
      repo.overviewPayments(tx, billerId),
    ]);
    const open = receivables.filter((r) => r.status !== "PAID");
    return {
      biller: { id: biller.id, name: biller.name, category: biller.category },
      kpis: {
        receivablesDuePaise: open.reduce((s, r) => s + r.total_paise + r.late_fee_paise, 0),
        collectedPaise: payments.reduce((s, p) => s + p.amount_paise, 0),
        overdueCount: receivables.filter((r) => r.status === "OVERDUE").length,
        customers: customers.length,
      },
      customers: customers.map((c) => ({
        id: c.id,
        name: c.name,
        mobileMasked: maskMobile(c.mobile),
        vehicleRegNo: c.vehicle_reg_no,
        contractId: c.contract_id,
        outstandingPaise: c.outstanding_paise,
      })),
      receivables: receivables.map((r) => ({
        id: r.id,
        customerId: r.customer_id,
        customerName: r.customer_name,
        vehicleRegNo: r.vehicle_reg_no,
        oemBillId: r.oem_bill_id,
        cycle: r.cycle,
        subtotalPaise: r.subtotal_paise,
        gstPaise: r.gst_paise,
        totalPaise: r.total_paise,
        lateFeePaise: r.late_fee_paise,
        dueDate: r.due_date,
        status: r.status,
        syncedAt: r.synced_at.toISOString(),
        paidPaymentId: r.paid_payment_id,
      })),
      payments: payments.map((p) => ({
        id: p.id,
        presentmentId: p.presentment_id,
        customerName: p.customer_name,
        vehicleRegNo: p.vehicle_reg_no,
        bbpsTxnRef: p.bbps_txn_ref,
        amountPaise: p.amount_paise,
        mode: p.mode,
        paidAt: p.paid_at.toISOString(),
      })),
    };
  });
}

export async function sync(billerId: string): Promise<BillerSyncResponse> {
  const customers = await withTx(async (tx) => {
    const biller = await repo.getBiller(tx, billerId);
    if (!biller) throw new UnknownBillerError(billerId);
    return repo.listCustomers(tx, billerId);
  });
  let synced = 0;
  for (const c of customers) {
    const bills = (await oemBillsFor(c.vehicle_reg_no)).filter((b) => normaliseRegNo(b.regNo) === c.vehicle_reg_no);
    const { n, settled } = await withTx(async (tx) => {
      const n = await repo.upsertReceivables(tx, c, bills);
      await repo.markOverdue(tx, { customerId: c.id });
      return { n, settled: await repo.settledReceivables(tx, c.id) };
    });
    synced += n;
    await repairOemPaidFlags(bills, settled);
  }
  return { synced };
}

/**
 * Re-sends `markPaid` for bills the biller has collected but the OEM still shows UNPAID (the
 * best-effort call after a payment advice failed). Runs outside any transaction; failures are logged.
 */
async function repairOemPaidFlags(
  bills: OemBill[],
  settled: { oem_bill_id: string; bbps_txn_ref: string; paid_at: Date }[],
): Promise<void> {
  const unpaidAtOem = new Set(bills.filter((b) => b.paymentStatus !== "PAID").map((b) => b.id));
  const byRef = new Map<string, { ids: string[]; paidAt: string }>();
  for (const s of settled) {
    if (!unpaidAtOem.has(s.oem_bill_id)) continue;
    const g = byRef.get(s.bbps_txn_ref) ?? { ids: [], paidAt: s.paid_at.toISOString() };
    g.ids.push(s.oem_bill_id);
    byRef.set(s.bbps_txn_ref, g);
  }
  for (const [ref, g] of byRef) {
    try {
      await oemMarkPaid(g.ids, ref, g.paidAt);
    } catch (err) {
      console.error("[biller] sync could not repair oem.markPaid", err);
    }
  }
}
