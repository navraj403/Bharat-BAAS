// DB-backed OEM test (npm run test:int). Creates only a TEST-prefixed vehicle and cleans up.
import { afterAll, describe, expect, it } from "vitest";
import { closeSql, sql } from "@/lib/db/client";
import { addTrip, generateBills, getBillsByRegNo, listVehicles, markPaid } from "./api";

const REG = "TEST0001";
let vehicleId = "";

async function cleanup() {
  // oem_trips and oem_bills cascade from the vehicle.
  await sql`delete from oem_vehicles where reg_no = ${REG}`;
}

describe("oem service (TEST vehicle)", () => {
  afterAll(async () => {
    await cleanup();
    await closeSql();
  });

  it("bills a new STD vehicle with 1,600 km at 837800 and is idempotent", async () => {
    await cleanup();
    const [v] = await sql<{ id: string }[]>`
      insert into oem_vehicles (reg_no, vin, model, plan_id, odometer_km, activated_on)
      values (${REG}, 'TESTVIN0000000001', 'Test Model', 'STD', 0, current_date) returning id`;
    vehicleId = v.id;

    let row = await addTrip(vehicleId, 1000);
    expect(row.kmThisCycle).toBe(1000);
    row = await addTrip(vehicleId, 600);
    expect(row.kmThisCycle).toBe(1600);
    expect(row.odometerKm).toBe(1600);
    expect(row.lastBill).toBeNull();

    await expect(addTrip(vehicleId, 0)).rejects.toThrow();
    await expect(addTrip("00000000-0000-0000-0000-000000000000", 5)).rejects.toThrow();

    const cycle = row.currentCycle;
    const { generated } = await generateBills(cycle, [vehicleId]);
    expect(generated).toHaveLength(1);
    const bill = generated[0];
    expect(bill.regNo).toBe(REG);
    expect(bill.kmDriven).toBe(1600);
    expect(bill.subtotalPaise).toBe(710000);
    expect(bill.gstPaise).toBe(127800);
    expect(bill.totalPaise).toBe(837800);
    expect(bill.paymentStatus).toBe("UNPAID");
    expect(bill.billNo).toBe(`OEM-${cycle.replace("-", "")}-${REG}`);

    // Idempotent per (vehicle, cycle).
    expect((await generateBills(cycle, [vehicleId])).generated).toHaveLength(0);

    // Row reflects the bill; only the test vehicle was billed.
    const listed = (await listVehicles()).find((x) => x.id === vehicleId);
    expect(listed?.lastBill?.totalPaise).toBe(837800);

    // Biller pull normalises the reg no.
    const pulled = await getBillsByRegNo("test-0001");
    expect(pulled.map((b) => b.id)).toEqual([bill.id]);
    expect(await getBillsByRegNo("NOPE0000")).toEqual([]);

    // markPaid flips once, retry is a no-op.
    const paidAt = new Date().toISOString();
    expect((await markPaid([bill.id], "BCTESTREF01", paidAt)).updated).toBe(1);
    expect((await markPaid([bill.id], "BCOTHERREF2", paidAt)).updated).toBe(0);
    const [after] = await getBillsByRegNo(REG);
    expect(after.paymentStatus).toBe("PAID");
    expect(after.paidRef).toBe("BCTESTREF01");
  });
});
