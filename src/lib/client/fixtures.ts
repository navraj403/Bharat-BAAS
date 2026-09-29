/**
 * In-memory fixture backend for UI lanes (NEXT_PUBLIC_USE_FIXTURES=1). Mirrors the §4 seed:
 * same vehicles, mobiles, billers and amounts; dates are relative to "now" like supabase/seed.sql.
 *
 * It is STATEFUL (module-level, per browser tab) so the demo path works without a DB:
 * fetch → pay → re-fetch shows ALREADY_PAID; OEM +km → generate → Kabir flips to BILL_DUE;
 * NBBL txns/events and biller payments update. `fixtureReset()` restores the seed.
 *
 * Try in the COU (billerId / vehicle / mobile):
 *   demo-finance MH01AB1001 9800000001 → BILL_DUE ₹6,726.00
 *   demo-finance MH01AB1002 9800000002 → BILL_DUE ₹11,889.62 (arrears + late fee, overdue)
 *   volt-leasing MH01AB1003 9800000003 → ALREADY_PAID ₹12,183.50 (BCSEEDPAID01)
 *   demo-finance MH01AB1004 9800000004 → NOT_GENERATED
 *   any wrong mobile / unknown vehicle   → NOT_FOUND
 *   any biller   MH01AB9999 (any mobile) → BILLER_UNAVAILABLE (SYS500)   [fixture-only trigger]
 *
 * Fixture-only helpers; the real billing engine is src/lib/domain/billing.ts (agent A).
 */
import type {
  AdminTableRows,
  AdminTableSummary,
  BillFetchResponse,
  BillLineItem,
  BillPaymentResponse,
  BillPresentment,
  BillerOverview,
  BillerSummary,
  Category,
  CouFetchRequest,
  CouPayRequest,
  Cycle,
  FetchResult,
  JsonValue,
  NbblEvent,
  NbblEventStep,
  NbblStats,
  NbblTxn,
  NbblTxnDetail,
  NbblTxnQuery,
  OemBill,
  OemPlan,
  OemVehicleRow,
  Party,
  PayResult,
  PaymentMode,
  PresentedCycle,
  Receipt,
  ResponseCode,
} from "@/lib/domain/types";
import { RESPONSE_MESSAGES } from "@/lib/domain/types";
import { formatCycle } from "@/lib/domain/cycle";
import { formatINR } from "@/lib/domain/money";
// ASSUMPTION constants (GST 18%, late fee 2%, due +10 days) are defined and tagged once, in billing.ts.
import { DUE_DAYS, GST_BPS, LATE_FEE_BPS } from "@/lib/domain/billing";

