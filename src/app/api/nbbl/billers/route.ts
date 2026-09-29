import { handle, badRequest } from "../_http";
import { listBillers } from "@/lib/parties/nbbl/api";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handle(async () => {
    const c = new URL(req.url).searchParams.get("category");
    if (c && c !== "EV_BAAS") throw badRequest("Unknown category");
    return listBillers(c === "EV_BAAS" ? "EV_BAAS" : undefined);
  });
}
