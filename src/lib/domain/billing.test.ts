import { describe, expect, it } from "vitest";
import { computeBill, dueDate, lateFee } from "./billing";
import { formatINR, pct } from "./money";

const STD = { fixedFeePaise: 150000, ratePaisePerKm: 350 };
const PRO = { fixedFeePaise: 200000, ratePaisePerKm: 450 };
const FLEX = { fixedFeePaise: 99900, ratePaisePerKm: 400 };

describe("computeBill", () => {
  it("0 km bills fixed + GST only (STD → ₹1,770.00)", () => {
    const b = computeBill(STD, 0);
    expect(b).toEqual({ fixedPaise: 150000, variablePaise: 0, subtotalPaise: 150000, gstPaise: 27000, totalPaise: 177000 });
    expect(formatINR(b.totalPaise)).toBe("₹1,770.00");
  });
  it("Riya STD 1200 km → 672600", () => {
    const b = computeBill(STD, 1200);
    expect(b.variablePaise).toBe(420000);
    expect(b.subtotalPaise).toBe(570000);
    expect(b.gstPaise).toBe(102600);
    expect(b.totalPaise).toBe(672600);
  });
  it("Arjun FLEX Jul 900 km → 542682, Aug 1100 km → 637082", () => {
    expect(computeBill(FLEX, 900).totalPaise).toBe(542682);
    expect(computeBill(FLEX, 1100).totalPaise).toBe(637082);
    expect(computeBill(FLEX, 1100).gstPaise).toBe(97182);
  });
  it("Meera PRO 1850 km → 1218350", () => {
    expect(computeBill(PRO, 1850).totalPaise).toBe(1218350);
  });
  it("Kabir STD 1600 km → 837800", () => {
    const b = computeBill(STD, 1600);
    expect(b.subtotalPaise).toBe(710000);
    expect(b.gstPaise).toBe(127800);
    expect(b.totalPaise).toBe(837800);
  });
  it("rejects negative or fractional km", () => {
    expect(() => computeBill(STD, -1)).toThrow();
    expect(() => computeBill(STD, 1.5)).toThrow();
  });
});

describe("lateFee / dueDate", () => {
  it("2% of Arjun's Jul subtotal 459900 → 9198", () => {
    expect(lateFee(459900)).toBe(9198);
  });
  it("due date is +10 days, across month and year ends", () => {
    expect(dueDate("2026-09-24")).toBe("2026-10-04");
    expect(dueDate("2026-12-25")).toBe("2027-01-04");
    expect(dueDate("2028-02-25")).toBe("2028-03-06");
  });
});

describe("money", () => {
  it("pct rounds half-up: GST on 539900 = 97182", () => {
    expect(pct(539900, 1800)).toBe(97182);
    expect(pct(25, 2000)).toBe(5);
    expect(pct(1, 5000)).toBe(1); // 0.5 rounds up to 1
  });
  it("formatINR uses Indian grouping and 2 decimals", () => {
    expect(formatINR(1188962)).toBe("₹11,889.62");
    expect(formatINR(0)).toBe("₹0.00");
    expect(formatINR(5)).toBe("₹0.05");
    expect(formatINR(99900)).toBe("₹999.00");
    expect(formatINR(12345678900)).toBe("₹12,34,56,789.00");
    expect(formatINR(-672600)).toBe("-₹6,726.00");
  });
});