// ─── Small helpers ───────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** Half-up percentage of a non-negative integer paise amount, in basis points. */
function pctBps(paise: number, bps: number): number {
  return Math.floor((paise * bps + 5000) / 10000);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function today(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}
function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}
/** First day of the month `offset` months from the current month (UTC). */
function monthStart(offset: number): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + offset, 1));
}
function cycleOf(d: Date): Cycle {
  return d.toISOString().slice(0, 7);
}
function cycleStart(cycle: Cycle): Date {
  const [y, m] = cycle.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
}
function cycleEnd(cycle: Cycle): Date {
  const [y, m] = cycle.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0));
}
function normaliseRegNo(v: string): string {
  return v.toUpperCase().replace(/[\s-]/g, "");
}
function maskMobile(m: string): string {
  return m.length === 10 ? `${m.slice(0, 2)}XXXXXX${m.slice(8)}` : "XXXXXXXXXX";
}
function maskName(name: string): string {
  const [first, ...rest] = name.split(" ");
  const last = rest.join(" ");
  return last ? `${first} ${last[0]}****` : first;
}
const rupees = formatINR;
function randRef(prefix: string): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
  let s = "";
  for (let i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return prefix + s;
}
function uuid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `fx-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}

/** Small artificial latency so loading states are visible. */
export function fixtureDelay(ms = 250 + Math.floor(Math.random() * 250)): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Store ───────────────────────────────────────────────────────────────────

interface FxVehicle {
  id: string;
  regNo: string;
  vin: string;
  model: string;
  planId: string;
  odometerKm: number;
  activatedOn: string;
}
interface FxTrip {
  vehicleId: string;
  km: number;
  recordedAt: string;
}
interface FxCustomer {
  id: string;
  billerId: string;
  name: string;
  mobile: string;
  vehicleRegNo: string;
  contractId: string;
}
interface FxBillerPayment {
  id: string;
  billerId: string;
  presentmentId: string;
  customerId: string;
  bbpsTxnRef: string;
  amountPaise: number;
  mode: PaymentMode;
  paidAt: string;
  cycles: Cycle[];
  oemBillIds: string[];
}
interface FxPresentment {
  id: string;
  customerId: string;
  bill: BillPresentment;
  status: "OPEN" | "PAID";
}
interface FxCouPayment {
  id: string;
  orderId: string;
  fetchRef: string;
  bbpsTxnRef: string | null;
  billerId: string | null;
  vehicleRegNo: string | null;
  amountPaise: number;
  mode: PaymentMode;
  status: "INITIATED" | "SUCCESS" | "FAILED";
  createdAt: string;
  updatedAt: string;
}
interface Store {
  plans: OemPlan[];
  vehicles: FxVehicle[];
  trips: FxTrip[];
  bills: OemBill[];
  billers: BillerSummary[];
  customers: FxCustomer[];
  presentments: FxPresentment[];
  payments: FxBillerPayment[];
  txns: NbblTxn[];
  events: NbblEvent[];
  couPayments: FxCouPayment[];
  nextEventId: number;
}

const PLANS: OemPlan[] = [
  { id: "STD", name: "Standard", fixedFeePaise: 150000, ratePaisePerKm: 350 },
  { id: "PRO", name: "Pro (long-range pack)", fixedFeePaise: 200000, ratePaisePerKm: 450 },
  { id: "FLEX", name: "Flex", fixedFeePaise: 99900, ratePaisePerKm: 400 },
];

function planOf(id: string): OemPlan {
  const p = PLANS.find((x) => x.id === id);
  if (!p) throw new Error(`fixture: unknown plan ${id}`);
  return p;
}

function makeBill(
  vehicle: FxVehicle,
  cycle: Cycle,
  km: number,
  billDate: Date,
  paid?: { ref: string; at: string },
): OemBill {
  const plan = planOf(vehicle.planId);
  const variable = km * plan.ratePaisePerKm;
  const subtotal = plan.fixedFeePaise + variable;
  const gst = pctBps(subtotal, GST_BPS);
  return {
    id: uuid(),
    billNo: `OEM-${cycle.replace("-", "")}-${vehicle.regNo}`,
    vehicleId: vehicle.id,
    regNo: vehicle.regNo,
    planId: plan.id,
    cycle,
    kmDriven: km,
    fixedFeePaise: plan.fixedFeePaise,
    ratePaisePerKm: plan.ratePaisePerKm,
    variablePaise: variable,
    subtotalPaise: subtotal,
    gstPaise: gst,
    totalPaise: subtotal + gst,
    billDate: isoDate(billDate),
    dueDate: isoDate(addDays(billDate, DUE_DAYS)),
    paymentStatus: paid ? "PAID" : "UNPAID",
    paidRef: paid?.ref ?? null,
    paidAt: paid?.at ?? null,
  };
}

function seedStore(): Store {
  const now = Date.now();
  const prev = monthStart(-1);
  const prev2 = monthStart(-2);
  const cur = monthStart(0);
  const midCur = new Date(cur.getTime() + (now - cur.getTime()) / 2).toISOString();
  const at = (base: Date, days: number) => new Date(base.getTime() + days * DAY_MS).toISOString();
  const ago = (ms: number) => new Date(now - ms).toISOString();

  const vehicles: FxVehicle[] = [
    { id: "11111111-0000-4000-8000-000000000001", regNo: "MH01AB1001", vin: "SMEVDEMO000001001", model: "Sample Motors Aura EV (sedan)", planId: "STD", odometerKm: 9380, activatedOn: isoDate(monthStart(-8)) },
    { id: "11111111-0000-4000-8000-000000000002", regNo: "MH01AB1002", vin: "SMEVDEMO000001002", model: "Sample Motors Nova EV (hatch)", planId: "FLEX", odometerKm: 8150, activatedOn: isoDate(monthStart(-6)) },
    { id: "11111111-0000-4000-8000-000000000003", regNo: "MH01AB1003", vin: "SMEVDEMO000001003", model: "Sample Motors Terra EV (SUV)", planId: "PRO", odometerKm: 14170, activatedOn: isoDate(monthStart(-10)) },
    { id: "11111111-0000-4000-8000-000000000004", regNo: "MH01AB1004", vin: "SMEVDEMO000001004", model: "Sample Motors Aura EV (sedan)", planId: "STD", odometerKm: 12, activatedOn: isoDate(cur) },
  ];
  const [riya, arjun, meera] = vehicles;
  const trips: FxTrip[] = [
    { vehicleId: riya.id, km: 400, recordedAt: at(prev, 4) },
    { vehicleId: riya.id, km: 450, recordedAt: at(prev, 12) },
    { vehicleId: riya.id, km: 350, recordedAt: at(prev, 21) },
    { vehicleId: arjun.id, km: 500, recordedAt: at(prev2, 6) },
    { vehicleId: arjun.id, km: 400, recordedAt: at(prev2, 18) },
    { vehicleId: arjun.id, km: 600, recordedAt: at(prev, 7) },
    { vehicleId: arjun.id, km: 500, recordedAt: at(prev, 19) },
    { vehicleId: meera.id, km: 900, recordedAt: at(prev, 5) },
    { vehicleId: meera.id, km: 950, recordedAt: at(prev, 16) },
    { vehicleId: riya.id, km: 180, recordedAt: midCur },
    { vehicleId: arjun.id, km: 150, recordedAt: midCur },
    { vehicleId: meera.id, km: 320, recordedAt: midCur },
  ];
  const t = today();
  const meeraPaidAt = ago(3 * DAY_MS);
  const bills: OemBill[] = [
    makeBill(riya, cycleOf(prev), 1200, addDays(t, -5)),
    makeBill(arjun, cycleOf(prev2), 900, addDays(t, -35)),
    makeBill(arjun, cycleOf(prev), 1100, addDays(t, -5)),
    makeBill(meera, cycleOf(prev), 1850, addDays(t, -5), { ref: "BCSEEDPAID01", at: meeraPaidAt }),
  ];
  const customers: FxCustomer[] = [
    { id: "33333333-0000-4000-8000-000000000001", billerId: "demo-finance", name: "Riya Sharma", mobile: "9800000001", vehicleRegNo: "MH01AB1001", contractId: "DF-BAAS-0001" },
    { id: "33333333-0000-4000-8000-000000000002", billerId: "demo-finance", name: "Arjun Mehta", mobile: "9800000002", vehicleRegNo: "MH01AB1002", contractId: "DF-BAAS-0002" },
    { id: "33333333-0000-4000-8000-000000000003", billerId: "volt-leasing", name: "Meera Iyer", mobile: "9800000003", vehicleRegNo: "MH01AB1003", contractId: "VL-BAAS-0001" },
    { id: "33333333-0000-4000-8000-000000000004", billerId: "demo-finance", name: "Kabir Khan", mobile: "9800000004", vehicleRegNo: "MH01AB1004", contractId: "DF-BAAS-0003" },
  ];
  const billers: BillerSummary[] = [
    { id: "demo-finance", name: "Demo Finance", category: "EV_BAAS", status: "ACTIVE" },
    { id: "volt-leasing", name: "Volt Leasing", category: "EV_BAAS", status: "ACTIVE" },
  ];

  const store: Store = {
    plans: PLANS,
    vehicles,
    trips,
    bills,
    billers,
    customers,
    presentments: [],
    payments: [],
    txns: [],
    events: [],
    couPayments: [],
    nextEventId: 1,
  };

  // Meera: paid presentment + payment + NBBL FETCH/PAY + COU order (AutoPay), as in seed.sql.
  const meeraCustomer = customers[2];
  const meeraBill = presentmentFor(store, meeraCustomer, [bills[3]]);
  meeraBill.presentmentId = "55555555-0000-4000-8000-000000000001";
  store.presentments.push({ id: meeraBill.presentmentId, customerId: meeraCustomer.id, bill: meeraBill, status: "PAID" });
  store.payments.push({
    id: "66666666-0000-4000-8000-000000000001",
    billerId: "volt-leasing",
    presentmentId: meeraBill.presentmentId,
    customerId: meeraCustomer.id,
    bbpsTxnRef: "BCSEEDPAID01",
    amountPaise: 1218350,
    mode: "UPI_AUTOPAY",
    paidAt: meeraPaidAt,
    cycles: [bills[3].cycle],
    oemBillIds: [bills[3].id],
  });
  store.couPayments.push({
    id: uuid(), orderId: "DP-SEED000001", fetchRef: "F-SEED000001", bbpsTxnRef: "BCSEEDPAID01",
    billerId: "volt-leasing", vehicleRegNo: "MH01AB1003", amountPaise: 1218350, mode: "UPI_AUTOPAY",
    status: "SUCCESS", createdAt: meeraPaidAt, updatedAt: meeraPaidAt,
  });

  // NBBL history (7 txns): Meera FETCH+PAY, Riya & Arjun fetches, Kabir not generated,
  // a wrong-mobile attempt, and one biller timeout.
  const hist: Array<{
    ref: string; type: "FETCH" | "PAY"; billerId: string; reg: string; mobile: string;
    amount: number | null; status: "SUCCESS" | "FAILED"; code: ResponseCode; fetchRef: string | null;
    billerRef: string | null; atMs: number; latency: number; result?: string; autopay?: boolean;
  }> = [
    { ref: "F-SEED000001", type: "FETCH", billerId: "volt-leasing", reg: "MH01AB1003", mobile: "9800000003", amount: 1218350, status: "SUCCESS", code: "000", fetchRef: null, billerRef: meeraBill.presentmentId, atMs: 3 * DAY_MS + 120_000, latency: 142, result: "BILL_DUE", autopay: true },
    { ref: "BCSEEDPAID01", type: "PAY", billerId: "volt-leasing", reg: "MH01AB1003", mobile: "9800000003", amount: 1218350, status: "SUCCESS", code: "000", fetchRef: "F-SEED000001", billerRef: meeraBill.presentmentId, atMs: 3 * DAY_MS, latency: 188, autopay: true },
    { ref: "F-K7Q2M9XP4A", type: "FETCH", billerId: "demo-finance", reg: "MH01AB1001", mobile: "9800000001", amount: 672600, status: "SUCCESS", code: "000", fetchRef: null, billerRef: uuid(), atMs: 2 * DAY_MS, latency: 131, result: "BILL_DUE" },
    { ref: "F-R3T8W2NB6C", type: "FETCH", billerId: "demo-finance", reg: "MH01AB1002", mobile: "9800000002", amount: 1188962, status: "SUCCESS", code: "000", fetchRef: null, billerRef: uuid(), atMs: DAY_MS + 3_600_000, latency: 164, result: "BILL_DUE" },
    { ref: "F-H5J9D3LV2E", type: "FETCH", billerId: "demo-finance", reg: "MH01AB1004", mobile: "9800000004", amount: null, status: "SUCCESS", code: "BFR001", fetchRef: null, billerRef: null, atMs: DAY_MS, latency: 97, result: "NOT_GENERATED" },
    { ref: "F-P2X6C8QZ5M", type: "FETCH", billerId: "demo-finance", reg: "MH01AB1001", mobile: "9800000009", amount: null, status: "SUCCESS", code: "BFR002", fetchRef: null, billerRef: null, atMs: 6 * 3_600_000, latency: 88, result: "NOT_FOUND" },
    { ref: "F-Z9B4N7GS3T", type: "FETCH", billerId: "volt-leasing", reg: "MH01AB1003", mobile: "9800000003", amount: null, status: "FAILED", code: "SYS500", fetchRef: null, billerRef: null, atMs: 2 * 3_600_000, latency: 3004, result: "BILLER_UNAVAILABLE" },
  ];
  for (const h of hist) {
    const createdAt = now - h.atMs;
    store.txns.push({
      ref: h.ref, type: h.type, couId: "DEMOPAY", billerId: h.billerId, category: "EV_BAAS",
      customerRefMasked: `${h.reg} / ${maskMobile(h.mobile)}`, amountPaise: h.amount, status: h.status,
      responseCode: h.code, fetchRef: h.fetchRef, billerRef: h.billerRef,
      createdAt: new Date(createdAt).toISOString(), completedAt: new Date(createdAt + h.latency).toISOString(),
      latencyMs: h.latency,
    });
    const initiatedBy = h.autopay ? "AUTOPAY" : "CUSTOMER";
    const steps: Array<[NbblEventStep, JsonValue]> =
      h.type === "FETCH"
        ? [
            ["COU_REQ", { initiatedBy, couId: "DEMOPAY", billerId: h.billerId, category: "EV_BAAS", customerParams: { vehicleRegNo: h.reg, registeredMobile: maskMobile(h.mobile) } }],
            ["BILLER_REQ", { nbblRef: h.ref, billerId: h.billerId, vehicleNo: h.reg, mobile: maskMobile(h.mobile) }],
            h.code === "SYS500"
              ? ["ERROR", { error: "Biller did not respond within 3000 ms" }]
              : ["BILLER_RESP", { result: h.result ?? null, responseCode: h.code, amountPaise: h.amount }],
            ["COU_RESP", { fetchRef: h.ref, result: h.result ?? null, responseCode: h.code, amountPaise: h.amount }],
          ]
        : [
            ["COU_REQ", { initiatedBy, couId: "DEMOPAY", fetchRef: h.fetchRef, amountPaise: h.amount, mode: "UPI_AUTOPAY", couOrderId: "DP-SEED000001" }],
            ["PAY_REQ", { billerId: h.billerId, presentmentId: h.billerRef, amountPaise: h.amount, bbpsTxnRef: h.ref, mode: "UPI_AUTOPAY" }],
            ["ADVICE_ACK", { ack: true, responseCode: "000", bbpsTxnRef: h.ref }],
            ["COU_RESP", { status: "SUCCESS", responseCode: "000", bbpsTxnRef: h.ref }],
          ];
    steps.forEach(([step, payload], i) => {
      store.events.push({
        id: store.nextEventId++, txnRef: h.ref, step, payload,
        at: new Date(createdAt + Math.round((h.latency * i) / (steps.length - 1))).toISOString(),
      });
    });
  }
  return store;
}

let store: Store = seedStore();

/** Restore the fixture seed (used by the fixture `adminReset`). */
export function fixtureReset(): void {
  store = seedStore();
}

// ─── Biller-side presentment (fixture mirror of the biller service) ──────────

function isOverdue(bill: OemBill): boolean {
  return bill.paymentStatus !== "PAID" && bill.dueDate < isoDate(today());
}

function presentmentFor(s: Store, customer: FxCustomer, unpaid: OemBill[]): BillPresentment {
  const sorted = [...unpaid].sort((a, b) => a.cycle.localeCompare(b.cycle));
  const latest = sorted[sorted.length - 1];
  const older = sorted.slice(0, -1);
  const biller = s.billers.find((b) => b.id === customer.billerId);
  const plan = planOf(latest.planId);
  const lines: BillLineItem[] = [
    { kind: "FIXED_FEE", label: "Fixed battery fee", cycle: latest.cycle, amountPaise: latest.fixedFeePaise },
    {
      kind: "USAGE",
      label: `Pay-per-use (${latest.kmDriven.toLocaleString("en-IN")} km × ${rupees(latest.ratePaisePerKm)}/km)`,
      cycle: latest.cycle, amountPaise: latest.variablePaise, km: latest.kmDriven, ratePaisePerKm: latest.ratePaisePerKm,
    },
    { kind: "GST", label: "GST @ 18%", cycle: latest.cycle, amountPaise: latest.gstPaise, rateBps: GST_BPS, basePaise: latest.subtotalPaise },
  ];
  for (const b of older) lines.push({ kind: "ARREARS", label: `Arrears (${formatCycle(b.cycle)})`, cycle: b.cycle, amountPaise: b.totalPaise });
  const cycles: PresentedCycle[] = sorted.map((b) => {
    const overdue = isOverdue(b);
    const lateFee = overdue ? pctBps(b.subtotalPaise, LATE_FEE_BPS) : 0;
    if (lateFee > 0) {
      lines.push({ kind: "LATE_FEE", label: `Late fee (${formatCycle(b.cycle)})`, cycle: b.cycle, amountPaise: lateFee, rateBps: LATE_FEE_BPS, basePaise: b.subtotalPaise });
    }
    return {
      cycle: b.cycle, oemBillId: b.id, oemBillNo: b.billNo, kmDriven: b.kmDriven, subtotalPaise: b.subtotalPaise,
      gstPaise: b.gstPaise, totalPaise: b.totalPaise, lateFeePaise: lateFee, billDate: b.billDate, dueDate: b.dueDate,
      status: b.paymentStatus === "PAID" ? "PAID" : overdue ? "OVERDUE" : "UNPAID",
    };
  });
  const arrears = older.reduce((sum, b) => sum + b.totalPaise, 0);
  const lateFees = cycles.reduce((sum, c) => sum + c.lateFeePaise, 0);
  return {
    presentmentId: uuid(),
    billerId: customer.billerId,
    billerName: biller?.name ?? customer.billerId,
    customerName: maskName(customer.name),
    vehicleRegNo: customer.vehicleRegNo,
    planId: plan.id,
    planName: plan.name,
    cycle: latest.cycle,
    billPeriod: { from: isoDate(cycleStart(latest.cycle)), to: isoDate(cycleEnd(latest.cycle)) },
    billDate: latest.billDate,
    dueDate: latest.dueDate,
    overdue: cycles.some((c) => c.status === "OVERDUE"),
    kmDriven: latest.kmDriven,
    currentCyclePaise: latest.totalPaise,
    arrearsPaise: arrears,
    lateFeePaise: lateFees,
    amountPaise: latest.totalPaise + arrears + lateFees,
    lines,
    cycles,
  };
}

function receiptFor(s: Store, p: FxBillerPayment, couOrderId?: string): Receipt {
  const customer = s.customers.find((c) => c.id === p.customerId);
  const biller = s.billers.find((b) => b.id === p.billerId);
  return {
    bbpsTxnRef: p.bbpsTxnRef,
    billerId: p.billerId,
    billerName: biller?.name ?? p.billerId,
    vehicleRegNo: customer?.vehicleRegNo ?? "",
    customerName: maskName(customer?.name ?? ""),
    amountPaise: p.amountPaise,
    mode: p.mode,
    paidAt: p.paidAt,
    cycles: p.cycles,
    ...(couOrderId ? { couOrderId } : {}),
  };
}

function logTxn(txn: NbblTxn, steps: Array<[NbblEventStep, JsonValue]>): void {
  store.txns.push(txn);
  const start = Date.parse(txn.createdAt);
  steps.forEach(([step, payload], i) => {
    store.events.push({
      id: store.nextEventId++, txnRef: txn.ref, step, payload,
      at: new Date(start + Math.round(((txn.latencyMs ?? 0) * i) / Math.max(1, steps.length - 1))).toISOString(),
    });
  });
}

// ─── COU / NBBL ──────────────────────────────────────────────────────────────

export function fixtureBillers(category?: Category): BillerSummary[] {
  return store.billers.filter((b) => !category || b.category === category);
}

export function fixtureFetch(req: CouFetchRequest): FetchResult {
  const reg = normaliseRegNo(req.vehicleNo);
  const fetchRef = randRef("F-");
  const biller = store.billers.find((b) => b.id === req.billerId);
  const latency = 90 + Math.floor(Math.random() * 120);
  const baseTxn = (code: ResponseCode, status: "SUCCESS" | "FAILED", amount: number | null, billerRef: string | null): NbblTxn => ({
    ref: fetchRef, type: "FETCH", couId: "DEMOPAY", billerId: req.billerId, category: "EV_BAAS",
    customerRefMasked: `${reg} / ${maskMobile(req.mobile)}`, amountPaise: amount, status, responseCode: code,
    fetchRef: null, billerRef, createdAt: new Date().toISOString(),
    completedAt: new Date(Date.now() + latency).toISOString(), latencyMs: latency,
  });
  const couReq: [NbblEventStep, JsonValue] = ["COU_REQ", { couId: "DEMOPAY", billerId: req.billerId, category: "EV_BAAS", customerParams: { vehicleRegNo: reg, registeredMobile: maskMobile(req.mobile) } }];
  const billerReq: [NbblEventStep, JsonValue] = ["BILLER_REQ", { nbblRef: fetchRef, billerId: req.billerId, vehicleNo: reg, mobile: maskMobile(req.mobile) }];

  let result: FetchResult;
  if (!biller) {
    result = { result: "BILLER_UNAVAILABLE", billerId: req.billerId, fetchRef, responseCode: "BFR003", message: RESPONSE_MESSAGES.BFR003 };
    logTxn(baseTxn("BFR003", "FAILED", null, null), [couReq, ["COU_RESP", { fetchRef, result: result.result, responseCode: "BFR003" }]]);
    return result;
  }
  if (reg === "MH01AB9999") {
    result = { result: "BILLER_UNAVAILABLE", billerId: biller.id, billerName: biller.name, fetchRef, responseCode: "SYS500", message: "Biller is not responding, try again" };
    logTxn(baseTxn("SYS500", "FAILED", null, null), [couReq, billerReq, ["ERROR", { error: "Biller did not respond" }], ["COU_RESP", { fetchRef, result: result.result, responseCode: "SYS500" }]]);
    return result;
  }
  const customer = store.customers.find((c) => c.billerId === biller.id && c.vehicleRegNo === reg && c.mobile === req.mobile);
  if (!customer) {
    result = { result: "NOT_FOUND", billerId: biller.id, billerName: biller.name, fetchRef, responseCode: "BFR002", message: `We couldn't find an account for this vehicle and mobile number with ${biller.name}.` };
  } else {
    const bills = store.bills.filter((b) => b.regNo === reg);
    const unpaid = bills.filter((b) => b.paymentStatus !== "PAID");
    const lastPayment = store.payments.filter((p) => p.customerId === customer.id).sort((a, b) => b.paidAt.localeCompare(a.paidAt))[0];
    if (unpaid.length > 0) {
      const bill = presentmentFor(store, customer, unpaid);
      store.presentments.push({ id: bill.presentmentId, customerId: customer.id, bill, status: "OPEN" });
      result = { result: "BILL_DUE", bill, fetchRef, responseCode: "000", message: RESPONSE_MESSAGES["000"] };
    } else if (lastPayment) {
      result = { result: "ALREADY_PAID", receipt: receiptFor(store, lastPayment), fetchRef, responseCode: "BFR001", message: "Bill already paid" };
    } else {
      result = {
        result: "NOT_GENERATED", billerId: biller.id, billerName: biller.name, vehicleRegNo: reg,
        customerName: maskName(customer.name), nextBillDate: isoDate(monthStart(1)), fetchRef,
        responseCode: "BFR001", message: "No bill generated yet for this vehicle. Bills are generated on the 1st of each month.",
      };
    }
  }
  const amount = result.result === "BILL_DUE" ? result.bill.amountPaise : null;
  const billerRef = result.result === "BILL_DUE" ? result.bill.presentmentId : null;
  logTxn(baseTxn(result.responseCode, "SUCCESS", amount, billerRef), [
    couReq,
    billerReq,
    ["BILLER_RESP", { result: result.result, responseCode: result.responseCode, amountPaise: amount, presentmentId: billerRef }],
    ["COU_RESP", { fetchRef, result: result.result, responseCode: result.responseCode, amountPaise: amount }],
  ]);
  return result;
}

