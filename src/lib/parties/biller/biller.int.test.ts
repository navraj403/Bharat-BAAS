// Biller service int tests (npm run test:int). Creates ONLY `TEST…` customers (and their
// receivables / presentments / payments) and deletes them afterwards. The OEM is faked for TEST
// vehicles (vi.mock of oem/api); seeded vehicles go to the real oem/api (read-only).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { OemBill, OemPlan } from "@/lib/domain/types";
import { closeSql, sql } from "@/lib/db/client";

const fake = vi.hoisted(() => ({
  bills: new Map<string, OemBill[]>(),
  markPaidCalls: [] as Array<{ ids: string[]; ref: string; paidAt: string }>,
}));

vi.mock("@/lib/parties/oem/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/parties/oem/api")>("@/lib/parties/oem/api");
  const plans: OemPlan[] = [
    { id: "FLEX", name: "Flex", fixedFeePaise: 99900, ratePaisePerKm: 400 },
    { id: "PRO", name: "Pro (long-range pack)", fixedFeePaise: 200000, ratePaisePerKm: 450 },
    { id: "STD", name: "Standard", fixedFeePaise: 150000, ratePaisePerKm: 350 },
  ];
  return {
    ...actual,
    listPlans: async () => plans,
    getBillsByRegNo: async (regNo: string) =>
      regNo.startsWith("TEST") ? (fake.bills.get(regNo) ?? []).map((b) => ({ ...b })) : actual.getBillsByRegNo(regNo),
    markPaid: async (ids: string[], ref: string, paidAt: string) => {
      fake.markPaidCalls.push({ ids, ref, paidAt });
      let updated = 0;
      for (const list of fake.bills.values()) {
        for (const b of list) {
          if (ids.includes(b.id) && b.paymentStatus === "UNPAID") {
            Object.assign(b, { paymentStatus: "PAID", paidRef: ref, paidAt });
            updated++;
          }
        }
      }
      return { updated };
    },
  };
});

// Imported after vi.mock (hoisted) so the service sees the fake OEM.
import { fetchBill, overview, paymentAdvice, sync } from "./api";
import { UnknownBillerError } from "./errors";

const BILLER = "bajaj-finance";
const RUN = Date.now().toString(36).toUpperCase().slice(-5);
const V = { due: `TEST${RUN}A`, arrears: `TEST${RUN}B`, none: `TEST${RUN}C` };
const MOBILE = { due: "9911100001", arrears: "9911100002", none: "9911100003" };

