import { NextResponse } from "next/server";
import type { ApiErrorBody } from "@/lib/domain/types";
import { OemError } from "@/lib/parties/oem/service";

export function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json<ApiErrorBody>({ error: { code, message } }, { status });
}

/** Maps thrown errors to the `{error:{code,message}}` contract (400 / 404 / 500). */
export function handleError(e: unknown) {
  if (e instanceof OemError) {
    return errorResponse(e.code === "NOT_FOUND" ? 404 : 400, e.code, e.message);
  }
  console.error("[oem]", e);
  return errorResponse(500, "INTERNAL", "Unexpected error");
}

/** Parses a JSON object body, or null when missing or malformed. */
export async function readJsonObject(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const v: unknown = await req.json();
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
