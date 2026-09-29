/**
 * Biller business rules: PURE functions (no DB, no I/O). Owner: agent B.
 * Presentment composition follows BUILD_PLAN §4 and the BillLineItem ordering in types.ts.
 */
import type {
  BillLineItem,
  BillPresentment,
  Cycle,
  IsoDate,
  OemBill,
  Paise,
  PresentedCycle,
  ReceivableStatus,
} from "@/lib/domain/types";
import { formatCycle } from "@/lib/domain/cycle";

// ASSUMPTION: GST 18% on the OEM bill (the OEM computes it; the biller only labels it).
export const GST_BPS = 1800;
// ASSUMPTION: late fee = 2% of an overdue bill's SUBTOTAL, one-time, no GST (docs/DOMAIN.md §4).
export const LATE_FEE_BPS = 200;

/** `mh-01 ab 1001` → `MH01AB1001`. */
export function normaliseRegNo(v: string): string {
  return v.toUpperCase().replace(/[\s-]/g, "");
}

/** `9800000001` → `98XXXXXX01`. */
export function maskMobile(m: string): string {
  return /^\d{10}$/.test(m) ? `${m.slice(0, 2)}XXXXXX${m.slice(8)}` : "XXXXXXXXXX";
}

/** `Riya Sharma` → `Riya S****`; single names are returned as-is. */
export function maskName(name: string): string {
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest.join(" ");
  return last ? `${first} ${last[0]}****` : first;
}

/** `paise × bps / 10000`, rounded half-up (integers only). */
export function pctBps(paise: Paise, bps: number): Paise {
  return Math.floor((paise * bps + 5000) / 10000);
}

/** One-time late fee on an overdue bill's subtotal. 459900 → 9198. */
export function lateFee(subtotalPaise: Paise): Paise {
  return pctBps(subtotalPaise, LATE_FEE_BPS);
}

/** `YYYY-MM` → first and last day (`YYYY-MM-DD`). */
export function cyclePeriod(cycle: Cycle): { from: IsoDate; to: IsoDate } {
  const [y, m] = cycle.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
}

/** 1st of the month after `today` (bills are generated on day 1 for the previous month). */
export function nextBillDate(today: IsoDate): IsoDate {
  const [y, m] = today.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01`;
}

function rupees(paise: Paise): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(paise / 100);
}

/** An open (UNPAID/OVERDUE) receivable joined with its OEM bill, as input to the presentment. */
export interface OpenCycle {
  receivableId: string;
  status: ReceivableStatus;
  lateFeePaise: Paise;
  bill: OemBill;
}

export interface PresentmentContext {
  presentmentId: string;
  billerId: string;
  billerName: string;
  /** Full name; masked here. */
  customerName: string;
  vehicleRegNo: string;
  /** planId → plan name (falls back to the id). */
  planNames: Record<string, string>;
}

/**
 * Builds the BillPresentment for the open cycles (any order; sorted oldest first here).
 * Lines: FIXED_FEE, USAGE, GST of the latest cycle; ARREARS per older cycle; LATE_FEE per
 * cycle with a late fee. `amountPaise` is the sum of the lines. Throws if `open` is empty.
 */
export function buildPresentment(ctx: PresentmentContext, open: OpenCycle[]): BillPresentment {
  if (open.length === 0) throw new Error("buildPresentment: no open cycles");
  const sorted = [...open].sort((a, b) => a.bill.cycle.localeCompare(b.bill.cycle));
  const latest = sorted[sorted.length - 1].bill;
  const older = sorted.slice(0, -1);

  const lines: BillLineItem[] = [
    { kind: "FIXED_FEE", label: "Fixed battery fee", cycle: latest.cycle, amountPaise: latest.fixedFeePaise },
    {
      kind: "USAGE",
      label: `Pay-per-use (${latest.kmDriven.toLocaleString("en-IN")} km × ${rupees(latest.ratePaisePerKm)}/km)`,
      cycle: latest.cycle,
      amountPaise: latest.variablePaise,
      km: latest.kmDriven,
      ratePaisePerKm: latest.ratePaisePerKm,
    },
    {
      kind: "GST",
      label: `GST @ ${GST_BPS / 100}%`,
      cycle: latest.cycle,
      amountPaise: latest.gstPaise,
      rateBps: GST_BPS,
      basePaise: latest.subtotalPaise,
    },
  ];
  for (const o of older) {
    lines.push({ kind: "ARREARS", label: `Arrears (${formatCycle(o.bill.cycle)})`, cycle: o.bill.cycle, amountPaise: o.bill.totalPaise });
  }
  for (const o of sorted) {
    if (o.lateFeePaise > 0) {
      lines.push({
        kind: "LATE_FEE",
        label: `Late fee (${formatCycle(o.bill.cycle)})`,
        cycle: o.bill.cycle,
        amountPaise: o.lateFeePaise,
        rateBps: LATE_FEE_BPS,
        basePaise: o.bill.subtotalPaise,
      });
    }
  }

  const cycles: PresentedCycle[] = sorted.map((o) => ({
    cycle: o.bill.cycle,
    oemBillId: o.bill.id,
    oemBillNo: o.bill.billNo,
    kmDriven: o.bill.kmDriven,
    subtotalPaise: o.bill.subtotalPaise,
    gstPaise: o.bill.gstPaise,
    totalPaise: o.bill.totalPaise,
    lateFeePaise: o.lateFeePaise,
    billDate: o.bill.billDate,
    dueDate: o.bill.dueDate,
    status: o.status,
  }));

  const arrearsPaise = older.reduce((s, o) => s + o.bill.totalPaise, 0);
  const lateFeePaise = sorted.reduce((s, o) => s + o.lateFeePaise, 0);
  const amountPaise = lines.reduce((s, l) => s + l.amountPaise, 0);

  return {
    presentmentId: ctx.presentmentId,
    billerId: ctx.billerId,
    billerName: ctx.billerName,
    customerName: maskName(ctx.customerName),
    vehicleRegNo: ctx.vehicleRegNo,
    planId: latest.planId,
    planName: ctx.planNames[latest.planId] ?? latest.planId,
    cycle: latest.cycle,
    billPeriod: cyclePeriod(latest.cycle),
    billDate: latest.billDate,
    dueDate: latest.dueDate,
    overdue: sorted.some((o) => o.status === "OVERDUE"),
    kmDriven: latest.kmDriven,
    currentCyclePaise: latest.totalPaise,
    arrearsPaise,
    lateFeePaise,
    amountPaise,
    lines,
    cycles,
  };
}
