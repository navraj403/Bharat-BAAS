import { NextResponse } from "next/server";
import { getBillsByRegNo, listBills } from "@/lib/parties/oem/api";
import { handleError } from "../_http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const regNo = new URL(req.url).searchParams.get("regNo");
    return NextResponse.json(regNo ? await getBillsByRegNo(regNo) : await listBills());
  } catch (e) {
    return handleError(e);
  }
}
