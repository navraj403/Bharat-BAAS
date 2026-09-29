import { handle } from "../_http";
import { stats } from "@/lib/parties/nbbl/api";

export const dynamic = "force-dynamic";

export function GET() {
  return handle(() => stats());
}
