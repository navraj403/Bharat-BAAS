import { handle } from "../../_http";
import { complaintStats } from "@/lib/parties/nbbl/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function GET() {
  return handle(() => complaintStats());
}
