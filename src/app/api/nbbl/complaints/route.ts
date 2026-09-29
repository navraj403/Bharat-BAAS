import { handle } from "../_http";
import { listComplaints } from "@/lib/parties/nbbl/api";
import type { ComplaintParty, ComplaintStatus } from "@/lib/domain/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function GET(req: Request) {
  return handle(() => {
    const q = new URL(req.url).searchParams;
    // Junk values are rejected (400) by listComplaints' guards.
    return listComplaints({
      status: (q.get("status") || undefined) as ComplaintStatus | undefined,
      pendingWith: (q.get("pendingWith") || undefined) as ComplaintParty | undefined,
    });
  });
}
