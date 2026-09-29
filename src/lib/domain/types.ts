/**
 * THE CONTRACT for Bharat BaaS (see docs/BUILD_PLAN.md §2–§6).
 *
 * Frozen after P0. Changes are ADDITIVE ONLY (new optional fields or new types),
 * made by the PM. Pure TypeScript: this file imports nothing.
 *
 * Units (everywhere in code):
 *  - Money is integer PAISE (`Paise`). ₹1 = 100 paise. Never floats. Format only at display.
 *  - Distance is integer KILOMETRES (`Km`). Rates are integer paise per km.
 *  - Calendar dates are ISO strings `YYYY-MM-DD` (`IsoDate`); instants are ISO-8601
 *    strings with timezone (`IsoDateTime`). The DB client returns `date` columns as
 *    `YYYY-MM-DD` strings already (see src/lib/db/client.ts).
 *  - A billing cycle is a calendar month `YYYY-MM` (`Cycle`).
 *  - Vehicle registration numbers are NORMALISED (uppercase, no spaces/dashes:
 *    `MH01AB1001`) in every DTO; display as `MH 01 AB 1001` in the UI only.
 */

// ─── Primitives ──────────────────────────────────────────────────────────────

/** Integer paise. */
export type Paise = number;
/** Integer kilometres. */
export type Km = number;
/** `YYYY-MM-DD`. */
export type IsoDate = string;
/** ISO-8601 instant, e.g. `2026-09-24T10:15:00.000Z`. */
export type IsoDateTime = string;
/** Billing cycle `YYYY-MM` (calendar month). */
export type Cycle = string;

/** Any JSON-serialisable value (used for NBBL event payloads and admin rows). */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

// ─── Enums ───────────────────────────────────────────────────────────────────

/** BBPS biller category. Only EV battery BaaS is live in the prototype. */
export type Category = "EV_BAAS";

/** Seeded OEM plan ids (docs/DOMAIN.md §3). Plans are rows, so treat as string at the DB edge. */
export type PlanId = "STD" | "PRO" | "FLEX";

/** Mock payment modes. */
export type PaymentMode = "UPI" | "UPI_AUTOPAY" | "NETBANKING" | "DEBIT_CARD";

/** Runtime list of every `PaymentMode` (single source for input validation). */
export const PAYMENT_MODES: readonly PaymentMode[] = ["UPI", "UPI_AUTOPAY", "NETBANKING", "DEBIT_CARD"];

/**
 * Mock BBPS response codes (docs/DOMAIN.md §5 + BFR003).
 * - `000`    success (fetch: a bill is due; pay: payment accepted)
 * - `BFR001` no bill due (fetch → NOT_GENERATED or ALREADY_PAID)
 * - `BFR002` invalid customer params (fetch → NOT_FOUND; generic, never says which field)
 * - `BFR003` biller not registered / inactive at NBBL
 * - `BPR001` amount mismatch (pay amount ≠ presentment amount; no part-payment)
 * - `BPR002` bill already paid (different bbpsTxnRef on a PAID presentment), or fetchRef not payable
 * - `SYS500` biller unavailable (biller threw / timed out)
 */
export type ResponseCode =
  | "000"
  | "BFR001"
  | "BFR002"
  | "BFR003"
  | "BPR001"
  | "BPR002"
  | "SYS500";

/** Default human messages per response code (UI may override copy). */
export const RESPONSE_MESSAGES: Record<ResponseCode, string> = {
  "000": "Success",
  BFR001: "No bill due",
  BFR002: "Invalid customer parameters",
  BFR003: "Biller not registered",
  BPR001: "Amount mismatch",
  BPR002: "Bill already paid",
  SYS500: "Biller unavailable",
};

/** Outcome of a bill fetch as seen by the customer. */
export type FetchResultKind =
  | "BILL_DUE"
  | "NOT_GENERATED"
  | "ALREADY_PAID"
  | "NOT_FOUND"
  | "BILLER_UNAVAILABLE";

/** OEM-side bill payment flag (the OEM only knows paid/unpaid). */
export type OemPaymentStatus = "UNPAID" | "PAID";

