import { describe, expect, it } from "vitest";
import {
  COMPLAINT_ID_RE,
  COU_TICKET_NO_RE,
  ComplaintInputError,
  ComplaintTransitionError,
  type ComplaintState,
  applyAction,
  canTransition,
  dueAt,
  initialAssignee,
  isComplaintReason,
  isOverdue,
  newComplaintId,
  newCouTicketNo,
  normaliseDescription,
  pendingWithLabel,
  slaDays,
  summariseComplaints,
  triageNote,
} from "./complaints";

const RAISED = "2026-09-20T10:00:00.000Z";
const OPEN_BILLER: ComplaintState = { status: "OPEN", pendingWith: "BILLER", resolution: null, closedAt: null };
const NOW = "2026-09-29T12:00:00.000Z";

describe("SLA", () => {
  it("days per reason", () => {
    expect(slaDays("DUPLICATE_PAYMENT")).toBe(5);
    expect(slaDays("DEBITED_TXN_FAILED")).toBe(5);
    expect(slaDays("PAID_BILL_PENDING")).toBe(3);
    expect(slaDays("WRONG_AMOUNT")).toBe(7);
    expect(slaDays("OTHER")).toBe(7);
  });

  it("dueAt = raisedAt + SLA calendar days", () => {
    expect(dueAt(RAISED, "PAID_BILL_PENDING")).toBe("2026-09-23T10:00:00.000Z");
    expect(dueAt(new Date(RAISED), "OTHER")).toBe("2026-09-27T10:00:00.000Z");
    expect(() => dueAt("not a date", "OTHER")).toThrow(ComplaintInputError);
  });

  it("overdue only when OPEN and strictly past due", () => {
    const due = dueAt(RAISED, "PAID_BILL_PENDING");
    expect(isOverdue({ status: "OPEN", dueAt: due }, "2026-09-23T10:00:00.000Z")).toBe(false);
    expect(isOverdue({ status: "OPEN", dueAt: due }, "2026-09-23T10:00:00.001Z")).toBe(true);
    expect(isOverdue({ status: "CLOSED", dueAt: due }, NOW)).toBe(false);
  });
});

describe("initialAssignee", () => {
  it("debited but failed: COU when NBBL never saw a PAY, NBBL when it failed, BILLER when it succeeded", () => {
    expect(initialAssignee("DEBITED_TXN_FAILED", null)).toBe("COU");
    expect(initialAssignee("DEBITED_TXN_FAILED", "FAILED")).toBe("NBBL");
    expect(initialAssignee("DEBITED_TXN_FAILED", "PENDING")).toBe("NBBL");
    expect(initialAssignee("DEBITED_TXN_FAILED", "SUCCESS")).toBe("BILLER");
  });

  it("biller-held reasons go to BILLER; OTHER to NBBL", () => {
    for (const r of ["DUPLICATE_PAYMENT", "PAID_BILL_PENDING", "WRONG_AMOUNT"] as const) {
      expect(initialAssignee(r, "SUCCESS")).toBe("BILLER");
      expect(initialAssignee(r, null)).toBe("BILLER");
    }
    expect(initialAssignee("OTHER", "SUCCESS")).toBe("NBBL");
  });

  it("labels", () => {
    expect(pendingWithLabel("BILLER", "Bajaj Finance")).toBe("Bajaj Finance");
    expect(pendingWithLabel("BILLER", null)).toBe("Biller");
    expect(pendingWithLabel("NBBL")).toBe("Bharat Connect");
    expect(pendingWithLabel("COU")).toBe("DemoPay");
  });
});

