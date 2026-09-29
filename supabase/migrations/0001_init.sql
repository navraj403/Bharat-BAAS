-- Bharat BaaS: initial schema (docs/BUILD_PLAN.md §6.4).
-- Idempotent: safe to run more than once. Money = integer paise, distance = integer km.
-- Each party owns its tables by prefix: oem_*, biller_*, nbbl_*, cou_*.
-- Cross-party links are plain values (no cross-prefix foreign keys) to keep parties isolated.
-- RLS stays OFF for the prototype (server-only connection); P4 enables it before sharing.

-- gen_random_uuid() is built in on PostgreSQL 13+.

-- ─── OEM (Maruti Suzuki, telematics) ────────────────────────────────────────
create table if not exists oem_plans (
  id                 text primary key,
  name               text not null,
  fixed_fee_paise    integer not null check (fixed_fee_paise >= 0),
  rate_paise_per_km  integer not null check (rate_paise_per_km >= 0)
);

create table if not exists oem_vehicles (
  id            uuid primary key default gen_random_uuid(),
  reg_no        text not null unique,
  vin           text not null,
  model         text not null,
  plan_id       text not null references oem_plans(id),
  odometer_km   integer not null default 0 check (odometer_km >= 0),
  activated_on  date not null
);

create table if not exists oem_trips (
  id           uuid primary key default gen_random_uuid(),
  vehicle_id   uuid not null references oem_vehicles(id) on delete cascade,
  km           integer not null check (km >= 0),
  recorded_at  timestamptz not null default now()
);
create index if not exists oem_trips_vehicle_recorded_idx on oem_trips (vehicle_id, recorded_at);

create table if not exists oem_bills (
  id                 uuid primary key default gen_random_uuid(),
  bill_no            text not null unique,
  vehicle_id         uuid not null references oem_vehicles(id) on delete cascade,
  plan_id            text not null references oem_plans(id),
  cycle              text not null check (cycle ~ '^\d{4}-\d{2}$'),
  km_driven          integer not null check (km_driven >= 0),
  fixed_fee_paise    integer not null,
  rate_paise_per_km  integer not null,
  variable_paise     integer not null,
  subtotal_paise     integer not null,
  gst_paise          integer not null,
  total_paise        integer not null,
  bill_date          date not null,
  due_date           date not null,
  payment_status     text not null default 'UNPAID' check (payment_status in ('UNPAID', 'PAID')),
  paid_ref           text,
  paid_at            timestamptz,
  created_at         timestamptz not null default now(),
  unique (vehicle_id, cycle)
);
create index if not exists oem_bills_cycle_idx on oem_bills (cycle);

-- ─── Biller (BaaS financier; BOU folded in) ─────────────────────────────────
create table if not exists biller_billers (
  id        text primary key,
  name      text not null,
  category  text not null default 'EV_BAAS'
);

create table if not exists biller_customers (
  id              uuid primary key default gen_random_uuid(),
  biller_id       text not null references biller_billers(id),
  name            text not null,
  mobile          text not null check (mobile ~ '^\d{10}$'),
  vehicle_reg_no  text not null,
  contract_id     text not null,
  created_at      timestamptz not null default now(),
  unique (biller_id, vehicle_reg_no)
);
create index if not exists biller_customers_vehicle_idx on biller_customers (vehicle_reg_no);

create table if not exists biller_receivables (
  id               uuid primary key default gen_random_uuid(),
  biller_id        text not null references biller_billers(id),
  customer_id      uuid not null references biller_customers(id) on delete cascade,
  oem_bill_id      uuid not null unique,          -- value link to oem_bills.id (no FK: party isolation)
  cycle            text not null,
  subtotal_paise   integer not null,
  gst_paise        integer not null,
  total_paise      integer not null,
  due_date         date not null,
  status           text not null default 'UNPAID' check (status in ('UNPAID', 'OVERDUE', 'PAID')),
  late_fee_paise   integer not null default 0,
  synced_at        timestamptz not null default now(),
  paid_payment_id  uuid
);
create index if not exists biller_receivables_customer_idx on biller_receivables (customer_id, status);
create index if not exists biller_receivables_biller_idx on biller_receivables (biller_id, status);

create table if not exists biller_presentments (
  id              uuid primary key default gen_random_uuid(),
  biller_id       text not null references biller_billers(id),
  customer_id     uuid not null references biller_customers(id) on delete cascade,
  receivable_ids  uuid[] not null,
  amount_paise    integer not null,
  breakdown       jsonb not null,               -- BillPresentment JSON (types.ts)
  status          text not null default 'OPEN' check (status in ('OPEN', 'PAID')),
  created_at      timestamptz not null default now()
);
create index if not exists biller_presentments_customer_idx on biller_presentments (customer_id, created_at desc);

create table if not exists biller_payments (
  id               uuid primary key default gen_random_uuid(),
  biller_id        text not null references biller_billers(id),
  presentment_id   uuid not null references biller_presentments(id),
  bbps_txn_ref     text not null unique,
  amount_paise     integer not null,
  mode             text not null,
  paid_at          timestamptz not null default now()
);
create index if not exists biller_payments_biller_idx on biller_payments (biller_id, paid_at desc);

-- ─── NBBL (Bharat Connect switch): transaction data only, never bills ───────
create table if not exists nbbl_billers (
  id        text primary key,
  name      text not null,
  category  text not null,
  status    text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE'))
);

create table if not exists nbbl_transactions (
  id                   uuid primary key default gen_random_uuid(),
  ref                  text not null unique,     -- FETCH: F-XXXXXXXXXX · PAY: bbpsTxnRef BCXXXXXXXXXX
  type                 text not null check (type in ('FETCH', 'PAY')),
  cou_id               text not null,
  biller_id            text not null,
  category             text not null,
  customer_ref_masked  text not null,
  amount_paise         integer,
  status               text not null default 'PENDING' check (status in ('PENDING', 'SUCCESS', 'FAILED')),
  response_code        text,
  fetch_ref            text,                     -- PAY: the FETCH it paid
  biller_ref           text,                     -- biller presentment id (routing reference only)
  created_at           timestamptz not null default now(),
  completed_at         timestamptz,
  latency_ms           integer
);
create index if not exists nbbl_transactions_created_idx on nbbl_transactions (created_at desc);
create index if not exists nbbl_transactions_fetch_ref_idx on nbbl_transactions (fetch_ref);

create table if not exists nbbl_events (
  id       bigserial primary key,
  txn_ref  text not null,
  step     text not null,
  payload  jsonb not null default '{}'::jsonb,
  at       timestamptz not null default now()
);
create index if not exists nbbl_events_txn_idx on nbbl_events (txn_ref, id);

-- ─── COU (DemoPay customer app) ─────────────────────────────────────────────
create table if not exists cou_payments (
  id              uuid primary key default gen_random_uuid(),
  order_id        text not null unique,
  fetch_ref       text not null,
  bbps_txn_ref    text,
  biller_id       text,
  vehicle_reg_no  text,
  amount_paise    integer not null,
  mode            text not null,
  status          text not null default 'INITIATED' check (status in ('INITIATED', 'SUCCESS', 'FAILED')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists cou_payments_created_idx on cou_payments (created_at desc);
