"use client";

import { useState, type ReactNode } from "react";
import { getNbblComplaint, getNbblComplaintStats, getNbblComplaints, nbblComplaintAction } from "@/lib/client/api";
import { COMPLAINT_NOTE_MAX, pendingWithLabel } from "@/lib/domain/complaints";
import {
  COMPLAINT_PARTIES,
  COMPLAINT_PARTY_LABELS,
  COMPLAINT_REASON_LABELS,
  COMPLAINT_RESOLUTIONS,
  COMPLAINT_RESOLUTION_LABELS,
  type ComplaintActionRequest,
  type ComplaintParty,
  type ComplaintResolution,
  type ComplaintStatus,
  type NbblComplaint,
  type NbblComplaintDetail,
} from "@/lib/domain/types";
import { Button, Card, DataTable, ErrorState, KpiTile, LoadingState, Money, StatusPill, formatDateTime, formatNumber, type Column } from "@/components/ui";
import { Notice, errMsg } from "@/components/consoles/PageShell";
import { useAsync } from "@/components/consoles/useAsync";

const HOUR_MS = 3_600_000;

function age(c: NbblComplaint): string {
  const end = c.closedAt ? new Date(c.closedAt).getTime() : Date.now();
  const ms = Math.max(0, end - new Date(c.createdAt).getTime());
  const d = Math.floor(ms / (24 * HOUR_MS));
  const h = Math.floor((ms % (24 * HOUR_MS)) / HOUR_MS);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

function PendingPill({ c }: { c: NbblComplaint }) {
  return c.status === "CLOSED" ? (
    <span className="text-ink-faint">—</span>
  ) : (
    <StatusPill status={c.pendingWith} label={pendingWithLabel(c.pendingWith, c.billerName)} />
  );
}

const cols = (selected: string | null): Column<NbblComplaint>[] => [
  { key: "id", header: "Complaint", render: (c) => <span className={`font-mono ${c.complaintId === selected ? "font-semibold" : ""}`}>{c.complaintId}</span> },
  { key: "ticket", header: "COU ticket", render: (c) => <span className="font-mono">{c.couTicketNo}</span> },
  { key: "txn", header: "Txn ref", render: (c) => (c.txnRef ? <span className="font-mono">{c.txnRef}</span> : "—") },
  { key: "biller", header: "Biller", render: (c) => c.billerName ?? c.billerId ?? "—" },
  { key: "reason", header: "Reason", render: (c) => COMPLAINT_REASON_LABELS[c.reason] },
  { key: "pending", header: "Pending with", render: (c) => <PendingPill c={c} /> },
  { key: "status", header: "Status", render: (c) => <StatusPill status={c.status} /> },
  {
    key: "due",
    header: "Due",
    render: (c) => (
      <span className="inline-flex items-center gap-2">
        {formatDateTime(c.dueAt)}
        {c.overdue ? <StatusPill status="OVERDUE" label="Overdue" /> : null}
      </span>
    ),
  },
  { key: "age", header: "Age", align: "right", render: (c) => age(c) },
];

const selectCls = "rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children}</dd>
    </div>
  );
}

