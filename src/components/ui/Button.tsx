import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "brand" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover",
  brand: "bg-brand text-white hover:opacity-90",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-surface-2",
  danger: "bg-danger text-white hover:opacity-90",
  ghost: "text-accent hover:bg-accent-soft",
};

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  const sz = size === "sm" ? "px-2.5 py-1 text-xs" : size === "lg" ? "px-4 py-2.5 text-sm" : "px-3 py-1.5 text-sm";
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${sz} ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
