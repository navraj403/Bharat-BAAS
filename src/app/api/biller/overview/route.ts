import { NextResponse, type NextRequest } from "next/server";
import { overview } from "@/lib/parties/biller/api";
import { errorResponse, handleError } from "../_http";

export const dynamic = "force-dynamic";

/** `GET /api/biller/overview?billerId=` → BillerOverview (unknown biller → 404). */
export async function GET(req: NextRequest) {
  try {
    const billerId = req.nextUrl.searchParams.get("billerId");
    if (!billerId) return errorResponse(400, "BAD_REQUEST", "Query param billerId is required");
    return NextResponse.json(await overview(billerId));
  } catch (e) {
    return handleError(e);
  }
}
