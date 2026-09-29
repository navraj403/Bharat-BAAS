import { formatINR } from "@/lib/domain/money";

export function Money({ paise, className = "" }: { paise: number; className?: string }) {
  return <span className={`tabular-nums whitespace-nowrap ${className}`}>{formatINR(paise)}</span>;
}
