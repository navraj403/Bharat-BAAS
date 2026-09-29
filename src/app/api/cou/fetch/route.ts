import { handle, readJson } from "../../nbbl/_http";
import { fetchBill } from "@/lib/parties/cou/api";

export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return handle(async () => {
    const b = await readJson(req);
    return fetchBill({
      billerId: String(b.billerId ?? ""),
      vehicleNo: String(b.vehicleNo ?? ""),
      mobile: String(b.mobile ?? ""),
    });
  });
}
