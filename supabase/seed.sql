-- Bharat BaaS demo seed (docs/BUILD_PLAN.md §4). Deterministic; all dates relative to now().
-- SINGLE SOURCE OF TRUTH: scripts/db-seed.mjs runs this file; src/lib/db/seed-sql.generated.ts
-- is generated from it by scripts/db-gen-seed.mjs (a unit test fails if they drift).
-- Truncates every app table first, so it doubles as "reset demo data".
--
-- Acceptance (§4), in paise:
--   Riya  MH01AB1001 STD  Aug 1,200 km: 150000 + 420000 = 570000 + GST 102600 = 672600  → BILL_DUE ₹6,726.00
--   Arjun MH01AB1002 FLEX Jul   900 km:  99900 + 360000 = 459900 + GST  82782 = 542682  (OVERDUE, late fee 9198)
--                          Aug 1,100 km:  99900 + 440000 = 539900 + GST  97182 = 637082
--                          → BILL_DUE 637082 + 542682 + 9198 = 1188962 → ₹11,889.62
--   Meera MH01AB1003 PRO  Aug 1,850 km: 200000 + 832500 = 1032500 + GST 185850 = 1218350 → ALREADY_PAID ₹12,183.50 (BCSEEDPAID01)
--   Kabir MH01AB1004 STD  activated this month, no bill → NOT_GENERATED; +1,600 km → 150000 + 560000 = 710000 + 127800 = 837800 ₹8,378.00
-- "Aug" = previous calendar month (bill_date = today − 5, due = today + 5).
-- "Jul" = two months ago       (bill_date = today − 35, due = today − 25 → overdue).
-- ASSUMPTION: GST 18%, due = bill_date + 10 days, late fee 2% of subtotal (docs/DOMAIN.md §4).

truncate table
  cou_payments,
  nbbl_events, nbbl_transactions, nbbl_billers,
  biller_payments, biller_presentments, biller_receivables, biller_customers, biller_billers,
  oem_bills, oem_trips, oem_vehicles, oem_plans
restart identity cascade;

-- ─── OEM ────────────────────────────────────────────────────────────────────
insert into oem_plans (id, name, fixed_fee_paise, rate_paise_per_km) values
  ('STD',  'Standard',              150000, 350),   -- ASSUMPTION: fixed fees are illustrative
  ('PRO',  'Pro (long-range pack)', 200000, 450),
  ('FLEX', 'Flex',                   99900, 400);

insert into oem_vehicles (id, reg_no, vin, model, plan_id, odometer_km, activated_on) values
  ('11111111-0000-4000-8000-000000000001', 'MH01AB1001', 'SMEVDEMO000001001', 'Sample Motors Aura EV (sedan)', 'STD',   9380, (date_trunc('month', current_date) - interval '8 months')::date),
  ('11111111-0000-4000-8000-000000000002', 'MH01AB1002', 'SMEVDEMO000001002', 'Sample Motors Nova EV (hatch)', 'FLEX',  8150, (date_trunc('month', current_date) - interval '6 months')::date),
  ('11111111-0000-4000-8000-000000000003', 'MH01AB1003', 'SMEVDEMO000001003', 'Sample Motors Terra EV (SUV)',  'PRO',  14170, (date_trunc('month', current_date) - interval '10 months')::date),
  ('11111111-0000-4000-8000-000000000004', 'MH01AB1004', 'SMEVDEMO000001004', 'Sample Motors Aura EV (sedan)', 'STD',     12, date_trunc('month', current_date)::date);

