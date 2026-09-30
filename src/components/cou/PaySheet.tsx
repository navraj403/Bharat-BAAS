"use client";

import { useEffect, useRef, useState } from "react";
import type { PaymentMode } from "@/lib/domain/types";
import { Button, FOCUS, Spinner, Tile, type TileTone } from "./ui";
import { Icon, type IconName } from "./icons";
import { formatINR } from "@/lib/domain/money";

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "1";

const METHODS: { mode: PaymentMode; label: string; hint: string; icon: IconName; tone: TileTone; tag?: string }[] = [
  { mode: "UPI", label: "UPI", hint: "demo@okbank", icon: "upi", tone: "green", tag: "Fastest" },
  { mode: "UPI_AUTOPAY", label: "UPI AutoPay", hint: "Pay monthly bills on their own", icon: "repeat", tone: "violet" },
  { mode: "NETBANKING", label: "Net banking", hint: "Mock bank login", icon: "bank", tone: "blue" },
  { mode: "DEBIT_CARD", label: "Debit card", hint: "Mock card payment", icon: "card", tone: "amber" },
];

const PIN_MODES: PaymentMode[] = ["UPI", "UPI_AUTOPAY"];
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

/** Bottom sheet inside the phone frame. `onPay` performs the payment; the sheet shows "processing" meanwhile. */
export function PaySheet({
  amountPaise,
  billerName,
  paying,
  onClose,
  onPay,
}: {
  amountPaise: number;
  billerName: string;
  paying: boolean;
  onClose: () => void;
  onPay: (mode: PaymentMode, simulateFailure: boolean) => void;
}) {
  const [mode, setMode] = useState<PaymentMode>("UPI");
  const [step, setStep] = useState<"method" | "pin">("method");
  const [pin, setPin] = useState("");
  const [fail, setFail] = useState(false);
  // Exit animation: slide down and fade, then unmount.
  const [closing, setClosing] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  function close() {
    if (paying || closing) return;
    setClosing(true);
    setTimeout(onClose, 220);
  }

  // Focus the sheet on open (so Escape and Tab start inside it); Escape closes it.
  useEffect(() => {
    sheetRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (step === "pin" && !paying && /^[0-9]$/.test(e.key)) press(e.key);
      else if (step === "pin" && !paying && e.key === "Backspace") press("⌫");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function next() {
    if (PIN_MODES.includes(mode)) setStep("pin");
    else onPay(mode, fail);
  }

  function press(k: string) {
    if (k === "⌫") setPin((p) => p.slice(0, -1));
    else if (k) setPin((p) => (p.length < 6 ? p + k : p));
  }

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && close()}
      className={`absolute inset-0 z-10 flex items-end bg-black/45 transition-opacity duration-200 starting:opacity-0 ${
        closing ? "opacity-0" : "opacity-100"
      }`}
    >
      <div
        ref={sheetRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Pay bill"
        className={`max-h-full w-full rounded-t-3xl bg-surface px-4 pb-4 pt-2 shadow-card outline-none transition-transform duration-300 ease-out-soft starting:translate-y-full ${
          closing ? "translate-y-full" : "translate-y-0"
        }`}
      >
        <span aria-hidden="true" className="mx-auto mb-3 block h-1 w-10 rounded-full bg-line-strong" />
        {paying ? (
          <div className="flex h-80 animate-rise flex-col items-center justify-center gap-3 text-ink">
            <Spinner className="size-10 text-pay" />
            <p className="font-semibold">Processing payment…</p>
            <p className="text-sm text-ink-muted">Don&apos;t close this screen</p>
          </div>
        ) : (
          <div className="flex flex-col">
            <div className="mb-3 flex items-start justify-between">
              <div>
                <p className="text-lg font-bold text-ink">Pay {formatINR(amountPaise)}</p>
                <p className="text-xs text-ink-muted">to {billerName}</p>
              </div>
              <button
                type="button"
                onClick={step === "pin" ? () => (setStep("method"), setPin("")) : close}
                aria-label={step === "pin" ? "Back to payment methods" : "Close"}
                className={`flex size-10 items-center justify-center rounded-full text-ink hover:bg-surface-2 ${FOCUS}`}
              >
                <Icon name={step === "pin" ? "back" : "x"} />
              </button>
            </div>

            {step === "method" ? (
              <div key="method" className="animate-rise">
                <fieldset className="space-y-2">
                  <legend className="mb-2 text-xs font-semibold text-ink-muted">Pay using</legend>
                  {METHODS.map((m) => {
                    const on = mode === m.mode;
                    return (
                      <label
                        key={m.mode}
                        className={`flex cursor-pointer items-center gap-3 rounded-2xl border p-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-pay ${
                          on ? "border-pay bg-pay-soft" : "border-line"
                        }`}
                      >
                        <input
                          type="radio"
                          name="mode"
                          value={m.mode}
                          aria-label={m.label}
                          checked={on}
                          onChange={() => setMode(m.mode)}
                          className="sr-only"
                        />
                        <Tile icon={m.icon} tone={m.tone} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold text-ink">{m.label}</span>
                          <span className="block text-xs text-ink-muted">{m.hint}</span>
                        </span>
                        {m.tag && (
                          <span className="rounded-full bg-pay-accent px-2 py-0.5 text-xs font-semibold text-pay-accent-ink">{m.tag}</span>
                        )}
                        <span
                          aria-hidden="true"
                          className={`size-4 shrink-0 rounded-full border-2 ${on ? "border-pay bg-pay shadow-[inset_0_0_0_2px_white]" : "border-line-strong"}`}
                        />
                      </label>
                    );
                  })}
                  {DEMO_MODE && (
                    <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-line-strong p-3 text-sm text-ink">
                      <input
                        type="checkbox"
                        aria-label="Simulate failure (demo)"
                        checked={fail}
                        onChange={(e) => setFail(e.target.checked)}
                        className="size-4 accent-pay"
                      />
                      Simulate failure (demo)
                    </label>
                  )}
                </fieldset>
                <Button className="mt-3" onClick={next}>
                  {PIN_MODES.includes(mode) ? "Pay securely" : `Pay ${formatINR(amountPaise)}`}
                </Button>
              </div>
            ) : (
              <div key="pin" className="animate-rise">
                <p className="text-center text-sm text-ink-muted">Enter UPI PIN (any 4 to 6 digits)</p>
                <p
                  aria-live="polite"
                  aria-label={`${pin.length} digits entered`}
                  className="my-3 flex h-8 items-center justify-center gap-3"
                >
                  {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
                    <span
                      key={i}
                      className={`size-3 rounded-full ${i < pin.length ? "animate-pop bg-pay-deep" : "border border-line-strong"}`}
                    />
                  ))}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {KEYS.map((k, i) =>
                    k ? (
                      <button
                        key={i}
                        type="button"
                        onClick={() => press(k)}
                        aria-label={k === "⌫" ? "Delete" : k}
                        className={`h-12 rounded-xl bg-surface-2 text-lg font-semibold text-ink hover:bg-pay-soft ${FOCUS}`}
                      >
                        {k}
                      </button>
                    ) : (
                      <span key={i} />
                    ),
                  )}
                </div>
                <Button className="mt-3" disabled={pin.length < 4} onClick={() => onPay(mode, fail)}>
                  Pay {formatINR(amountPaise)}
                </Button>
              </div>
            )}
            <p className="mt-2 flex items-center justify-center gap-1 text-xs text-ink-muted">
              <Icon name="lock" className="size-3.5" /> Mock payment, no money moves
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
