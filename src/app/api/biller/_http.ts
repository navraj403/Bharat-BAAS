/** Shared helpers for the biller's thin route handlers. Owner: agent B. */
import { NextResponse } from "next/server";
import type { ApiErrorBody } from "@/lib/domain/types";
import { UnknownBillerError } from "@/lib/parties/biller/errors";

export function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json<ApiErrorBody>({ error: { code, message } }, { status });
}

/** Parses the body as a JSON object, or null if it is not one. */
export async function readJsonObject(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const v: unknown = await req.json();
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function handleError(e: unknown) {
  if (e instanceof UnknownBillerError) return errorResponse(404, "NOT_FOUND", e.message);
  console.error("[api/biller]", e);
  return errorResponse(500, "INTERNAL", "Unexpected biller error");
}

export const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
