import { describe, expect, it } from "vitest";
import { formatCycle } from "./cycle";

describe("formatCycle", () => {
  it("formats YYYY-MM as 'Mon YYYY'", () => {
    expect(formatCycle("2026-07")).toBe("Jul 2026");
    expect(formatCycle("2026-12")).toBe("Dec 2026");
    expect(formatCycle("2027-01")).toBe("Jan 2027");
  });
  it("returns anything else unchanged", () => {
    expect(formatCycle("2026-13")).toBe("2026-13");
    expect(formatCycle("July")).toBe("July");
  });
});