/** Biller receivable status. UNPAID → OVERDUE (past due_date, late fee applied once) → PAID. */
export type ReceivableStatus = "UNPAID" | "OVERDUE" | "PAID";

/** Biller presentment status. */
export type PresentmentStatus = "OPEN" | "PAID";

export type NbblTxnType = "FETCH" | "PAY";
export type NbblTxnStatus = "PENDING" | "SUCCESS" | "FAILED";

/**
 * NBBL hop-timeline steps.
 * FETCH txn: COU_REQ → BILLER_REQ → BILLER_RESP → COU_RESP
 * PAY txn:   COU_REQ → PAY_REQ (payment advice sent to biller) → ADVICE_ACK → COU_RESP
 * ERROR may be logged at any point (e.g. biller threw → SYS500).
 */
export type NbblEventStep =
  | "COU_REQ"
  | "BILLER_REQ"
  | "BILLER_RESP"
  | "PAY_REQ"
  | "ADVICE_ACK"
  | "COU_RESP"
  | "ERROR";

/** COU (DemoPay) payment order status. */
export type CouPaymentStatus = "INITIATED" | "SUCCESS" | "FAILED";

/** The party that owns a table (DB explorer grouping). */
export type Party = "oem" | "biller" | "nbbl" | "cou";

// ─── Bill presentment (biller → NBBL → COU) ──────────────────────────────────

/**
 * Line item kinds on a presented bill. Order in `lines`:
 *   FIXED_FEE, USAGE, GST            — latest unpaid cycle
 *   ARREARS                          — one per older unpaid cycle (that cycle's total incl. GST)
 *   LATE_FEE                         — one per OVERDUE cycle (2% of that cycle's subtotal, no GST)
 */
export type BillLineKind = "FIXED_FEE" | "USAGE" | "GST" | "ARREARS" | "LATE_FEE";

export interface BillLineItem {
  kind: BillLineKind;
  /** Display label, e.g. "Fixed battery fee", "Pay-per-use (1,100 km × ₹4.00/km)", "GST @ 18%", "Arrears (2026-07)", "Late fee (2026-07)". */
  label: string;
  /** The cycle this line belongs to. */
  cycle: Cycle;
  amountPaise: Paise;
  /** USAGE only: km driven in the cycle. */
  km?: Km;
  /** USAGE only: rate in paise per km. */
  ratePaisePerKm?: Paise;
  /** GST / LATE_FEE only: rate in basis points (GST 1800 = 18%, late fee 200 = 2%). */
  rateBps?: number;
  /** GST / LATE_FEE only: the amount the rate was applied to. */
  basePaise?: Paise;
}

/** One OEM bill (cycle) included in a presentment. */
export interface PresentedCycle {
  cycle: Cycle;
  oemBillId: string;
  oemBillNo: string;
  kmDriven: Km;
  subtotalPaise: Paise;
  gstPaise: Paise;
  /** subtotal + GST (excludes late fee). */
  totalPaise: Paise;
  /** Late fee applied to this cycle (0 unless OVERDUE). */
  lateFeePaise: Paise;
  billDate: IsoDate;
  dueDate: IsoDate;
  status: ReceivableStatus;
}

/**
 * What the customer sees on "Bill due" (BUILD_PLAN §5 screen 4a).
 * `amountPaise` = latest cycle total + arrears totals + late fees — the ONLY payable amount
 * (exact amount, no part-payment). It always equals the sum of `lines[].amountPaise`.
 */
