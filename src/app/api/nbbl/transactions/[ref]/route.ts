import { handle, HttpError } from "../../_http";
import { getTransaction } from "@/lib/parties/nbbl/api";

export const dynamic = "force-dynamic";

export function GET(_req: Request, ctx: { params: Promise<{ ref: string }> }) {
  return handle(async () => {
    const { ref } = await ctx.params;
    const t = await getTransaction(ref);
    if (!t) throw new HttpError(404, "NOT_FOUND", "Transaction not found");
    return t;
  });
}
