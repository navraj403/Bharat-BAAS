type Tone = "success" | "warning" | "danger" | "info" | "neutral";

const TONES: Record<Tone, string> = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  neutral: "bg-surface-2 text-ink-muted",
};

const MAP: Record<string, Tone> = {
  PAID: "success",
  SUCCESS: "success",
  ACTIVE: "success",
  "000": "success",
  UNPAID: "warning",
  PENDING: "warning",
  OPEN: "warning",
  OVERDUE: "danger",
  FAILED: "danger",
  INACTIVE: "neutral",
  FETCH: "info",
  PAY: "info",
};

export function StatusPill({ status, tone, label }: { status: string; tone?: Tone; label?: string }) {
  const t = tone ?? MAP[status] ?? (/^(BFR|BPR|SYS)/.test(status) ? "danger" : "neutral");
  return (
    <span className={`inline-flex items-center rounded-pill px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONES[t]}`}>
      {label ?? status}
    </span>
  );
}
