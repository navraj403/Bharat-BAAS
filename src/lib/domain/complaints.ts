/**
 * Complaint rules (docs/COMPLAINTS_PLAN.md "Design"). PURE: imports only types, no app/db code,
 * so the server (NBBL/COU services), the fixtures and the UI can all share it.
 *
 * - SLA per reason → `dueAt`, `isOverdue`
 * - Auto-triage → `initialAssignee` (what makes "pending with" meaningful)
 * - State machine → `canTransition`, `applyAction`
 * - Ref generators → `newCouTicketNo` (`DPT-` + 8), `newComplaintId` (`CC` + 10)
 * - Error classes carrying an HTTP status + code, for routes and the fixture client:
 *     ComplaintInputError      → 400 BAD_REQUEST
 *     ComplaintNotFoundError   → 404 NOT_FOUND
 *     ComplaintTransitionError → 409 INVALID_TRANSITION
 */
import type {
  ComplaintActionKind,
  ComplaintActionRequest,
  ComplaintActionType,
  ComplaintParty,
  ComplaintReason,
  ComplaintResolution,
  ComplaintStatus,
  IsoDateTime,
  NbblComplaintStats,
  NbblTxnStatus,
} from "./types";
import {
  COMPLAINT_ACTION_TYPES,
  COMPLAINT_PARTIES,
  COMPLAINT_PARTY_LABELS,
  COMPLAINT_REASONS,
  COMPLAINT_RESOLUTIONS,
} from "./types";

const DAY_MS = 86_400_000;

// ─── Limits and actors ───────────────────────────────────────────────────────

/** Max length of the customer's optional description. */
export const COMPLAINT_DESCRIPTION_MAX = 280;
/** Max length of an operator note. */
export const COMPLAINT_NOTE_MAX = 500;

/** Actor for automatic events (initial triage). */
export const ACTOR_SYSTEM = "SYSTEM";
/** Default actor for NBBL console actions. */
export const ACTOR_NBBL_OPS = "NBBL_OPS";

// ─── Errors ──────────────────────────────────────────────────────────────────

/** Base class: routes map `status` + `code` straight to `{error:{code,message}}`. */
export class ComplaintError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ComplaintError";
    this.status = status;
    this.code = code;
  }
}

/** Bad or missing input (unknown reason, note too long, ASSIGN without assignTo…) → 400. */
export class ComplaintInputError extends ComplaintError {
  constructor(message: string) {
    super(400, "BAD_REQUEST", message);
    this.name = "ComplaintInputError";
  }
}

/** Unknown complaint id (on a mutation) or unknown COU order → 404. Getters return null instead. */
export class ComplaintNotFoundError extends ComplaintError {
  constructor(message: string) {
    super(404, "NOT_FOUND", message);
    this.name = "ComplaintNotFoundError";
  }
}

/** The action is not allowed in the complaint's current state → 409. */
export class ComplaintTransitionError extends ComplaintError {
  constructor(message: string) {
    super(409, "INVALID_TRANSITION", message);
    this.name = "ComplaintTransitionError";
  }
}

// ─── Type guards (input validation) ──────────────────────────────────────────

const includes = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);

export const isComplaintReason = (v: unknown): v is ComplaintReason => includes(COMPLAINT_REASONS, v);
export const isComplaintParty = (v: unknown): v is ComplaintParty => includes(COMPLAINT_PARTIES, v);
export const isComplaintResolution = (v: unknown): v is ComplaintResolution =>
  includes(COMPLAINT_RESOLUTIONS, v);
export const isComplaintActionType = (v: unknown): v is ComplaintActionType =>
  includes(COMPLAINT_ACTION_TYPES, v);
export const isComplaintStatus = (v: unknown): v is ComplaintStatus => v === "OPEN" || v === "CLOSED";

/**
 * Trim and length-check an optional description. Returns null for empty/absent.
 * Throws ComplaintInputError when it is not a string or longer than COMPLAINT_DESCRIPTION_MAX.
 */
