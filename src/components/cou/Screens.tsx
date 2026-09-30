"use client";

import { useState } from "react";
import type { BillerSummary, FetchResult, Receipt } from "@/lib/domain/types";
import { formatINR } from "@/lib/domain/money";
import { formatCycle } from "@/lib/domain/cycle";
import { BharatConnect, Button, Card, FOCUS, Initials, Screen, Skeleton, Spinner } from "./ui";
import { Icon, type IconName } from "./icons";
import { MODE_LABEL, displayVehicle, formatDate, isValidMobile, isValidVehicle, nextBillDate } from "./format";

// ─── Home ────────────────────────────────────────────────────────────────────

const QUICK: { icon: IconName; label: string }[] = [
  { icon: "scan", label: "Scan & pay" },
  { icon: "send", label: "To mobile" },
  { icon: "bank", label: "To bank" },
  { icon: "wallet", label: "Balance" },
];

const CATEGORIES: { id: string; label: string; icon: IconName; enabled?: boolean }[] = [
  { id: "ev", label: "EV battery", icon: "battery", enabled: true },
  { id: "elec", label: "Electricity", icon: "bulb" },
  { id: "mobile", label: "Mobile", icon: "phone" },
  { id: "fastag", label: "FASTag", icon: "road" },
  { id: "gas", label: "Gas", icon: "flame" },
  { id: "water", label: "Water", icon: "droplet" },
  { id: "emi", label: "Loan EMI", icon: "receipt" },
  { id: "more", label: "More", icon: "dots" },
];