export interface BillPresentment {
  /** Biller presentment id (uuid). NBBL keeps it as `billerRef` to route the payment advice. */
  presentmentId: string;
  billerId: string;
  billerName: string;
  /** Masked, e.g. "Riya S****". */
  customerName: string;
  vehicleRegNo: string;
  planId: string;
  planName: string;
  /** Latest unpaid cycle. */
  cycle: Cycle;
  /** First and last day of the latest cycle. */
  billPeriod: { from: IsoDate; to: IsoDate };
  /** Latest cycle's bill date / due date. */
  billDate: IsoDate;
  dueDate: IsoDate;
  /** True if ANY included cycle is OVERDUE (UI shows a red "Overdue" pill). */
  overdue: boolean;
  /** Latest cycle's km driven. */
  kmDriven: Km;
  /** Latest cycle's total incl. GST. */
  currentCyclePaise: Paise;
  /** Sum of older unpaid cycle totals (incl. their GST). */
  arrearsPaise: Paise;
  /** Sum of late fees. */
  lateFeePaise: Paise;
  /** Total payable. */
  amountPaise: Paise;
  lines: BillLineItem[];
  /** Every cycle included, oldest first. */
  cycles: PresentedCycle[];
}

/** Payment receipt (COU screen 6, and the "Already paid" state). */
export interface Receipt {
  /** Bharat Connect reference, `BC` + 10 [A-Z0-9]. */
  bbpsTxnRef: string;
  billerId: string;
  billerName: string;
  vehicleRegNo: string;
  /** Masked, e.g. "Riya S****". */
  customerName: string;
  amountPaise: Paise;
  mode: PaymentMode;
  paidAt: IsoDateTime;
  /** Cycles settled by this payment. */
  cycles: Cycle[];
  /** DemoPay order id — present only when the receipt came through the COU pay flow. */
  couOrderId?: string;
}

// ─── Fetch outcomes (shared by biller, NBBL and COU) ─────────────────────────

export interface BillDueOutcome {
  result: "BILL_DUE";
  bill: BillPresentment;
}

export interface NotGeneratedOutcome {
  result: "NOT_GENERATED";
  billerId: string;
  billerName: string;
  vehicleRegNo: string;
  /** Masked. */
  customerName: string;
  /** 1st of next month (bills are generated on day 1 for the previous month). */
  nextBillDate: IsoDate;
}

export interface AlreadyPaidOutcome {
  result: "ALREADY_PAID";
  /** The customer's last payment. */
  receipt: Receipt;
}

export interface NotFoundOutcome {
  result: "NOT_FOUND";
  billerId: string;
  billerName: string;
}

export interface BillerUnavailableOutcome {
  result: "BILLER_UNAVAILABLE";
  billerId: string;
  /** Absent when the biller id is not in the NBBL registry (BFR003). */
  billerName?: string;
}

/** Outcomes the biller itself can return. */
export type BillerFetchOutcome =
  | BillDueOutcome
  | NotGeneratedOutcome
  | AlreadyPaidOutcome
  | NotFoundOutcome;

/** Outcomes NBBL/COU can return (biller outcomes + NBBL-produced BILLER_UNAVAILABLE). */
export type FetchOutcome = BillerFetchOutcome | BillerUnavailableOutcome;

/**
 * Response-code mapping (fixed):
 *   BILL_DUE → 000 · NOT_GENERATED → BFR001 · ALREADY_PAID → BFR001 · NOT_FOUND → BFR002
 *   BILLER_UNAVAILABLE → SYS500 (biller threw) or BFR003 (biller not registered)
 */
export interface ResponseMeta {
  responseCode: ResponseCode;
  message: string;
}

// ─── Biller (BOU-facing) ─────────────────────────────────────────────────────

/** NBBL → Biller: `POST /api/biller/bbps/fetch`, `biller/api.fetchBill`. */
export interface BillerFetchRequest {
  /** NBBL FETCH txn ref (`F-…`), for the biller's logs. */
  nbblRef: string;
  billerId: string;
  /** Raw as typed; the biller normalises it again. */
  vehicleNo: string;
  /** 10 digits. */
  mobile: string;
}

export type BillerFetchResponse = BillerFetchOutcome & ResponseMeta;

/** NBBL → Biller: `POST /api/biller/bbps/payment-advice`, `biller/api.paymentAdvice`. */
export interface PaymentAdvice {
  billerId: string;
  presentmentId: string;
  amountPaise: Paise;
  bbpsTxnRef: string;
  mode: PaymentMode;
  /** When NBBL accepted the payment. */
  paidAt: IsoDateTime;
}

