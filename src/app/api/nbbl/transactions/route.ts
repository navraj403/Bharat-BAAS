import { handle, badRequest } from "../_http";
import { listTransactions } from "@/lib/parties/nbbl/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function GET(req: Request) {
  return handle(async () => {
    const sp = new URL(req.url).searchParams;
    const type = sp.get("type");
    if (type && type !== "FETCH" && type !== "PAY") throw badRequest("type must be FETCH or PAY");
    const l = sp.get("limit");
    const limit = l === null ? undefined : Number(l);
    if (limit !== undefined && !Number.isFinite(limit)) throw badRequest("limit must be a number");
    return listTransactions({ type: (type as "FETCH" | "PAY" | null) ?? undefined, limit });
  });
}
