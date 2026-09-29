import { handle, readJson } from "../../nbbl/_http";
import { pay } from "@/lib/parties/cou/api";
import type { PaymentMode } from "@/lib/domain/types";

export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return handle(async () => {
    const b = await readJson(req);
    return pay({
      fetchRef: String(b.fetchRef ?? ""),
      amountPaise: b.amountPaise as number,
      mode: String(b.mode ?? "") as PaymentMode,
      simulateFailure: b.simulateFailure === true,
    });
  });
}