-- Trips. Previous month ("Aug") and two months ago ("Jul") match the bills below.
-- Current month: small running totals for Riya/Arjun/Meera; Kabir has 0 km (no trips).
insert into oem_trips (vehicle_id, km, recorded_at) values
  -- Riya, Aug: 400 + 450 + 350 = 1,200
  ('11111111-0000-4000-8000-000000000001', 400, date_trunc('month', now()) - interval '1 month' + interval '4 days 9 hours'),
  ('11111111-0000-4000-8000-000000000001', 450, date_trunc('month', now()) - interval '1 month' + interval '12 days 18 hours'),
  ('11111111-0000-4000-8000-000000000001', 350, date_trunc('month', now()) - interval '1 month' + interval '21 days 8 hours'),
  -- Arjun, Jul: 500 + 400 = 900
  ('11111111-0000-4000-8000-000000000002', 500, date_trunc('month', now()) - interval '2 months' + interval '6 days 10 hours'),
  ('11111111-0000-4000-8000-000000000002', 400, date_trunc('month', now()) - interval '2 months' + interval '18 days 17 hours'),
  -- Arjun, Aug: 600 + 500 = 1,100
  ('11111111-0000-4000-8000-000000000002', 600, date_trunc('month', now()) - interval '1 month' + interval '7 days 11 hours'),
  ('11111111-0000-4000-8000-000000000002', 500, date_trunc('month', now()) - interval '1 month' + interval '19 days 19 hours'),
  -- Meera, Aug: 900 + 950 = 1,850
  ('11111111-0000-4000-8000-000000000003', 900, date_trunc('month', now()) - interval '1 month' + interval '5 days 8 hours'),
  ('11111111-0000-4000-8000-000000000003', 950, date_trunc('month', now()) - interval '1 month' + interval '16 days 20 hours'),
  -- Current month (midpoint between the 1st and now, so always inside the cycle and in the past)
  ('11111111-0000-4000-8000-000000000001', 180, date_trunc('month', now()) + (now() - date_trunc('month', now())) / 2),
  ('11111111-0000-4000-8000-000000000002', 150, date_trunc('month', now()) + (now() - date_trunc('month', now())) / 2),
  ('11111111-0000-4000-8000-000000000003', 320, date_trunc('month', now()) + (now() - date_trunc('month', now())) / 2);

insert into oem_bills (id, bill_no, vehicle_id, plan_id, cycle, km_driven, fixed_fee_paise, rate_paise_per_km,
                       variable_paise, subtotal_paise, gst_paise, total_paise, bill_date, due_date,
                       payment_status, paid_ref, paid_at, created_at) values
  -- Riya, Aug, STD 1,200 km → 672600
  ('22222222-0000-4000-8000-000000000001',
   'OEM-' || to_char(date_trunc('month', current_date) - interval '1 month', 'YYYYMM') || '-MH01AB1001',
   '11111111-0000-4000-8000-000000000001', 'STD',
   to_char(date_trunc('month', current_date) - interval '1 month', 'YYYY-MM'),
   1200, 150000, 350, 420000, 570000, 102600, 672600,
   current_date - 5, current_date + 5, 'UNPAID', null, null, now() - interval '5 days'),
  -- Arjun, Jul, FLEX 900 km → 542682 (overdue)
  ('22222222-0000-4000-8000-000000000002',
   'OEM-' || to_char(date_trunc('month', current_date) - interval '2 months', 'YYYYMM') || '-MH01AB1002',
   '11111111-0000-4000-8000-000000000002', 'FLEX',
   to_char(date_trunc('month', current_date) - interval '2 months', 'YYYY-MM'),
   900, 99900, 400, 360000, 459900, 82782, 542682,
   current_date - 35, current_date - 25, 'UNPAID', null, null, now() - interval '35 days'),
  -- Arjun, Aug, FLEX 1,100 km → 637082
  ('22222222-0000-4000-8000-000000000003',
   'OEM-' || to_char(date_trunc('month', current_date) - interval '1 month', 'YYYYMM') || '-MH01AB1002',
   '11111111-0000-4000-8000-000000000002', 'FLEX',
   to_char(date_trunc('month', current_date) - interval '1 month', 'YYYY-MM'),
   1100, 99900, 400, 440000, 539900, 97182, 637082,
   current_date - 5, current_date + 5, 'UNPAID', null, null, now() - interval '5 days'),
  -- Meera, Aug, PRO 1,850 km → 1218350 (paid)
  ('22222222-0000-4000-8000-000000000004',
   'OEM-' || to_char(date_trunc('month', current_date) - interval '1 month', 'YYYYMM') || '-MH01AB1003',
   '11111111-0000-4000-8000-000000000003', 'PRO',
   to_char(date_trunc('month', current_date) - interval '1 month', 'YYYY-MM'),
   1850, 200000, 450, 832500, 1032500, 185850, 1218350,
   current_date - 5, current_date + 5, 'PAID', 'BCSEEDPAID01', now() - interval '3 days', now() - interval '5 days');

