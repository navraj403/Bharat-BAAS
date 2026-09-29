import type { ReactNode } from "react";

export function KpiTile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-card border border-line bg-surface p-4 shadow-card">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-ink-faint">{hint}</div> : null}
    </div>
  );
}