/**
 * Biller → NBBL acknowledgement.
 * - ok (`000`): receivables PAID, payment inserted, OEM bills marked paid; `receipt` set.
 * - same bbpsTxnRef again: the SAME ack is returned (idempotent).
 * - `BPR001` amount mismatch, `BPR002` already paid by another ref: `ack=false`, `receipt` null.
 */
export interface PaymentAdviceAck extends ResponseMeta {
  ack: boolean;
  bbpsTxnRef: string;
  presentmentId: string;
  billerPaymentId: string | null;
  receipt: Receipt | null;
}

/** `POST /api/biller/sync` request/response. */
export interface BillerSyncRequest {
  billerId: string;
}
export interface BillerSyncResponse {
  /** Receivables created or updated from OEM bills. */
  synced: number;
}

export interface BillerCustomerRow {
  id: string;
  name: string;
  /** `98XXXXXX01`. */
  mobileMasked: string;
  vehicleRegNo: string;
  contractId: string;
  /** Sum of UNPAID/OVERDUE receivable totals + late fees. */
  outstandingPaise: Paise;
}

export interface BillerReceivableRow {
  id: string;
  customerId: string;
  customerName: string;
  vehicleRegNo: string;
  oemBillId: string;
  cycle: Cycle;
  subtotalPaise: Paise;
  gstPaise: Paise;
  totalPaise: Paise;
  lateFeePaise: Paise;
  dueDate: IsoDate;
  status: ReceivableStatus;
  syncedAt: IsoDateTime;
  paidPaymentId: string | null;
}

export interface BillerPaymentRow {
  id: string;
  presentmentId: string;
  customerName: string;
  vehicleRegNo: string;
  bbpsTxnRef: string;
  amountPaise: Paise;
  mode: PaymentMode;
  paidAt: IsoDateTime;
}

/** `GET /api/biller/overview?billerId=` */
export interface BillerOverview {
  biller: { id: string; name: string; category: Category };
  kpis: {
    /** UNPAID + OVERDUE totals incl. late fees. */
    receivablesDuePaise: Paise;
    collectedPaise: Paise;
    overdueCount: number;
    customers: number;
  };
  customers: BillerCustomerRow[];
  /** Newest cycle first. */
  receivables: BillerReceivableRow[];
  /** Newest first. */
  payments: BillerPaymentRow[];
}

// ─── NBBL (switch) ───────────────────────────────────────────────────────────

/** NBBL registry entry. `GET /api/nbbl/billers?category=`, `GET /api/cou/billers?category=`. */
export interface BillerSummary {
  id: string;
  name: string;
  category: Category;
  status: "ACTIVE" | "INACTIVE";
}

/** Customer parameters for EV_BAAS (docs/DOMAIN.md §5). */
export interface CustomerParams {
  vehicleRegNo: string;
  registeredMobile: string;
}

/** COU → NBBL: `POST /api/nbbl/bill-fetch`. */
export interface BillFetchRequest {
  /** COU id, `DEMOPAY` for the prototype. */
  couId: string;
  billerId: string;
  category: Category;
  customerParams: CustomerParams;
}

/** NBBL → COU. `fetchRef` is the NBBL FETCH txn ref (`F-` + 10 [A-Z0-9]); always present. */
export type BillFetchResponse = FetchOutcome & ResponseMeta & { fetchRef: string };

/** COU → NBBL: `POST /api/nbbl/bill-pay`. */
export interface BillPaymentRequest {
  couId: string;
  /** Must be a FETCH txn with responseCode 000 (BILL_DUE), else BPR002. */
  fetchRef: string;
  amountPaise: Paise;
  mode: PaymentMode;
  /** DemoPay order id, for correlation in NBBL events. */
  couOrderId: string;
}

/** NBBL → COU. `bbpsTxnRef` is the PAY txn ref (`BC…`); null only if NBBL rejected before issuing one. */
export interface BillPaymentResponse extends ResponseMeta {
  status: "SUCCESS" | "FAILED";
  bbpsTxnRef: string | null;
  receipt: Receipt | null;
}

