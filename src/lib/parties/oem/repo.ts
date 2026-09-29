/** OEM SQL. Only this party touches oem_* tables. */
import { sql, withTx, type Tx } from "@/lib/db/client";
import type { OemBill, OemPlan, OemVehicleRow } from "@/lib/domain/types";

interface BillDb {
  id: string;
  bill_no: string;
  vehicle_id: string;
  reg_no: string;
  plan_id: string;
  cycle: string;
  km_driven: number;
  fixed_fee_paise: number;
  rate_paise_per_km: number;
  variable_paise: number;
  subtotal_paise: number;
  gst_paise: number;
  total_paise: number;
  bill_date: string;
  due_date: string;
  payment_status: "UNPAID" | "PAID";
  paid_ref: string | null;
  paid_at: Date | null;
}

function toBill(r: BillDb): OemBill {
  return {
    id: r.id,
    billNo: r.bill_no,
    vehicleId: r.vehicle_id,
    regNo: r.reg_no,
    planId: r.plan_id,
    cycle: r.cycle,
    kmDriven: r.km_driven,
    fixedFeePaise: r.fixed_fee_paise,
    ratePaisePerKm: r.rate_paise_per_km,
    variablePaise: r.variable_paise,
    subtotalPaise: r.subtotal_paise,
    gstPaise: r.gst_paise,
    totalPaise: r.total_paise,
    billDate: r.bill_date,
    dueDate: r.due_date,
    paymentStatus: r.payment_status,
    paidRef: r.paid_ref,
    paidAt: r.paid_at ? r.paid_at.toISOString() : null,
  };
}

export async function selectPlans(): Promise<OemPlan[]> {
  const rows = await sql<{ id: string; name: string; fixed_fee_paise: number; rate_paise_per_km: number }[]>`
    select id, name, fixed_fee_paise, rate_paise_per_km from oem_plans order by id`;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    fixedFeePaise: r.fixed_fee_paise,
    ratePaisePerKm: r.rate_paise_per_km,
  }));
}

interface VehicleDb {
  id: string;
  reg_no: string;
  vin: string;
  model: string;
  plan_id: string;
  plan_name: string;
  fixed_fee_paise: number;
  rate_paise_per_km: number;
  odometer_km: number;
  activated_on: string;
  current_cycle: string;
  km_this_cycle: number;
  lb_id: string | null;
  lb_bill_no: string | null;
  lb_cycle: string | null;
  lb_total: number | null;
  lb_status: "UNPAID" | "PAID" | null;
}

/** All vehicles (ordered by reg_no), or just one when `vehicleId` is given. */
export async function selectVehicleRows(vehicleId?: string): Promise<OemVehicleRow[]> {
  const rows = await sql<VehicleDb[]>`
    select v.id, v.reg_no, v.vin, v.model, v.plan_id, p.name as plan_name, p.fixed_fee_paise,
           p.rate_paise_per_km, v.odometer_km, v.activated_on,
           to_char(now(), 'YYYY-MM') as current_cycle,
           coalesce((select sum(t.km) from oem_trips t
                     where t.vehicle_id = v.id
                       and t.recorded_at >= date_trunc('month', now())
                       and t.recorded_at < date_trunc('month', now()) + interval '1 month'), 0)::int as km_this_cycle,
           lb.id as lb_id, lb.bill_no as lb_bill_no, lb.cycle as lb_cycle,
           lb.total_paise as lb_total, lb.payment_status as lb_status
    from oem_vehicles v
    join oem_plans p on p.id = v.plan_id
    left join lateral (
      select id, bill_no, cycle, total_paise, payment_status from oem_bills
      where vehicle_id = v.id order by cycle desc limit 1
    ) lb on true
    where (${vehicleId ?? null}::uuid is null or v.id = ${vehicleId ?? null}::uuid)
    order by v.reg_no`;
  return rows.map((r) => ({
    id: r.id,
    regNo: r.reg_no,
    vin: r.vin,
    model: r.model,
    planId: r.plan_id,
    planName: r.plan_name,
    fixedFeePaise: r.fixed_fee_paise,
    ratePaisePerKm: r.rate_paise_per_km,
    odometerKm: r.odometer_km,
    activatedOn: r.activated_on,
    currentCycle: r.current_cycle,
    kmThisCycle: r.km_this_cycle,
    lastBill: r.lb_id
      ? {
          id: r.lb_id,
          billNo: r.lb_bill_no as string,
          cycle: r.lb_cycle as string,
          totalPaise: r.lb_total as number,
          paymentStatus: r.lb_status as "UNPAID" | "PAID",
        }
      : null,
  }));
}

/** Records the trip and bumps the odometer atomically. Returns false if the vehicle is unknown. */
export async function insertTrip(vehicleId: string, km: number): Promise<boolean> {
  return withTx(async (tx) => {
    const upd = await tx`update oem_vehicles set odometer_km = odometer_km + ${km} where id = ${vehicleId} returning id`;
    if (upd.length === 0) return false;
    await tx`insert into oem_trips (vehicle_id, km, recorded_at) values (${vehicleId}, ${km}, now())`;
    return true;
  });
}

