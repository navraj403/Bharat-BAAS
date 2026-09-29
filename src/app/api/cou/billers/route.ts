import { handle, badRequest } from "../../nbbl/_http";
import { listBillers } from "@/lib/parties/cou/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function GET(req: Request) {
  return handle(async () => {
    const c = new URL(req.url).searchParams.get("category") ?? "EV_BAAS";
    if (c !== "EV_BAAS") throw badRequest("Unknown category");
    return listBillers("EV_BAAS");
  });
}
