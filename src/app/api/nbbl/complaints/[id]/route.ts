import { handle, HttpError } from "../../_http";
import { getComplaint } from "@/lib/parties/nbbl/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const c = await getComplaint(id);
    if (!c) throw new HttpError(404, "NOT_FOUND", "Complaint not found");
    return c;
  });
}
