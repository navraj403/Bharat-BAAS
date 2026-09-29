import { handle } from "../../nbbl/_http";
import { reset } from "@/lib/parties/admin/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function POST() {
  return handle(() => reset());
}
