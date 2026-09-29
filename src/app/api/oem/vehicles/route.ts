import { NextResponse } from "next/server";
import { listVehicles } from "@/lib/parties/oem/api";
import { handleError } from "../_http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await listVehicles());
  } catch (e) {
    return handleError(e);
  }
}
