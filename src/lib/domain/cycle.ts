/** Billing-cycle helpers. Pure; no imports. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2026-07` → "Jul 2026". Returns the input unchanged if it is not a `YYYY-MM` cycle. */
export function formatCycle(cycle: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(cycle);
  if (!m) return cycle;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${m[1]}` : cycle;
}
