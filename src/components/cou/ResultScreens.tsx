"use client";

import { useState, type CSSProperties } from "react";
import type { BillPresentment, Receipt } from "@/lib/domain/types";
import { formatINR } from "@/lib/domain/money";
import { formatCycle } from "@/lib/domain/cycle";
import { BharatConnect, Button, Card, FOCUS, Pill, Screen, Tile } from "./ui";
import { Icon } from "./icons";
import { MODE_LABEL, displayVehicle, formatDate, formatDateTime } from "./format";

/** Copies text to the clipboard; the label flips to "Copied" and is announced. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked: the ref stays visible to copy by hand.
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Copied" : "Copy Bharat Connect ref"}
      className={`rounded-md px-1.5 py-0.5 font-sans text-xs font-semibold text-pay hover:bg-pay-soft ${FOCUS}`}
    >
      <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 py-2 text-sm">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={`text-right font-medium text-ink ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

// ─── Bill due → confirm ──────────────────────────────────────────────────────

/** "Due in 4 days" / "Due today" / "Overdue", from the bill's due date and the viewer's today. */
function dueChip(bill: BillPresentment): { text: string; tone: "danger" | "warning" | "success" } {
  if (bill.overdue) return { text: bill.arrearsPaise > 0 ? "Includes overdue bill" : "Overdue", tone: "danger" };
  const today = new Date();
  const utcToday = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const [y, m, d] = bill.dueDate.split("-").map(Number);
  const days = Math.round((Date.UTC(y, m - 1, d) - utcToday) / 86_400_000);
  if (days < 0) return { text: "Overdue", tone: "danger" };
  if (days === 0) return { text: "Due today", tone: "warning" };
  return { text: `Due in ${days} day${days === 1 ? "" : "s"}`, tone: days <= 3 ? "warning" : "success" };
}

