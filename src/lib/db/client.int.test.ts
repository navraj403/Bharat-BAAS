// Read-only DB smoke test for the client (npm run test:int). Never writes.
import { afterAll, describe, expect, it } from "vitest";
import { closeSql, sql, withTx } from "./client";

describe("db client", () => {
  afterAll(async () => {
    await closeSql();
  });

  it("lazy sql tag queries and parses date as YYYY-MM-DD string", async () => {
    const [row] = await sql<{ n: number; d: string }[]>`select 1::int as n, current_date as d`;
    expect(row.n).toBe(1);
    expect(row.d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("withTx returns the callback value", async () => {
    const n = await withTx(async (tx) => {
      const [r] = await tx<{ n: number }[]>`select count(*)::int as n from oem_plans`;
      return r.n;
    });
    expect(typeof n).toBe("number");
  });
});
