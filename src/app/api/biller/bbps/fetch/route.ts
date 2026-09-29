import { NextResponse } from "next/server";
import { fetchBill } from "@/lib/parties/biller/api";
import { errorResponse, handleError, isStr, readJsonObject } from "../../_http";

export const dynamic = "force-dynamic";

/** BOU-facing fetch (called by NBBL). Business outcomes (incl. NOT_FOUND) are HTTP 200. */
export async function POST(req: Request) {
  try {
    const b = await readJsonObject(req);
    if (!b || !isStr(b.billerId) || typeof b.vehicleNo !== "string" || typeof b.mobile !== "string") {
      return errorResponse(400, "BAD_REQUEST", "Body must be {nbblRef, billerId, vehicleNo, mobile}");
    }
    const nbblRef = typeof b.nbblRef === "string" ? b.nbblRef : "";
    return NextResponse.json(
      await fetchBill({ nbblRef, billerId: b.billerId, vehicleNo: b.vehicleNo, mobile: b.mobile }),
    );
  } catch (e) {
    return handleError(e);
  }
}
