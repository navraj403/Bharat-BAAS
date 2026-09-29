/** Pure billing engine (BUILD_PLAN §4). Bill = FIXED + VARIABLE. Integer paise, half-up once per line. */
import { pct } from "./money";

/** The plan fields the engine needs. */
export interface BillingPlan {
  fixedFeePaise: number;
  ratePaisePerKm: number;
}

export interface BillAmounts {
  fixedPaise: number;
  variablePaise: number;
  subtotalPaise: number;
  gstPaise: number;
  totalPaise: number;
}

// ASSUMPTION: GST on the battery subscription + usage is 18%.
export const GST_BPS = 1800;
// ASSUMPTION: late fee is 2% of an overdue bill's subtotal, charged once, no GST on it.
export const LATE_FEE_BPS = 200;
// ASSUMPTION: bills fall due 10 days after the bill date.
export const DUE_DAYS = 10;

/**
 * fixed = plan fixed fee in full, even at 0 km (ASSUMPTION: no pro-rating);
 * variable = km × rate on actual km, no minimum km.
 */
export function computeBill(plan: BillingPlan, kmDriven: number): BillAmounts {
  if (!Number.isInteger(kmDriven) || kmDriven < 0) {
    throw new RangeError("kmDriven must be a non-negative integer");
  }
  const fixedPaise = plan.fixedFeePaise;
  const variablePaise = kmDriven * plan.ratePaisePerKm;
  const subtotalPaise = fixedPaise + variablePaise;
  const gstPaise = pct(subtotalPaise, GST_BPS);
  return { fixedPaise, variablePaise, subtotalPaise, gstPaise, totalPaise: subtotalPaise + gstPaise };
}

/** Late fee on an overdue bill: 2% of the subtotal (half-up). */
export function lateFee(subtotalPaise: number): number {
  return pct(subtotalPaise, LATE_FEE_BPS);
}

/** `YYYY-MM-DD` + 10 days (UTC calendar arithmetic, no timezone drift). */
export function dueDate(billDate: string): string {
  const [y, m, d] = billDate.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + DUE_DAYS));
  return t.toISOString().slice(0, 10);
}
