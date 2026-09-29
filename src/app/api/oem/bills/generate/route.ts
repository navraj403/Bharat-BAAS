import { NextResponse } from "next/server";
import { generateBills } from "@/lib/parties/oem/api";
import { errorResponse, handleError, readJsonObject } from "../../_http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = await readJsonObject(req);
    if (!body || typeof body.cycle !== "string" || !/^\d{4}-\d{2}$/.test(body.cycle)) {
      return errorResponse(400, "BAD_REQUEST", "Body must be {cycle: 'YYYY-MM', vehicleIds?: string[]}");
    }
    const ids = body.vehicleIds;
    if (ids !== undefined && (!Array.isArray(ids) || ids.some((x) => typeof x !== "string"))) {
      return errorResponse(400, "BAD_REQUEST", "vehicleIds must be an array of strings");
    }
    return NextResponse.json(await generateBills(body.cycle, ids as string[] | undefined));
  } catch (e) {
    return handleError(e);
  }
}
