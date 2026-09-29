"use client";

import { useState } from "react";
import { billerSync, getBillerOverview, getNbblComplaints } from "@/lib/client/api";
import { COMPLAINT_REASON_LABELS, type BillerCustomerRow, type BillerPaymentRow, type BillerReceivableRow, type NbblComplaint } from "@/lib/domain/types";
import { Button, Card, DataTable, ErrorState, KpiTile, LoadingState, Money, StatusPill, formatDateTime, formatRegNo, type Column } from "@/components/ui";
import { Notice, PageHeader, errMsg } from "@/components/consoles/PageShell";
import { useAsync } from "@/components/consoles/useAsync";

const BILLERS = [
  { id: "bajaj-finance", name: "Bajaj Finance" },
  { id: "volt-leasing", name: "Volt Leasing" },
];

const customerCols: Column<BillerCustomerRow>[] = [
  { key: "name", header: "Customer", render: (c) => c.name },
  { key: "mobile", header: "Mobile", render: (c) => c.mobileMasked },
  { key: "veh", header: "Vehicle", render: (c) => <span className="font-mono">{formatRegNo(c.vehicleRegNo)}</span> },
  { key: "contract", header: "Contract", render: (c) => c.contractId },
  { key: "out", header: "Outstanding", align: "right", render: (c) => <Money paise={c.outstandingPaise} /> },
];

const receivableCols: Column<BillerReceivableRow>[] = [
  { key: "cycle", header: "Cycle", render: (r) => r.cycle },
  { key: "cust", header: "Customer", render: (r) => r.customerName },
  { key: "veh", header: "Vehicle", render: (r) => <span className="font-mono">{formatRegNo(r.vehicleRegNo)}</span> },
  { key: "sub", header: "Subtotal", align: "right", render: (r) => <Money paise={r.subtotalPaise} /> },
  { key: "gst", header: "GST", align: "right", render: (r) => <Money paise={r.gstPaise} /> },
  { key: "late", header: "Late fee", align: "right", render: (r) => <Money paise={r.lateFeePaise} /> },
  { key: "total", header: "Total", align: "right", render: (r) => <Money paise={r.totalPaise} className="font-semibold" /> },
  { key: "due", header: "Due", render: (r) => r.dueDate },
  { key: "status", header: "Status", render: (r) => <StatusPill status={r.status} /> },
];

const paymentCols: Column<BillerPaymentRow>[] = [
  { key: "ref", header: "BBPS ref", render: (p) => <span className="font-mono">{p.bbpsTxnRef}</span> },
  { key: "cust", header: "Customer", render: (p) => p.customerName },
  { key: "veh", header: "Vehicle", render: (p) => <span className="font-mono">{formatRegNo(p.vehicleRegNo)}</span> },
  { key: "amt", header: "Amount", align: "right", render: (p) => <Money paise={p.amountPaise} className="font-semibold" /> },
  { key: "mode", header: "Mode", render: (p) => p.mode },
  { key: "at", header: "Paid at", render: (p) => formatDateTime(p.paidAt) },
];

const complaintCols: Column<NbblComplaint>[] = [
  { key: "id", header: "Complaint", render: (c) => <span className="font-mono">{c.complaintId}</span> },
  { key: "txn", header: "Txn ref", render: (c) => (c.txnRef ? <span className="font-mono">{c.txnRef}</span> : "-") },
  { key: "reason", header: "Reason", render: (c) => COMPLAINT_REASON_LABELS[c.reason] },
  { key: "amt", header: "Amount", align: "right", render: (c) => <Money paise={c.amountPaise} /> },
  { key: "due", header: "Due", render: (c) => (<span className="inline-flex items-center gap-2">{formatDateTime(c.dueAt)}{c.overdue ? <StatusPill status="OVERDUE" label="Overdue" /> : null}</span>) },
];

export default function BillerPage() {
  const [billerId, setBillerId] = useState(BILLERS[0].id);
  const overview = useAsync(() => getBillerOverview(billerId), billerId);
  const complaints = useAsync(
    async () => (await getNbblComplaints({ status: "OPEN", pendingWith: "BILLER" })).filter((c) => c.billerId === billerId),
    `complaints:${billerId}`,
    { intervalMs: 3000 },
  );
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  async function sync() {
    setSyncing(true);
    try {
      const r = await billerSync(billerId);
      setMsg({ tone: "success", text: `Synced ${r.synced} receivable(s) from the OEM.` });
      await overview.reload();
    } catch (e) {
      setMsg({ tone: "danger", text: `Sync failed: ${errMsg(e)}` });
    } finally {
      setSyncing(false);
    }
  }

  const o = overview.data;

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
      <PageHeader
        title="Biller console"
        subtitle="BaaS financier: customers, receivables pulled from the OEM, and payments received over Bharat Connect."
        actions={
          <>
            <div role="group" aria-label="Choose biller" className="flex rounded-lg border border-line-strong bg-surface p-0.5">
              {BILLERS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  aria-pressed={b.id === billerId}
                  onClick={() => {
                    setBillerId(b.id);
                    setMsg(null);
                  }}
                  className={`rounded-md px-3 py-1 text-sm font-medium ${b.id === billerId ? "bg-accent text-accent-ink" : "text-ink-muted hover:bg-surface-2"}`}
                >
                  {b.name}
                </button>
              ))}
            </div>
            <Button variant="primary" disabled={syncing} onClick={() => void sync()}>
              {syncing ? "Syncing..." : "Sync from OEM"}
            </Button>
          </>
        }
      />
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}

      {overview.error ? (
        <Card>
          <ErrorState error={overview.error} onRetry={() => void overview.reload()} />
        </Card>
      ) : overview.loading || !o ? (
        <Card>
          <LoadingState label="Loading biller overview..." />
        </Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <KpiTile label="Receivables due" value={<Money paise={o.kpis.receivablesDuePaise} />} />
            <KpiTile label="Collected" value={<Money paise={o.kpis.collectedPaise} />} />
            <KpiTile label="Overdue bills" value={o.kpis.overdueCount} hint={`${o.kpis.customers} customers`} />
          </div>
          <Card title="Customers" className="mb-6">
            <DataTable caption="Biller customers" columns={customerCols} rows={o.customers} rowKey={(c) => c.id} empty="No customers" />
          </Card>
          <Card title="Receivables" className="mb-6">
            <DataTable caption="Receivables" columns={receivableCols} rows={o.receivables} rowKey={(r) => r.id} empty="No receivables yet. Try Sync from OEM." />
          </Card>
          <Card title="Complaints pending with you" className="mb-6">
            {complaints.error ? (
              <ErrorState error={complaints.error} onRetry={() => void complaints.reload()} />
            ) : !complaints.data ? (
              <LoadingState label="Loading complaints..." />
            ) : (
              <DataTable caption="Complaints pending with this biller" columns={complaintCols} rows={complaints.data} rowKey={(c) => c.complaintId} empty="No open complaints pending with you." />
            )}
          </Card>
          <Card title="Payments">
            <DataTable caption="Payments received" columns={paymentCols} rows={o.payments} rowKey={(p) => p.id} empty="No payments received yet" />
          </Card>
        </>
      )}
    </main>
  );
}