-- ─── Biller ─────────────────────────────────────────────────────────────────
insert into biller_billers (id, name, category) values
  ('demo-finance', 'Demo Finance', 'EV_BAAS'),
  ('volt-leasing', 'Volt Leasing', 'EV_BAAS');

insert into biller_customers (id, biller_id, name, mobile, vehicle_reg_no, contract_id, created_at) values
  ('33333333-0000-4000-8000-000000000001', 'demo-finance', 'Riya Sharma', '9800000001', 'MH01AB1001', 'DF-BAAS-0001', now() - interval '8 months'),
  ('33333333-0000-4000-8000-000000000002', 'demo-finance', 'Arjun Mehta', '9800000002', 'MH01AB1002', 'DF-BAAS-0002', now() - interval '6 months'),
  ('33333333-0000-4000-8000-000000000003', 'volt-leasing', 'Meera Iyer',  '9800000003', 'MH01AB1003', 'VL-BAAS-0001', now() - interval '10 months'),
  ('33333333-0000-4000-8000-000000000004', 'demo-finance', 'Kabir Khan',  '9800000004', 'MH01AB1004', 'DF-BAAS-0003', date_trunc('month', now()));

-- Receivables = bills already synced from the OEM. Arjun's Jul bill is OVERDUE with its
-- one-time late fee applied (2% × 459900 = 9198). Meera's is PAID.
insert into biller_receivables (id, biller_id, customer_id, oem_bill_id, cycle, subtotal_paise, gst_paise, total_paise,
                                due_date, status, late_fee_paise, synced_at, paid_payment_id) values
  ('44444444-0000-4000-8000-000000000001', 'demo-finance', '33333333-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000001',
   to_char(date_trunc('month', current_date) - interval '1 month', 'YYYY-MM'), 570000, 102600, 672600,
   current_date + 5, 'UNPAID', 0, now() - interval '4 days', null),
  ('44444444-0000-4000-8000-000000000002', 'demo-finance', '33333333-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000002',
   to_char(date_trunc('month', current_date) - interval '2 months', 'YYYY-MM'), 459900, 82782, 542682,
   current_date - 25, 'OVERDUE', 9198, now() - interval '4 days', null),
  ('44444444-0000-4000-8000-000000000003', 'demo-finance', '33333333-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000003',
   to_char(date_trunc('month', current_date) - interval '1 month', 'YYYY-MM'), 539900, 97182, 637082,
   current_date + 5, 'UNPAID', 0, now() - interval '4 days', null),
  ('44444444-0000-4000-8000-000000000004', 'volt-leasing', '33333333-0000-4000-8000-000000000003', '22222222-0000-4000-8000-000000000004',
   to_char(date_trunc('month', current_date) - interval '1 month', 'YYYY-MM'), 1032500, 185850, 1218350,
   current_date + 5, 'PAID', 0, now() - interval '4 days', '66666666-0000-4000-8000-000000000001');

