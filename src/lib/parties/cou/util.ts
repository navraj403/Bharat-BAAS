/** COU-local helpers (COU must not import NBBL internals). */
import { randomInt } from "node:crypto";

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** DemoPay order id: `DP-` + 10 [A-Z0-9]. */
export function newOrderId(): string {
  let s = "";
  for (let i = 0; i < 10; i++) s += ALNUM[randomInt(ALNUM.length)];
  return `DP-${s}`;
}

/** Uppercase, strip spaces and dashes. */
export function normaliseVehicleNo(v: string): string {
  return String(v ?? "")
    .toUpperCase()
    .replace(/[\s-]/g, "");
}
