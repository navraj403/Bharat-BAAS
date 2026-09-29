// Local formatters. TODO(integrator): swap formatINR for src/lib/domain/money.ts once it exists.

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Integer paise -> "₹6,726.00". */
export function formatINR(paise: number): string {
  return inr.format(paise / 100);
}

/** Uppercase, strip spaces and dashes: "mh-01 ab 1001" -> "MH01AB1001". */
export function normaliseVehicle(input: string): string {
  return input.toUpperCase().replace(/[\s-]+/g, "");
}

const VEHICLE_RE = /^([A-Z]{2})(\d{2})([A-Z]{1,3})(\d{4})$/;

export function isValidVehicle(input: string): boolean {
  return VEHICLE_RE.test(normaliseVehicle(input));
}

/** "MH01AB1001" -> "MH 01 AB 1001". Falls back to the raw value. */
export function displayVehicle(reg: string): string {
  const m = VEHICLE_RE.exec(normaliseVehicle(reg));
  return m ? `${m[1]} ${m[2]} ${m[3]} ${m[4]}` : reg;
}

export function isValidMobile(m: string): boolean {
  return /^[6-9]\d{9}$/.test(m);
}

/** "2026-09-24" or ISO instant -> "24 Sep 2026". */
export function formatDate(s: string): string {
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** ISO instant -> "24 Sep 2026, 3:42 pm". */
export function formatDateTime(s: string): string {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export const MODE_LABEL: Record<string, string> = {
  UPI: "UPI",
  UPI_AUTOPAY: "UPI AutoPay",
  NETBANKING: "Net banking",
  DEBIT_CARD: "Debit card",
};
