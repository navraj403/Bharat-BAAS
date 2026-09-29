/**
 * Typed browser client for every route in BUILD_PLAN §6.5. UI code (client or server components)
 * calls ONLY these functions, never `fetch` directly.
 *
 * - With `NEXT_PUBLIC_USE_FIXTURES=1` every call is served by the in-memory fixtures in
 *   ./fixtures.ts (with a small artificial delay) and never touches the network or the DB.
 * - Otherwise it calls the route handlers on the same origin. Non-2xx responses throw `ApiError`
 *   with the server's `{error:{code,message}}`. Business outcomes (NOT_FOUND bill, declined
 *   payment, BPR codes…) are NOT errors: they resolve normally (see FetchResult / PayResult).
 *
 * Paths are relative (`/api/...`), so from a Server Component prefer calling the party
 * `api.ts` directly; this module is primarily for the browser.
 */
import type {
  AdminTableRows,
  AdminTableSummary,
  ApiErrorBody,
  BillFetchRequest,
  BillFetchResponse,
  BillPaymentRequest,
  BillPaymentResponse,
  BillerFetchRequest,
  BillerFetchResponse,
  BillerOverview,
  BillerSummary,
  BillerSyncResponse,
  Category,
  CouFetchRequest,
  CouPayRequest,
  Cycle,
  FetchResult,
  GenerateBillsResponse,
  Km,
  NbblStats,
  NbblTxn,
  NbblTxnDetail,
  NbblTxnQuery,
  OemBill,
  OemVehicleRow,
  PayResult,
  PaymentAdvice,
  PaymentAdviceAck,
  ResetResponse,
} from "@/lib/domain/types";
import * as fx from "./fixtures";

/** True when the UI should use local fixtures instead of the API. */
export const USE_FIXTURES = process.env.NEXT_PUBLIC_USE_FIXTURES === "1";

/** Thrown for any non-2xx API response (or a network failure: code `NETWORK`). */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

function isApiErrorBody(v: unknown): v is ApiErrorBody {
  if (typeof v !== "object" || v === null || !("error" in v)) return false;
  const e = (v as { error: unknown }).error;
  return typeof e === "object" && e !== null && "code" in e && "message" in e;
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch (err) {
    throw new ApiError("NETWORK", err instanceof Error ? err.message : "Network error", 0);
  }
  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    if (isApiErrorBody(data)) throw new ApiError(data.error.code, data.error.message, res.status);
    throw new ApiError(`HTTP_${res.status}`, res.statusText || "Request failed", res.status);
  }
  return data as T;
}

/** Runs a fixture producer after a short delay; errors become ApiError like the real API. */
async function fixture<T>(produce: () => T, notFoundIfNull = false): Promise<T> {
  await fx.fixtureDelay();
  let value: T;
  try {
    value = produce();
  } catch (err) {
    throw new ApiError("BAD_REQUEST", err instanceof Error ? err.message : "Bad request", 400);
  }
  if (notFoundIfNull && value === null) throw new ApiError("NOT_FOUND", "Not found", 404);
  return value;
}

