import { NextResponse } from "next/server";
import type { PaymentMode } from "@/lib/domain/types";
import { paymentAdvice } from "@/lib/parties/biller/api";
import { errorResponse, handleError, isStr, readJsonObject } from "../../_http";

export const dynamic = "force-dynamic";

const MODES: readonly PaymentMode[] = ["UPI", "UPI_AUTOPAY", "NETBANKING", "DEBIT_CARD"];

/** BOU-facing payment advice (called by NBBL). BPR001/BPR002 are HTTP 200 with ack=false. */
export async function POST(req: Request) {
  try {
    const b = await readJsonObject(req);
    if (
      !b ||
      !isStr(b.billerId) ||
      !isStr(b.presentmentId) ||
      !isStr(b.bbpsTxnRef) ||
      !Number.isSafeInteger(b.amountPaise) ||
      !MODES.includes(b.mode as PaymentMode) ||
      !isStr(b.paidAt)
    ) {
      return errorResponse(
        400,
        "BAD_REQUEST",
        "Body must be {billerId, presentmentId, amountPaise:int, bbpsTxnRef, mode, paidAt}",
      );
    }
    if (!/^[0-9a-f-]{36}$/i.test(b.presentmentId)) {
      return errorResponse(400, "BAD_REQUEST", "presentmentId must be a uuid");
    }
    return NextResponse.json(
      await paymentAdvice({
        billerId: b.billerId,
        presentmentId: b.presentmentId,
        amountPaise: b.amountPaise as number,
        bbpsTxnRef: b.bbpsTxnRef,
        mode: b.mode as PaymentMode,
        paidAt: b.paidAt,
      }),
    );
  } catch (e) {
    return handleError(e);
  }
}
