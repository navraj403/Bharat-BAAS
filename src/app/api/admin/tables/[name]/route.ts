import { handle, HttpError } from "../../../nbbl/_http";
import { getTableRows } from "@/lib/parties/admin/api";

export const dynamic = "force-dynamic";

export function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  return handle(async () => {
    const { name } = await ctx.params;
    const t = await getTableRows(name);
    if (!t) throw new HttpError(404, "NOT_FOUND", "Unknown table");
    return t;
  });
}