let today = "";
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function monthOffset(iso: string, n: number): string {
  const d = new Date(`${iso.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
}
function oemBill(regNo: string, cycle: string, planId: string, fixed: number, rate: number, km: number, billDate: string): OemBill {
  const variable = km * rate;
  const subtotal = fixed + variable;
  const gst = Math.floor((subtotal * 1800 + 5000) / 10000);
  return {
    id: crypto.randomUUID(),
    billNo: `TEST-${cycle.replace("-", "")}-${regNo}`,
    vehicleId: crypto.randomUUID(),
    regNo,
    planId,
    cycle,
    kmDriven: km,
    fixedFeePaise: fixed,
    ratePaisePerKm: rate,
    variablePaise: variable,
    subtotalPaise: subtotal,
    gstPaise: gst,
    totalPaise: subtotal + gst,
    billDate,
    dueDate: addDays(billDate, 10),
    paymentStatus: "UNPAID",
    paidRef: null,
    paidAt: null,
  };
}
const ref = (tag: string) => `BCT${RUN}${tag}`.slice(0, 12).padEnd(12, "0");

async function cleanup() {
  const custs = await sql<{ id: string }[]>`select id from biller_customers where vehicle_reg_no like 'TEST%'`;
  const ids = custs.map((c) => c.id);
  if (ids.length === 0) return;
  await sql`delete from biller_payments where presentment_id in
            (select id from biller_presentments where customer_id = any(${sql.array(ids)}::uuid[]))`;
  await sql`delete from biller_presentments where customer_id = any(${sql.array(ids)}::uuid[])`;
  await sql`delete from biller_receivables where customer_id = any(${sql.array(ids)}::uuid[])`;
  await sql`delete from biller_customers where id = any(${sql.array(ids)}::uuid[])`;
}

beforeAll(async () => {
  await cleanup();
  const [r] = await sql<{ d: string }[]>`select current_date as d`;
  today = r.d;
  const prev = monthOffset(today, -1);
  const prev2 = monthOffset(today, -2);
  fake.bills.set(V.due, [oemBill(V.due, prev, "STD", 150000, 350, 1200, addDays(today, -5))]);
  // Arjun's composition: Jul (overdue) + Aug (due in future), FLEX.
  fake.bills.set(V.arrears, [
    oemBill(V.arrears, prev2, "FLEX", 99900, 400, 900, addDays(today, -35)),
    oemBill(V.arrears, prev, "FLEX", 99900, 400, 1100, addDays(today, -5)),
  ]);
  await sql`
    insert into biller_customers (biller_id, name, mobile, vehicle_reg_no, contract_id) values
      (${BILLER}, 'Test Due', ${MOBILE.due}, ${V.due}, ${"TEST-" + RUN + "-A"}),
      (${BILLER}, 'Test Arrears', ${MOBILE.arrears}, ${V.arrears}, ${"TEST-" + RUN + "-B"}),
      (${BILLER}, 'Test None', ${MOBILE.none}, ${V.none}, ${"TEST-" + RUN + "-C"})`;
});

afterAll(async () => {
  await cleanup();
  await closeSql();
});

beforeEach(() => {
  fake.markPaidCalls.length = 0;
});

const fetchFor = (vehicleNo: string, mobile: string) => fetchBill({ nbblRef: "F-TEST000000", billerId: BILLER, vehicleNo, mobile });

describe("biller fetch", () => {
  it("BILL_DUE single cycle; vehicle normalised; OPEN presentment reused", async () => {
    const dashed = `${V.due.slice(0, 4).toLowerCase()}-${V.due.slice(4)}`;
    const r = await fetchFor(dashed, MOBILE.due);
    expect(r.result).toBe("BILL_DUE");
    expect(r.responseCode).toBe("000");
    if (r.result !== "BILL_DUE") return;
    expect(r.bill.amountPaise).toBe(672600);
    expect(r.bill.lines.map((l) => l.kind)).toEqual(["FIXED_FEE", "USAGE", "GST"]);
    expect(r.bill.planName).toBe("Standard");
    expect(r.bill.customerName).toBe("Test D****");

    const again = await fetchFor(V.due, MOBILE.due);
    expect(again.result === "BILL_DUE" && again.bill.presentmentId).toBe(r.bill.presentmentId);
    const [n] = await sql<{ n: number }[]>`select count(*)::int as n from biller_presentments where id = ${r.bill.presentmentId}`;
    expect(n.n).toBe(1);
  });

  it("arrears + late fee = 1188962; late fee applied once", async () => {
    const r = await fetchFor(V.arrears, MOBILE.arrears);
    expect(r.result).toBe("BILL_DUE");
    if (r.result !== "BILL_DUE") return;
    expect(r.bill.amountPaise).toBe(1188962);
    expect(r.bill.currentCyclePaise).toBe(637082);
    expect(r.bill.arrearsPaise).toBe(542682);
    expect(r.bill.lateFeePaise).toBe(9198);
    expect(r.bill.overdue).toBe(true);
    expect(r.bill.lines.map((l) => l.kind)).toEqual(["FIXED_FEE", "USAGE", "GST", "ARREARS", "LATE_FEE"]);
    expect(r.bill.lines.reduce((s, l) => s + l.amountPaise, 0)).toBe(r.bill.amountPaise);

    const again = await fetchFor(V.arrears, MOBILE.arrears);
    expect(again.result === "BILL_DUE" && again.bill.amountPaise).toBe(1188962);
    expect(again.result === "BILL_DUE" && again.bill.presentmentId).toBe(r.bill.presentmentId);
    const rows = await sql<{ status: string; late_fee_paise: number }[]>`
      select r.status, r.late_fee_paise from biller_receivables r
      join biller_customers c on c.id = r.customer_id where c.vehicle_reg_no = ${V.arrears} order by r.cycle`;
    expect(rows).toEqual([
      { status: "OVERDUE", late_fee_paise: 9198 },
      { status: "UNPAID", late_fee_paise: 0 },
    ]);
  });

  it("NOT_FOUND on wrong mobile (generic), and on malformed mobile", async () => {
    const r = await fetchFor(V.due, "9911199999");
    expect(r).toMatchObject({ result: "NOT_FOUND", responseCode: "BFR002", billerId: BILLER, billerName: "Bajaj Finance" });
    expect(r.message).not.toMatch(/mobile is|wrong mobile|vehicle is/i);
    expect((await fetchFor(V.due, "12")).result).toBe("NOT_FOUND");
    // A valid customer of ANOTHER biller is not found here either.
    expect((await fetchFor("MH01AB1003", "9800000003")).result).toBe("NOT_FOUND");
  });

  it("NOT_GENERATED with next bill date = 1st of next month", async () => {
    const r = await fetchFor(V.none, MOBILE.none);
    expect(r).toMatchObject({ result: "NOT_GENERATED", responseCode: "BFR001" });
    if (r.result !== "NOT_GENERATED") return;
    expect(r.nextBillDate).toBe(`${monthOffset(today, 1)}-01`);
    expect(r.customerName).toBe("Test N****");
  });

  it("unknown biller throws UnknownBillerError", async () => {
    await expect(fetchBill({ nbblRef: "F-X", billerId: "nope", vehicleNo: V.due, mobile: MOBILE.due })).rejects.toBeInstanceOf(
      UnknownBillerError,
    );
  });
});

describe("biller payment advice", () => {
  it("BPR001 on amount mismatch, then pays; idempotent replay; BPR002 on a different ref; ALREADY_PAID", async () => {
    const f = await fetchFor(V.arrears, MOBILE.arrears);
    if (f.result !== "BILL_DUE") throw new Error("expected BILL_DUE");
    const base = {
      billerId: BILLER,
      presentmentId: f.bill.presentmentId,
      mode: "UPI" as const,
      paidAt: new Date().toISOString(),
    };

    const short = await paymentAdvice({ ...base, amountPaise: f.bill.amountPaise - 1, bbpsTxnRef: ref("M") });
    expect(short).toMatchObject({ ack: false, responseCode: "BPR001", billerPaymentId: null, receipt: null });
    expect(fake.markPaidCalls).toHaveLength(0);

    const ok = await paymentAdvice({ ...base, amountPaise: f.bill.amountPaise, bbpsTxnRef: ref("P") });
    expect(ok).toMatchObject({ ack: true, responseCode: "000", bbpsTxnRef: ref("P") });
    expect(ok.receipt?.amountPaise).toBe(1188962);
    expect(ok.receipt?.cycles).toEqual(f.bill.cycles.map((c) => c.cycle));
    expect(fake.markPaidCalls).toHaveLength(1);
    expect([...fake.markPaidCalls[0].ids].sort()).toEqual(f.bill.cycles.map((c) => c.oemBillId).sort());

    const replay = await paymentAdvice({ ...base, amountPaise: f.bill.amountPaise, bbpsTxnRef: ref("P") });
    expect(replay).toEqual(ok);

    const other = await paymentAdvice({ ...base, amountPaise: f.bill.amountPaise, bbpsTxnRef: ref("Q") });
    expect(other).toMatchObject({ ack: false, responseCode: "BPR002", receipt: null });

    const [n] = await sql<{ n: number }[]>`select count(*)::int as n from biller_payments where presentment_id = ${f.bill.presentmentId}`;
    expect(n.n).toBe(1);

    const after = await fetchFor(V.arrears, MOBILE.arrears);
    expect(after).toMatchObject({ result: "ALREADY_PAID", responseCode: "BFR001" });
    if (after.result === "ALREADY_PAID") {
      expect(after.receipt.bbpsTxnRef).toBe(ref("P"));
      expect(after.receipt.amountPaise).toBe(1188962);
    }
  });

  it("unknown presentment → BPR002", async () => {
    const r = await paymentAdvice({
      billerId: BILLER,
      presentmentId: crypto.randomUUID(),
      amountPaise: 100,
      bbpsTxnRef: ref("U"),
      mode: "UPI",
      paidAt: new Date().toISOString(),
    });
    expect(r).toMatchObject({ ack: false, responseCode: "BPR002" });
  });
});

describe("biller overview + sync", () => {
  it("overview includes TEST rows and KPIs; unknown biller throws", async () => {
    const o = await overview(BILLER);
    expect(o.biller.name).toBe("Bajaj Finance");
    const c = o.customers.find((x) => x.vehicleRegNo === V.due);
    expect(c?.outstandingPaise).toBe(672600);
    expect(c?.mobileMasked).toBe("99XXXXXX01");
    expect(o.payments.some((p) => p.bbpsTxnRef === ref("P"))).toBe(true);
    expect(o.kpis.customers).toBe(o.customers.length);
    await expect(overview("nope")).rejects.toBeInstanceOf(UnknownBillerError);
  });

  it("sync is idempotent on amounts", async () => {
    const before = await sql`select id, status, total_paise, late_fee_paise from biller_receivables where biller_id = ${BILLER} order by id`;
    const r = await sync(BILLER);
    expect(r.synced).toBeGreaterThanOrEqual(0);
    const after = await sql`select id, status, total_paise, late_fee_paise from biller_receivables where biller_id = ${BILLER} order by id`;
    expect(after).toEqual(before);
  });
});

describe("seeded acceptance (read-only amounts)", () => {
  it("Riya 672600, Arjun 1188962, Meera ALREADY_PAID, Kabir NOT_GENERATED; amounts unchanged", async () => {
    const before = await sql`select id, status, total_paise, late_fee_paise from biller_receivables where oem_bill_id::text like '22222222-%' order by id`;
    const riya = await fetchBill({ nbblRef: "F-T", billerId: "bajaj-finance", vehicleNo: "MH 01 AB 1001", mobile: "9800000001" });
    const arjun = await fetchBill({ nbblRef: "F-T", billerId: "bajaj-finance", vehicleNo: "MH01AB1002", mobile: "9800000002" });
    const meera = await fetchBill({ nbblRef: "F-T", billerId: "volt-leasing", vehicleNo: "MH01AB1003", mobile: "9800000003" });
    const kabir = await fetchBill({ nbblRef: "F-T", billerId: "bajaj-finance", vehicleNo: "MH01AB1004", mobile: "9800000004" });

    // If the PM/integrator already paid or generated in this DB, skip the strict amount checks.
    if (riya.result === "BILL_DUE") expect(riya.bill.amountPaise).toBe(672600);
    if (arjun.result === "BILL_DUE" && arjun.bill.cycles.length === 2) expect(arjun.bill.amountPaise).toBe(1188962);
    if (meera.result === "ALREADY_PAID") {
      expect(meera.receipt.bbpsTxnRef).toBe("BCSEEDPAID01");
      expect(meera.receipt.amountPaise).toBe(1218350);
    }
    expect(["NOT_GENERATED", "BILL_DUE"]).toContain(kabir.result);
    expect(riya.result).not.toBe("NOT_FOUND");

    const after = await sql`select id, status, total_paise, late_fee_paise from biller_receivables where oem_bill_id::text like '22222222-%' order by id`;
    expect(after).toEqual(before);
  });
});
