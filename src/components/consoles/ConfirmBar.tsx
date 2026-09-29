"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui";

/** In-page confirm step (confirm() is not allowed). */
export function ConfirmBar({
  children,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-label="Confirm action"
      className="flex flex-wrap items-center justify-between gap-3 border-b border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning"
    >
      <span className="max-w-3xl">{children}</span>
      <span className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="danger" size="sm" onClick={onConfirm} disabled={busy}>
          {busy ? "Working..." : confirmLabel}
        </Button>
      </span>
    </div>
  );
}
