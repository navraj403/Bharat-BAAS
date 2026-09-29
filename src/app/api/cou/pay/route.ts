import { handle, readJson, paymentMode } from "../../nbbl/_http";
import { pay } from "@/lib/parties/cou/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function POST(req: Request) {
  return handle(async () => {
    const b = await readJson(req);
    return pay({
      fetchRef: String(b.fetchRef ?? ""),
      amountPaise: b.amountPaise as number,
      mode: paymentMode(b.mode),
      simulateFailure: b.simulateFailure === true,
    });
  });
}
