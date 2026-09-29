import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Notice({ tone, children }: { tone: "success" | "danger" | "info"; children: ReactNode }) {
  const c = tone === "success" ? "bg-success-soft text-success" : tone === "danger" ? "bg-danger-soft text-danger" : "bg-info-soft text-info";
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`mb-4 rounded-lg px-4 py-2 text-sm ${c}`}>
      {children}
    </div>
  );
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
