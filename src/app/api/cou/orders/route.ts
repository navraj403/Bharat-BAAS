import { handle } from "../../nbbl/_http";
import { listOrders } from "@/lib/parties/cou/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function GET() {
  return handle(() => listOrders());
}