export function fixturePay(req: CouPayRequest): PayResult {
  const couOrderId = randRef("DP-");
  const nowIso = new Date().toISOString();
  const order: FxCouPayment = {
    id: uuid(), orderId: couOrderId, fetchRef: req.fetchRef, bbpsTxnRef: null, billerId: null, vehicleRegNo: null,
    amountPaise: req.amountPaise, mode: req.mode, status: "INITIATED", createdAt: nowIso, updatedAt: nowIso,
  };
  store.couPayments.push(order);
  if (req.simulateFailure) {
    order.status = "FAILED";
    return { status: "FAILED", couOrderId, failureReason: "PAYMENT_DECLINED", responseCode: null, bbpsTxnRef: null, message: "Payment declined by your bank (simulated)." };
  }
  const res = fixtureBillPay({ couId: "DEMOPAY", fetchRef: req.fetchRef, amountPaise: req.amountPaise, mode: req.mode, couOrderId });
  if (res.status === "SUCCESS" && res.receipt) {
    order.status = "SUCCESS";
    order.bbpsTxnRef = res.bbpsTxnRef;
    order.billerId = res.receipt.billerId;
    order.vehicleRegNo = res.receipt.vehicleRegNo;
    return { status: "SUCCESS", couOrderId, responseCode: "000", receipt: { ...res.receipt, couOrderId } };
  }
  order.status = "FAILED";
  return {
    status: "FAILED", couOrderId,
    failureReason: res.responseCode === "SYS500" ? "BILLER_UNAVAILABLE" : "BBPS_REJECTED",
    responseCode: res.responseCode, bbpsTxnRef: res.bbpsTxnRef, message: res.message,
  };
}

