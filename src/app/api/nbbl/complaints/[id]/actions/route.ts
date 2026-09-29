import { handle, readJson } from "../../../_http";
import { complaintAction } from "@/lib/parties/nbbl/api";
import type { ComplaintActionRequest } from "@/lib/domain/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const b = await readJson(req);
    // applyAction validates action/assignTo/resolution/note (400) and the transition (409).
    return complaintAction(id, b as unknown as ComplaintActionRequest);
  });
}