-- Meera's presentment (PAID). breakdown = BillPresentment JSON (src/lib/domain/types.ts).
insert into biller_presentments (id, biller_id, customer_id, receivable_ids, amount_paise, breakdown, status, created_at) values
  ('55555555-0000-4000-8000-000000000001', 'volt-leasing', '33333333-0000-4000-8000-000000000003',
   array['44444444-0000-4000-8000-000000000004']::uuid[], 1218350,
   jsonb_build_object(
     'presentmentId', '55555555-0000-4000-8000-000000000001',
     'billerId', 'volt-leasing',
     'billerName', 'Volt Leasing',
     'customerName', 'Meera I****',
     'vehicleRegNo', 'MH01AB1003',
     'planId', 'PRO',
     'planName', 'Pro (long-range pack)',
     'cycle', to_char(date_trunc('month', current_date) - interval '1 month', 'YYYY-MM'),
     'billPeriod', jsonb_build_object(
        'from', to_char(date_trunc('month', current_date) - interval '1 month', 'YYYY-MM-DD'),
        'to',   to_char(date_trunc('month', current_date) - interval '1 day', 'YYYY-MM-DD')),
     'billDate', to_char(current_date - 5, 'YYYY-MM-DD'),
     'dueDate',  to_char(current_date + 5, 'YYYY-MM-DD'),
     'overdue', false,
     'kmDriven', 1850,
     'currentCyclePaise', 1218350,
     'arrearsPaise', 0,
     'lateFeePaise', 0,
     'amountPaise', 1218350,
     'lines', jsonb_build_array(
        jsonb_build_object('kind', 'FIXED_FEE', 'label', 'Fixed battery fee',
                           'cycle', to_char(date_trunc('month', current_date) - interval '1 month', 'YYYY-MM'), 'amountPaise', 200000),
        jsonb_build_object('kind', 'USAGE', 'label', 'Pay-per-use (1,850 km × ₹4.50/km)',
                           'cycle', to_char(date_trunc('month', current_date) - interval '1 month', 'YYYY-MM'), 'amountPaise', 832500,
                           'km', 1850, 'ratePaisePerKm', 450),
        jsonb_build_object('kind', 'GST', 'label', 'GST @ 18%',
                           'cycle', to_char(date_trunc('month', current_date) - interval '1 month', 'YYYY-MM'), 'amountPaise', 185850,
                           'rateBps', 1800, 'basePaise', 1032500)),
     'cycles', jsonb_build_array(
        jsonb_build_object('cycle', to_char(date_trunc('month', current_date) - interval '1 month', 'YYYY-MM'),
                           'oemBillId', '22222222-0000-4000-8000-000000000004',
                           'oemBillNo', 'OEM-' || to_char(date_trunc('month', current_date) - interval '1 month', 'YYYYMM') || '-MH01AB1003',
                           'kmDriven', 1850, 'subtotalPaise', 1032500, 'gstPaise', 185850, 'totalPaise', 1218350,
                           'lateFeePaise', 0,
                           'billDate', to_char(current_date - 5, 'YYYY-MM-DD'),
                           'dueDate', to_char(current_date + 5, 'YYYY-MM-DD'),
                           'status', 'PAID'))),
   'PAID', now() - interval '3 days' - interval '2 minutes');

insert into biller_payments (id, biller_id, presentment_id, bbps_txn_ref, amount_paise, mode, paid_at) values
  ('66666666-0000-4000-8000-000000000001', 'volt-leasing', '55555555-0000-4000-8000-000000000001',
   'BCSEEDPAID01', 1218350, 'UPI_AUTOPAY', now() - interval '3 days');