/** One NBBL transaction (FETCH or PAY). NBBL never stores bill data — only amounts and masked refs. */
export interface NbblTxn {
  /** FETCH: `F-XXXXXXXXXX`; PAY: the bbpsTxnRef `BCXXXXXXXXXX`. */
  ref: string;
  type: NbblTxnType;
  couId: string;
  billerId: string;
  category: Category;
  /** e.g. `MH01AB1001 / 98XXXXXX01`. */
  customerRefMasked: string;
  /** FETCH: presented amount (if BILL_DUE); PAY: paid amount. */
  amountPaise: Paise | null;
  status: NbblTxnStatus;
  responseCode: ResponseCode | null;
  /** PAY only: the FETCH ref it paid. */
  fetchRef: string | null;
  /** Biller's reference: presentmentId (FETCH with BILL_DUE, and PAY). */
  billerRef: string | null;
  createdAt: IsoDateTime;
  completedAt: IsoDateTime | null;
  latencyMs: number | null;
}

export interface NbblEvent {
  id: number;
  txnRef: string;
  step: NbblEventStep;
  /** Request/response JSON as it crossed the hop; mobiles MUST be masked. */
  payload: JsonValue;
  at: IsoDateTime;
}

/** `GET /api/nbbl/transactions/:ref`. Events oldest first. */
export type NbblTxnDetail = NbblTxn & { events: NbblEvent[] };

/** `GET /api/nbbl/stats`. */
export interface NbblStats {
  fetches: number;
  payments: number;
  /** 0..1 across all txns with a final status. Not money, so a float is fine. */
  successRate: number;
  /** Sum of SUCCESS PAY amounts. */
  valuePaise: Paise;
}

export interface NbblTxnQuery {
  type?: NbblTxnType;
  /** Default 50, max 200. Newest first. */
  limit?: number;
}

// ─── COU (DemoPay) ───────────────────────────────────────────────────────────

/** Customer app → COU: `POST /api/cou/fetch`. */
export interface CouFetchRequest {
  billerId: string;
  /** As typed; COU normalises (uppercase, strip spaces/dashes) before sending. */
  vehicleNo: string;
  /** 10 digits, no +91. */
  mobile: string;
}

/** COU → customer app. Identical to what NBBL returned (COU passes it through). */
export type FetchResult = BillFetchResponse;

/** Customer app → COU: `POST /api/cou/pay`. */
export interface CouPayRequest {
  fetchRef: string;
  amountPaise: Paise;
  mode: PaymentMode;
  /** Demo: mock UPI declines; cou_payments FAILED; NBBL is NOT called. */
  simulateFailure?: boolean;
}

/**
 * COU → customer app.
 * failureReason: PAYMENT_DECLINED (simulated mock-UPI failure, no NBBL call),
 * BBPS_REJECTED (NBBL/biller returned a non-000 code, see responseCode),
 * BILLER_UNAVAILABLE (SYS500).
 */
export type PayResult =
  | {
      status: "SUCCESS";
      couOrderId: string;
      responseCode: "000";
      receipt: Receipt;
    }
  | {
      status: "FAILED";
      couOrderId: string;
      failureReason: "PAYMENT_DECLINED" | "BBPS_REJECTED" | "BILLER_UNAVAILABLE";
      responseCode: ResponseCode | null;
      bbpsTxnRef: string | null;
      message: string;
    };

// ─── OEM ─────────────────────────────────────────────────────────────────────

export interface OemPlan {
  id: string;
  name: string;
  fixedFeePaise: Paise;
  ratePaisePerKm: Paise;
}

/** Bill number format: `OEM-<YYYYMM>-<regNo>`, e.g. `OEM-202608-MH01AB1001`. */
export interface OemBill {
  id: string;
  billNo: string;
  vehicleId: string;
  regNo: string;
  planId: string;
  cycle: Cycle;
  kmDriven: Km;
  /** Snapshot of the plan at generation time. */
  fixedFeePaise: Paise;
  ratePaisePerKm: Paise;
  /** kmDriven × ratePaisePerKm. */
  variablePaise: Paise;
  /** fixed + variable. */
  subtotalPaise: Paise;
  /** 18% of subtotal, half-up. */
  gstPaise: Paise;
  /** subtotal + GST. */
  totalPaise: Paise;
  billDate: IsoDate;
  dueDate: IsoDate;
  paymentStatus: OemPaymentStatus;
  paidRef: string | null;
  paidAt: IsoDateTime | null;
}

