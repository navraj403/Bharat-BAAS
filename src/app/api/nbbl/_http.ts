/** Shared route helpers for the nbbl/cou/admin API folders. */
import { NextResponse } from "next/server";
import { ComplaintError } from "@/lib/domain/complaints";
import { PAYMENT_MODES, type PaymentMode } from "@/lib/domain/types";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (m: string) => new HttpError(400, "BAD_REQUEST", m);

export function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Validate `mode` against the PaymentMode union or throw 400. */
export const paymentMode = (v: unknown): PaymentMode => {
  if (typeof v !== "string" || !(PAYMENT_MODES as readonly string[]).includes(v)) {
    throw badRequest(`mode must be one of ${PAYMENT_MODES.join(", ")}`);
  }
  return v as PaymentMode;
};

/** Parse a JSON object body or throw 400. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const b: unknown = await req.json();
    if (b && typeof b === "object" && !Array.isArray(b)) return b as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw badRequest("Request body must be a JSON object");
}

export const str = (v: unknown, name: string): string => {
  if (typeof v !== "string" || !v) throw badRequest(`${name} is required`);
  return v;
};

/** Run a handler; map HttpError to its status, anything else to 500 INTERNAL. */
export async function handle(fn: () => Promise<unknown>): Promise<Response> {
  try {
    return NextResponse.json(await fn());
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.status, e.code, e.message);
    if (e instanceof ComplaintError) return errorResponse(e.status, e.code, e.message);
    if (e instanceof Error && e.name === "BadRequestError") {
      return errorResponse(400, "BAD_REQUEST", e.message);
    }
    console.error(e);
    return errorResponse(500, "INTERNAL", "Internal error");
  }
}
