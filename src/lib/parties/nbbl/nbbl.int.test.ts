import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeSql, sql } from "@/lib/db/client";
import type { BillerFetchResponse, PaymentAdvice, PaymentAdviceAck } from "@/lib/domain/types";

const fetchBillMock = vi.fn();
const paymentAdviceMock = vi.fn();
vi.mock("@/lib/parties/biller/api", () => ({
  fetchBill: (...a: unknown[]) => fetchBillMock(...a),
  paymentAdvice: (...a: unknown[]) => paymentAdviceMock(...a),
}));

import { billFetch, billPay, getTransaction, listBillers, listTransactions, stats } from "./api";

const COU = "TEST-COU";
const PRESENTMENT = "00000000-0000-4000-8000-00000000c001";

const dueResp = {
  result: "BILL_DUE",
  responseCode: "000",
  message: "Success",
  bill: { presentmentId: PRESENTMENT, amountPaise: 50000, billerId: "demo-finance" },
} as unknown as BillerFetchResponse;

const receipt = {
  bbpsTxnRef: "x",
  billerId: "demo-finance",
  billerName: "Demo Finance",
  vehicleRegNo: "TEST1",
  customerName: "T****",
  amountPaise: 50000,
  mode: "UPI",
  paidAt: new Date().toISOString(),
  cycles: ["2026-08"],
};

const fetchReq = (billerId = "demo-finance") => ({
  couId: COU,
  billerId,
  category: "EV_BAAS" as const,
  customerParams: { vehicleRegNo: "mh 01-ab 1001", registeredMobile: "9800000001" },
});

async function cleanup() {
  await sql`delete from nbbl_events where txn_ref in (select ref from nbbl_transactions where cou_id = ${COU})`;
  await sql`delete from nbbl_transactions where cou_id = ${COU}`;
}

beforeEach(() => {
  fetchBillMock.mockReset();
  paymentAdviceMock.mockReset();
});
afterAll(async () => {
  await cleanup();
  await closeSql();
});

