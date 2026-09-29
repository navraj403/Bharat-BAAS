-- Bharat BaaS: customer complaints (docs/COMPLAINTS_PLAN.md "Design").
-- Idempotent: safe to run more than once. Additive only (no change to 0001 tables).
-- NBBL is the system of record for status / pending-with / timeline; the COU keeps its own
-- ticket row and reads live status from NBBL through nbbl/api. Cross-party links are plain values.

-- ─── NBBL (Bharat Connect switch): BBPS complaints + timeline ───────────────
create table if not exists nbbl_complaints (
  id                   uuid primary key default gen_random_uuid(),
  complaint_id         text not null unique,     -- BBPS complaint ref: CC + 10 [A-Z0-9]
  cou_id               text not null,
  cou_ticket_no        text not null,            -- the COU's ticket (DPT-XXXXXXXX)
  order_id             text not null,            -- the COU order it is about
  txn_ref              text,                     -- PAY bbpsTxnRef; null when NBBL never saw a payment
  biller_id            text,
  customer_ref_masked  text,                     -- masked only (vehicle / 98XXXXXX01)
  amount_paise         integer not null check (amount_paise >= 0),
  reason               text not null check (reason in
                         ('DUPLICATE_PAYMENT', 'DEBITED_TXN_FAILED', 'PAID_BILL_PENDING', 'WRONG_AMOUNT', 'OTHER')),
  description          text,
  status               text not null default 'OPEN' check (status in ('OPEN', 'CLOSED')),
  pending_with         text not null check (pending_with in ('COU', 'NBBL', 'BILLER')),
  resolution           text check (resolution in ('RESOLVED', 'REJECTED', 'REFUNDED')),
  due_at               timestamptz not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  closed_at            timestamptz,
  unique (cou_id, cou_ticket_no)
);
create index if not exists nbbl_complaints_created_idx on nbbl_complaints (created_at desc);
create index if not exists nbbl_complaints_status_idx on nbbl_complaints (status, pending_with);
create index if not exists nbbl_complaints_order_idx on nbbl_complaints (cou_id, order_id, reason);

create table if not exists nbbl_complaint_events (
  id            bigserial primary key,
  complaint_id  text not null,                   -- nbbl_complaints.complaint_id
  action        text not null check (action in ('RAISED', 'ASSIGNED', 'NOTE', 'CLOSED', 'REOPENED')),
  from_party    text check (from_party in ('COU', 'NBBL', 'BILLER')),
  to_party      text check (to_party in ('COU', 'NBBL', 'BILLER')),
  actor         text not null,
  note          text,
  at            timestamptz not null default now()
);
create index if not exists nbbl_complaint_events_complaint_idx on nbbl_complaint_events (complaint_id, id);

-- ─── COU (DemoPay): the customer's ticket ───────────────────────────────────
create table if not exists cou_complaints (
  id            uuid primary key default gen_random_uuid(),
  ticket_no     text not null unique,            -- DPT-XXXXXXXX
  order_id      text not null,                   -- cou_payments.order_id
  complaint_id  text not null,                   -- NBBL ref (CC…)
  reason        text not null,
  description   text,
  created_at    timestamptz not null default now()
);
create index if not exists cou_complaints_created_idx on cou_complaints (created_at desc);
