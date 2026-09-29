"use client";

import { useState } from "react";
import { getNbblStats, getNbblTransaction, getNbblTransactions } from "@/lib/client/api";
import type { NbblEvent, NbblTxn } from "@/lib/domain/types";
import { Button, Card, DataTable, ErrorState, KpiTile, LoadingState, Money, StatusPill, formatDateTime, formatNumber, type Column } from "@/components/ui";
import { ComplaintsView } from "./ComplaintsView";
import { PageHeader } from "@/components/consoles/PageShell";
import { useAsync } from "@/components/consoles/useAsync";

const STEP_LABEL: Record<string, string> = {
  COU_REQ: "COU request",
  BILLER_REQ: "To biller",
  BILLER_RESP: "Biller response",
  PAY_REQ: "Payment request",
  ADVICE_ACK: "Advice acknowledged",
  COU_RESP: "Response to COU",
  ERROR: "Error",
};

const txnCols = (selected: string | null): Column<NbblTxn>[] => [
  { key: "ref", header: "Ref", render: (t) => <span className="font-mono">{t.ref}</span> },
  { key: "type", header: "Type", render: (t) => <StatusPill status={t.type} /> },
  { key: "biller", header: "Biller", render: (t) => t.billerId },
  { key: "cou", header: "COU", render: (t) => t.couId },
  { key: "cust", header: "Customer ref", render: (t) => <span className="font-mono">{t.customerRefMasked}</span> },
  { key: "amt", header: "Amount", align: "right", render: (t) => (t.amountPaise === null ? "-" : <Money paise={t.amountPaise} />) },
  { key: "code", header: "Response", render: (t) => (t.responseCode ? <StatusPill status={t.responseCode} /> : <StatusPill status={t.status} />) },
  { key: "lat", header: "Latency", align: "right", render: (t) => (t.latencyMs === null ? "-" : `${formatNumber(t.latencyMs)} ms`) },
  { key: "time", header: "Time", render: (t) => <span className={t.ref === selected ? "font-semibold" : ""}>{formatDateTime(t.createdAt)}</span> },
];

function EventItem({ ev }: { ev: NbblEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="relative pb-4 pl-6 last:pb-0">
      <span aria-hidden className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full bg-accent" />
      <span aria-hidden className="absolute left-[4px] top-4 h-full w-px bg-line" />
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-semibold text-ink">{ev.step}</span>
        <span className="text-sm text-ink-muted">{STEP_LABEL[ev.step] ?? ev.step}</span>
        <span className="text-xs text-ink-faint">{formatDateTime(ev.at)}</span>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="rounded text-xs font-medium text-accent hover:underline"
        >
          {open ? "Hide payload" : "Show payload"}
        </button>
      </div>
      {open ? (
        <pre className="mt-2 max-h-72 max-w-full overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-xs text-ink">
          {JSON.stringify(ev.payload, null, 2)}
        </pre>
      ) : null}
    </li>
  );
}

function Timeline({ txnRef, paused }: { txnRef: string; paused: boolean }) {
  const detail = useAsync(() => getNbblTransaction(txnRef), txnRef, { intervalMs: 3000, paused });
  return (
    <Card title={<span>Hop timeline <span className="font-mono text-ink-muted">{txnRef}</span></span>} className="mt-6">
      {detail.error ? (
        <ErrorState error={detail.error} onRetry={() => void detail.reload()} />
      ) : detail.loading || !detail.data ? (
        <LoadingState label="Loading hops..." />
      ) : detail.data.events.length === 0 ? (
        <p className="p-4 text-sm text-ink-faint">No events logged.</p>
      ) : (
        <ol className="p-4">
          {detail.data.events.map((ev) => (
            <EventItem key={ev.id} ev={ev} />
          ))}
        </ol>
      )}
    </Card>
  );
}

export default function NbblPage() {
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"txns" | "complaints">("txns");
  const stats = useAsync(getNbblStats, "stats", { intervalMs: 3000, paused });
  const txns = useAsync(() => getNbblTransactions({ limit: 100 }), "txns", { intervalMs: 3000, paused });

  const s = stats.data;

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
      <PageHeader
        title="NBBL monitor"
        subtitle="Bharat Connect switch: transaction data only, every hop logged."
        actions={
          <>
            <span className="text-xs text-ink-muted" aria-live="polite">
              {paused ? "Auto-refresh paused" : "Auto-refresh every 3s"}
            </span>
            <Button size="sm" aria-pressed={paused} onClick={() => setPaused((p) => !p)}>
              {paused ? "Resume" : "Pause"}
            </Button>
          </>
        }
      />

      <div role="tablist" aria-label="NBBL views" className="mb-4 flex gap-1 border-b border-line">
        {(["txns", "complaints"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`panel-${t}`}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium ${tab === t ? "border-b-2 border-accent text-accent" : "text-ink-muted hover:text-ink"}`}
          >
            {t === "txns" ? "Transactions" : "Complaints"}
          </button>
        ))}
      </div>

      {tab === "complaints" ? (
        <div role="tabpanel" id="panel-complaints" aria-labelledby="tab-complaints">
          <ComplaintsView
            paused={paused}
            onViewTxn={(ref) => {
              setSelected(ref);
              setTab("txns");
            }}
          />
        </div>
      ) : (
      <div role="tabpanel" id="panel-txns" aria-labelledby="tab-txns">
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Bill fetches" value={s ? formatNumber(s.fetches) : "-"} />
        <KpiTile label="Payments" value={s ? formatNumber(s.payments) : "-"} />
        <KpiTile label="Success rate" value={s ? `${(s.successRate <= 1 ? s.successRate * 100 : s.successRate).toFixed(1)}%` : "-"} />
        <KpiTile label="Value processed" value={s ? <Money paise={s.valuePaise} /> : "-"} />
      </div>

      <Card title="Transactions" actions={<span className="text-xs text-ink-faint">Select a ref to see its hops</span>}>
        {txns.error ? (
          <ErrorState error={txns.error} onRetry={() => void txns.reload()} />
        ) : txns.loading || !txns.data ? (
          <LoadingState label="Loading transactions..." />
        ) : (
          <DataTable
            caption="NBBL transactions"
            columns={txnCols(selected)}
            rows={txns.data}
            rowKey={(t) => t.ref}
            empty="No transactions yet. Fetch a bill in the customer app."
            onRowClick={(t) => setSelected(t.ref)}
            selectedKey={selected}
          />
        )}
      </Card>

      {selected ? <Timeline txnRef={selected} paused={paused} /> : null}
      </div>
      )}
    </main>
  );
}