export function HomeScreen({ onEv, onHelp }: { onEv: () => void; onHelp: () => void }) {
  return (
    <div className="flex h-full flex-col bg-pay-canvas">
      <header className="shrink-0 bg-pay-deep px-4 pb-4 pt-4 text-white">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">DemoPay</h1>
          <span className="flex items-center gap-3">
            <button
              type="button"
              onClick={onHelp}
              aria-label="Help & support"
              className="flex size-8 items-center justify-center rounded-full hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <Icon name="support" />
            </button>
            <span className="flex gap-3" aria-hidden="true">
              <Icon name="bell" />
              <Icon name="user" />
            </span>
          </span>
        </div>
        <button
          type="button"
          onClick={onEv}
          className="mt-3 flex h-10 w-full items-center gap-2 rounded-full bg-white px-4 text-left text-sm text-ink-faint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <Icon name="search" className="size-4" /> Search bills, billers
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <Card>
          <ul className="grid grid-cols-4 gap-1 text-center text-xs text-ink">
            {QUICK.map((q) => (
              <li key={q.label} title="Not part of this demo" className="text-ink-muted">
                <span className="mx-auto mb-1 flex size-11 items-center justify-center rounded-full bg-pay-soft text-pay">
                  <Icon name={q.icon} />
                </span>
                {q.label}
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink">Recharge and pay bills</h2>
          <ul className="grid grid-cols-4 gap-x-1 gap-y-3 text-center text-xs">
            {CATEGORIES.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={!c.enabled}
                  onClick={c.enabled ? onEv : undefined}
                  title={c.enabled ? undefined : "Coming soon"}
                  className={`relative flex w-full flex-col items-center rounded-lg py-1 ${FOCUS} ${
                    c.enabled ? "font-semibold text-ink" : "cursor-not-allowed text-ink-faint"
                  }`}
                >
                  {c.enabled && (
                    <span className="absolute -top-1.5 right-0 rounded-full bg-brand px-1.5 text-[10px] font-bold text-ink">
                      New
                    </span>
                  )}
                  <span
                    className={`mb-1 flex size-11 items-center justify-center rounded-full ${
                      c.enabled ? "bg-pay text-white" : "bg-surface-2 text-ink-faint"
                    }`}
                  >
                    <Icon name={c.icon} />
                  </span>
                  {c.label}
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <button
          type="button"
          onClick={onEv}
          className={`flex w-full items-center gap-3 rounded-2xl border border-pay-line bg-pay-soft p-3 text-left ${FOCUS}`}
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-pay text-white">
            <Icon name="battery" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-pay-deep">Pay your EV battery bill</span>
            <span className="block text-xs text-pay">Pay-per-km BaaS bills, now on Bharat Connect</span>
          </span>
          <Icon name="chevron" className="size-4 text-pay" />
        </button>

        <button
          type="button"
          onClick={onHelp}
          className={`flex w-full items-center gap-3 rounded-2xl border border-line bg-white p-3 text-left ${FOCUS}`}
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-pay-soft text-pay">
            <Icon name="support" className="size-6" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink">Help &amp; support</span>
            <span className="block text-xs text-ink-muted">Raise a complaint about a payment · Track your tickets</span>
          </span>
          <Icon name="chevron" className="size-4 text-ink-faint" />
        </button>
      </div>
      <BharatConnect />
    </div>
  );
}

// ─── Billers ─────────────────────────────────────────────────────────────────

export type BillersState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; billers: BillerSummary[] };

export interface RecentFetch {
  biller: BillerSummary;
  vehicle: string;
  mobile: string;
}

export function BillersScreen({
  state,
  recent,
  onBack,
  onPick,
  onPickRecent,
  onRetry,
}: {
  state: BillersState;
  recent: RecentFetch | null;
  onBack: () => void;
  onPick: (b: BillerSummary) => void;
  onPickRecent: (r: RecentFetch) => void;
  onRetry: () => void;
}) {
  const [q, setQ] = useState("");
  const shown =
    state.status === "ready" ? state.billers.filter((b) => b.name.toLowerCase().includes(q.trim().toLowerCase())) : [];

  return (
    <Screen
      title="EV battery (BaaS)"
      onBack={onBack}
      headerExtra={
        <label className="flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm text-ink">
          <Icon name="search" className="size-4 text-ink-faint" />
          <span className="sr-only">Search billers</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by biller name"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-faint"
          />
        </label>
      }
    >
      {state.status === "loading" && (
        <div className="flex items-center justify-center gap-2 py-10 text-ink-muted">
          <Spinner /> Loading billers…
        </div>
      )}
      {state.status === "error" && (
        <div role="alert" className="rounded-2xl bg-danger-soft p-4 text-sm text-danger">
          <p className="mb-3">We couldn&apos;t load the biller list. Try again.</p>
          <Button variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}
      {state.status === "ready" && (
        <>
          <h2 className="mb-2 px-1 text-xs font-semibold text-ink-muted">All billers</h2>
          <ul className="space-y-2">
            {shown.length === 0 && <li className="px-1 text-sm text-ink-muted">No billers match &ldquo;{q}&rdquo;.</li>}
            {shown.map((b, i) => {
              const active = b.status === "ACTIVE";
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    disabled={!active}
                    onClick={() => onPick(b)}
                    className={`flex w-full items-center gap-3 rounded-2xl border border-pay-line bg-surface p-3 text-left hover:border-pay disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`}
                  >
                    <Initials name={b.name} tone={i} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-ink">{b.name}</span>
                      <span className="block text-xs text-ink-muted">
                        {active ? "Battery subscription · Bharat Connect" : "Currently unavailable"}
                      </span>
                    </span>
                    <Icon name="chevron" className="size-4 text-ink-faint" />
                  </button>
                </li>
              );
            })}
          </ul>

          {recent && (
            <>
              <h2 className="mb-2 mt-5 px-1 text-xs font-semibold text-ink-muted">Recent</h2>
              <button
                type="button"
                onClick={() => onPickRecent(recent)}
                className={`flex w-full items-center gap-3 rounded-2xl border border-pay-line bg-surface p-3 text-left hover:border-pay ${FOCUS}`}
              >
                <Icon name="history" className="size-5 text-pay" />
                <span className="flex-1 text-sm text-ink">
                  {displayVehicle(recent.vehicle)} · {recent.biller.name}
                </span>
                <Icon name="chevron" className="size-4 text-ink-faint" />
              </button>
            </>
          )}
        </>
      )}
      <div className="mt-4">
        <BharatConnect label="Bharat Connect billers" />
      </div>
    </Screen>
  );
}

// ─── Details + inline fetch result (Paytm-style) ─────────────────────────────

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "1";
const DEMO_CHIPS = [
  { label: "Riya · Bill due", v: "MH01AB1001", m: "9800000001" },
  { label: "Arjun · Overdue", v: "MH01AB1002", m: "9800000002" },
  { label: "Meera · Paid", v: "MH01AB1003", m: "9800000003" },
  { label: "Kabir · No bill", v: "MH01AB1004", m: "9800000004" },
  { label: "Wrong mobile", v: "MH01AB1001", m: "9111111111" },
];

/** A fetch result that stays on the details form (everything except BILL_DUE). */
export type InlineResult = Exclude<FetchResult, { result: "BILL_DUE" }>;

function PaidCard({ receipt, onViewReceipt }: { receipt: Receipt; onViewReceipt: () => void }) {
  const period = receipt.cycles.length ? receipt.cycles.map(formatCycle).join(" + ") : "Your bill";
  return (
    <div className="rounded-2xl border border-success/40 bg-success-soft p-3 text-sm text-success">
      <p className="flex items-center gap-1.5 text-base font-semibold">
        <Icon name="checkCircle" /> No bill due
      </p>
      <p className="mt-1 text-ink">
        {period} bill of <b>{formatINR(receipt.amountPaise)}</b> was paid on {formatDate(receipt.paidAt)} via{" "}
        {MODE_LABEL[receipt.mode] ?? receipt.mode}.
      </p>
      <p className="mt-1 text-xs">
        Ref <span className="font-mono">{receipt.bbpsTxnRef}</span> · {receipt.customerName}
      </p>
      <button
        type="button"
        onClick={onViewReceipt}
        className={`mt-2 inline-flex items-center gap-0.5 rounded font-semibold underline-offset-2 hover:underline ${FOCUS}`}
      >
        View receipt <Icon name="chevron" className="size-4" />
      </button>
    </div>
  );
}

function InlineResultCard({
  result,
  onViewReceipt,
}: {
  result: InlineResult;
  onViewReceipt: (r: Receipt) => void;
}) {
  switch (result.result) {
    case "ALREADY_PAID":
      return (
        <>
          <PaidCard receipt={result.receipt} onViewReceipt={() => onViewReceipt(result.receipt)} />
          <p className="mt-2 text-center text-xs text-ink-muted">Next bill on {formatDate(nextBillDate())}</p>
        </>
      );
    case "NOT_GENERATED":
      return (
        <div className="rounded-2xl border border-warning/40 bg-warning-soft p-3 text-sm text-warning">
          <p className="flex items-center gap-1.5 text-base font-semibold">
            <Icon name="clock" /> Bill not generated yet
          </p>
          <p className="mt-1 text-ink">
            {result.customerName} · your next bill for {displayVehicle(result.vehicleRegNo)} will be ready on{" "}
            {formatDate(result.nextBillDate)}.
          </p>
        </div>
      );
    case "NOT_FOUND":
      return null; // shown as a field error under the mobile number
    default:
      return (
        <div role="alert" className="rounded-2xl border border-danger/40 bg-danger-soft p-3 text-sm text-danger">
          <p className="flex items-center gap-1.5 text-base font-semibold">
            <Icon name="alert" /> Biller not responding
          </p>
          <p className="mt-1 text-ink">
            {result.billerName ?? "The biller"} isn&apos;t responding right now. Try again in a moment.
          </p>
        </div>
      );
  }
}

/** Bill-card-shaped shimmer shown while NBBL fetches the bill. */
function FetchSkeleton() {
  return (
    <div className="mt-3 animate-rise rounded-2xl border border-pay-line bg-surface p-3">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <Skeleton className="mx-auto mt-4 h-7 w-1/2" />
      <Skeleton className="mx-auto mt-2 h-4 w-1/4 rounded-full" />
      <p className="mt-3 text-center text-xs text-ink-muted">Fetching your bill via Bharat Connect…</p>
    </div>
  );
}

export function DetailsScreen({
  biller,
  vehicle,
  mobile,
  setVehicle,
  setMobile,
  fetching,
  error,
  inline,
  onBack,
  onFetch,
  onViewReceipt,
}: {
  biller: BillerSummary;
  vehicle: string;
  mobile: string;
  setVehicle: (v: string) => void;
  setMobile: (m: string) => void;
  fetching: boolean;
  error: string | null;
  inline: InlineResult | null;
  onBack: () => void;
  onFetch: () => void;
  onViewReceipt: (r: Receipt) => void;
}) {
  const [touched, setTouched] = useState({ v: false, m: false });
  const vOk = isValidVehicle(vehicle);
  const mOk = isValidMobile(mobile);
  const notFound = inline?.result === "NOT_FOUND";
  const vErr = touched.v && !vOk ? "Enter a valid number, like MH 01 AB 1001" : null;
  const mErr =
    touched.m && !mOk
      ? "Enter a 10-digit mobile number"
      : notFound
        ? `No account found for this vehicle and mobile with ${biller.name}.`
        : null;
  const field =
    "h-12 w-full rounded-xl border bg-surface px-3 text-base text-ink placeholder:text-ink-faint " + FOCUS;

  return (
    <Screen
      title={biller.name}
      onBack={onBack}
      footer={
        <Button type="submit" form="cou-details-form" disabled={!vOk || !mOk} loading={fetching}>
          {fetching ? "Fetching bill…" : "Fetch bill"}
        </Button>
      }
    >
      <Card>
        <form
          id="cou-details-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (vOk && mOk && !fetching) onFetch();
          }}
          className="space-y-3"
        >
          <div>
            <label htmlFor="vehicle" className="mb-1 block text-xs font-medium text-ink-muted">
              Vehicle registration number
            </label>
            <input
              id="vehicle"
              value={vehicle}
              onChange={(e) => setVehicle(e.target.value.toUpperCase())}
              onBlur={() => setTouched((t) => ({ ...t, v: true }))}
              placeholder="MH 01 AB 1001"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-invalid={!!vErr}
              aria-describedby="vehicle-err"
              className={`${field} uppercase ${vErr ? "border-danger" : "border-line-strong"}`}
            />
            <p id="vehicle-err" className="mt-1 min-h-4 text-xs text-danger">
              {vErr}
            </p>
          </div>
          <div>
            <label htmlFor="mobile" className="mb-1 block text-xs font-medium text-ink-muted">
              Linked mobile number
            </label>
            <div className="flex gap-2">
              <span className="flex h-12 items-center rounded-xl border border-line-strong bg-surface-2 px-3 text-ink-muted">
                +91
              </span>
              <input
                id="mobile"
                value={mobile}
                onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
                onBlur={() => setTouched((t) => ({ ...t, m: true }))}
                placeholder="98XXXXXXXX"
                inputMode="numeric"
                autoComplete="off"
                aria-invalid={!!mErr}
                aria-describedby="mobile-err"
                className={`${field} ${mErr ? "border-danger" : "border-line-strong"}`}
              />
            </div>
            <p id="mobile-err" role={notFound ? "alert" : undefined} className="mt-1 min-h-4 text-xs text-danger">
              {mErr && notFound && <Icon name="alert" className="mr-1 inline size-3.5 align-[-2px]" />}
              {mErr}
            </p>
          </div>
        </form>
      </Card>

      {fetching && <FetchSkeleton />}

      {inline && (
        <div className="mt-3 animate-rise">
          <InlineResultCard result={inline} onViewReceipt={onViewReceipt} />
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-2xl bg-danger-soft p-3 text-sm text-danger">
          {error}
        </p>
      )}

      {DEMO_MODE && (
        <div className="mt-4">
          <p className="mb-2 px-1 text-xs font-semibold text-ink-faint">Demo numbers</p>
          <div className="flex flex-wrap gap-2">
            {DEMO_CHIPS.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={() => {
                  setVehicle(c.v);
                  setMobile(c.m);
                  setTouched({ v: true, m: true });
                }}
                className={`rounded-full border border-pay-line bg-surface px-3 py-1.5 text-xs font-medium text-pay-deep hover:bg-pay-soft ${FOCUS}`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </Screen>
  );
}