/** NBBL bill-pay + biller payment advice, fixture edition. */
export function fixtureBillPay(req: { couId: string; fetchRef: string; amountPaise: number; mode: PaymentMode; couOrderId: string }): BillPaymentResponse {
  const fetchTxn = store.txns.find((t) => t.ref === req.fetchRef && t.type === "FETCH");
  if (!fetchTxn || fetchTxn.responseCode !== "000" || !fetchTxn.billerRef) {
    return { status: "FAILED", bbpsTxnRef: null, receipt: null, responseCode: "BPR002", message: "This bill is not payable. Fetch the bill again." };
  }
  // Idempotency per fetchRef (mirrors nbbl/api.billPay): a retry returns the earlier receipt.
  const priorTxn = store.txns.find((t) => t.type === "PAY" && t.fetchRef === req.fetchRef && t.status === "SUCCESS");
  const priorPayment = priorTxn && store.payments.find((p) => p.bbpsTxnRef === priorTxn.ref);
  if (priorTxn && priorPayment) {
    return { status: "SUCCESS", bbpsTxnRef: priorTxn.ref, receipt: receiptFor(store, priorPayment, req.couOrderId), responseCode: "000", message: RESPONSE_MESSAGES["000"] };
  }
  const bbpsTxnRef = randRef("BC");
  const presentment = store.presentments.find((p) => p.id === fetchTxn.billerRef);
  let code: ResponseCode = "000";
  const alreadySettled =
    !!presentment &&
    presentment.bill.cycles.some((c) => store.bills.find((b) => b.id === c.oemBillId)?.paymentStatus === "PAID");
  if (!presentment || presentment.status === "PAID" || alreadySettled) code = "BPR002";
  else if (presentment.bill.amountPaise !== req.amountPaise) code = "BPR001";
  const latency = 120 + Math.floor(Math.random() * 150);
  const paidAt = new Date().toISOString();
  let receipt: Receipt | null = null;
  if (code === "000" && presentment) {
    presentment.status = "PAID";
    const oemBillIds = presentment.bill.cycles.map((c) => c.oemBillId);
    for (const b of store.bills) {
      if (oemBillIds.includes(b.id)) {
        b.paymentStatus = "PAID";
        b.paidRef = bbpsTxnRef;
        b.paidAt = paidAt;
      }
    }
    const payment: FxBillerPayment = {
      id: uuid(), billerId: presentment.bill.billerId, presentmentId: presentment.id, customerId: presentment.customerId,
      bbpsTxnRef, amountPaise: req.amountPaise, mode: req.mode, paidAt, cycles: presentment.bill.cycles.map((c) => c.cycle), oemBillIds,
    };
    store.payments.push(payment);
    receipt = receiptFor(store, payment, req.couOrderId);
  }
  const ok = code === "000";
  logTxn(
    {
      ref: bbpsTxnRef, type: "PAY", couId: req.couId, billerId: fetchTxn.billerId, category: "EV_BAAS",
      customerRefMasked: fetchTxn.customerRefMasked, amountPaise: req.amountPaise, status: ok ? "SUCCESS" : "FAILED",
      responseCode: code, fetchRef: req.fetchRef, billerRef: fetchTxn.billerRef, createdAt: paidAt,
      completedAt: new Date(Date.parse(paidAt) + latency).toISOString(), latencyMs: latency,
    },
    [
      ["COU_REQ", { couId: req.couId, fetchRef: req.fetchRef, amountPaise: req.amountPaise, mode: req.mode, couOrderId: req.couOrderId }],
      ["PAY_REQ", { billerId: fetchTxn.billerId, presentmentId: fetchTxn.billerRef, amountPaise: req.amountPaise, bbpsTxnRef, mode: req.mode }],
      ["ADVICE_ACK", { ack: ok, responseCode: code, bbpsTxnRef }],
      ["COU_RESP", { status: ok ? "SUCCESS" : "FAILED", responseCode: code, bbpsTxnRef }],
    ],
  );
  return { status: ok ? "SUCCESS" : "FAILED", bbpsTxnRef, receipt, responseCode: code, message: RESPONSE_MESSAGES[code] };
}

