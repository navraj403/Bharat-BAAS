import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon } from "./icons";

export const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pay";

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
      style={{ width: size, height: size, fontSize: size * 0.55 }}
      className="inline-flex shrink-0 items-center justify-center rounded-md bg-accent font-bold text-white"
    >
      B
    </span>
  );
}

/** "B Bharat Connect" strip shown at the foot of biller screens. */
export function BharatConnect({ label = "Bharat Connect" }: { label?: string }) {
  return (
    <p className="flex items-center justify-center gap-1.5 py-2 text-xs text-ink-muted">
      <BMark size={16} /> {label}
    </p>
  );
}

/** Two-letter avatar for a biller: "Bajaj Finance" -> "BF". */
export function Initials({ name, tone = 0 }: { name: string; tone?: number }) {
  const tones = ["bg-accent-soft text-accent", "bg-success-soft text-success", "bg-brand-soft text-warning"];
  const text = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      aria-hidden="true"
      className={`inline-flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${tones[tone % tones.length]}`}
    >
      {text}
    </span>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "success";
  loading?: boolean;
};

export function Button({ variant = "primary", loading, children, className = "", disabled, ...rest }: BtnProps) {
  const styles = {
    primary: "bg-pay text-white hover:bg-pay-deep",
    success: "bg-success text-white hover:opacity-90",
    secondary: "border border-pay-line bg-surface text-pay hover:bg-pay-soft",
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

/** Indigo app-bar screen with an optional slot under the title (search bar) and a sticky footer. */
export function Screen({
  title,
  onBack,
  children,
  footer,
  headerExtra,
}: {
  title: string;
  onBack?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  headerExtra?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col bg-pay-canvas">
      <header className="shrink-0 bg-pay-deep px-3 pb-3 pt-3 text-white">
        <div className="flex items-center gap-1">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className="flex size-10 items-center justify-center rounded-full hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"
            >
              <Icon name="back" />
            </button>
          )}
          <h1 className={`text-base font-semibold ${onBack ? "" : "pl-1"}`}>{title}</h1>
        </div>
        {headerExtra && <div className="mt-2 px-1">{headerExtra}</div>}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
      {footer && <div className="shrink-0 border-t border-pay-line bg-surface p-3">{footer}</div>}
    </div>
  );
}

/** White rounded card used across the customer app. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-pay-line bg-surface p-3 ${className}`}>{children}</div>;
}

export function Pill({ tone, children }: { tone: "danger" | "success" | "info" | "warning" | "pay"; children: ReactNode }) {
  const t = {
    danger: "bg-danger-soft text-danger",
    success: "bg-success-soft text-success",
    info: "bg-info-soft text-info",
    warning: "bg-warning-soft text-warning",
    pay: "bg-pay-soft text-pay-deep",
  }[tone];
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${t}`}>{children}</span>;
}
