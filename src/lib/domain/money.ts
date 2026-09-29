/** Money helpers. All amounts are integer paise. Pure; no imports. */

/** Integer division of `num / den` rounded half-up (non-negative operands). */
export function divRoundHalfUp(num: number, den: number): number {
  return Math.floor((2 * num + den) / (2 * den));
}

/** `paise × bps / 10,000`, rounded half-up to whole paise. `pct(539900, 1800)` → 97182. */
export function pct(paise: number, bps: number): number {
  return divRoundHalfUp(paise * bps, 10_000);
}

/** Indian grouping, always 2 decimals: `1188962` → "₹11,889.62". Negative values get a leading "-". */
export function formatINR(paise: number): string {
  const neg = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  const s = String(rupees);
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
  return `${neg ? "-" : ""}₹${grouped}.${frac}`;
}

/** Sum of integer paise amounts. */
export function sumPaise(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
