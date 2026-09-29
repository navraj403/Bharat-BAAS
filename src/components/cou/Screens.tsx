"use client";

import { useState } from "react";
import type { BillerSummary } from "@/lib/domain/types";
import { BMark, Button, FOCUS, Screen, Spinner } from "./ui";
import { isValidMobile, isValidVehicle } from "./format";

const CATEGORIES = [
  { id: "ev", label: "EV Battery (BaaS)", icon: "🔋", enabled: true },
  { id: "elec", label: "Electricity", icon: "💡", enabled: false },
  { id: "mobile", label: "Mobile", icon: "📱", enabled: false },
  { id: "fastag", label: "FASTag", icon: "🛣️", enabled: false },
  { id: "water", label: "Water", icon: "💧", enabled: false },
  { id: "gas", label: "Gas", icon: "🔥", enabled: false },
];

export function HomeScreen({ onEv }: { onEv: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 bg-accent px-4 pb-6 pt-5 text-accent-ink">
        <p className="text-sm opacity-80">Welcome to</p>
        <h1 className="text-2xl font-bold">DemoPay</h1>
        <p className="mt-1 text-sm opacity-80">Pay your bills through Bharat Connect</p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <h2 className="mb-4 text-sm font-semibold text-ink-muted">Recharge &amp; pay bills</h2>
        <ul className="grid grid-cols-3 gap-3">
          {CATEGORIES.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                disabled={!c.enabled}
                onClick={c.enabled ? onEv : undefined}
                className={`relative flex h-28 w-full flex-col items-center justify-center gap-2 rounded-xl border p-2 text-center text-xs font-medium ${FOCUS} ${
                  c.enabled
                    ? "border-accent bg-accent-soft text-ink hover:bg-white"
                    : "cursor-not-allowed border-line bg-surface text-ink-faint"
                }`}
              >
                {c.enabled && (
                  <span className="absolute -top-2 right-2 rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold text-white">
                    New
                  </span>
                )}
                <span aria-hidden="true" className={`text-2xl ${c.enabled ? "" : "grayscale"}`}>
                  {c.icon}
                </span>
                <span>{c.label}</span>
                {!c.enabled && <span className="text-[10px]">Coming soon</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export type BillersState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; billers: BillerSummary[] };

export function BillersScreen({
  state,
  onBack,
  onPick,
  onRetry,
}: {
  state: BillersState;
  onBack: () => void;
  onPick: (b: BillerSummary) => void;
  onRetry: () => void;
}) {
  return (
    <Screen title="Choose your biller" onBack={onBack}>
      <p className="mb-3 text-sm text-ink-muted">EV Battery (BaaS) billers on Bharat Connect</p>
      {state.status === "loading" && (
        <div className="flex items-center justify-center gap-2 py-10 text-ink-muted">
          <Spinner /> Loading billers…
        </div>
      )}
      {state.status === "error" && (
        <div role="alert" className="rounded-xl bg-danger-soft p-4 text-sm text-danger">
          <p className="mb-3">We couldn&apos;t load the biller list. Please try again.</p>
          <Button variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}
      {state.status === "ready" && (
        <ul className="space-y-2">
          {state.billers.length === 0 && <li className="text-sm text-ink-muted">No billers available.</li>}
          {state.billers.map((b) => {
            const active = b.status === "ACTIVE";
            return (
              <li key={b.id}>
                <button
                  type="button"
                  disabled={!active}
                  onClick={() => onPick(b)}
                  className={`flex w-full items-center gap-3 rounded-xl border border-line bg-surface p-3 text-left hover:border-accent disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`}
                >
                  <BMark />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-ink">{b.name}</span>
                    <span className="block text-xs text-ink-muted">
                      {active ? "Bharat Connect biller" : "Currently unavailable"}
                    </span>
                  </span>
                  <span aria-hidden="true" className="text-ink-faint">
                    ›
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Screen>
  );
}

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "1";
const DEMO_CHIPS = [
  { label: "Riya · Bill due", v: "MH01AB1001", m: "9800000001" },
  { label: "Arjun · Overdue", v: "MH01AB1002", m: "9800000002" },
  { label: "Meera · Paid", v: "MH01AB1003", m: "9800000003" },
  { label: "Kabir · No bill", v: "MH01AB1004", m: "9800000004" },
  { label: "Wrong mobile", v: "MH01AB1001", m: "9111111111" },
];

export function DetailsScreen({
  biller,
  vehicle,
  mobile,
  setVehicle,
  setMobile,
  fetching,
  error,
  onBack,
  onFetch,
}: {
  biller: BillerSummary;
  vehicle: string;
  mobile: string;
  setVehicle: (v: string) => void;
  setMobile: (m: string) => void;
  fetching: boolean;
  error: string | null;
  onBack: () => void;
  onFetch: () => void;
}) {
  const [touched, setTouched] = useState({ v: false, m: false });
  const vOk = isValidVehicle(vehicle);
  const mOk = isValidMobile(mobile);
  const vErr = touched.v && !vOk ? "Enter a valid number, like MH 01 AB 1001" : null;
  const mErr = touched.m && !mOk ? "Enter a 10-digit mobile number" : null;
  const field =
    "h-12 w-full rounded-xl border bg-surface px-3 text-base text-ink placeholder:text-ink-faint " + FOCUS;

  return (
    <Screen
      title="Enter vehicle details"
      onBack={onBack}
      footer={
        <Button type="submit" form="cou-details-form" disabled={!vOk || !mOk} loading={fetching}>
          {fetching ? "Fetching bill…" : "Fetch bill"}
        </Button>
      }
    >
      <div className="mb-4 flex items-center gap-3 rounded-xl bg-surface-2 p-3">
        <BMark size={32} />
        <div>
          <p className="text-sm font-semibold text-ink">{biller.name}</p>
          <p className="text-xs text-ink-muted">EV Battery (BaaS)</p>
        </div>
      </div>

      <form
        id="cou-details-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (vOk && mOk && !fetching) onFetch();
        }}
        className="space-y-4"
      >
        <div>
          <label htmlFor="vehicle" className="mb-1 block text-sm font-medium text-ink">
            Vehicle registration no
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
          <label htmlFor="mobile" className="mb-1 block text-sm font-medium text-ink">
            Linked mobile no
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
          <p id="mobile-err" className="mt-1 min-h-4 text-xs text-danger">
            {mErr}
          </p>
        </div>
      </form>

      {error && (
        <p role="alert" className="mt-2 rounded-xl bg-danger-soft p-3 text-sm text-danger">
          {error}
        </p>
      )}

      {DEMO_MODE && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Demo numbers</p>
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
                className={`rounded-full border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2 ${FOCUS}`}
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