export function normaliseDescription(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new ComplaintInputError("description must be a string");
  const t = v.trim();
  if (t.length > COMPLAINT_DESCRIPTION_MAX) {
    throw new ComplaintInputError(`description must be at most ${COMPLAINT_DESCRIPTION_MAX} characters`);
  }
  return t || null;
}

// ─── SLA ─────────────────────────────────────────────────────────────────────

/**
 * Calendar days NBBL allows to resolve a complaint, per reason.
 * ASSUMPTION: illustrative TATs, not NPCI's published complaint TATs. Money-movement issues get
 * 5 days, a paid-but-not-posted bill 3 days (the biller only has to post it), everything else 7.
 */
export const SLA_DAYS: Record<ComplaintReason, number> = {
  DUPLICATE_PAYMENT: 5, // ASSUMPTION
  DEBITED_TXN_FAILED: 5, // ASSUMPTION
  PAID_BILL_PENDING: 3, // ASSUMPTION
  WRONG_AMOUNT: 7, // ASSUMPTION
  OTHER: 7, // ASSUMPTION
};

export function slaDays(reason: ComplaintReason): number {
  return SLA_DAYS[reason];
}

/**
 * Due instant = raisedAt + SLA calendar days (exact 24 h days, UTC; no business-day calendar).
 * ASSUMPTION: calendar days, counted from the raise instant. A REOPEN keeps the original due date.
 */
export function dueAt(raisedAt: IsoDateTime | Date, reason: ComplaintReason): IsoDateTime {
  const t = typeof raisedAt === "string" ? Date.parse(raisedAt) : raisedAt.getTime();
  if (!Number.isFinite(t)) throw new ComplaintInputError("raisedAt is not a valid date");
  return new Date(t + slaDays(reason) * DAY_MS).toISOString();
}

/** OPEN and strictly past its due instant. CLOSED complaints are never overdue. */
export function isOverdue(
  c: { status: ComplaintStatus; dueAt: IsoDateTime },
  now: Date | IsoDateTime = new Date(),
): boolean {
  if (c.status !== "OPEN") return false;
  const n = typeof now === "string" ? Date.parse(now) : now.getTime();
  return n > Date.parse(c.dueAt);
}

// ─── Triage ──────────────────────────────────────────────────────────────────

/**
 * Who a new complaint is pending with.
 * `payTxnStatus` is the status of the NBBL PAY txn at the order's bbpsTxnRef, or null when NBBL
 * has no PAY txn for it (e.g. the mock UPI declined before NBBL was called).
 *
 * ASSUMPTION (auto-triage rules, illustrative):
 * - DEBITED_TXN_FAILED, no PAY txn   → COU    (the money never reached the switch; the COU/bank must reverse it)
 * - DEBITED_TXN_FAILED, FAILED/PENDING → NBBL (the switch must reconcile the failed/stuck txn)
 * - DEBITED_TXN_FAILED, SUCCESS      → BILLER (NBBL shows it paid; the biller must confirm credit)
 * - DUPLICATE_PAYMENT, PAID_BILL_PENDING, WRONG_AMOUNT → BILLER (the biller holds the money/posting)
 * - OTHER                            → NBBL   (ops triages manually)
 */
export function initialAssignee(reason: ComplaintReason, payTxnStatus: NbblTxnStatus | null): ComplaintParty {
  switch (reason) {
    case "DEBITED_TXN_FAILED":
      if (payTxnStatus === null) return "COU";
      if (payTxnStatus === "SUCCESS") return "BILLER";
      return "NBBL";
    case "DUPLICATE_PAYMENT":
    case "PAID_BILL_PENDING":
    case "WRONG_AMOUNT":
      return "BILLER";
    case "OTHER":
      return "NBBL";
  }
}

/**
 * The note on the initial ASSIGNED (auto-triage) event: why the complaint is pending with that
 * party. Mirrors `initialAssignee`; the seed and fixtures use the same wording.
 */
