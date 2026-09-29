import { handle, readJson, str, badRequest } from "../_http";
import { billPay } from "@/lib/parties/nbbl/api";
import type { PaymentMode } from "@/lib/domain/types";

export const dynamic = "force-dynamic";

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
      mode: str(b.mode, "mode") as PaymentMode,
      couOrderId: str(b.couOrderId, "couOrderId"),
    });
  });
}
