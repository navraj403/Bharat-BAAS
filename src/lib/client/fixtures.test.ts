import { beforeEach, describe, expect, it } from "vitest";
import {
  fixtureAddTrip,
  fixtureBillerOverview,
  fixtureFetch,
  fixtureGenerateBills,
  fixturePay,
  fixtureReset,
  fixtureStats,
  fixtureTransaction,
  fixtureVehicles,
} from "./fixtures";

const RIYA = { billerId: "demo-finance", vehicleNo: "mh-01 ab 1001", mobile: "9800000001" };
const ARJUN = { billerId: "demo-finance", vehicleNo: "MH01AB1002", mobile: "9800000002" };
const MEERA = { billerId: "volt-leasing", vehicleNo: "MH01AB1003", mobile: "9800000003" };
const KABIR = { billerId: "demo-finance", vehicleNo: "MH01AB1004", mobile: "9800000004" };

describe("fixtures reproduce BUILD_PLAN §4", () => {
  beforeEach(() => fixtureReset());

  it("Riya: BILL_DUE ₹6,726.00 with fixed + usage + GST lines", () => {
    const r = fixtureFetch(RIYA);
    expect(r.result).toBe("BILL_DUE");
    if (r.result !== "BILL_DUE") return;
    expect(r.responseCode).toBe("000");
    expect(r.bill.amountPaise).toBe(672600);
    expect(r.bill.lines.map((l) => [l.kind, l.amountPaise])).toEqual([
      ["FIXED_FEE", 150000],
      ["USAGE", 420000],
      ["GST", 102600],
    ]);
    expect(r.bill.overdue).toBe(false);
  });

  it("Arjun: BILL_DUE ₹11,889.62 = Aug + Jul arrears + late fee, overdue", () => {
    const r = fixtureFetch(ARJUN);
    if (r.result !== "BILL_DUE") throw new Error(r.result);
    expect(r.bill.amountPaise).toBe(1188962);
    expect(r.bill.currentCyclePaise).toBe(637082);
    expect(r.bill.arrearsPaise).toBe(542682);
    expect(r.bill.lateFeePaise).toBe(9198);
    expect(r.bill.overdue).toBe(true);
    expect(r.bill.lines.reduce((s, l) => s + l.amountPaise, 0)).toBe(1188962);
  });

  it("Meera: ALREADY_PAID ₹12,183.50 with BCSEEDPAID01", () => {
    const r = fixtureFetch(MEERA);
    if (r.result !== "ALREADY_PAID") throw new Error(r.result);
    expect(r.receipt.amountPaise).toBe(1218350);
    expect(r.receipt.bbpsTxnRef).toBe("BCSEEDPAID01");
  });

  it("Kabir: NOT_GENERATED, then +1,600 km and generate → ₹8,378.00", () => {
    expect(fixtureFetch(KABIR).result).toBe("NOT_GENERATED");
    const kabir = fixtureVehicles().find((v) => v.regNo === "MH01AB1004");
    if (!kabir) throw new Error("no Kabir");
    expect(kabir.kmThisCycle).toBe(0);
    fixtureAddTrip(kabir.id, 1600);
    const { generated } = fixtureGenerateBills(kabir.currentCycle, [kabir.id]);
    expect(generated).toHaveLength(1); // per-vehicle generation must not bill Riya/Arjun/Meera
    expect(generated.find((b) => b.regNo === "MH01AB1004")?.totalPaise).toBe(837800);
    const r = fixtureFetch(KABIR);
    if (r.result !== "BILL_DUE") throw new Error(r.result);
    expect(r.bill.amountPaise).toBe(837800);
  });

  it("wrong mobile → NOT_FOUND; MH01AB9999 → BILLER_UNAVAILABLE", () => {
    expect(fixtureFetch({ ...RIYA, mobile: "9800000009" }).result).toBe("NOT_FOUND");
    expect(fixtureFetch({ ...RIYA, vehicleNo: "MH01AB9999" }).result).toBe("BILLER_UNAVAILABLE");
  });

  it("pay → receipt BC…, re-fetch ALREADY_PAID, double pay rejected, simulated failure", () => {
    const f = fixtureFetch(RIYA);
    if (f.result !== "BILL_DUE") throw new Error(f.result);
    expect(fixturePay({ fetchRef: f.fetchRef, amountPaise: 1, mode: "UPI" })).toMatchObject({ status: "FAILED", responseCode: "BPR001" });
    expect(fixturePay({ fetchRef: f.fetchRef, amountPaise: 672600, mode: "UPI", simulateFailure: true })).toMatchObject({ status: "FAILED", failureReason: "PAYMENT_DECLINED" });
    const p = fixturePay({ fetchRef: f.fetchRef, amountPaise: 672600, mode: "UPI" });
    if (p.status !== "SUCCESS") throw new Error(p.message);
    expect(p.receipt.bbpsTxnRef).toMatch(/^BC[A-Z0-9]{10}$/);
    expect(fixtureFetch(RIYA).result).toBe("ALREADY_PAID");
    expect(fixturePay({ fetchRef: f.fetchRef, amountPaise: 672600, mode: "UPI" })).toMatchObject({ status: "FAILED", responseCode: "BPR002" });
    expect(fixtureTransaction(p.receipt.bbpsTxnRef)?.events.map((e) => e.step)).toEqual(["COU_REQ", "PAY_REQ", "ADVICE_ACK", "COU_RESP"]);
    expect(fixtureBillerOverview("demo-finance").kpis.collectedPaise).toBe(672600);
  });

  it("seeds NBBL history and biller KPIs", () => {
    expect(fixtureStats().fetches).toBeGreaterThanOrEqual(6);
    const df = fixtureBillerOverview("demo-finance");
    expect(df.kpis.receivablesDuePaise).toBe(672600 + 1188962);
    expect(df.kpis.overdueCount).toBe(1);
    expect(fixtureBillerOverview("volt-leasing").kpis.collectedPaise).toBe(1218350);
  });
});
