import { handle } from "../../nbbl/_http";
import { listTables } from "@/lib/parties/admin/api";

export const dynamic = "force-dynamic";

export function GET() {
  return handle(() => listTables());
}
