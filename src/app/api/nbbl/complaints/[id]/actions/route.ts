import { handle, readJson } from "../../../_http";
import { complaintAction } from "@/lib/parties/nbbl/api";
import type { ComplaintActionRequest } from "@/lib/domain/types";
import { ACTOR_NBBL_OPS } from "@/lib/domain/complaints";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const b = await readJson(req);
    // applyAction validates action/assignTo/resolution/note (400) and the transition (409).
    // The console is the only caller: the actor is always NBBL_OPS, never taken from the body.
    const { actor: _ignored, ...rest } = b;
    void _ignored;
    return complaintAction(id, { ...(rest as unknown as ComplaintActionRequest), actor: ACTOR_NBBL_OPS });
  });
}
