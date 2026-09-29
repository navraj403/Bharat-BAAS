import { afterAll, describe, expect, it } from "vitest";
import { closeSql, sql } from "@/lib/db/client";
import {
  ComplaintInputError,
  ComplaintNotFoundError,
  ComplaintTransitionError,
} from "@/lib/domain/complaints";
import {
  complaintAction,
  complaintStats,
  getComplaint,
  listComplaints,
  raiseComplaint,
} from "./api";

// Everything created here uses a TEST- order id / ticket / couId so the seeded rows stay untouched.
const COU = "TEST-COU";
const ORDER = "TEST-ORDER-1";
const base = {
  couId: COU,
  couTicketNo: "TEST-TKT-1",
  orderId: ORDER,
  bbpsTxnRef: null,
  billerId: "bajaj-finance",
  vehicleRegNo: "mh-01-ab-1001",
  amountPaise: 672600,
};

afterAll(async () => {
  const ids = (await sql`select complaint_id from nbbl_complaints where cou_id = ${COU}`).map(
    (r) => r.complaint_id as string,
  );
  await sql`delete from nbbl_complaint_events where complaint_id = any(${ids})`;
  await sql`delete from nbbl_complaints where cou_id = ${COU}`;
  await closeSql();
});

describe("nbbl complaints", () => {
  let id = "";

  it("raises and auto-triages DEBITED_TXN_FAILED with no PAY txn to COU", async () => {
    const before = await complaintStats();
    const c = await raiseComplaint({ ...base, reason: "DEBITED_TXN_FAILED", description: "  money gone " });
    id = c.complaintId;
    expect(id).toMatch(/^CC[A-Z0-9]{10}$/);
    expect(c).toMatchObject({
      status: "OPEN",
      pendingWith: "COU",
      txnRef: null,
      billerName: "Bajaj Finance",
      description: "money gone",
      overdue: false,
    });
    expect(c.customerRefMasked).toBe("MH01AB1001");
    expect(Date.parse(c.dueAt) - Date.parse(c.createdAt)).toBe(5 * 86_400_000);

    const d = await getComplaint(id);
    expect(d?.linkedTxn).toBeNull();
    expect(d?.events.map((e) => [e.action, e.fromParty, e.toParty, e.actor])).toEqual([
      ["RAISED", null, null, COU],
      ["ASSIGNED", null, "COU", "SYSTEM"],
    ]);

    const after = await complaintStats();
    expect(after.open).toBe(before.open + 1);
    expect(after.byParty.COU).toBe(before.byParty.COU + 1);
  });

  it("is idempotent while OPEN for the same (cou, order, reason)", async () => {
    const again = await raiseComplaint({ ...base, couTicketNo: "TEST-TKT-2", reason: "DEBITED_TXN_FAILED" });
    expect(again.complaintId).toBe(id);
    expect(again.couTicketNo).toBe("TEST-TKT-1");
    const rows = await listComplaints({ couId: COU });
    expect(rows).toHaveLength(1);
  });

  it("rejects bad input", async () => {
    await expect(raiseComplaint({ ...base, reason: "NOPE" as never })).rejects.toBeInstanceOf(ComplaintInputError);
    await expect(complaintAction(id, { action: "ASSIGN" })).rejects.toBeInstanceOf(ComplaintInputError);
    await expect(complaintAction("CCNOSUCH0000", { action: "NOTE", note: "x" })).rejects.toBeInstanceOf(
      ComplaintNotFoundError,
    );
    await expect(listComplaints({ status: "BOGUS" as never })).rejects.toBeInstanceOf(ComplaintInputError);
  });

  it("assigns to BILLER, filters by pendingWith, and refuses a no-op assign", async () => {
    const d = await complaintAction(id, { action: "ASSIGN", assignTo: "BILLER", note: "check credit" });
    expect(d.pendingWith).toBe("BILLER");
    expect(d.events.at(-1)).toMatchObject({ action: "ASSIGNED", fromParty: "COU", toParty: "BILLER", actor: "NBBL_OPS" });
    expect(await listComplaints({ couId: COU, pendingWith: "BILLER" })).toHaveLength(1);
    expect(await listComplaints({ couId: COU, pendingWith: "COU" })).toHaveLength(0);
    await expect(complaintAction(id, { action: "ASSIGN", assignTo: "BILLER" })).rejects.toBeInstanceOf(
      ComplaintTransitionError,
    );
  });

  it("rejects a bad transition (reopen an OPEN complaint)", async () => {
    await expect(complaintAction(id, { action: "REOPEN" })).rejects.toBeInstanceOf(ComplaintTransitionError);
  });

  it("closes with a resolution, then reopens back to NBBL", async () => {
    await expect(complaintAction(id, { action: "CLOSE" })).rejects.toBeInstanceOf(ComplaintInputError);
    const before = await complaintStats();
    const closed = await complaintAction(id, { action: "CLOSE", resolution: "REFUNDED", note: "refunded" });
    expect(closed).toMatchObject({ status: "CLOSED", resolution: "REFUNDED", overdue: false });
    expect(closed.closedAt).not.toBeNull();
    const mid = await complaintStats();
    expect(mid.closed).toBe(before.closed + 1);
    expect(mid.open).toBe(before.open - 1);
    await expect(complaintAction(id, { action: "ASSIGN", assignTo: "NBBL" })).rejects.toBeInstanceOf(
      ComplaintTransitionError,
    );
    await complaintAction(id, { action: "NOTE", note: "post-closure note" });

    const reopened = await complaintAction(id, { action: "REOPEN", note: "customer disputes" });
    expect(reopened).toMatchObject({ status: "OPEN", pendingWith: "NBBL", resolution: null, closedAt: null });
    expect(reopened.events.map((e) => e.action)).toEqual([
      "RAISED", "ASSIGNED", "ASSIGNED", "CLOSED", "NOTE", "REOPENED",
    ]);
    const after = await complaintStats();
    expect(after.open).toBe(before.open);
    expect(after.byParty.NBBL).toBe(before.byParty.NBBL + 1);
  });

  it("returns null for an unknown complaint", async () => {
    expect(await getComplaint("CCNOSUCH0000")).toBeNull();
  });
});
