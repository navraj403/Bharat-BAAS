"use client";

import { useCallback, useEffect, useState } from "react";
import { getCouComplaints, getCouOrders, raiseCouComplaint } from "@/lib/client/api";
import { COMPLAINT_DESCRIPTION_MAX, pendingWithLabel } from "@/lib/domain/complaints";
import { formatINR } from "@/lib/domain/money";
import {
  COMPLAINT_REASONS,
  COMPLAINT_REASON_LABELS,
  COMPLAINT_RESOLUTION_LABELS,
  type ComplaintReason,
  type CouComplaint,
  type CouOrder,
} from "@/lib/domain/types";
import { Button, Card, FOCUS, Pill, Screen, Spinner } from "./ui";
import { Icon } from "./icons";
import { displayVehicle, formatDate } from "./format";

type Tab = "raise" | "tickets";

const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export function HelpScreen({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<Tab>("raise");
  return (
    <Screen
      title="Help & support"
      onBack={onBack}
      headerExtra={
        <div role="tablist" aria-label="Help sections" className="flex gap-1 rounded-full bg-white/15 p-1 text-sm font-semibold">
          {(
            [
              ["raise", "Raise a complaint"],
              ["tickets", "My tickets"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`help-tab-${id}`}
              aria-selected={tab === id}
              aria-controls="help-panel"
              onClick={() => setTab(id)}
              className={`h-9 flex-1 rounded-full px-2 focus-visible:outline-2 focus-visible:outline-white ${
                tab === id ? "bg-white text-pay-deep" : "text-white hover:bg-white/10"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      }
    >
      <div role="tabpanel" id="help-panel" aria-labelledby={`help-tab-${tab}`}>
        {tab === "raise" ? <RaiseFlow onViewTickets={() => setTab("tickets")} /> : <TicketsList />}
      </div>
    </Screen>
  );
}

// ─── Raise a complaint ───────────────────────────────────────────────────────

function StatusPill({ status }: { status: CouOrder["status"] }) {
  if (status === "SUCCESS") return <Pill tone="success">SUCCESS</Pill>;
  if (status === "FAILED") return <Pill tone="danger">FAILED</Pill>;
  return <Pill tone="warning">{status}</Pill>;
}

function RaiseFlow({ onViewTickets }: { onViewTickets: () => void }) {
  const [orders, setOrders] = useState<CouOrder[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [order, setOrder] = useState<CouOrder | null>(null);
  const [reason, setReason] = useState<ComplaintReason | null>(null);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<CouComplaint | null>(null);

  const fetchOrders = useCallback(
    () => getCouOrders().then(setOrders, (e) => setLoadError(errMsg(e, "Couldn't load your orders."))),
    [],
  );
  const load = useCallback(() => {
    setOrders(null);
    setLoadError(null);
    void fetchOrders();
  }, [fetchOrders]);
  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  function reset() {
    setOrder(null);
    setReason(null);
    setDescription("");
    setSubmitError(null);
    setTicket(null);
    load();
  }

  async function submit() {
    if (!order || !reason || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const d = description.trim();
      setTicket(await raiseCouComplaint({ orderId: order.orderId, reason, ...(d ? { description: d } : {}) }));
    } catch (e) {
      setSubmitError(errMsg(e, "We couldn't raise your complaint. Try again."));
    } finally {
      setSubmitting(false);
    }
  }

  // Step 3: confirmation
  if (ticket) {
    return (
      <div className="space-y-3">
        <Card className="text-center">
          <span className="mx-auto mb-2 flex size-14 items-center justify-center rounded-full bg-success-soft text-success">
            <Icon name="checkCircle" className="size-8" />
          </span>
          <h2 className="text-base font-semibold text-ink">Complaint raised</h2>
          <p className="mt-1 text-sm text-ink-muted">We&apos;ll resolve this by {formatDate(ticket.dueAt)}.</p>
        </Card>
        <Card>
          <dl className="space-y-2 text-sm">
            <Row label="Ticket no" value={ticket.ticketNo} mono />
            <Row label="BBPS complaint id" value={ticket.complaintId} mono />
            <Row label="Reason" value={COMPLAINT_REASON_LABELS[ticket.reason]} />
            <Row label="Status" value={`Pending with ${pendingWithLabel(ticket.pendingWith, ticket.billerName)}`} />
            <Row label="Resolve by" value={formatDate(ticket.dueAt)} />
          </dl>
        </Card>
        <Button onClick={onViewTickets}>View my tickets</Button>
        <Button variant="secondary" onClick={reset}>
          Done
        </Button>
      </div>
    );
  }

  // Step 2: reason
  if (order) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => {
            setOrder(null);
            setSubmitError(null);
          }}
          className={`flex items-center gap-1 rounded text-sm font-semibold text-pay ${FOCUS}`}
        >
          <Icon name="back" className="size-4" /> Change order
        </button>
        <OrderCard order={order} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-3"
        >
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-semibold text-ink">What went wrong?</legend>
            {COMPLAINT_REASONS.map((r) => (
              <label
                key={r}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-pay ${
                  reason === r ? "border-pay bg-pay-soft text-pay-deep" : "border-pay-line bg-surface text-ink"
                }`}
              >
                <input
                  type="radio"
                  name="complaint-reason"
                  value={r}
                  checked={reason === r}
                  onChange={() => setReason(r)}
                  className="size-4 accent-pay"
                />
                {COMPLAINT_REASON_LABELS[r]}
              </label>
            ))}
          </fieldset>
          <div>
            <label htmlFor="complaint-desc" className="mb-1 block text-sm font-semibold text-ink">
              Add a note <span className="font-normal text-ink-muted">(optional)</span>
            </label>
            <textarea
              id="complaint-desc"
              rows={3}
              maxLength={COMPLAINT_DESCRIPTION_MAX}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={`w-full resize-none rounded-xl border border-pay-line bg-surface p-3 text-sm text-ink ${FOCUS}`}
            />
            <p className="mt-1 text-right text-xs text-ink-muted" aria-live="polite">
              {description.length}/{COMPLAINT_DESCRIPTION_MAX}
            </p>
          </div>
          {submitError && (
            <p role="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger">
              {submitError}
            </p>
          )}
          <Button type="submit" disabled={!reason} loading={submitting}>
            Submit complaint
          </Button>
        </form>
      </div>
    );
  }

  // Step 1: order list
  if (loadError)
    return (
      <div className="space-y-3">
        <p role="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger">
          {loadError}
        </p>
        <Button variant="secondary" onClick={load}>
          Try again
        </Button>
      </div>
    );
  if (!orders) return <Loading />;
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-ink">Select the payment you have a problem with</h2>
      {orders.length === 0 ? (
        <Card className="py-8 text-center text-sm text-ink-muted">
          You haven&apos;t made any payments yet, so there&apos;s nothing to complain about.
        </Card>
      ) : (
        <ul className="space-y-2">
          {orders.map((o) => (
            <li key={o.orderId}>
              <button
                type="button"
                onClick={() => setOrder(o)}
                className={`block w-full rounded-2xl text-left ${FOCUS}`}
                aria-label={`Select order ${o.orderId}, ${o.billerName ?? "payment"}, ${formatINR(o.amountPaise)}, ${o.status}`}
              >
                <OrderCard order={o} chevron />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OrderCard({ order, chevron }: { order: CouOrder; chevron?: boolean }) {
  return (
    <Card className="hover:bg-surface-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{order.billerName ?? "Bill payment"}</p>
          {order.vehicleRegNo && <p className="text-xs text-ink-muted">{displayVehicle(order.vehicleRegNo)}</p>}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold text-ink">{formatINR(order.amountPaise)}</p>
          <StatusPill status={order.status} />
        </div>
      </div>
      <div className="mt-2 flex items-end justify-between gap-2 text-xs text-ink-muted">
        <div className="min-w-0 break-all">
          <p>{formatDate(order.createdAt)}</p>
          <p>Order {order.orderId}</p>
          {order.bbpsTxnRef && <p>BBPS ref {order.bbpsTxnRef}</p>}
        </div>
        {chevron && <Icon name="chevron" className="size-4 shrink-0" />}
      </div>
    </Card>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={`text-right font-semibold text-ink ${mono ? "break-all font-mono text-xs leading-5" : ""}`}>{value}</dd>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex justify-center py-10 text-pay">
      <Spinner />
    </div>
  );
}

// ─── My tickets ──────────────────────────────────────────────────────────────

function TicketsList() {
  const [tickets, setTickets] = useState<CouComplaint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(true);

  const fetchTickets = useCallback(
    () =>
      getCouComplaints()
        .then(setTickets, (e) => setError(errMsg(e, "Couldn't load your tickets.")))
        .finally(() => setRefreshing(false)),
    [],
  );
  const load = useCallback(() => {
    setRefreshing(true);
    setError(null);
    void fetchTickets();
  }, [fetchTickets]);
  useEffect(() => {
    void fetchTickets();
  }, [fetchTickets]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Your tickets</h2>
        <button
          type="button"
          onClick={load}
          disabled={refreshing}
          className={`flex items-center gap-1 rounded px-2 py-1 text-sm font-semibold text-pay disabled:opacity-50 ${FOCUS}`}
        >
          <Icon name="repeat" className={`size-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger">
          {error}
        </p>
      )}
      {!tickets && !error && <Loading />}
      {tickets && tickets.length === 0 && (
        <Card className="py-8 text-center text-sm text-ink-muted">No tickets yet. Raise a complaint and it will show up here.</Card>
      )}
      {tickets && tickets.length > 0 && (
        <ul className="space-y-2">
          {tickets.map((t) => (
            <li key={t.ticketNo}>
              <TicketCard t={t} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TicketCard({ t }: { t: CouComplaint }) {
  const open = t.status === "OPEN";
  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-all font-mono text-xs font-semibold text-ink">{t.ticketNo}</p>
          <p className="mt-0.5 text-sm font-semibold text-ink">{COMPLAINT_REASON_LABELS[t.reason]}</p>
        </div>
        {open ? <Pill tone="warning">Open</Pill> : <Pill tone="success">Closed</Pill>}
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        {formatINR(t.amountPaise)} · {t.billerName ?? "Bill payment"}
      </p>
      <div className="mt-2 space-y-1 border-t border-pay-line pt-2 text-xs text-ink-muted">
        {open ? (
          <>
            <p>
              Pending with <span className="font-semibold text-ink">{pendingWithLabel(t.pendingWith, t.billerName)}</span>
            </p>
            <p className="flex flex-wrap items-center gap-2">
              <span>Due {formatDate(t.dueAt)}</span>
              {t.overdue && <Pill tone="danger">Overdue</Pill>}
            </p>
          </>
        ) : (
          <p>
            {t.resolution ? (
              <span className="font-semibold text-ink">{COMPLAINT_RESOLUTION_LABELS[t.resolution]}</span>
            ) : (
              "Closed"
            )}
            {t.closedAt && ` on ${formatDate(t.closedAt)}`}
          </p>
        )}
      </div>
    </Card>
  );
}