export function triageNote(reason: ComplaintReason, payTxnStatus: NbblTxnStatus | null): string {
  switch (reason) {
    case "DEBITED_TXN_FAILED":
      if (payTxnStatus === null) return "Auto-triage: no payment reached Bharat Connect, pending with MeterPe.";
      if (payTxnStatus === "SUCCESS") return "Auto-triage: Bharat Connect shows the payment successful, pending with the biller.";
      if (payTxnStatus === "PENDING") return "Auto-triage: the PAY is stuck at the switch, pending with Bharat Connect.";
      return "Auto-triage: the PAY failed at the switch, pending with Bharat Connect.";
    case "DUPLICATE_PAYMENT":
      return "Auto-triage: duplicate payment, pending with the biller.";
    case "PAID_BILL_PENDING":
      return "Auto-triage: paid bill not posted, pending with the biller.";
    case "WRONG_AMOUNT":
      return "Auto-triage: wrong amount charged, pending with the biller.";
    case "OTHER":
      return "Auto-triage: other, pending with Bharat Connect.";
  }
}

/** Plain-words assignee for UIs: the biller's name for BILLER when known, else the party label. */
export function pendingWithLabel(party: ComplaintParty, billerName?: string | null): string {
  if (party === "BILLER" && billerName) return billerName;
  return COMPLAINT_PARTY_LABELS[party];
}

// ─── State machine ───────────────────────────────────────────────────────────

/**
 * CLOSE only when OPEN, REOPEN only when CLOSED, ASSIGN only when OPEN, NOTE always.
 * ASSUMPTION: notes are allowed on closed tickets (ops can annotate after closure).
 */
export function canTransition(status: ComplaintStatus, action: ComplaintActionType): boolean {
  switch (action) {
    case "ASSIGN":
    case "CLOSE":
      return status === "OPEN";
    case "REOPEN":
      return status === "CLOSED";
    case "NOTE":
      return true;
  }
}

/** The mutable part of a complaint. */
export interface ComplaintState {
  status: ComplaintStatus;
  pendingWith: ComplaintParty;
  resolution: ComplaintResolution | null;
  closedAt: IsoDateTime | null;
}

/** The event row an action writes (`nbbl_complaint_events` minus id/complaintId). */
export interface ComplaintEventDraft {
  action: ComplaintActionKind;
  fromParty: ComplaintParty | null;
  toParty: ComplaintParty | null;
  actor: string;
  note: string | null;
  at: IsoDateTime;
}

export interface ComplaintTransition {
  next: ComplaintState;
  event: ComplaintEventDraft;
}

function normaliseNote(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new ComplaintInputError("note must be a string");
  const t = v.trim();
  if (t.length > COMPLAINT_NOTE_MAX) {
    throw new ComplaintInputError(`note must be at most ${COMPLAINT_NOTE_MAX} characters`);
  }
  return t || null;
}

/**
 * Validate and apply an operator action. Pure: returns the next state and the event to write.
 * Throws ComplaintInputError (400) for bad input, ComplaintTransitionError (409) for a
 * disallowed transition (including ASSIGN to the party it is already pending with).
 *
 * - ASSIGN → pendingWith = assignTo; event ASSIGNED from→to.
 * - NOTE   → state unchanged; event NOTE.
 * - CLOSE  → CLOSED, resolution, closedAt = now; event CLOSED (fromParty = pendingWith).
 * - REOPEN → OPEN, resolution/closedAt cleared, pendingWith = NBBL; event REOPENED (→ NBBL).
 *   ASSUMPTION: a reopened complaint goes back to the switch for re-triage.
 */
