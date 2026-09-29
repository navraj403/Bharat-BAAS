import { handle, readJson, str, badRequest } from "../_http";
import { billFetch } from "@/lib/parties/nbbl/api";

export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return handle(async () => {
    const b = await readJson(req);
    const p = b.customerParams as Record<string, unknown> | undefined;
    if (!p || typeof p !== "object") throw badRequest("customerParams is required");
    return billFetch({
      couId: str(b.couId, "couId"),
      billerId: str(b.billerId, "billerId"),
      category: "EV_BAAS",
      customerParams: {
        vehicleRegNo: str(p.vehicleRegNo, "vehicleRegNo"),
        registeredMobile: str(p.registeredMobile, "registeredMobile"),
      },
    });
  });
}
