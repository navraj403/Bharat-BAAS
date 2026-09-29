import { describe, expect, it } from "vitest";
import type { OemBill } from "@/lib/domain/types";
import {
  buildPresentment,
  cyclePeriod,
  lateFee,
  maskMobile,
  maskName,
  nextBillDate,
  normaliseRegNo,
  type OpenCycle,
} from "./rules";

function bill(p: Partial<OemBill> & Pick<OemBill, "id" | "cycle" | "kmDriven">): OemBill {
  const fixed = p.fixedFeePaise ?? 99900;
  const rate = p.ratePaisePerKm ?? 400;
  const variable = p.kmDriven * rate;
  const subtotal = fixed + variable;
  const gst = Math.floor((subtotal * 1800 + 5000) / 10000);
  return {
    billNo: `OEM-${p.cycle.replace("-", "")}-MH01AB1002`,
    vehicleId: "v",
    regNo: "MH01AB1002",
    planId: "FLEX",
    fixedFeePaise: fixed,
    ratePaisePerKm: rate,
    variablePaise: variable,
    subtotalPaise: subtotal,
    gstPaise: gst,
    totalPaise: subtotal + gst,
    billDate: "2026-08-25",
    dueDate: "2026-09-04",
    paymentStatus: "UNPAID",
    paidRef: null,
    paidAt: null,
    ...p,
  };
}

const ctx = {
  presentmentId: "p1",
  billerId: "bajaj-finance",
  billerName: "Bajaj Finance",
  customerName: "Arjun Mehta",
  vehicleRegNo: "MH01AB1002",
  planNames: { FLEX: "Flex" },
};

describe("biller rules", () => {
  it("normalises, masks and dates", () => {
    expect(normaliseRegNo("mh-01 ab 1001")).toBe("MH01AB1001");
    expect(maskMobile("9800000001")).toBe("98XXXXXX01");
    expect(maskName("Riya Sharma")).toBe("Riya S****");
    expect(maskName("Kabir")).toBe("Kabir");
    expect(lateFee(459900)).toBe(9198);
    expect(lateFee(50)).toBe(1); // 1.0 paise
    expect(lateFee(25)).toBe(1); // 0.5 → half-up
    expect(lateFee(24)).toBe(0);
    expect(nextBillDate("2026-09-29")).toBe("2026-10-01");
    expect(nextBillDate("2026-12-31")).toBe("2027-01-01");
    expect(cyclePeriod("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(cyclePeriod("2028-02").to).toBe("2028-02-29");
  });

  it("single cycle: fixed + usage + GST (Riya 672600)", () => {
    const b = bill({ id: "b1", cycle: "2026-08", kmDriven: 1200, fixedFeePaise: 150000, ratePaisePerKm: 350, planId: "STD" });
    const p = buildPresentment(ctx, [{ receivableId: "r1", status: "UNPAID", lateFeePaise: 0, bill: b }]);
    expect(p.amountPaise).toBe(672600);
    expect(p.lines.map((l) => [l.kind, l.amountPaise])).toEqual([
      ["FIXED_FEE", 150000],
      ["USAGE", 420000],
      ["GST", 102600],
    ]);
    expect(p.lines[1].label).toBe("Pay-per-use (1,200 km × ₹3.50/km)");
    expect(p.planName).toBe("STD"); // falls back to id
    expect(p.overdue).toBe(false);
    expect(p.billPeriod).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });

  it("arrears + late fee reproduce Arjun 1188962, lines in contract order", () => {
    const jul = bill({ id: "b-jul", cycle: "2026-07", kmDriven: 900, dueDate: "2026-08-04" });
    const aug = bill({ id: "b-aug", cycle: "2026-08", kmDriven: 1100 });
    const open: OpenCycle[] = [
      { receivableId: "r-aug", status: "UNPAID", lateFeePaise: 0, bill: aug },
      { receivableId: "r-jul", status: "OVERDUE", lateFeePaise: 9198, bill: jul },
    ];
    const p = buildPresentment(ctx, open);
    expect(p.lines.map((l) => [l.kind, l.cycle, l.amountPaise])).toEqual([
      ["FIXED_FEE", "2026-08", 99900],
      ["USAGE", "2026-08", 440000],
      ["GST", "2026-08", 97182],
      ["ARREARS", "2026-07", 542682],
      ["LATE_FEE", "2026-07", 9198],
    ]);
    expect(p.currentCyclePaise).toBe(637082);
    expect(p.arrearsPaise).toBe(542682);
    expect(p.lateFeePaise).toBe(9198);
    expect(p.amountPaise).toBe(1188962);
    expect(p.overdue).toBe(true);
    expect(p.cycle).toBe("2026-08");
    expect(p.cycles.map((c) => c.cycle)).toEqual(["2026-07", "2026-08"]);
    expect(p.customerName).toBe("Arjun M****");
    expect(p.planName).toBe("Flex");
  });

  it("throws on no open cycles", () => {
    expect(() => buildPresentment(ctx, [])).toThrow();
  });
});
