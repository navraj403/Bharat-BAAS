"use client";

import { useState } from "react";
import type { PaymentMode } from "@/lib/domain/types";
import { Button, FOCUS, Spinner } from "./ui";
import { formatINR } from "./format";

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "1";

const METHODS: { mode: PaymentMode; label: string; hint: string }[] = [
  { mode: "UPI", label: "UPI", hint: "Pay with your UPI PIN" },
  { mode: "NETBANKING", label: "Net banking", hint: "Mock bank login" },
  { mode: "DEBIT_CARD", label: "Debit card", hint: "Mock card payment" },
];

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

/** Bottom sheet inside the phone frame. `onPay` performs the payment; sheet shows "processing" meanwhile. */
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

  function next() {
    if (mode === "UPI") setStep("pin");
    else onPay(mode, fail);
  }

  function press(k: string) {
    if (k === "⌫") setPin((p) => p.slice(0, -1));
    else if (k) setPin((p) => (p.length < 6 ? p + k : p));
  }

  return (
    <div className="absolute inset-0 z-10 flex items-end bg-black/40">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Pay bill"
        className="h-[560px] max-h-full w-full rounded-t-2xl bg-surface p-4 shadow-card"
      >
        {paying ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-ink">
            <Spinner className="size-10 text-accent" />
            <p className="font-semibold">Processing payment…</p>
            <p className="text-sm text-ink-muted">Please don&apos;t close this screen</p>
          </div>
        ) : (
          <div className="flex h-full flex-col">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-xs text-ink-muted">Paying {billerName}</p>
                <p className="text-xl font-bold text-ink">{formatINR(amountPaise)}</p>
              </div>
              <button
                type="button"
                onClick={step === "pin" ? () => (setStep("method"), setPin("")) : onClose}
                aria-label={step === "pin" ? "Back to payment methods" : "Close"}
                className={`flex size-10 items-center justify-center rounded-full text-xl hover:bg-surface-2 ${FOCUS}`}
              >
                <span aria-hidden="true">{step === "pin" ? "←" : "✕"}</span>
              </button>
            </div>

            {step === "method" ? (
              <>
                <fieldset className="min-h-0 flex-1 space-y-2">
                  <legend className="mb-2 text-sm font-semibold text-ink-muted">Pay using</legend>
                  {METHODS.map((m) => (
                    <label
                      key={m.mode}
                      className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
                        mode === m.mode ? "border-accent bg-accent-soft" : "border-line"
                      }`}
                    >
                      <input
                        type="radio"
                        name="mode"
                        checked={mode === m.mode}
                        onChange={() => setMode(m.mode)}
                        className="size-4 accent-accent"
                      />
                      <span>
                        <span className="block font-medium text-ink">{m.label}</span>
                        <span className="block text-xs text-ink-muted">{m.hint}</span>
                      </span>
                    </label>
                  ))}
                  {DEMO_MODE && (
                    <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line-strong p-3 text-sm text-ink">
                      <input
                        type="checkbox"
                        checked={fail}
                        onChange={(e) => setFail(e.target.checked)}
                        className="size-4 accent-accent"
                      />
                      Simulate failure (demo)
                    </label>
                  )}
                </fieldset>
                <Button onClick={next}>{mode === "UPI" ? "Continue" : `Pay ${formatINR(amountPaise)}`}</Button>
              </>
            ) : (
              <>
                <div className="flex-1">
                  <p className="text-center text-sm text-ink-muted">Enter UPI PIN (any 4 to 6 digits)</p>
                  <p
                    aria-live="polite"
                    aria-label={`${pin.length} digits entered`}
                    className="my-3 flex h-8 items-center justify-center gap-3"
                  >
                    {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
                      <span
                        key={i}
                        className={`size-3 rounded-full ${i < pin.length ? "bg-ink" : "border border-line-strong"}`}
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
                          className={`h-12 rounded-xl bg-surface-2 text-lg font-semibold text-ink hover:bg-line ${FOCUS}`}
                        >
                          {k}
                        </button>
                      ) : (
                        <span key={i} />
                      ),
                    )}
                  </div>
                </div>
                <Button disabled={pin.length < 4} onClick={() => onPay(mode, fail)}>
                  Pay {formatINR(amountPaise)}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
