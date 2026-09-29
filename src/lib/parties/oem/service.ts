/** OEM business logic. Uses the pure billing engine; SQL lives in repo.ts. */
import { computeBill, dueDate } from "@/lib/domain/billing";
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
import { withTx } from "@/lib/db/client";
import * as repo from "./repo";

const MAX_TRIP_KM = 10_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Thrown for bad input (route → 400) or unknown resources (route → 404). */
export class OemError extends Error {
  constructor(
    public code: "BAD_REQUEST" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
  }
}

export const normaliseRegNo = (s: string): string => s.toUpperCase().replace(/[\s-]/g, "");

export function listPlans(): Promise<OemPlan[]> {
  return repo.selectPlans();
}

export function listVehicles(): Promise<OemVehicleRow[]> {
  return repo.selectVehicleRows();
}

export async function addTrip(vehicleId: string, km: Km): Promise<OemVehicleRow> {
  if (!Number.isInteger(km) || km <= 0 || km > MAX_TRIP_KM) {
    throw new OemError("BAD_REQUEST", `km must be a whole number between 1 and ${MAX_TRIP_KM}`);
  }
  if (!UUID_RE.test(vehicleId)) throw new OemError("NOT_FOUND", "Vehicle not found");
  const ok = await repo.insertTrip(vehicleId, km);
  if (!ok) throw new OemError("NOT_FOUND", "Vehicle not found");
  const [row] = await repo.selectVehicleRows(vehicleId);
  return row;
}

export async function generateBills(cycle: Cycle, vehicleIds?: string[]): Promise<GenerateBillsResponse> {
  const m = /^(\d{4})-(\d{2})$/.exec(cycle);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) {
    throw new OemError("BAD_REQUEST", "cycle must be YYYY-MM");
  }
  // Unknown / malformed ids are ignored (they match no vehicle).
  const ids = vehicleIds?.filter((id) => UUID_RE.test(id));
  if (ids && ids.length === 0) return { generated: [] };
  // bill_date = generation date (today, UTC).
  const billDate = new Date().toISOString().slice(0, 10);
  const due = dueDate(billDate);

  return withTx(async (tx) => {
    const vehicles = await repo.selectBillable(tx, cycle, ids);
    const created: string[] = [];
    for (const v of vehicles) {
      const b = computeBill({ fixedFeePaise: v.fixed_fee_paise, ratePaisePerKm: v.rate_paise_per_km }, v.km);
      const id = await repo.insertBill(tx, {
        billNo: `OEM-${m[1]}${m[2]}-${v.reg_no}`,
        vehicleId: v.id,
        planId: v.plan_id,
        cycle,
        kmDriven: v.km,
        fixedFeePaise: b.fixedPaise,
        ratePaisePerKm: v.rate_paise_per_km,
        variablePaise: b.variablePaise,
        subtotalPaise: b.subtotalPaise,
        gstPaise: b.gstPaise,
        totalPaise: b.totalPaise,
        billDate,
        dueDate: due,
      });
      if (id) created.push(id);
    }
    return { generated: await repo.selectBillsByIds(tx, created) };
  });
}

export function listBills(): Promise<OemBill[]> {
  return repo.selectAllBills();
}

export function getBillsByRegNo(regNo: string): Promise<OemBill[]> {
  return repo.selectBillsByRegNo(normaliseRegNo(regNo));
}

export async function markPaid(billIds: string[], bbpsTxnRef: string, paidAt: IsoDateTime): Promise<MarkPaidResponse> {
  const ids = billIds.filter((id) => UUID_RE.test(id));
  return { updated: await repo.updatePaid(ids, bbpsTxnRef, paidAt) };
}