export function BillScreen({
  bill,
  onBack,
  onPay,
}: {
  bill: BillPresentment;
  onBack: () => void;
  onPay: () => void;
}) {
  const usage = bill.lines.find((l) => l.kind === "USAGE" && l.cycle === bill.cycle);
  const due = dueChip(bill);

  return (
    <Screen
      title="Bill details"
      onBack={onBack}
      footer={<Button onClick={onPay}>Pay via Bharat Connect</Button>}
    >
      <Card className="animate-rise p-4">
        <div className="flex items-center gap-3">
          <Tile icon="battery" tone="green" round />
          <div className="min-w-0">
            <p className="text-base font-bold text-ink">EV Battery · {formatCycle(bill.cycle)}</p>
            <p className="text-xs text-ink-muted">
              {displayVehicle(bill.vehicleRegNo)} · {bill.planName} plan
            </p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <Pill tone="success">{bill.kmDriven.toLocaleString("en-IN")} km</Pill>
          {usage?.ratePaisePerKm !== undefined && <Pill tone="info">{formatINR(usage.ratePaisePerKm)}/km</Pill>}
          <Pill tone={due.tone}>{due.text}</Pill>
        </div>

        <table className="mt-3 w-full text-sm">
          <caption className="sr-only">Bill breakdown</caption>
          <tbody>
            {bill.lines.map((l, i) => (
              <tr key={`${l.kind}-${l.cycle}-${i}`}>
                <th
                  scope="row"
                  className={`py-2 pr-3 text-left font-normal ${
                    l.kind === "LATE_FEE" || l.kind === "ARREARS" ? "text-danger" : "text-ink"
                  }`}
                >
                  {l.label}
                </th>
                <td className="whitespace-nowrap py-2 text-right tabular-nums text-ink">{formatINR(l.amountPaise)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line">
              <th scope="row" className="pt-3 text-left text-base font-bold text-ink">
                Total due
              </th>
              <td className="whitespace-nowrap pt-3 text-right text-2xl font-extrabold tabular-nums text-pay-bar">
                {formatINR(bill.amountPaise)}
              </td>
            </tr>
          </tfoot>
        </table>

        <p className="mt-3 text-xs text-ink-muted">
          {bill.customerName} · {bill.billerName} · {formatDate(bill.billPeriod.from)} – {formatDate(bill.billPeriod.to)}
        </p>
      </Card>
      <div className="mt-3">
        <BharatConnect label="Bill fetched via Bharat Connect" />
      </div>
    </Screen>
  );
}

// ─── Receipt ─────────────────────────────────────────────────────────────────

export type ReceiptView =
  | { kind: "success"; receipt: Receipt; couOrderId?: string }
  | { kind: "failed"; message: string; couOrderId?: string; amountPaise: number };

function receiptText(r: Receipt, orderId?: string): string {
  return [
    "MeterPe receipt (prototype, no real payment)",
    `Paid ${formatINR(r.amountPaise)} to ${r.billerName}`,
    `Vehicle: ${displayVehicle(r.vehicleRegNo)}`,
    `Paid for: ${r.cycles.map(formatCycle).join(" + ")}`,
    `Bharat Connect ref: ${r.bbpsTxnRef}`,
    orderId ? `MeterPe order: ${orderId}` : null,
    `Mode: ${MODE_LABEL[r.mode] ?? r.mode}`,
    `Time: ${formatDateTime(r.paidAt)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function ReceiptActions({ receipt, orderId }: { receipt: Receipt; orderId?: string }) {
  const [copied, setCopied] = useState(false);
  const text = receiptText(receipt, orderId);

  async function share() {
    try {
      if (navigator.share) await navigator.share({ title: "Payment receipt", text });
      else {
        await navigator.clipboard.writeText(text);
        setCopied(true);
      }
    } catch {
      // Share sheet dismissed: nothing to do.
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `receipt-${receipt.bbpsTxnRef}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const btn = `flex flex-1 items-center justify-center gap-1.5 rounded-2xl border border-pay-line bg-surface py-3 text-sm font-semibold text-pay hover:bg-pay-soft ${FOCUS}`;
  return (
    <div className="mt-3 flex gap-2">
      <button type="button" onClick={share} className={btn}>
        <Icon name="share" className="size-4" /> {copied ? "Copied" : "Share"}
      </button>
      <button type="button" onClick={download} className={btn}>
        <Icon name="download" className="size-4" /> Receipt
      </button>
    </div>
  );
}

/**
 * Result mark: the white disc pops in, a ring pings once, then the tick (or cross) draws itself.
 * stroke-dasharray = path length; the `draw` keyframe runs dashoffset from --len to 0.
 */
function ResultMark({ tone }: { tone: "success" | "danger" }) {
  const stroke = { strokeDasharray: 18, ["--len" as string]: 18 } as CSSProperties;
  return (
    <span className="relative mx-auto mb-2 flex size-14 items-center justify-center">
      <span aria-hidden="true" className="absolute inset-0 animate-ping-once rounded-full bg-white opacity-0 [animation-delay:350ms]" />
      <span
        className={`relative flex size-14 animate-pop items-center justify-center rounded-full bg-white ${
          tone === "success" ? "text-success" : "text-danger"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          className={`size-8 ${tone === "danger" ? "animate-shake [animation-delay:700ms]" : ""}`}
          fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {tone === "success" ? (
            <path d="m6 12.5 4 4 8-9" pathLength={18} style={stroke} className="animate-draw [animation-delay:300ms]" />
          ) : (
            <>
              <path d="M7 7l10 10" pathLength={18} style={stroke} className="animate-draw [animation-delay:300ms]" />
              <path d="M17 7 7 17" pathLength={18} style={stroke} className="animate-draw [animation-delay:450ms]" />
            </>
          )}
        </svg>
      </span>
    </span>
  );
}

function Hero({ tone, title, amountPaise, sub }: { tone: "success" | "danger"; title: string; amountPaise: number; sub: string }) {
  return (
    <div className={`shrink-0 px-4 pb-6 pt-8 text-center text-white ${tone === "success" ? "bg-success" : "bg-danger"}`}>
      <ResultMark tone={tone} />
      <h1 className="animate-rise text-base font-semibold [animation-delay:250ms]">{title}</h1>
      <p className="mt-1 animate-rise text-3xl font-bold tabular-nums [animation-delay:320ms]">{formatINR(amountPaise)}</p>
      <p className="mt-1 animate-rise text-sm text-white/90 [animation-delay:390ms]">{sub}</p>
    </div>
  );
}

export function ReceiptScreen({
  view,
  onDone,
  onRetry,
}: {
  view: ReceiptView;
  onDone: () => void;
  onRetry?: () => void;
}) {
  if (view.kind === "failed") {
    return (
      <div className="flex h-full flex-col bg-pay-canvas">
        <Hero tone="danger" title="Payment failed" amountPaise={view.amountPaise} sub="You haven't been charged" />
        <div className="min-h-0 flex-1 animate-rise overflow-y-auto p-3 [animation-delay:500ms]">
          <Card>
            <p className="text-sm text-ink">{view.message}</p>
            {view.couOrderId && (
              <dl className="mt-2 border-t border-line">
                <Row label="MeterPe order" value={view.couOrderId} mono />
              </dl>
            )}
          </Card>
        </div>
        <div className="shrink-0 space-y-2 border-t border-pay-line bg-surface p-3">
          {onRetry && <Button onClick={onRetry}>Try again</Button>}
          <Button variant="secondary" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  const r = view.receipt;
  const orderId = view.couOrderId ?? r.couOrderId;
  return (
    <div className="flex h-full flex-col bg-pay-canvas">
      <Hero
        tone="success"
        title="Payment successful"
        amountPaise={r.amountPaise}
        sub={`to ${r.billerName} · ${formatDateTime(r.paidAt)}`}
      />
      <div className="min-h-0 flex-1 animate-rise overflow-y-auto p-3 [animation-delay:500ms]">
        <Card>
          <dl className="divide-y divide-line">
            <div className="flex items-center justify-between gap-3 py-2 text-sm">
              <dt className="text-ink-muted">Bharat Connect ref</dt>
              <dd className="flex items-center gap-1 font-mono font-medium text-ink">
                {r.bbpsTxnRef}
                <CopyButton text={r.bbpsTxnRef} />
              </dd>
            </div>
            <Row label="Vehicle" value={displayVehicle(r.vehicleRegNo)} />
            {r.cycles.length > 0 && <Row label="Paid for" value={r.cycles.map(formatCycle).join(" + ")} />}
            <Row label="Mode" value={MODE_LABEL[r.mode] ?? r.mode} />
            {orderId && <Row label="MeterPe order" value={orderId} mono />}
          </dl>
        </Card>
        <p className="mt-2 flex items-center gap-1.5 rounded-xl bg-pay-soft px-3 py-2 text-xs text-pay-deep">
          <Icon name="checkCircle" className="size-4 shrink-0" /> Bharat Connect assured · verify this payment with your ref
        </p>
        <ReceiptActions receipt={r} orderId={orderId} />
        <div className="mt-3">
          <BharatConnect label="Paid via Bharat Connect" />
        </div>
      </div>
      <div className="shrink-0 border-t border-pay-line bg-surface p-3">
        <Button onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}
