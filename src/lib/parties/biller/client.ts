/**
 * The biller's ONLY door to the OEM (party isolation): calls `parties/oem/api.ts`, never oem_* tables.
 * Owner: agent B.
 */
import * as oem from "@/lib/parties/oem/api";
import type { IsoDateTime, OemBill } from "@/lib/domain/types";

/** All OEM bills for a vehicle (every cycle, oldest first). */
export function oemBillsFor(regNo: string): Promise<OemBill[]> {
  return oem.getBillsByRegNo(regNo);
}

/** planId → plan name. Best effort: an OEM failure here only degrades labels to the plan id. */
export async function oemPlanNames(): Promise<Record<string, string>> {
  try {
    const plans = await oem.listPlans();
    return Object.fromEntries(plans.map((p) => [p.id, p.name]));
  } catch {
    return {};
  }
}

/** Flags the OEM bills as paid (the OEM ignores already-PAID bills, so retries are harmless). */
export async function oemMarkPaid(billIds: string[], bbpsTxnRef: string, paidAt: IsoDateTime): Promise<number> {
  if (billIds.length === 0) return 0;
  const r = await oem.markPaid(billIds, bbpsTxnRef, paidAt);
  return r.updated;
}