describe("state machine", () => {
  it("canTransition", () => {
    expect(canTransition("OPEN", "ASSIGN")).toBe(true);
    expect(canTransition("CLOSED", "ASSIGN")).toBe(false);
    expect(canTransition("OPEN", "CLOSE")).toBe(true);
    expect(canTransition("CLOSED", "CLOSE")).toBe(false);
    expect(canTransition("CLOSED", "REOPEN")).toBe(true);
    expect(canTransition("OPEN", "REOPEN")).toBe(false);
    expect(canTransition("OPEN", "NOTE")).toBe(true);
    expect(canTransition("CLOSED", "NOTE")).toBe(true);
  });

  it("ASSIGN moves pendingWith and records from→to", () => {
    const t = applyAction(OPEN_BILLER, { action: "ASSIGN", assignTo: "NBBL", note: " chasing " }, NOW);
    expect(t.next.pendingWith).toBe("NBBL");
    expect(t.event).toEqual({ action: "ASSIGNED", fromParty: "BILLER", toParty: "NBBL", actor: "NBBL_OPS", note: "chasing", at: NOW });
  });

  it("ASSIGN to the current party is 409; missing assignTo is 400", () => {
    expect(() => applyAction(OPEN_BILLER, { action: "ASSIGN", assignTo: "BILLER" })).toThrow(ComplaintTransitionError);
    expect(() => applyAction(OPEN_BILLER, { action: "ASSIGN" })).toThrow(ComplaintInputError);
  });

  it("CLOSE needs a resolution, sets closedAt; closing twice is 409", () => {
    expect(() => applyAction(OPEN_BILLER, { action: "CLOSE" })).toThrow(ComplaintInputError);
    const t = applyAction(OPEN_BILLER, { action: "CLOSE", resolution: "REFUNDED" }, NOW);
    expect(t.next).toEqual({ status: "CLOSED", pendingWith: "BILLER", resolution: "REFUNDED", closedAt: NOW });
    expect(t.event.action).toBe("CLOSED");
    expect(t.event.fromParty).toBe("BILLER");
    const err = (() => {
      try {
        applyAction(t.next, { action: "CLOSE", resolution: "RESOLVED" });
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ComplaintTransitionError);
    expect(err).toMatchObject({ status: 409, code: "INVALID_TRANSITION" });
  });

  it("REOPEN clears resolution and goes back to NBBL; REOPEN on OPEN is 409; ASSIGN on CLOSED is 409", () => {
    const closed = applyAction(OPEN_BILLER, { action: "CLOSE", resolution: "REJECTED" }, NOW).next;
    expect(() => applyAction(closed, { action: "ASSIGN", assignTo: "COU" })).toThrow(ComplaintTransitionError);
    const t = applyAction(closed, { action: "REOPEN", actor: "ops-1" }, NOW);
    expect(t.next).toEqual({ status: "OPEN", pendingWith: "NBBL", resolution: null, closedAt: null });
    expect(t.event).toMatchObject({ action: "REOPENED", toParty: "NBBL", actor: "ops-1" });
    expect(() => applyAction(OPEN_BILLER, { action: "REOPEN" })).toThrow(ComplaintTransitionError);
  });

  it("NOTE needs text, max 500 chars; unknown action is 400", () => {
    expect(() => applyAction(OPEN_BILLER, { action: "NOTE", note: "  " })).toThrow(ComplaintInputError);
    expect(() => applyAction(OPEN_BILLER, { action: "NOTE", note: "x".repeat(501) })).toThrow(ComplaintInputError);
    expect(applyAction(OPEN_BILLER, { action: "NOTE", note: "called biller" }).next).toEqual(OPEN_BILLER);
    expect(() => applyAction(OPEN_BILLER, { action: "DELETE" as never })).toThrow(ComplaintInputError);
  });
});

describe("input helpers", () => {
  it("reason guard and description", () => {
    expect(isComplaintReason("WRONG_AMOUNT")).toBe(true);
    expect(isComplaintReason("REFUND_PLS")).toBe(false);
    expect(isComplaintReason(3)).toBe(false);
    expect(normaliseDescription(undefined)).toBeNull();
    expect(normaliseDescription("   ")).toBeNull();
    expect(normaliseDescription(" hi ")).toBe("hi");
    expect(() => normaliseDescription("x".repeat(281))).toThrow(ComplaintInputError);
    expect(() => normaliseDescription(42)).toThrow(ComplaintInputError);
  });
});

describe("stats", () => {
  it("counts open/overdue/closed and open by party", () => {
    const past = "2026-09-25T00:00:00.000Z";
    const future = "2026-10-05T00:00:00.000Z";
    expect(
      summariseComplaints(
        [
          { status: "OPEN", pendingWith: "BILLER", dueAt: past },
          { status: "OPEN", pendingWith: "NBBL", dueAt: future },
          { status: "OPEN", pendingWith: "BILLER", dueAt: future },
          { status: "CLOSED", pendingWith: "COU", dueAt: past },
        ],
        NOW,
      ),
    ).toEqual({ total: 4, open: 3, overdue: 1, closed: 1, byParty: { COU: 0, NBBL: 1, BILLER: 2 } });
  });
});

describe("ref generators", () => {
  it("formats", () => {
    expect(newCouTicketNo()).toMatch(COU_TICKET_NO_RE);
    expect(newComplaintId()).toMatch(COMPLAINT_ID_RE);
  });

  it("deterministic with an rng, and rng=0.999… stays in range", () => {
    expect(newCouTicketNo(() => 0)).toBe("DPT-AAAAAAAA");
    expect(newComplaintId(() => 0.9999999)).toBe("CC9999999999");
  });
});

describe("triageNote", () => {
  it("explains the initial assignee", () => {
    expect(triageNote("DEBITED_TXN_FAILED", null)).toBe("Auto-triage: no payment reached Bharat Connect, pending with DemoPay.");
    expect(triageNote("DEBITED_TXN_FAILED", "FAILED")).toContain("pending with Bharat Connect");
    expect(triageNote("DEBITED_TXN_FAILED", "PENDING")).toContain("pending with Bharat Connect");
    expect(triageNote("DEBITED_TXN_FAILED", "SUCCESS")).toContain("pending with the biller");
    expect(triageNote("OTHER", null)).toContain("pending with Bharat Connect");
  });
  it("matches the seeded auto-triage note", () => {
    expect(triageNote("PAID_BILL_PENDING", "SUCCESS")).toBe("Auto-triage: paid bill not posted, pending with the biller.");
  });
});
