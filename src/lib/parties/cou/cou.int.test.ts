import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeSql, sql } from "@/lib/db/client";
import type { BillerFetchResponse, PaymentAdvice, PaymentAdviceAck } from "@/lib/domain/types";

const fetchBillMock = vi.fn();
const paymentAdviceMock = vi.fn();
vi.mock("@/lib/parties/biller/api", () => ({
  fetchBill: (...a: unknown[]) => fetchBillMock(...a),
  paymentAdvice: (...a: unknown[]) => paymentAdviceMock(...a),
}));

import { fetchBill, listBillers, pay } from "./api";

// COU always uses couId DEMOPAY; identify our rows via the TEST- presentment / order ids we track.
const PRESENTMENT = "00000000-0000-4000-8000-00000000c002";
const orderIds: string[] = [];
const fetchRefs: string[] = [];

const due = {
  result: "BILL_DUE",
  responseCode: "000",
  message: "Success",
  bill: { presentmentId: PRESENTMENT, amountPaise: 70000 },
} as unknown as BillerFetchResponse;

async function cleanup() {
  const pays = await sql`select ref from nbbl_transactions where biller_ref = ${PRESENTMENT}
    or fetch_ref = any(${fetchRefs}) or ref = any(${fetchRefs})`;
  const refs = [...new Set([...pays.map((r) => r.ref as string), ...fetchRefs])];
  await sql`delete from nbbl_events where txn_ref = any(${refs})`;
  await sql`delete from nbbl_transactions where ref = any(${refs})`;
  await sql`delete from cou_payments where order_id = any(${orderIds})`;
}

beforeEach(() => {
  fetchBillMock.mockReset();
  paymentAdviceMock.mockReset();
});
afterAll(async () => {
  await cleanup();
  await closeSql();
});

describe("cou", () => {
  it("lists billers via nbbl", async () => {
    expect((await listBillers("EV_BAAS")).length).toBeGreaterThanOrEqual(2);
  });

  it("validates fetch input", async () => {
    await expect(fetchBill({ billerId: "bajaj-finance", vehicleNo: " - ", mobile: "9800000001" })).rejects.toThrow();
    await expect(fetchBill({ billerId: "bajaj-finance", vehicleNo: "MH01AB1001", mobile: "123" })).rejects.toThrow();
  });

  it("fetch -> pay success writes cou_payments and returns receipt", async () => {
    fetchBillMock.mockResolvedValue(due);
    const f = await fetchBill({ billerId: "bajaj-finance", vehicleNo: "mh 01 ab 1001", mobile: "9800000001" });
    fetchRefs.push(f.fetchRef);
    expect(f.responseCode).toBe("000");
    expect(fetchBillMock.mock.calls[0][0].vehicleNo).toBe("MH01AB1001");

    paymentAdviceMock.mockImplementation(
      async (a: PaymentAdvice): Promise<PaymentAdviceAck> => ({
        ack: true,
        responseCode: "000",
        message: "Success",
        bbpsTxnRef: a.bbpsTxnRef,
        presentmentId: a.presentmentId,
        billerPaymentId: "bp",
        receipt: {
          bbpsTxnRef: a.bbpsTxnRef,
          billerId: "bajaj-finance",
          billerName: "Bajaj Finance",
          vehicleRegNo: "MH01AB1001",
          customerName: "T****",
          amountPaise: a.amountPaise,
          mode: a.mode,
          paidAt: a.paidAt,
          cycles: ["2026-08"],
        },
      }),
    );
    const r = await pay({ fetchRef: f.fetchRef, amountPaise: 70000, mode: "UPI" });
    orderIds.push(r.couOrderId);
    expect(r.status).toBe("SUCCESS");
    if (r.status !== "SUCCESS") return;
    expect(r.receipt.couOrderId).toBe(r.couOrderId);
    const [row] = await sql`select * from cou_payments where order_id = ${r.couOrderId}`;
    expect(row).toMatchObject({
      status: "SUCCESS",
      bbps_txn_ref: r.receipt.bbpsTxnRef,
      biller_id: "bajaj-finance",
      vehicle_reg_no: "MH01AB1001",
    });
  });

  it("simulateFailure does not call NBBL", async () => {
    const before = await sql`select count(*)::int as n from nbbl_transactions`;
    const r = await pay({ fetchRef: "F-TESTSIMFAIL", amountPaise: 100, mode: "UPI", simulateFailure: true });
    orderIds.push(r.couOrderId);
    expect(r).toMatchObject({ status: "FAILED", failureReason: "PAYMENT_DECLINED", responseCode: null });
    const after = await sql`select count(*)::int as n from nbbl_transactions`;
    expect(after[0].n).toBe(before[0].n);
    const [row] = await sql`select status from cou_payments where order_id = ${r.couOrderId}`;
    expect(row.status).toBe("FAILED");
  });

  it("bad fetchRef -> BBPS_REJECTED", async () => {
    const r = await pay({ fetchRef: "F-TESTNOTREAL", amountPaise: 100, mode: "UPI" });
    orderIds.push(r.couOrderId);
    expect(r).toMatchObject({ status: "FAILED", failureReason: "BBPS_REJECTED", responseCode: "BPR002" });
  });

  it("biller down on fetch -> SYS500 passthrough; on pay -> BILLER_UNAVAILABLE", async () => {
    fetchBillMock.mockRejectedValue(new Error("down"));
    const f = await fetchBill({ billerId: "bajaj-finance", vehicleNo: "MH01AB1001", mobile: "9800000001" });
    fetchRefs.push(f.fetchRef);
    expect(f).toMatchObject({ result: "BILLER_UNAVAILABLE", responseCode: "SYS500" });

    fetchBillMock.mockResolvedValue(due);
    const f2 = await fetchBill({ billerId: "bajaj-finance", vehicleNo: "MH01AB1001", mobile: "9800000001" });
    fetchRefs.push(f2.fetchRef);
    paymentAdviceMock.mockRejectedValue(new Error("down"));
    const r = await pay({ fetchRef: f2.fetchRef, amountPaise: 70000, mode: "UPI" });
    orderIds.push(r.couOrderId);
    expect(r).toMatchObject({ status: "FAILED", failureReason: "BILLER_UNAVAILABLE", responseCode: "SYS500" });
  });
});
