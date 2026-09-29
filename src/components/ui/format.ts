// Console display helpers (agent E). Money is formatted with formatINR from src/lib/domain/money.ts.

/** `MH01AB1001` -> `MH 01 AB 1001`. Falls back to the input if it does not match. */
export function formatRegNo(reg: string): string {
  const m = /^([A-Z]{2})(\d{1,2})([A-Z]{1,3})(\d{1,4})$/.exec(reg.replace(/[\s-]/g, "").toUpperCase());
  return m ? `${m[1]} ${m[2]} ${m[3]} ${m[4]}` : reg;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-IN").format(n);
}

export function currentCycle(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
