import { NextResponse } from "next/server";
import { addTrip } from "@/lib/parties/oem/api";
import { errorResponse, handleError, readJsonObject } from "../../../_http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await readJsonObject(req);
    if (!body || typeof body.km !== "number") {
      return errorResponse(400, "BAD_REQUEST", "Body must be {km: number}");
    }
    return NextResponse.json(await addTrip(id, body.km));
  } catch (e) {
    return handleError(e);
  }
}
