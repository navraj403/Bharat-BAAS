import { handle, readJson } from "../../nbbl/_http";
import { listComplaints, raiseComplaint } from "@/lib/parties/cou/api";
import type { ComplaintReason } from "@/lib/domain/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function GET() {
  return handle(() => listComplaints());
}

export function POST(req: Request) {
  return handle(async () => {
    const b = await readJson(req);
    // Field validation (reason, description length, unknown order) lives in cou/api.
    return raiseComplaint({
      orderId: typeof b.orderId === "string" ? b.orderId : "",
      reason: b.reason as ComplaintReason,
      description: b.description as string | undefined,
    });
  });
}
