"use client";

import Link from "next/link";
import { useState } from "react";
import { adminReset } from "@/lib/client/api";
import { Button, Card } from "@/components/ui";
import { ConfirmBar } from "@/components/consoles/ConfirmBar";
import { Notice, errMsg } from "@/components/consoles/PageShell";

const PARTIES = [
  { href: "/cou", name: "COU", sub: "DemoPay", role: "Customer app: pick biller, fetch the bill, pay via mock UPI." },
  { href: "/nbbl", name: "NBBL", sub: "Bharat Connect switch", role: "Routes fetch and pay, issues BBPS refs, logs every hop." },
  { href: "/biller", name: "Biller", sub: "Bajaj Finance / Volt Leasing", role: "Pulls bills from the OEM, adds arrears and late fee, takes payment." },
  { href: "/oem", name: "OEM", sub: "Maruti Suzuki", role: "Records km from telematics and generates the monthly bill." },
];

const SCRIPT = [
  "Customer app: pick EV Battery (BaaS), then Bajaj Finance, then enter the vehicle number and linked mobile.",
  "See one of three results: bill due, bill not generated, or already paid.",
  "Pay through mock UPI and get a receipt with a Bharat Connect reference (BC...).",
  "Fetch again: it now shows Already paid.",
  "NBBL monitor: the FETCH and PAY transactions with every hop.",
  "Biller console: the bill is shown as collected.",
  "OEM console: add km to a new vehicle and click Generate bill. That customer flips from Not generated to Bill due live.",
  "DB explorer (and Supabase Table Editor): the rows each party owns.",
];

export default function Home() {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  async function reset() {
    setBusy(true);
    try {
      await adminReset();
      setMsg({ tone: "success", text: "Demo data reset to the seed." });
      setConfirming(false);
    } catch (e) {
      setMsg({ tone: "danger", text: `Reset failed: ${errMsg(e)}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold text-ink">Bharat BaaS</h1>
        <p className="mt-2 max-w-3xl text-ink-muted">
          Pay-per-km EV battery billing as a biller category on Bharat Connect (BBPS). Four parties exchange one usage-based bill over a mock rail.
        </p>
      </div>

      <Card title="How the bill moves" className="mb-6">
        <div className="p-4">
          <ol className="grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] md:items-stretch">
            {PARTIES.flatMap((p, i) => {
              const box = (
                <li key={p.name} className="rounded-card border border-line bg-canvas p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-lg font-semibold text-accent">{p.name}</span>
                    <span className="text-xs text-ink-faint">{p.sub}</span>
                  </div>
                  <p className="mt-2 text-sm text-ink-muted">{p.role}</p>
                  <Link href={p.href} className="mt-3 inline-block text-sm font-medium text-accent underline-offset-2 hover:underline">
                    Open {p.name} &rarr;
                  </Link>
                </li>
              );
              if (i === PARTIES.length - 1) return [box];
              return [
                box,
                <li key={`a${i}`} aria-hidden className="flex items-center justify-center text-2xl text-brand md:px-1">
                  <span className="hidden md:inline">&rarr;</span>
                  <span className="md:hidden">&darr;</span>
                </li>,
              ];
            })}
          </ol>
          <p className="mt-3 text-xs text-ink-faint">
            Fetch flows left to right (COU asks, NBBL routes, the biller asks the OEM); the bill and payment advice flow back.
          </p>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card title="3-minute demo script">
          <ol className="list-decimal space-y-2 p-4 pl-9 text-sm text-ink">
            {SCRIPT.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </Card>

        <Card title="Demo data">
          {confirming ? (
            <ConfirmBar confirmLabel="Yes, reset" busy={busy} onConfirm={reset} onCancel={() => setConfirming(false)}>
              This wipes every party&apos;s tables and reloads the seed. Continue?
            </ConfirmBar>
          ) : null}
          <div className="p-4">
            {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
            <p className="mb-3 text-sm text-ink-muted">Run this before each demo to return to the seeded starting state.</p>
            <Button variant="danger" onClick={() => setConfirming(true)} disabled={confirming || busy}>
              Reset demo data
            </Button>
          </div>
        </Card>
      </div>
    </main>
  );
}
