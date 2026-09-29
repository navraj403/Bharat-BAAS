/** Pure helpers for NBBL: ref generators and PII masking. */
import { randomInt } from "node:crypto";

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function rand(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += ALNUM[randomInt(ALNUM.length)];
  return s;
}

/** FETCH txn ref: `F-` + 10 [A-Z0-9]. */
export const newFetchRef = (): string => `F-${rand(10)}`;
/** bbpsTxnRef (PAY txn ref): `BC` + 10 [A-Z0-9]. */
export const newBbpsTxnRef = (): string => `BC${rand(10)}`;
/** COU order id: `DP-` + 10 [A-Z0-9]. */
export const newOrderId = (): string => `DP-${rand(10)}`;

/** `9800000001` -> `98XXXXXX01`. Anything shorter than 5 chars is fully masked. */
export function maskMobile(m: string): string {
  const d = String(m ?? "");
  if (d.length < 5) return "X".repeat(d.length);
  return d.slice(0, 2) + "X".repeat(d.length - 4) + d.slice(-2);
}

/** Uppercase, strip spaces and dashes. */
export function normaliseVehicleNo(v: string): string {
  return String(v ?? "")
    .toUpperCase()
    .replace(/[\s-]/g, "");
}