/** `GET /api/oem/vehicles` row. */
export interface OemVehicleRow {
  id: string;
  regNo: string;
  vin: string;
  model: string;
  planId: string;
  planName: string;
  fixedFeePaise: Paise;
  ratePaisePerKm: Paise;
  odometerKm: Km;
  activatedOn: IsoDate;
  /** The current calendar month `YYYY-MM`. */
  currentCycle: Cycle;
  /** Sum of trips recorded in the current cycle. */
  kmThisCycle: Km;
  /** Most recent bill (by cycle), or null. */
  lastBill: {
    id: string;
    billNo: string;
    cycle: Cycle;
    totalPaise: Paise;
    paymentStatus: OemPaymentStatus;
  } | null;
}

/** `POST /api/oem/vehicles/:id/trips`. `km` is a positive integer. */
export interface AddTripRequest {
  km: Km;
}

/** `POST /api/oem/bills/generate`. */
export interface GenerateBillsRequest {
  cycle: Cycle;
  /** Optional: bill only these OEM vehicle ids (the console's per-row "Generate bill"). Omitted = all eligible vehicles. */
  vehicleIds?: string[];
}
export interface GenerateBillsResponse {
  generated: OemBill[];
}

/** `oem/api.markPaid` result. */
export interface MarkPaidResponse {
  updated: number;
}

// ─── Admin (DB explorer) ─────────────────────────────────────────────────────

/** `GET /api/admin/tables` row. */
export interface AdminTableSummary {
  party: Party;
  table: string;
  rows: number;
}

/** `GET /api/admin/tables/:name` (whitelisted names only, newest first, max 100 rows). */
export interface AdminTableRows {
  party: Party;
  table: string;
  columns: string[];
  rows: Record<string, JsonValue>[];
}

