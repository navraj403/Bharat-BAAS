import { NextResponse } from "next/server";
import { sync } from "@/lib/parties/biller/api";
import { errorResponse, handleError, isStr, readJsonObject } from "../_http";

export const dynamic = "force-dynamic";

/** `POST /api/biller/sync {billerId}` → {synced} (unknown biller → 404). */
export async function POST(req: Request) {
  try {
    const b = await readJsonObject(req);
    if (!b || !isStr(b.billerId)) return errorResponse(400, "BAD_REQUEST", "Body must be {billerId}");
    return NextResponse.json(await sync(b.billerId));
  } catch (e) {
    return handleError(e);
  }
}
