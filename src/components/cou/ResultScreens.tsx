"use client";

import type { ReactNode } from "react";
import type { BillPresentment, FetchResult, Receipt } from "@/lib/domain/types";
import { Button, Pill, Screen } from "./ui";
import { formatINR } from "@/lib/domain/money";
import { MODE_LABEL, displayVehicle, formatDate, formatDateTime } from "./format";

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 py-2 text-sm">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={`text-right font-medium text-ink ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

function BillDue({ bill }: { bill: BillPresentment }) {
  return (
    <>
      <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-ink-muted">{bill.billerName}</p>
            <p className="text-lg font-bold text-ink">{bill.customerName}</p>
          </div>
          {bill.overdue && <Pill tone="danger">Overdue</Pill>}
        </div>
        <dl className="mt-2 divide-y divide-line">
          <Row label="Vehicle" value={displayVehicle(bill.vehicleRegNo)} />
          <Row label="Plan" value={bill.planName} />
          <Row label="Bill period" value={`${formatDate(bill.billPeriod.from)} – ${formatDate(bill.billPeriod.to)}`} />
          <Row label="Due date" value={formatDate(bill.dueDate)} />
        </dl>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <h2 id="bill-breakdown-heading" className="border-b border-line bg-surface-2 px-4 py-2 text-sm font-semibold text-ink">
          Bill breakdown
        </h2>
        <table className="w-full text-sm" aria-labelledby="bill-breakdown-heading">
          <tbody className="divide-y divide-line">
            {bill.lines.map((l, i) => (
              <tr key={`${l.kind}-${l.cycle}-${i}`}>
                <th
                  scope="row"
                  className={`px-4 py-2.5 text-left font-normal ${
                    l.kind === "LATE_FEE" ? "text-danger" : l.kind === "ARREARS" ? "text-warning" : "text-ink"
                  }`}
                >
                  {l.label}
                </th>
                <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-ink">
                  {formatINR(l.amountPaise)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line-strong bg-surface-2">
              <th scope="row" className="px-4 py-3 text-left text-base font-bold text-ink">
                Total
              </th>
              <td className="whitespace-nowrap px-4 py-3 text-right text-base font-bold tabular-nums text-ink">
                {formatINR(bill.amountPaise)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

function Notice({
  tone,
  icon,
  title,
  children,
}: {
  tone: "neutral" | "success" | "danger";
  icon: string;
  title: string;
  children: ReactNode;
}) {
  const bg = { neutral: "bg-info-soft", success: "bg-success-soft", danger: "bg-danger-soft" }[tone];
  const fg = { neutral: "text-info", success: "text-success", danger: "text-danger" }[tone];
  return (
    <div role={tone === "danger" ? "alert" : undefined} className={`rounded-xl p-5 text-center ${bg}`}>
      <div
        aria-hidden="true"
        className={`mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-white text-2xl ${fg}`}
      >
        {icon}
      </div>
      <h2 className={`text-lg font-bold ${fg}`}>{title}</h2>
      <div className="mt-1 text-sm text-ink">{children}</div>
    </div>
  );
}

export function ResultScreen({
  result,
  vehicle,
  refetching,
  onBack,
  onPay,
  onRefetch,
  onViewReceipt,
}: {
  result: FetchResult;
  vehicle: string;
  refetching: boolean;
  onBack: () => void;
  onPay: () => void;
  onRefetch: () => void;
  onViewReceipt: (r: Receipt) => void;
}) {
  let body: ReactNode;
  let footer: ReactNode;

  switch (result.result) {
    case "BILL_DUE":
      body = <BillDue bill={result.bill} />;
      footer = <Button onClick={onPay}>Pay {formatINR(result.bill.amountPaise)}</Button>;
      break;
    case "NOT_GENERATED":
      body = (
        <Notice tone="neutral" icon="🕒" title="No bill yet">
          <p>
            No bill generated yet for {displayVehicle(result.vehicleRegNo)}. Bills are generated on the 1st of each
            month.
          </p>
          <p className="mt-2 text-ink-muted">Next bill: {formatDate(result.nextBillDate)}</p>
        </Notice>
      );
      footer = (
        <Button variant="secondary" loading={refetching} onClick={onRefetch}>
          Check again
        </Button>
      );
      break;
    case "ALREADY_PAID": {
      const r = result.receipt;
      body = (
        <>
          <Notice tone="success" icon="✓" title="Already paid">
            <p>
              Paid {formatINR(r.amountPaise)} on {formatDate(r.paidAt)}. You have nothing due.
            </p>
          </Notice>
          <dl className="mt-4 divide-y divide-line rounded-xl border border-line bg-surface px-4">
            <Row label="Biller" value={r.billerName} />
            <Row label="Bharat Connect ref" value={r.bbpsTxnRef} mono />
            <Row label="Paid via" value={MODE_LABEL[r.mode] ?? r.mode} />
          </dl>
        </>
      );
      footer = (
        <Button variant="success" onClick={() => onViewReceipt(r)}>
          View receipt
        </Button>
      );
      break;
    }
    case "NOT_FOUND":
      body = (
        <Notice tone="danger" icon="!" title="Account not found">
          <p>
            We couldn&apos;t find an account for this vehicle and mobile number with {result.billerName}. Check the
            details and try again.
          </p>
        </Notice>
      );
      footer = <Button onClick={onBack}>Edit details</Button>;
      break;
    default:
      body = (
        <Notice tone="danger" icon="!" title="Biller not responding">
          <p>{result.billerName ?? "The biller"} is not responding right now. Please try again in a moment.</p>
        </Notice>
      );
      footer = (
        <Button loading={refetching} onClick={onRefetch}>
          Try again
        </Button>
      );
  }

  return (
    <Screen
      title={result.result === "BILL_DUE" ? "Your bill" : `Bill · ${displayVehicle(vehicle)}`}
      onBack={onBack}
      footer={footer}
    >
      {body}
    </Screen>
  );
}

export type ReceiptView =
  | { kind: "success"; receipt: Receipt; couOrderId?: string }
  | { kind: "failed"; message: string; couOrderId?: string; amountPaise: number };

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
      <Screen
        title="Payment failed"
        footer={
          <div className="space-y-2">
            {onRetry && <Button onClick={onRetry}>Try again</Button>}
            <Button variant="secondary" onClick={onDone}>
              Done
            </Button>
          </div>
        }
      >
        <Notice tone="danger" icon="✕" title="Payment failed">
          <p>{view.message}</p>
          <p className="mt-2 text-ink-muted">You have not been charged. Amount: {formatINR(view.amountPaise)}</p>
        </Notice>
        {view.couOrderId && (
          <dl className="mt-4 divide-y divide-line rounded-xl border border-line bg-surface px-4">
            <Row label="DemoPay order" value={view.couOrderId} mono />
          </dl>
        )}
      </Screen>
    );
  }
  const r = view.receipt;
  const orderId = view.couOrderId ?? r.couOrderId;
  return (
    <Screen title="Receipt" footer={<Button onClick={onDone}>Done</Button>}>
      <Notice tone="success" icon="✓" title="Paid">
        <p className="text-2xl font-bold">{formatINR(r.amountPaise)}</p>
        <p className="text-ink-muted">to {r.billerName}</p>
      </Notice>
      <dl className="mt-4 divide-y divide-line rounded-xl border border-line bg-surface px-4">
        <Row label="Biller" value={r.billerName} />
        <Row label="Vehicle" value={displayVehicle(r.vehicleRegNo)} />
        <Row label="Bharat Connect ref" value={r.bbpsTxnRef} mono />
        {orderId && <Row label="DemoPay order" value={orderId} mono />}
        <Row label="Paid via" value={MODE_LABEL[r.mode] ?? r.mode} />
        <Row label="Time" value={formatDateTime(r.paidAt)} />
      </dl>
    </Screen>
  );
}