export function fixtureBillFetch(req: { billerId: string; customerParams: { vehicleRegNo: string; registeredMobile: string } }): BillFetchResponse {
  return fixtureFetch({ billerId: req.billerId, vehicleNo: req.customerParams.vehicleRegNo, mobile: req.customerParams.registeredMobile });
}

export function fixtureTransactions(query?: NbblTxnQuery): NbblTxn[] {
  const limit = Math.min(query?.limit ?? 50, 200);
  return store.txns
    .filter((t) => !query?.type || t.type === query.type)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export function fixtureTransaction(ref: string): NbblTxnDetail | null {
  const txn = store.txns.find((t) => t.ref === ref);
  if (!txn) return null;
  return { ...txn, events: store.events.filter((e) => e.txnRef === ref).sort((a, b) => a.id - b.id) };
}

export function fixtureStats(): NbblStats {
  const final = store.txns.filter((t) => t.status !== "PENDING");
  const ok = final.filter((t) => t.status === "SUCCESS").length;
  return {
    fetches: store.txns.filter((t) => t.type === "FETCH").length,
    payments: store.txns.filter((t) => t.type === "PAY").length,
    successRate: final.length ? ok / final.length : 0,
    valuePaise: store.txns.filter((t) => t.type === "PAY" && t.status === "SUCCESS").reduce((s, t) => s + (t.amountPaise ?? 0), 0),
  };
}

// ─── Biller ──────────────────────────────────────────────────────────────────

export function fixtureBillerOverview(billerId: string): BillerOverview {
  const biller = store.billers.find((b) => b.id === billerId);
  if (!biller) throw new Error(`Unknown biller ${billerId}`);
  const customers = store.customers.filter((c) => c.billerId === billerId);
  const receivables = customers.flatMap((c) =>
    store.bills
      .filter((b) => b.regNo === c.vehicleRegNo)
      .map((b) => {
        const overdue = isOverdue(b);
        const payment = store.payments.find((p) => p.oemBillIds.includes(b.id));
        return {
          id: `rcv-${b.id}`, customerId: c.id, customerName: c.name, vehicleRegNo: c.vehicleRegNo, oemBillId: b.id,
          cycle: b.cycle, subtotalPaise: b.subtotalPaise, gstPaise: b.gstPaise, totalPaise: b.totalPaise,
          lateFeePaise: overdue ? pctBps(b.subtotalPaise, LATE_FEE_BPS) : 0, dueDate: b.dueDate,
          status: b.paymentStatus === "PAID" ? ("PAID" as const) : overdue ? ("OVERDUE" as const) : ("UNPAID" as const),
          syncedAt: new Date(Date.parse(b.billDate) + DAY_MS).toISOString(), paidPaymentId: payment?.id ?? null,
        };
      }),
  ).sort((a, b) => b.cycle.localeCompare(a.cycle) || a.vehicleRegNo.localeCompare(b.vehicleRegNo));
  const open = receivables.filter((r) => r.status !== "PAID");
  const payments = store.payments
    .filter((p) => p.billerId === billerId)
    .sort((a, b) => b.paidAt.localeCompare(a.paidAt))
    .map((p) => {
      const c = store.customers.find((x) => x.id === p.customerId);
      return {
        id: p.id, presentmentId: p.presentmentId, customerName: c?.name ?? "", vehicleRegNo: c?.vehicleRegNo ?? "",
        bbpsTxnRef: p.bbpsTxnRef, amountPaise: p.amountPaise, mode: p.mode, paidAt: p.paidAt,
      };
    });
  return {
    biller: { id: biller.id, name: biller.name, category: biller.category },
    kpis: {
      receivablesDuePaise: open.reduce((s, r) => s + r.totalPaise + r.lateFeePaise, 0),
      collectedPaise: payments.reduce((s, p) => s + p.amountPaise, 0),
      overdueCount: receivables.filter((r) => r.status === "OVERDUE").length,
      customers: customers.length,
    },
    customers: customers.map((c) => ({
      id: c.id, name: c.name, mobileMasked: maskMobile(c.mobile), vehicleRegNo: c.vehicleRegNo, contractId: c.contractId,
      outstandingPaise: open.filter((r) => r.customerId === c.id).reduce((s, r) => s + r.totalPaise + r.lateFeePaise, 0),
    })),
    receivables,
    payments,
  };
}

// ─── OEM ─────────────────────────────────────────────────────────────────────

function vehicleRow(v: FxVehicle): OemVehicleRow {
  const plan = planOf(v.planId);
  const currentCycle = cycleOf(monthStart(0));
  const start = monthStart(0).toISOString();
  const kmThisCycle = store.trips.filter((t) => t.vehicleId === v.id && t.recordedAt >= start).reduce((s, t) => s + t.km, 0);
  const last = store.bills.filter((b) => b.vehicleId === v.id).sort((a, b) => b.cycle.localeCompare(a.cycle))[0];
  return {
    id: v.id, regNo: v.regNo, vin: v.vin, model: v.model, planId: plan.id, planName: plan.name,
    fixedFeePaise: plan.fixedFeePaise, ratePaisePerKm: plan.ratePaisePerKm, odometerKm: v.odometerKm,
    activatedOn: v.activatedOn, currentCycle, kmThisCycle,
    lastBill: last ? { id: last.id, billNo: last.billNo, cycle: last.cycle, totalPaise: last.totalPaise, paymentStatus: last.paymentStatus } : null,
  };
}

export function fixtureVehicles(): OemVehicleRow[] {
  return [...store.vehicles].sort((a, b) => a.regNo.localeCompare(b.regNo)).map(vehicleRow);
}

export function fixtureAddTrip(vehicleId: string, km: number): OemVehicleRow {
  const v = store.vehicles.find((x) => x.id === vehicleId);
  if (!v) throw new Error("Vehicle not found");
  if (!Number.isInteger(km) || km <= 0 || km > 10_000) throw new Error("km must be a positive integer up to 10,000");
  store.trips.push({ vehicleId, km, recordedAt: new Date().toISOString() });
  v.odometerKm += km;
  return vehicleRow(v);
}

export function fixtureGenerateBills(cycle: Cycle, vehicleIds?: string[]): { generated: OemBill[] } {
  if (!/^\d{4}-\d{2}$/.test(cycle)) throw new Error("cycle must be YYYY-MM");
  const from = cycleStart(cycle).toISOString();
  const to = new Date(cycleEnd(cycle).getTime() + DAY_MS).toISOString();
  const generated: OemBill[] = [];
  for (const v of store.vehicles) {
    if (vehicleIds && !vehicleIds.includes(v.id)) continue;
    if (v.activatedOn > isoDate(cycleEnd(cycle))) continue;
    if (store.bills.some((b) => b.vehicleId === v.id && b.cycle === cycle)) continue;
    const km = store.trips.filter((t) => t.vehicleId === v.id && t.recordedAt >= from && t.recordedAt < to).reduce((s, t) => s + t.km, 0);
    const bill = makeBill(v, cycle, km, today());
    store.bills.push(bill);
    generated.push(bill);
  }
  return { generated };
}

export function fixtureBills(regNo?: string): OemBill[] {
  if (regNo) {
    const reg = normaliseRegNo(regNo);
    return store.bills.filter((b) => b.regNo === reg).sort((a, b) => a.cycle.localeCompare(b.cycle));
  }
  return [...store.bills].sort((a, b) => b.cycle.localeCompare(a.cycle) || a.regNo.localeCompare(b.regNo));
}

// ─── Admin ───────────────────────────────────────────────────────────────────

function snake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}
function toRow(obj: object): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  for (const [k, v] of Object.entries(obj)) out[snake(k)] = v === undefined ? null : (v as JsonValue);
  return out;
}