describe("nbbl", () => {
  it("lists active billers", async () => {
    const b = await listBillers("EV_BAAS");
    expect(b.map((x) => x.id)).toEqual(expect.arrayContaining(["demo-finance", "volt-leasing"]));
  });

  it("fetch -> pay happy path with masked events", async () => {
    fetchBillMock.mockResolvedValue(dueResp);
    const f = await billFetch(fetchReq());
    expect(f.responseCode).toBe("000");
    expect(f.fetchRef).toMatch(/^F-[A-Z0-9]{10}$/);
    expect(fetchBillMock.mock.calls[0][0]).toMatchObject({
      billerId: "demo-finance",
      vehicleNo: "MH01AB1001",
      mobile: "9800000001",
    });

    const ft = await getTransaction(f.fetchRef);
    expect(ft).toMatchObject({ status: "SUCCESS", amountPaise: 50000, billerRef: PRESENTMENT });
    expect(ft!.events.map((e) => e.step)).toEqual([
      "COU_REQ",
      "BILLER_REQ",
      "BILLER_RESP",
      "COU_RESP",
    ]);
    expect(JSON.stringify(ft)).not.toContain("9800000001");
    expect(JSON.stringify(ft)).toContain("98XXXXXX01");

    paymentAdviceMock.mockImplementation(
      async (a: PaymentAdvice): Promise<PaymentAdviceAck> => ({
        ack: true,
        responseCode: "000",
        message: "Success",
        bbpsTxnRef: a.bbpsTxnRef,
        presentmentId: a.presentmentId,
        billerPaymentId: "bp1",
        receipt: { ...receipt, bbpsTxnRef: a.bbpsTxnRef } as PaymentAdviceAck["receipt"],
      }),
    );
    const p = await billPay({
      couId: COU,
      fetchRef: f.fetchRef,
      amountPaise: 50000,
      mode: "UPI",
      couOrderId: "DP-TEST000001",
    });
    expect(p.status).toBe("SUCCESS");
    expect(p.bbpsTxnRef).toMatch(/^BC[A-Z0-9]{10}$/);
    expect(paymentAdviceMock.mock.calls[0][0]).toMatchObject({
      billerId: "demo-finance",
      presentmentId: PRESENTMENT,
      amountPaise: 50000,
    });
    const pt = await getTransaction(p.bbpsTxnRef!);
    expect(pt).toMatchObject({ type: "PAY", status: "SUCCESS", responseCode: "000", fetchRef: f.fetchRef });
    expect(pt!.events.map((e) => e.step)).toEqual(["COU_REQ", "PAY_REQ", "ADVICE_ACK", "COU_RESP"]);

    const list = await listTransactions({ type: "PAY", limit: 5 });
    expect(list.length).toBeGreaterThan(0);
    const s = await stats();
    expect(s.payments).toBeGreaterThan(0);
    expect(s.successRate).toBeGreaterThan(0);
  });

  it("retry on the same fetchRef replays the advice: same bbpsTxnRef, one PAY txn", async () => {
    fetchBillMock.mockResolvedValue(dueResp);
    const f = await billFetch(fetchReq());
    paymentAdviceMock.mockImplementation(
      async (a: PaymentAdvice): Promise<PaymentAdviceAck> => ({
        ack: true,
        responseCode: "000",
        message: "Success",
        bbpsTxnRef: a.bbpsTxnRef,
        presentmentId: a.presentmentId,
        billerPaymentId: "bp1",
        receipt: { ...receipt, bbpsTxnRef: a.bbpsTxnRef } as PaymentAdviceAck["receipt"],
      }),
    );
    const req = { couId: COU, fetchRef: f.fetchRef, amountPaise: 50000, mode: "UPI" as const, couOrderId: "DP-TEST000009" };
    const first = await billPay(req);
    // Simulate a timeout after the biller committed: the PAY txn was never closed.
    await sql`update nbbl_transactions set status = 'PENDING' where ref = ${first.bbpsTxnRef}`;
    const again = await billPay({ ...req, couOrderId: "DP-TEST000010" });

    expect(again).toMatchObject({ status: "SUCCESS", bbpsTxnRef: first.bbpsTxnRef });
    expect(paymentAdviceMock.mock.calls[1][0]).toMatchObject({ bbpsTxnRef: first.bbpsTxnRef, presentmentId: PRESENTMENT });
    const pays = await sql`select status from nbbl_transactions where fetch_ref = ${f.fetchRef} and type = 'PAY'`;
    expect(pays.map((r) => r.status)).toEqual(["SUCCESS"]);
  });

  it("unknown biller -> BFR003 without calling the biller", async () => {
    const f = await billFetch(fetchReq("TEST-NOPE"));
    expect(f).toMatchObject({ result: "BILLER_UNAVAILABLE", responseCode: "BFR003" });
    expect(fetchBillMock).not.toHaveBeenCalled();
    expect((await getTransaction(f.fetchRef))!.status).toBe("FAILED");
  });

  it("biller down -> SYS500", async () => {
    fetchBillMock.mockRejectedValue(new Error("boom"));
    const f = await billFetch(fetchReq());
    expect(f).toMatchObject({ result: "BILLER_UNAVAILABLE", responseCode: "SYS500" });
    const t = await getTransaction(f.fetchRef);
    expect(t!.status).toBe("FAILED");
    expect(t!.events.map((e) => e.step)).toContain("ERROR");
  });

  it("pay with bad fetchRef -> BPR002, no PAY txn", async () => {
    const p = await billPay({
      couId: COU,
      fetchRef: "F-DOESNOTEXI",
      amountPaise: 100,
      mode: "UPI",
      couOrderId: "DP-TEST000002",
    });
    expect(p).toMatchObject({ status: "FAILED", responseCode: "BPR002", bbpsTxnRef: null });
    expect(paymentAdviceMock).not.toHaveBeenCalled();
  });

  it("pay against a non-due fetch is rejected", async () => {
    fetchBillMock.mockResolvedValue({
      result: "NOT_FOUND",
      responseCode: "BFR002",
      message: "x",
      billerId: "demo-finance",
      billerName: "Demo Finance",
    });
    const f = await billFetch(fetchReq());
    const p = await billPay({
      couId: COU,
      fetchRef: f.fetchRef,
      amountPaise: 100,
      mode: "UPI",
      couOrderId: "DP-TEST000003",
    });
    expect(p.responseCode).toBe("BPR002");
  });

  it("biller nack and biller throw both fail the PAY txn", async () => {
    fetchBillMock.mockResolvedValue(dueResp);
    const f = await billFetch(fetchReq());
    paymentAdviceMock.mockResolvedValueOnce({
      ack: false,
      responseCode: "BPR001",
      message: "Amount mismatch",
      bbpsTxnRef: "x",
      presentmentId: PRESENTMENT,
      billerPaymentId: null,
      receipt: null,
    });
    const req = { couId: COU, fetchRef: f.fetchRef, amountPaise: 1, mode: "UPI" as const, couOrderId: "DP-TEST000004" };
    const p1 = await billPay(req);
    expect(p1).toMatchObject({ status: "FAILED", responseCode: "BPR001" });
    paymentAdviceMock.mockRejectedValueOnce(new Error("down"));
    const p2 = await billPay(req);
    expect(p2).toMatchObject({ status: "FAILED", responseCode: "SYS500" });
    expect((await getTransaction(p2.bbpsTxnRef!))!.status).toBe("FAILED");
  });
});
