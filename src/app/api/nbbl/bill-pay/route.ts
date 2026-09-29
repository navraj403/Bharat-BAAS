import { handle, readJson, str, badRequest, paymentMode } from "../_http";
import { billPay } from "@/lib/parties/nbbl/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function POST(req: Request) {
  return handle(async () => {
    const b = await readJson(req);
    if (!Number.isInteger(b.amountPaise) || (b.amountPaise as number) <= 0) {
      throw badRequest("amountPaise must be a positive integer");
    }
    return billPay({
      couId: str(b.couId, "couId"),
      fetchRef: str(b.fetchRef, "fetchRef"),
      amountPaise: b.amountPaise as number,
      mode: paymentMode(b.mode),
      couOrderId: str(b.couOrderId, "couOrderId"),
    });
  });
}