-- ─── NBBL (registry + Meera's FETCH/PAY so the monitor is not empty) ────────
insert into nbbl_billers (id, name, category, status) values
  ('demo-finance', 'Demo Finance', 'EV_BAAS', 'ACTIVE'),
  ('volt-leasing', 'Volt Leasing', 'EV_BAAS', 'ACTIVE');

insert into nbbl_transactions (ref, type, cou_id, biller_id, category, customer_ref_masked, amount_paise, status,
                               response_code, fetch_ref, biller_ref, created_at, completed_at, latency_ms) values
  ('F-SEED000001', 'FETCH', 'DEMOPAY', 'volt-leasing', 'EV_BAAS', 'MH01AB1003 / 98XXXXXX03', 1218350, 'SUCCESS',
   '000', null, '55555555-0000-4000-8000-000000000001',
   now() - interval '3 days' - interval '2 minutes', now() - interval '3 days' - interval '2 minutes' + interval '142 milliseconds', 142),
  ('BCSEEDPAID01', 'PAY', 'DEMOPAY', 'volt-leasing', 'EV_BAAS', 'MH01AB1003 / 98XXXXXX03', 1218350, 'SUCCESS',
   '000', 'F-SEED000001', '55555555-0000-4000-8000-000000000001',
   now() - interval '3 days' - interval '188 milliseconds', now() - interval '3 days', 188);

insert into nbbl_events (txn_ref, step, payload, at) values
  ('F-SEED000001', 'COU_REQ',
   '{"initiatedBy":"AUTOPAY","couId":"DEMOPAY","billerId":"volt-leasing","category":"EV_BAAS","customerParams":{"vehicleRegNo":"MH01AB1003","registeredMobile":"98XXXXXX03"}}'::jsonb,
   now() - interval '3 days' - interval '2 minutes'),
  ('F-SEED000001', 'BILLER_REQ',
   '{"nbblRef":"F-SEED000001","billerId":"volt-leasing","vehicleNo":"MH01AB1003","mobile":"98XXXXXX03"}'::jsonb,
   now() - interval '3 days' - interval '2 minutes' + interval '12 milliseconds'),
  ('F-SEED000001', 'BILLER_RESP',
   '{"result":"BILL_DUE","responseCode":"000","presentmentId":"55555555-0000-4000-8000-000000000001","amountPaise":1218350}'::jsonb,
   now() - interval '3 days' - interval '2 minutes' + interval '130 milliseconds'),
  ('F-SEED000001', 'COU_RESP',
   '{"fetchRef":"F-SEED000001","result":"BILL_DUE","responseCode":"000","amountPaise":1218350}'::jsonb,
   now() - interval '3 days' - interval '2 minutes' + interval '142 milliseconds'),
  ('BCSEEDPAID01', 'COU_REQ',
   '{"initiatedBy":"AUTOPAY","couId":"DEMOPAY","fetchRef":"F-SEED000001","amountPaise":1218350,"mode":"UPI_AUTOPAY","couOrderId":"DP-SEED000001"}'::jsonb,
   now() - interval '3 days' - interval '188 milliseconds'),
  ('BCSEEDPAID01', 'PAY_REQ',
   '{"billerId":"volt-leasing","presentmentId":"55555555-0000-4000-8000-000000000001","amountPaise":1218350,"bbpsTxnRef":"BCSEEDPAID01","mode":"UPI_AUTOPAY"}'::jsonb,
   now() - interval '3 days' - interval '170 milliseconds'),
  ('BCSEEDPAID01', 'ADVICE_ACK',
   '{"ack":true,"responseCode":"000","bbpsTxnRef":"BCSEEDPAID01","billerPaymentId":"66666666-0000-4000-8000-000000000001"}'::jsonb,
   now() - interval '3 days' - interval '15 milliseconds'),
  ('BCSEEDPAID01', 'COU_RESP',
   '{"status":"SUCCESS","responseCode":"000","bbpsTxnRef":"BCSEEDPAID01"}'::jsonb,
   now() - interval '3 days');

-- ─── COU (DemoPay) ──────────────────────────────────────────────────────────
insert into cou_payments (order_id, fetch_ref, bbps_txn_ref, biller_id, vehicle_reg_no, amount_paise, mode, status, created_at, updated_at) values
  ('DP-SEED000001', 'F-SEED000001', 'BCSEEDPAID01', 'volt-leasing', 'MH01AB1003', 1218350, 'UPI_AUTOPAY', 'SUCCESS',
   now() - interval '3 days' - interval '200 milliseconds', now() - interval '3 days');