const FIXTURE_TABLES: Array<{ party: Party; table: string; rows: () => object[] }> = [
  { party: "oem", table: "oem_plans", rows: () => store.plans },
  { party: "oem", table: "oem_vehicles", rows: () => store.vehicles },
  { party: "oem", table: "oem_trips", rows: () => [...store.trips].reverse() },
  { party: "oem", table: "oem_bills", rows: () => fixtureBills() },
  { party: "biller", table: "biller_billers", rows: () => store.billers.map(({ id, name, category }) => ({ id, name, category })) },
  { party: "biller", table: "biller_customers", rows: () => store.customers },
  { party: "biller", table: "biller_receivables", rows: () => store.billers.flatMap((b) => fixtureBillerOverview(b.id).receivables) },
  { party: "biller", table: "biller_presentments", rows: () => store.presentments.map((p) => ({ id: p.id, customerId: p.customerId, amountPaise: p.bill.amountPaise, status: p.status })).reverse() },
  { party: "biller", table: "biller_payments", rows: () => [...store.payments].reverse().map(({ id, billerId, presentmentId, bbpsTxnRef, amountPaise, mode, paidAt }) => ({ id, billerId, presentmentId, bbpsTxnRef, amountPaise, mode, paidAt })) },
  { party: "nbbl", table: "nbbl_billers", rows: () => store.billers },
  { party: "nbbl", table: "nbbl_transactions", rows: () => fixtureTransactions({ limit: 100 }) },
  { party: "nbbl", table: "nbbl_events", rows: () => [...store.events].reverse() },
  { party: "cou", table: "cou_payments", rows: () => [...store.couPayments].reverse() },
];

export function fixtureAdminTables(): AdminTableSummary[] {
  return FIXTURE_TABLES.map((t) => ({ party: t.party, table: t.table, rows: t.rows().length }));
}

export function fixtureAdminTableRows(name: string): AdminTableRows | null {
  const t = FIXTURE_TABLES.find((x) => x.table === name);
  if (!t) return null;
  const rows = t.rows().slice(0, 100).map(toRow);
  const columns = rows.length ? Object.keys(rows[0]) : [];
  return { party: t.party, table: t.table, columns, rows };
}