export function applyAction(
  state: ComplaintState,
  req: ComplaintActionRequest,
  now: Date | IsoDateTime = new Date(),
): ComplaintTransition {
  if (!req || !isComplaintActionType(req.action)) {
    throw new ComplaintInputError(`action must be one of ${COMPLAINT_ACTION_TYPES.join(", ")}`);
  }
  const at = typeof now === "string" ? new Date(now).toISOString() : now.toISOString();
  const note = normaliseNote(req.note);
  const actor = typeof req.actor === "string" && req.actor.trim() ? req.actor.trim() : ACTOR_NBBL_OPS;

  if (!canTransition(state.status, req.action)) {
    throw new ComplaintTransitionError(`Cannot ${req.action} a ${state.status} complaint`);
  }

  switch (req.action) {
    case "ASSIGN": {
      if (!isComplaintParty(req.assignTo)) {
        throw new ComplaintInputError(`assignTo must be one of ${COMPLAINT_PARTIES.join(", ")}`);
      }
      if (req.assignTo === state.pendingWith) {
        throw new ComplaintTransitionError(`Complaint is already pending with ${req.assignTo}`);
      }
      return {
        next: { ...state, pendingWith: req.assignTo },
        event: { action: "ASSIGNED", fromParty: state.pendingWith, toParty: req.assignTo, actor, note, at },
      };
    }
    case "NOTE": {
      if (!note) throw new ComplaintInputError("note is required");
      return {
        next: { ...state },
        event: { action: "NOTE", fromParty: null, toParty: null, actor, note, at },
      };
    }
    case "CLOSE": {
      if (!isComplaintResolution(req.resolution)) {
        throw new ComplaintInputError(`resolution must be one of ${COMPLAINT_RESOLUTIONS.join(", ")}`);
      }
      return {
        next: { ...state, status: "CLOSED", resolution: req.resolution, closedAt: at },
        event: { action: "CLOSED", fromParty: state.pendingWith, toParty: null, actor, note, at },
      };
    }
    case "REOPEN": {
      return {
        next: { status: "OPEN", pendingWith: "NBBL", resolution: null, closedAt: null },
        event: { action: "REOPENED", fromParty: null, toParty: "NBBL", actor, note, at },
      };
    }
  }
}

// ─── Stats ───────────────────────────────────────────────────────────────────

/** Console KPIs from a list of complaints. `byParty` counts OPEN complaints only. */
export function summariseComplaints(
  rows: ReadonlyArray<{ status: ComplaintStatus; pendingWith: ComplaintParty; dueAt: IsoDateTime }>,
  now: Date | IsoDateTime = new Date(),
): NbblComplaintStats {
  const stats: NbblComplaintStats = {
    total: rows.length,
    open: 0,
    overdue: 0,
    closed: 0,
    byParty: { COU: 0, NBBL: 0, BILLER: 0 },
  };
  for (const r of rows) {
    if (r.status === "CLOSED") {
      stats.closed++;
      continue;
    }
    stats.open++;
    stats.byParty[r.pendingWith]++;
    if (isOverdue(r, now)) stats.overdue++;
  }
  return stats;
}

// ─── Ref generators ──────────────────────────────────────────────────────────

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** Uniform [0, 1). Uses Web Crypto when present (Node 20+ and browsers), else Math.random. */
function defaultRng(): number {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } }).crypto;
  if (c?.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
  return Math.random();
}

function randAlnum(n: number, rng: () => number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += ALNUM[Math.min(ALNUM.length - 1, Math.floor(rng() * ALNUM.length))];
  return s;
}

/** COU ticket number: `DPT-` + 8 [A-Z0-9]. */
export const newCouTicketNo = (rng: () => number = defaultRng): string => `DPT-${randAlnum(8, rng)}`;
/** NBBL (BBPS) complaint id: `CC` + 10 [A-Z0-9]. */
export const newComplaintId = (rng: () => number = defaultRng): string => `CC${randAlnum(10, rng)}`;

export const COU_TICKET_NO_RE = /^DPT-[A-Z0-9]{8}$/;
export const COMPLAINT_ID_RE = /^CC[A-Z0-9]{10}$/;