function qs(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter((e): e is [string, string | number] => e[1] !== undefined);
  if (entries.length === 0) return "";
  return "?" + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

// ─── COU (customer app) ──────────────────────────────────────────────────────

/** `GET /api/cou/billers?category=` */
export function getCouBillers(category: Category = "EV_BAAS"): Promise<BillerSummary[]> {
  if (USE_FIXTURES) return fixture(() => fx.fixtureBillers(category));
  return request("GET", `/api/cou/billers${qs({ category })}`);
}

/** `POST /api/cou/fetch` → BILL_DUE | NOT_GENERATED | ALREADY_PAID | NOT_FOUND | BILLER_UNAVAILABLE */
export function couFetch(req: CouFetchRequest): Promise<FetchResult> {
  if (USE_FIXTURES) return fixture(() => fx.fixtureFetch(req));
  return request("POST", "/api/cou/fetch", req);
}

/** `POST /api/cou/pay` */
export function couPay(req: CouPayRequest): Promise<PayResult> {
  if (USE_FIXTURES) return fixture(() => fx.fixturePay(req));
  return request("POST", "/api/cou/pay", req);
}

// ─── NBBL (switch) ───────────────────────────────────────────────────────────

/** `GET /api/nbbl/billers?category=` */
export function getNbblBillers(category?: Category): Promise<BillerSummary[]> {
  if (USE_FIXTURES) return fixture(() => fx.fixtureBillers(category));
  return request("GET", `/api/nbbl/billers${qs({ category })}`);
}

/** `POST /api/nbbl/bill-fetch` (normally called server-side by the COU). */
export function nbblBillFetch(req: BillFetchRequest): Promise<BillFetchResponse> {
  if (USE_FIXTURES) return fixture(() => fx.fixtureBillFetch(req));
  return request("POST", "/api/nbbl/bill-fetch", req);
}

/** `POST /api/nbbl/bill-pay` (normally called server-side by the COU). */
export function nbblBillPay(req: BillPaymentRequest): Promise<BillPaymentResponse> {
  if (USE_FIXTURES) return fixture(() => fx.fixtureBillPay(req));
  return request("POST", "/api/nbbl/bill-pay", req);
}

/** `GET /api/nbbl/transactions?type=&limit=` (newest first) */
export function getNbblTransactions(query?: NbblTxnQuery): Promise<NbblTxn[]> {
  if (USE_FIXTURES) return fixture(() => fx.fixtureTransactions(query));
  return request("GET", `/api/nbbl/transactions${qs({ type: query?.type, limit: query?.limit })}`);
}

/** `GET /api/nbbl/transactions/:ref` (404 → ApiError NOT_FOUND) */
export function getNbblTransaction(ref: string): Promise<NbblTxnDetail> {
  if (USE_FIXTURES) return fixture(() => fx.fixtureTransaction(ref), true) as Promise<NbblTxnDetail>;
  return request("GET", `/api/nbbl/transactions/${encodeURIComponent(ref)}`);
}

/** `GET /api/nbbl/stats` */
export function getNbblStats(): Promise<NbblStats> {
  if (USE_FIXTURES) return fixture(() => fx.fixtureStats());
  return request("GET", "/api/nbbl/stats");
}

// ─── Biller ──────────────────────────────────────────────────────────────────

/** `POST /api/biller/bbps/fetch` (BOU-facing; normally called by NBBL). */
export function billerBbpsFetch(req: BillerFetchRequest): Promise<BillerFetchResponse> {
  if (USE_FIXTURES) {
    return fixture(() => {
      const r = fx.fixtureFetch({ billerId: req.billerId, vehicleNo: req.vehicleNo, mobile: req.mobile });
      if (r.result === "BILLER_UNAVAILABLE") throw new Error("Biller unavailable");
      // Strip NBBL's fetchRef: the biller response has no NBBL ref.
      const { fetchRef, ...rest } = r;
      void fetchRef;
      return rest;
    });
  }
  return request("POST", "/api/biller/bbps/fetch", req);
}

/** `POST /api/biller/bbps/payment-advice` (BOU-facing; normally called by NBBL). */
export function billerPaymentAdvice(advice: PaymentAdvice): Promise<PaymentAdviceAck> {
  if (USE_FIXTURES) {
    return fixture(() => ({
      ack: false,
      responseCode: "BPR002" as const,
      message: "Fixture mode: pay through couPay()",
      bbpsTxnRef: advice.bbpsTxnRef,
      presentmentId: advice.presentmentId,
      billerPaymentId: null,
      receipt: null,
    }));
  }
  return request("POST", "/api/biller/bbps/payment-advice", advice);
}

/** `GET /api/biller/overview?billerId=` */
export function getBillerOverview(billerId: string): Promise<BillerOverview> {
  if (USE_FIXTURES) return fixture(() => fx.fixtureBillerOverview(billerId));
  return request("GET", `/api/biller/overview${qs({ billerId })}`);
}

/** `POST /api/biller/sync {billerId}` */
export function billerSync(billerId: string): Promise<BillerSyncResponse> {
  if (USE_FIXTURES) return fixture(() => ({ synced: fx.fixtureBillerOverview(billerId).receivables.length }));
  return request("POST", "/api/biller/sync", { billerId });
}

// ─── OEM ─────────────────────────────────────────────────────────────────────

/** `GET /api/oem/vehicles` */
export function getOemVehicles(): Promise<OemVehicleRow[]> {
  if (USE_FIXTURES) return fixture(() => fx.fixtureVehicles());
  return request("GET", "/api/oem/vehicles");
}

/** `POST /api/oem/vehicles/:id/trips {km}` */
export function addOemTrip(vehicleId: string, km: Km): Promise<OemVehicleRow> {
  if (USE_FIXTURES) return fixture(() => fx.fixtureAddTrip(vehicleId, km));
  return request("POST", `/api/oem/vehicles/${encodeURIComponent(vehicleId)}/trips`, { km });
}

/** `POST /api/oem/bills/generate {cycle}` */
export function generateOemBills(cycle: Cycle): Promise<GenerateBillsResponse> {
  if (USE_FIXTURES) return fixture(() => fx.fixtureGenerateBills(cycle));
  return request("POST", "/api/oem/bills/generate", { cycle });
}

/** `GET /api/oem/bills?regNo=` (all bills when regNo is omitted) */
export function getOemBills(regNo?: string): Promise<OemBill[]> {
  if (USE_FIXTURES) return fixture(() => fx.fixtureBills(regNo));
  return request("GET", `/api/oem/bills${qs({ regNo })}`);
}

// ─── Admin (DB explorer) ─────────────────────────────────────────────────────

/** `GET /api/admin/tables` */
export function getAdminTables(): Promise<AdminTableSummary[]> {
  if (USE_FIXTURES) return fixture(() => fx.fixtureAdminTables());
  return request("GET", "/api/admin/tables");
}

/** `GET /api/admin/tables/:name` (404 → ApiError NOT_FOUND) */
export function getAdminTableRows(name: string): Promise<AdminTableRows> {
  if (USE_FIXTURES) return fixture(() => fx.fixtureAdminTableRows(name), true) as Promise<AdminTableRows>;
  return request("GET", `/api/admin/tables/${encodeURIComponent(name)}`);
}

/** `POST /api/admin/reset` (truncate + seed) */
export function adminReset(): Promise<ResetResponse> {
  if (USE_FIXTURES) {
    return fixture(() => {
      fx.fixtureReset();
      return { ok: true as const };
    });
  }
  return request("POST", "/api/admin/reset");
}
