import type { ButtonHTMLAttributes, ReactNode } from "react";

export const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block size-5 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}

/** Generic Bharat Connect style mark (placeholder, not the real logo). */
export function BMark({ size = 40 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand font-bold text-white"
    >
      B
    </span>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "success";
  loading?: boolean;
};

export function Button({ variant = "primary", loading, children, className = "", disabled, ...rest }: BtnProps) {
  const styles = {
    primary: "bg-accent text-accent-ink hover:bg-accent-hover",
    success: "bg-success text-white hover:opacity-90",
    secondary: "border border-line-strong bg-surface text-ink hover:bg-surface-2",
  }[variant];
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${FOCUS} ${className}`}
      {...rest}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

export function Screen({
  title,
  onBack,
  children,
  footer,
}: {
  title: string;
  onBack?: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className={`flex size-10 items-center justify-center rounded-full text-xl text-ink hover:bg-surface-2 ${FOCUS}`}
          >
            <span aria-hidden="true">←</span>
          </button>
        ) : (
          <span className="size-2" />
        )}
        <h1 className="text-base font-semibold text-ink">{title}</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      {footer && <div className="shrink-0 border-t border-line bg-surface p-4">{footer}</div>}
    </div>
  );
}

export function Pill({ tone, children }: { tone: "danger" | "success" | "info" | "warning"; children: ReactNode }) {
  const t = {
    danger: "bg-danger-soft text-danger",
    success: "bg-success-soft text-success",
    info: "bg-info-soft text-info",
    warning: "bg-warning-soft text-warning",
  }[tone];
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${t}`}>{children}</span>;
}
