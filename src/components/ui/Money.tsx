import { formatMoney } from "./format";

export function Money({ paise, className = "" }: { paise: number; className?: string }) {
  return <span className={`tabular-nums whitespace-nowrap ${className}`}>{formatMoney(paise)}</span>;
}