export interface EligibleVehicle {
  id: string;
  reg_no: string;
  plan_id: string;
  fixed_fee_paise: number;
  rate_paise_per_km: number;
  km: number;
}

/** Vehicles activated by the end of the cycle with no bill for it, with the cycle's trip km. */
export async function selectBillable(
  tx: Tx,
  cycle: string,
  vehicleIds?: string[],
): Promise<EligibleVehicle[]> {
  const start = `${cycle}-01`;
  const ids = vehicleIds ?? null;
  return tx<EligibleVehicle[]>`
    select v.id, v.reg_no, v.plan_id, p.fixed_fee_paise, p.rate_paise_per_km,
           coalesce((select sum(t.km) from oem_trips t
                     where t.vehicle_id = v.id
                       and t.recorded_at >= ${start}::date
                       and t.recorded_at < ${start}::date + interval '1 month'), 0)::int as km
    from oem_vehicles v
    join oem_plans p on p.id = v.plan_id
    where v.activated_on < ${start}::date + interval '1 month'
      and not exists (select 1 from oem_bills b where b.vehicle_id = v.id and b.cycle = ${cycle})
      and (${ids}::uuid[] is null or v.id = any(${ids}::uuid[]))
    order by v.reg_no`;
}

export interface NewBill {
  billNo: string;
  vehicleId: string;
  planId: string;
  cycle: string;
  kmDriven: number;
  fixedFeePaise: number;
  ratePaisePerKm: number;
  variablePaise: number;
  subtotalPaise: number;
  gstPaise: number;
  totalPaise: number;
  billDate: string;
  dueDate: string;
}

/** Inserts one bill; returns its id, or null if (vehicle, cycle) already has one (race). */
export async function insertBill(tx: Tx, b: NewBill): Promise<string | null> {
  const rows = await tx<{ id: string }[]>`
    insert into oem_bills (bill_no, vehicle_id, plan_id, cycle, km_driven, fixed_fee_paise, rate_paise_per_km,
      variable_paise, subtotal_paise, gst_paise, total_paise, bill_date, due_date)
    values (${b.billNo}, ${b.vehicleId}, ${b.planId}, ${b.cycle}, ${b.kmDriven}, ${b.fixedFeePaise},
      ${b.ratePaisePerKm}, ${b.variablePaise}, ${b.subtotalPaise}, ${b.gstPaise}, ${b.totalPaise},
      ${b.billDate}::date, ${b.dueDate}::date)
    on conflict (vehicle_id, cycle) do nothing
    returning id`;
  return rows[0]?.id ?? null;
}

export async function selectBillsByIds(tx: Tx, ids: string[]): Promise<OemBill[]> {
  if (ids.length === 0) return [];
  const rows = await tx<BillDb[]>`
    select b.id, b.bill_no, b.vehicle_id, v.reg_no, b.plan_id, b.cycle, b.km_driven, b.fixed_fee_paise,
           b.rate_paise_per_km, b.variable_paise, b.subtotal_paise, b.gst_paise, b.total_paise,
           b.bill_date, b.due_date, b.payment_status, b.paid_ref, b.paid_at
    from oem_bills b join oem_vehicles v on v.id = b.vehicle_id
    where b.id = any(${ids}::uuid[]) order by v.reg_no`;
  return rows.map(toBill);
}

export async function selectAllBills(): Promise<OemBill[]> {
  const rows = await sql<BillDb[]>`
    select b.id, b.bill_no, b.vehicle_id, v.reg_no, b.plan_id, b.cycle, b.km_driven, b.fixed_fee_paise,
           b.rate_paise_per_km, b.variable_paise, b.subtotal_paise, b.gst_paise, b.total_paise,
           b.bill_date, b.due_date, b.payment_status, b.paid_ref, b.paid_at
    from oem_bills b join oem_vehicles v on v.id = b.vehicle_id
    order by b.cycle desc, v.reg_no`;
  return rows.map(toBill);
}

export async function selectBillsByRegNo(regNo: string): Promise<OemBill[]> {
  const rows = await sql<BillDb[]>`
    select b.id, b.bill_no, b.vehicle_id, v.reg_no, b.plan_id, b.cycle, b.km_driven, b.fixed_fee_paise,
           b.rate_paise_per_km, b.variable_paise, b.subtotal_paise, b.gst_paise, b.total_paise,
           b.bill_date, b.due_date, b.payment_status, b.paid_ref, b.paid_at
    from oem_bills b join oem_vehicles v on v.id = b.vehicle_id
    where v.reg_no = ${regNo} order by b.cycle asc`;
  return rows.map(toBill);
}

export async function updatePaid(billIds: string[], ref: string, paidAt: string): Promise<number> {
  if (billIds.length === 0) return 0;
  const rows = await sql`
    update oem_bills set payment_status = 'PAID', paid_ref = ${ref}, paid_at = ${paidAt}::timestamptz
    where id = any(${billIds}::uuid[]) and payment_status = 'UNPAID' returning id`;
  return rows.length;
}