function ActionBar({ c, onDone }: { c: NbblComplaintDetail; onDone: (d: NbblComplaintDetail) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [resolution, setResolution] = useState<ComplaintResolution>("RESOLVED");
  const open = c.status === "OPEN";

  async function run(req: ComplaintActionRequest, clearNote = true) {
    setBusy(true);
    setError(null);
    try {
      const d = await nbblComplaintAction(c.complaintId, req);
      if (clearNote) setNote("");
      onDone(d);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  const trimmed = note.trim();

  return (
    <div className="space-y-4 border-t border-line p-4">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {open ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Assign to">
          <span className="text-sm font-medium text-ink">Assign to</span>
          {COMPLAINT_PARTIES.map((p: ComplaintParty) => (
            <Button key={p} size="sm" disabled={busy || c.pendingWith === p} onClick={() => void run({ action: "ASSIGN", assignTo: p }, false)}>
              {p === "BILLER" && c.billerName ? c.billerName : COMPLAINT_PARTY_LABELS[p]}
            </Button>
          ))}
        </div>
      ) : null}
      <div>
        <label htmlFor="cmp-note" className="block text-sm font-medium text-ink">
          Note
        </label>
        <textarea
          id="cmp-note"
          value={note}
          maxLength={COMPLAINT_NOTE_MAX}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-lg border border-line-strong bg-surface p-2 text-sm text-ink"
        />
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy || !trimmed} onClick={() => void run({ action: "NOTE", note: trimmed })}>
            Add note
          </Button>
          <span className="text-xs text-ink-faint">
            {note.length}/{COMPLAINT_NOTE_MAX}
          </span>
        </div>
      </div>
      {open ? (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="cmp-res" className="block text-sm font-medium text-ink">
              Resolution
            </label>
            <select id="cmp-res" value={resolution} onChange={(e) => setResolution(e.target.value as ComplaintResolution)} className={`mt-1 ${selectCls}`}>
              {COMPLAINT_RESOLUTIONS.map((r) => (
                <option key={r} value={r}>
                  {COMPLAINT_RESOLUTION_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          <Button variant="primary" disabled={busy} onClick={() => void run({ action: "CLOSE", resolution, note: trimmed || undefined })}>
            Close complaint
          </Button>
        </div>
      ) : (
        <Button variant="primary" disabled={busy} onClick={() => void run({ action: "REOPEN", note: trimmed || undefined })}>
          Reopen complaint
        </Button>
      )}
      {busy ? (
        <p className="text-xs text-ink-muted" aria-live="polite">
          Working...
        </p>
      ) : null}
    </div>
  );
}

function Detail({ id, paused, onViewTxn, onChanged }: { id: string; paused: boolean; onViewTxn: (ref: string) => void; onChanged: () => void }) {
  const detail = useAsync(() => getNbblComplaint(id), id, { intervalMs: 3000, paused });
  // useAsync keeps the previous row's data until the new id loads; show loading, not stale data.
  const c = detail.data?.complaintId === id ? detail.data : undefined;
  return (
    <Card
      title={
        <span>
          Complaint <span className="font-mono text-ink-muted">{id}</span>
        </span>
      }
      className="mt-6"
    >
      {detail.error ? (
        <ErrorState error={detail.error} onRetry={() => void detail.reload()} />
      ) : detail.loading || !c ? (
        <LoadingState label="Loading complaint..." />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 text-sm">
            <StatusPill status={c.status} />
            {c.status === "OPEN" ? (
              <span className="inline-flex items-center gap-1">
                Pending with <PendingPill c={c} />
              </span>
            ) : c.resolution ? (
              <StatusPill status={c.resolution} label={COMPLAINT_RESOLUTION_LABELS[c.resolution]} tone="success" />
            ) : null}
            <span className="text-ink-muted">Due {formatDateTime(c.dueAt)}</span>
            {c.overdue ? <StatusPill status="OVERDUE" label="Overdue" /> : null}
          </div>
          <dl className="grid grid-cols-2 gap-4 p-4 lg:grid-cols-4">
            <Field label="Customer ref">{c.customerRefMasked ?? "—"}</Field>
            <Field label="Amount">
              <Money paise={c.amountPaise} />
            </Field>
            <Field label="Order id">
              <span className="font-mono">{c.orderId}</span>
            </Field>
            <Field label="Reason">{COMPLAINT_REASON_LABELS[c.reason]}</Field>
            <div className="col-span-2 lg:col-span-4">
              <Field label="Description">{c.description ?? "—"}</Field>
            </div>
          </dl>
          <div className="mx-4 mb-4 rounded-lg border border-line bg-surface-2 p-3 text-sm">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Linked transaction</div>
            {c.linkedTxn ? (
              <LinkedTxn txn={c.linkedTxn} onViewTxn={onViewTxn} />
            ) : (
              <span className="text-ink-muted">No payment transaction linked{c.txnRef ? ` (${c.txnRef} not found)` : ""}.</span>
            )}
          </div>
          <h3 className="px-4 text-sm font-semibold text-ink">Timeline</h3>
          <ol className="p-4">
            {c.events.map((ev) => (
              <li key={ev.id} className="relative pb-4 pl-6 last:pb-0">
                <span aria-hidden className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full bg-accent" />
                <span aria-hidden className="absolute left-[4px] top-4 h-full w-px bg-line" />
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono text-xs font-semibold text-ink">{ev.action}</span>
                  {ev.fromParty || ev.toParty ? (
                    <span className="text-ink-muted">
                      {ev.fromParty ? COMPLAINT_PARTY_LABELS[ev.fromParty] : "—"} → {ev.toParty ? COMPLAINT_PARTY_LABELS[ev.toParty] : "—"}
                    </span>
                  ) : null}
                  <span className="text-xs text-ink-muted">by {ev.actor}</span>
                  <span className="text-xs text-ink-faint">{formatDateTime(ev.at)}</span>
                </div>
                {ev.note ? <p className="mt-0.5 text-sm text-ink">{ev.note}</p> : null}
              </li>
            ))}
          </ol>
          <ActionBar
            key={c.complaintId}
            c={c}
            onDone={() => {
              void detail.reload();
              onChanged();
            }}
          />
        </>
      )}
    </Card>
  );
}

function LinkedTxn({ txn, onViewTxn }: { txn: NonNullable<NbblComplaintDetail["linkedTxn"]>; onViewTxn: (ref: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="font-mono">{txn.ref}</span>
      <StatusPill status={txn.type} />
      <StatusPill status={txn.status} />
      {txn.amountPaise === null ? null : <Money paise={txn.amountPaise} />}
      <Button size="sm" onClick={() => onViewTxn(txn.ref)}>
        View hop timeline
      </Button>
    </div>
  );
}

export function ComplaintsView({ paused, onViewTxn }: { paused: boolean; onViewTxn: (ref: string) => void }) {
  const [status, setStatus] = useState<ComplaintStatus | "">("");
  const [party, setParty] = useState<ComplaintParty | "">("");
  const [selected, setSelected] = useState<string | null>(null);
  const stats = useAsync(getNbblComplaintStats, "cstats", { intervalMs: 3000, paused });
  const list = useAsync(
    () => getNbblComplaints({ status: status || undefined, pendingWith: party || undefined }),
    `clist:${status}:${party}`,
    { intervalMs: 3000, paused },
  );
  const s = stats.data;
  const n = (v: number | undefined) => (v === undefined ? "-" : formatNumber(v));

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <KpiTile label="Open" value={n(s?.open)} />
        <KpiTile label="Overdue" value={n(s?.overdue)} />
        <KpiTile label="With biller" value={n(s?.byParty.BILLER)} />
        <KpiTile label="With NBBL" value={n(s?.byParty.NBBL)} />
        <KpiTile label="With COU" value={n(s?.byParty.COU)} />
        <KpiTile label="Closed" value={n(s?.closed)} />
      </div>

      <Card
        title="Complaints"
        actions={
          <>
            <label className="flex items-center gap-1.5 text-xs text-ink-muted">
              Status
              <select value={status} onChange={(e) => setStatus(e.target.value as ComplaintStatus | "")} className={selectCls}>
                <option value="">All</option>
                <option value="OPEN">Open</option>
                <option value="CLOSED">Closed</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-ink-muted">
              Pending with
              <select value={party} onChange={(e) => setParty(e.target.value as ComplaintParty | "")} className={selectCls}>
                <option value="">All</option>
                {COMPLAINT_PARTIES.map((p) => (
                  <option key={p} value={p}>
                    {COMPLAINT_PARTY_LABELS[p]}
                  </option>
                ))}
              </select>
            </label>
          </>
        }
      >
        {list.error ? (
          <ErrorState error={list.error} onRetry={() => void list.reload()} />
        ) : list.loading || !list.data ? (
          <LoadingState label="Loading complaints..." />
        ) : (
          <DataTable
            caption="NBBL complaints"
            columns={cols(selected)}
            rows={list.data}
            rowKey={(c) => c.complaintId}
            empty="No complaints match. Raise one from the customer app."
            onRowClick={(c) => setSelected(c.complaintId)}
            selectedKey={selected}
          />
        )}
      </Card>

      {selected ? (
        <Detail
          id={selected}
          paused={paused}
          onViewTxn={onViewTxn}
          onChanged={() => {
            void list.reload();
            void stats.reload();
          }}
        />
      ) : null}
    </>
  );
}