export interface ResetResponse {
  ok: true;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

/**
 * Every non-2xx API response body. Business outcomes (NOT_FOUND bill, BPR001, payment
 * declined…) are NOT errors: they return 200 with a FetchResult / PayResult / ack.
 * Errors are for bad input (400 `BAD_REQUEST`), unknown resource (404 `NOT_FOUND`),
 * and unexpected failures (500 `INTERNAL`).
 */
export interface ApiErrorBody {
  error: { code: string; message: string };
}

// ─── Complaints (Phase C, docs/COMPLAINTS_PLAN.md) ───────────────────────────
//
// A customer raises a complaint in the COU (DemoPay) against one of their orders (a
// `cou_payments` row). The COU keeps a ticket (`DPT-` + 8 [A-Z0-9]) and NBBL opens a BBPS
// complaint (`CC` + 10 [A-Z0-9]). NBBL is the system of record for status, assignee
// ("pending with") and the timeline. Pure rules (SLA, triage, transitions) live in
// src/lib/domain/complaints.ts.

/** Why the customer is complaining. */
export type ComplaintReason =
  | "DUPLICATE_PAYMENT"
  | "DEBITED_TXN_FAILED"
  | "PAID_BILL_PENDING"
  | "WRONG_AMOUNT"
  | "OTHER";

/** Runtime list of every `ComplaintReason`, in the order the COU shows them. */
export const COMPLAINT_REASONS: readonly ComplaintReason[] = [
  "DEBITED_TXN_FAILED",
  "PAID_BILL_PENDING",
  "DUPLICATE_PAYMENT",
  "WRONG_AMOUNT",
  "OTHER",
];

/** Customer-facing labels (COU radios, NBBL table). */
export const COMPLAINT_REASON_LABELS: Record<ComplaintReason, string> = {
  DUPLICATE_PAYMENT: "Duplicate payment",
  DEBITED_TXN_FAILED: "Payment deducted but transaction failed",
  PAID_BILL_PENDING: "Payment successful but bill still pending",
  WRONG_AMOUNT: "Wrong amount charged",
  OTHER: "Something else",
};

/** Ticket status. */
export type ComplaintStatus = "OPEN" | "CLOSED";
export const COMPLAINT_STATUSES: readonly ComplaintStatus[] = ["OPEN", "CLOSED"];

/** The party a complaint is currently pending with. */
export type ComplaintParty = "COU" | "NBBL" | "BILLER";
export const COMPLAINT_PARTIES: readonly ComplaintParty[] = ["COU", "NBBL", "BILLER"];

/**
 * Generic labels. For BILLER, prefer the complaint's `billerName` ("Pending with Bajaj Finance")
 * and fall back to this label only when `billerName` is null.
 */
export const COMPLAINT_PARTY_LABELS: Record<ComplaintParty, string> = {
  COU: "DemoPay",
  NBBL: "Bharat Connect",
  BILLER: "Biller",
};

/** How a CLOSED complaint was resolved. */
export type ComplaintResolution = "RESOLVED" | "REJECTED" | "REFUNDED";
export const COMPLAINT_RESOLUTIONS: readonly ComplaintResolution[] = ["RESOLVED", "REJECTED", "REFUNDED"];
export const COMPLAINT_RESOLUTION_LABELS: Record<ComplaintResolution, string> = {
  RESOLVED: "Resolved",
  REJECTED: "Rejected",
  REFUNDED: "Refunded",
};

/** Timeline event kinds (`nbbl_complaint_events.action`). */
export type ComplaintActionKind = "RAISED" | "ASSIGNED" | "NOTE" | "CLOSED" | "REOPENED";

/** What an NBBL operator can do to a complaint (`POST /api/nbbl/complaints/:id/actions`). */
export type ComplaintActionType = "ASSIGN" | "NOTE" | "CLOSE" | "REOPEN";
export const COMPLAINT_ACTION_TYPES: readonly ComplaintActionType[] = ["ASSIGN", "NOTE", "CLOSE", "REOPEN"];

/** One COU order (a `cou_payments` row) the customer can complain about. `GET /api/cou/orders`. */
export interface CouOrder {
  /** `DP-` + 10 [A-Z0-9] (seed: `DP-SEED00000n`). */
  orderId: string;
  fetchRef: string;
  /** Null when NBBL never issued a PAY ref (e.g. mock UPI declined). */
  bbpsTxnRef: string | null;
  /** Null when the COU never learnt it (only filled on success unless seeded). */
  billerId: string | null;
  /** Resolved from the NBBL registry; null when billerId is null or unknown. */
  billerName: string | null;
  vehicleRegNo: string | null;
  amountPaise: Paise;
  mode: PaymentMode;
  status: CouPaymentStatus;
  createdAt: IsoDateTime;
}

/** Customer app → COU: `POST /api/cou/complaints`. */
export interface RaiseComplaintRequest {
  orderId: string;
  reason: ComplaintReason;
  /** Optional free text, max 280 chars (`COMPLAINT_DESCRIPTION_MAX`). */
  description?: string;
}

/**
 * A ticket as the customer sees it (`POST`/`GET /api/cou/complaints`): the COU's own row
 * merged with live status from NBBL. `overdue` = OPEN and now > dueAt.
 */
export interface CouComplaint {
  /** COU ticket `DPT-` + 8 [A-Z0-9]. */
  ticketNo: string;
  /** NBBL (BBPS) complaint id `CC` + 10 [A-Z0-9]. */
  complaintId: string;
  // Order summary
  orderId: string;
  bbpsTxnRef: string | null;
  billerId: string | null;
  billerName: string | null;
  vehicleRegNo: string | null;
  amountPaise: Paise;
  // Complaint
  reason: ComplaintReason;
  description: string | null;
  status: ComplaintStatus;
  pendingWith: ComplaintParty;
  resolution: ComplaintResolution | null;
  dueAt: IsoDateTime;
  overdue: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  closedAt: IsoDateTime | null;
}

/** A BBPS complaint at NBBL (`GET /api/nbbl/complaints`). Customer refs are masked only. */
export interface NbblComplaint {
  /** `CC` + 10 [A-Z0-9]. */
  complaintId: string;
  couId: string;
  couTicketNo: string;
  /** The COU order id the complaint is about. */
  orderId: string;
  /** The PAY txn (bbpsTxnRef) it is about; null when NBBL never saw a payment. */
  txnRef: string | null;
  billerId: string | null;
  billerName: string | null;
  /** From the linked PAY txn (`MH01AB1003 / 98XXXXXX03`), else the vehicle reg no, else null. */
  customerRefMasked: string | null;
  amountPaise: Paise;
  reason: ComplaintReason;
  description: string | null;
  status: ComplaintStatus;
  pendingWith: ComplaintParty;
  resolution: ComplaintResolution | null;
  /** createdAt + SLA days for the reason (see complaints.ts `dueAt`). */
  dueAt: IsoDateTime;
  /** Derived at read time: OPEN and now > dueAt. */
  overdue: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  closedAt: IsoDateTime | null;
}

/** One entry on a complaint's timeline (`nbbl_complaint_events`). */
export interface NbblComplaintEvent {
  id: number;
  complaintId: string;
  action: ComplaintActionKind;
  /** ASSIGNED: previous party (null on the initial triage). CLOSED: the party it was pending with. Else null. */
  fromParty: ComplaintParty | null;
  /** ASSIGNED: new party. REOPENED: NBBL. Else null. */
  toParty: ComplaintParty | null;
  /** `DEMOPAY` (the COU id) for RAISED, `SYSTEM` for auto-triage, `NBBL_OPS` for console actions. */
  actor: string;
  note: string | null;
  at: IsoDateTime;
}

/** `GET /api/nbbl/complaints/:id`. Events oldest first; linkedTxn = the PAY txn at txnRef, if any. */
export type NbblComplaintDetail = NbblComplaint & {
  events: NbblComplaintEvent[];
  linkedTxn: NbblTxn | null;
};

/** `GET /api/nbbl/complaints?status=&pendingWith=`. Newest first. */
export interface NbblComplaintQuery {
  status?: ComplaintStatus;
  pendingWith?: ComplaintParty;
}

/**
 * NBBL console → `POST /api/nbbl/complaints/:id/actions`.
 * - ASSIGN: needs `assignTo` (≠ current pendingWith); OPEN only.
 * - NOTE:   needs a non-empty `note`; any status.
 * - CLOSE:  needs `resolution`; OPEN only; optional `note`.
 * - REOPEN: CLOSED only; resets pendingWith to NBBL; optional `note`.
 * Invalid transition → 409 `INVALID_TRANSITION`; missing/invalid field → 400 `BAD_REQUEST`.
 */
export interface ComplaintActionRequest {
  action: ComplaintActionType;
  assignTo?: ComplaintParty;
  resolution?: ComplaintResolution;
  /** Max 500 chars (`COMPLAINT_NOTE_MAX`). */
  note?: string;
  /** Defaults to `NBBL_OPS`. */
  actor?: string;
}

/** `GET /api/nbbl/complaints/stats`. `byParty` counts OPEN complaints only. */
export interface NbblComplaintStats {
  total: number;
  open: number;
  /** OPEN and past dueAt. */
  overdue: number;
  closed: number;
  byParty: Record<ComplaintParty, number>;
}

/**
 * COU → NBBL (server-side, `nbbl/api.raiseComplaint`). The COU sends what it knows about the
 * order; NBBL looks up the PAY txn by `bbpsTxnRef`, masks the customer, triages and sets the SLA.
 * Idempotent: an OPEN complaint for the same (couId, orderId, reason) is returned as is.
 */
export interface NbblRaiseComplaintRequest {
  couId: string;
  /** The COU ticket number (`DPT-…`) the COU generated for this complaint. */
  couTicketNo: string;
  orderId: string;
  bbpsTxnRef: string | null;
  billerId: string | null;
  vehicleRegNo: string | null;
  amountPaise: Paise;
  reason: ComplaintReason;
  description?: string;
}
