import { handle } from "../../nbbl/_http";
import { listTables } from "@/lib/parties/admin/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function GET() {
  return handle(() => listTables());
}
