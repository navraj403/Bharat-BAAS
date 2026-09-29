import { describe, expect, it } from "vitest";
import { maskMobile, newBbpsTxnRef, newFetchRef, newOrderId, normaliseVehicleNo } from "./util";

describe("nbbl util", () => {
  it("generates refs in the documented formats", () => {
    expect(newFetchRef()).toMatch(/^F-[A-Z0-9]{10}$/);
    expect(newBbpsTxnRef()).toMatch(/^BC[A-Z0-9]{10}$/);
    expect(newOrderId()).toMatch(/^DP-[A-Z0-9]{10}$/);
    expect(newFetchRef()).not.toBe(newFetchRef());
  });
  it("masks mobiles", () => {
    expect(maskMobile("9800000001")).toBe("98XXXXXX01");
    expect(maskMobile("123")).toBe("XXX");
  });
  it("normalises vehicle numbers", () => {
    expect(normaliseVehicleNo("mh 01-ab 1001")).toBe("MH01AB1001");
  });
});
