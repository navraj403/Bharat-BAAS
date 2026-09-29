/**
 * OEM (Sample Motors, telematics): PUBLIC API. Owner: agent A.
 * Signatures are FINAL (P0). Implement the bodies; do not change the signatures.
 * Other parties (the biller) may import ONLY this file from `parties/oem`.
 *
 * Billing (pure, in src/lib/domain/billing.ts; see BUILD_PLAN §4):
 *   fixed = plan.fixed_fee_paise (full, even at 0 km) · variable = km × plan.rate_paise_per_km
 *   subtotal = fixed + variable · gst = round_half_up(subtotal × 18%) · total = subtotal + gst
 *   bill_date = generation date (today) · due_date = bill_date + 10 days
 * Bill number: `OEM-<YYYYMM>-<regNo>` (e.g. OEM-202608-MH01AB1001), matching the seed.
 * oem_bills stores a snapshot of plan_id, fixed_fee_paise and rate_paise_per_km.
 */
import type {
  Cycle,
  GenerateBillsResponse,
  IsoDateTime,
  Km,
  MarkPaidResponse,
  OemBill,
  OemPlan,
  OemVehicleRow,
} from "@/lib/domain/types";

/** All plans (STD, PRO, FLEX), ordered by id. */
export async function listPlans(): Promise<OemPlan[]> {
  throw new Error("NotImplemented");
}

/**
 * `GET /api/oem/vehicles`. Every vehicle ordered by regNo, with its plan, odometer,
 * `currentCycle` (current calendar month), `kmThisCycle` (sum of trips whose recorded_at is in
 * the current calendar month, 0 if none) and `lastBill` (latest cycle) or null.
 */
export async function listVehicles(): Promise<OemVehicleRow[]> {
  throw new Error("NotImplemented");
}

/**
 * `POST /api/oem/vehicles/:id/trips {km}`. Records a trip (recorded_at = now) and adds `km`
 * to the odometer, in one transaction. `km` must be a positive integer (≤ 10,000), else throw
 * (the route maps it to 400). Unknown vehicle id → throw (route → 404).
 * Returns the refreshed row.
 */
export async function addTrip(vehicleId: string, km: Km): Promise<OemVehicleRow> {
  void vehicleId;
  void km;
  throw new Error("NotImplemented");
}

/**
 * `POST /api/oem/bills/generate {cycle}`. For every vehicle activated on or before the last day
 * of `cycle` that has NO bill for `cycle`, create one from the km of trips recorded inside that
 * calendar month (0 km still bills the fixed fee). Idempotent per (vehicle, cycle): re-running
 * returns only newly created bills (empty array if none). `cycle` must match /^\d{4}-\d{2}$/.
 *
 * `vehicleIds` (optional, PM addition at Gate 0): when given, only those vehicles are considered
 * (same eligibility and idempotency rules); unknown ids are ignored. The demo uses this per row
 * so that billing Kabir does not also bill Riya/Arjun/Meera for the current month.
 *
 * Demo note: generating the CURRENT month WITHOUT `vehicleIds` also bills Riya/Arjun/Meera (their
 * current-month trips + fixed fee). Kabir (activated this month, +1,600 km) → ₹8,378.00.
 */
export async function generateBills(
  cycle: Cycle,
  vehicleIds?: string[],
): Promise<GenerateBillsResponse> {
  void cycle;
  void vehicleIds;
  throw new Error("NotImplemented");
}

/** `GET /api/oem/bills` (console, no regNo). All bills, newest cycle first, then regNo. */
export async function listBills(): Promise<OemBill[]> {
  throw new Error("NotImplemented");
}

/**
 * `GET /api/oem/bills?regNo=`: the biller's pull (`syncFromOem`). All bills for the vehicle
 * (every cycle, paid or not), oldest cycle first. `regNo` is normalised (uppercase, spaces and
 * dashes removed) before lookup. Unknown vehicle → [].
 */
export async function getBillsByRegNo(regNo: string): Promise<OemBill[]> {
  void regNo;
  throw new Error("NotImplemented");
}

/**
 * Called by the biller after a successful payment advice. Sets payment_status = 'PAID',
 * paid_ref = `bbpsTxnRef`, paid_at = `paidAt` on each bill id that is still UNPAID
 * (already-PAID bills are left untouched, so a retry is harmless). Returns how many changed.
 */
export async function markPaid(
  billIds: string[],
  bbpsTxnRef: string,
  paidAt: IsoDateTime,
): Promise<MarkPaidResponse> {
  void billIds;
  void bbpsTxnRef;
  void paidAt;
  throw new Error("NotImplemented");
}
