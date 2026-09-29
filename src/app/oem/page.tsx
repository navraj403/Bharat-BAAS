"use client";

import { useState } from "react";
import { addOemTrip, generateOemBills, getOemBills, getOemVehicles } from "@/lib/client/api";
import type { OemBill, OemVehicleRow } from "@/lib/domain/types";
import { Button, Card, DataTable, ErrorState, LoadingState, Money, StatusPill, currentCycle, formatNumber, formatRegNo, type Column } from "@/components/ui";
import { ConfirmBar } from "@/components/consoles/ConfirmBar";
import { Notice, PageHeader, errMsg } from "@/components/consoles/PageShell";
import { useAsync } from "@/components/consoles/useAsync";

export default function OemPage() {
  const vehicles = useAsync(getOemVehicles, "vehicles");
  const bills = useAsync(() => getOemBills(), "bills");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [cycle, setCycle] = useState(currentCycle);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger" | "info"; text: string } | null>(null);

  async function refresh() {
    await Promise.all([vehicles.reload(), bills.reload()]);
  }

  async function addKm(v: OemVehicleRow, km: number) {
    if (!Number.isInteger(km) || km <= 0) {
      setMsg({ tone: "danger", text: "Enter a whole number of km greater than 0." });
      return;
    }
    setBusyId(v.id);
    try {
      await addOemTrip(v.id, km);
      setMsg({ tone: "success", text: `Added ${km} km to ${formatRegNo(v.regNo)}.` });
      setCustom((c) => ({ ...c, [v.id]: "" }));
      await refresh();
    } catch (e) {
      setMsg({ tone: "danger", text: `Could not add km: ${errMsg(e)}` });
    } finally {
      setBusyId(null);
    }
  }

  async function generate(ids: string[] | undefined, label: string) {
    setBusyId(ids?.[0] ?? "__bulk");
    try {
      const r = await generateOemBills(cycle, ids);
      setMsg(
        r.generated.length > 0
          ? { tone: "success", text: `${label}: generated ${r.generated.length} bill(s) for ${cycle}.` }
          : { tone: "info", text: `${label}: nothing to generate, ${cycle} bill(s) already exist.` },
      );
      setConfirmBulk(false);
      await refresh();
    } catch (e) {
      setMsg({ tone: "danger", text: `Bill generation failed: ${errMsg(e)}` });
    } finally {
      setBusyId(null);
    }
  }

  const vehicleCols: Column<OemVehicleRow>[] = [
    { key: "reg", header: "Reg no", render: (v) => <span className="font-mono font-medium">{formatRegNo(v.regNo)}</span> },
    { key: "model", header: "Model", render: (v) => v.model },
    {
      key: "plan",
      header: "Plan",
      render: (v) => (
        <span>
          {v.planName} <span className="text-ink-faint">(<Money paise={v.fixedFeePaise} /> + <Money paise={v.ratePaisePerKm} />/km)</span>
        </span>
      ),
    },
    { key: "odo", header: "Odometer", align: "right", render: (v) => `${formatNumber(v.odometerKm)} km` },
    { key: "km", header: "Km this cycle", align: "right", render: (v) => <span className="font-semibold">{formatNumber(v.kmThisCycle)} km</span> },
    {
      key: "last",
      header: "Last bill",
      render: (v) =>
        v.lastBill ? (
          <span className="flex items-center gap-2">
            {v.lastBill.cycle} <StatusPill status={v.lastBill.paymentStatus} />
          </span>
        ) : (
          <span className="text-ink-faint">No bill yet</span>
        ),
    },
    {
      key: "km-actions",
      header: "Add km",
      render: (v) => (
        <div className="flex items-center gap-1.5">
          <Button size="sm" disabled={busyId === v.id} onClick={() => void addKm(v, 100)}>
            +100 km
          </Button>
          <Button size="sm" disabled={busyId === v.id} onClick={() => void addKm(v, 500)}>
            +500 km
          </Button>
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              void addKm(v, Number(custom[v.id]));
            }}
          >
            <input
              type="number"
              min={1}
              inputMode="numeric"
              aria-label={`Custom km for ${formatRegNo(v.regNo)}`}
              placeholder="km"
              value={custom[v.id] ?? ""}
              onChange={(e) => setCustom((c) => ({ ...c, [v.id]: e.target.value }))}
              className="w-20 rounded-lg border border-line-strong bg-surface px-2 py-1 text-sm"
            />
            <Button size="sm" type="submit" disabled={busyId === v.id || !custom[v.id]}>
              Add
            </Button>
          </form>
        </div>
      ),
    },
    {
      key: "gen",
      header: "Bill",
      render: (v) => (
        <Button variant="brand" disabled={busyId === v.id} onClick={() => void generate([v.id], formatRegNo(v.regNo))}>
          Generate bill
        </Button>
      ),
    },
  ];

  const billCols: Column<OemBill>[] = [
    { key: "cycle", header: "Cycle", render: (b) => b.cycle },
    { key: "reg", header: "Reg no", render: (b) => <span className="font-mono">{formatRegNo(b.regNo)}</span> },
    { key: "km", header: "Km", align: "right", render: (b) => formatNumber(b.kmDriven) },
    { key: "fixed", header: "Fixed", align: "right", render: (b) => <Money paise={b.fixedFeePaise} /> },
    { key: "var", header: "Variable", align: "right", render: (b) => <Money paise={b.variablePaise} /> },
    { key: "gst", header: "GST", align: "right", render: (b) => <Money paise={b.gstPaise} /> },
    { key: "total", header: "Total", align: "right", render: (b) => <Money paise={b.totalPaise} className="font-semibold" /> },
    { key: "status", header: "Payment", render: (b) => <StatusPill status={b.paymentStatus} /> },
  ];

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
      <PageHeader title="OEM console" subtitle="Maruti Suzuki: telematics, plans and monthly bill generation." />
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}

      <Card
        title="Vehicles"
        className="mb-6"
        actions={
          <>
            <label className="text-xs text-ink-muted" htmlFor="cycle">
              Cycle
            </label>
            <input
              id="cycle"
              type="month"
              value={cycle}
              onChange={(e) => setCycle(e.target.value)}
              className="rounded-lg border border-line-strong bg-surface px-2 py-1 text-sm"
            />
            <Button variant="secondary" size="sm" disabled={!cycle || confirmBulk} onClick={() => setConfirmBulk(true)}>
              Generate bills for {cycle || "..."}
            </Button>
          </>
        }
      >
        {confirmBulk ? (
          <ConfirmBar confirmLabel={`Generate for ${cycle}`} busy={busyId === "__bulk"} onConfirm={() => void generate(undefined, "Bulk")} onCancel={() => setConfirmBulk(false)}>
            This bills every active vehicle without a {cycle} bill, including Riya, Arjun and Meera. Kabir&apos;s demo bill will no longer be the only new one.
          </ConfirmBar>
        ) : null}
        {vehicles.error ? (
          <ErrorState error={vehicles.error} onRetry={() => void vehicles.reload()} />
        ) : vehicles.loading || !vehicles.data ? (
          <LoadingState label="Loading vehicles..." />
        ) : (
          <DataTable caption="OEM vehicles" columns={vehicleCols} rows={vehicles.data} rowKey={(v) => v.id} empty="No vehicles" />
        )}
      </Card>

      <Card title="Bills">
        {bills.error ? (
          <ErrorState error={bills.error} onRetry={() => void bills.reload()} />
        ) : bills.loading || !bills.data ? (
          <LoadingState label="Loading bills..." />
        ) : (
          <DataTable caption="OEM bills" columns={billCols} rows={bills.data} rowKey={(b) => b.id} empty="No bills generated yet" />
        )}
      </Card>
    </main>
  );
}
