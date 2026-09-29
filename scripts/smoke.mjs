#!/usr/bin/env node
// End-to-end API smoke test for Bharat BaaS (BUILD_PLAN §4 + pay / re-fetch / double-pay / failure / Kabir).
// Plain Node ESM, no deps. Usage: npm run smoke [-- --base=https://host]
// Resets the demo data at the start and at the end. Exit 1 on any failure.

const arg = process.argv.find((a) => a.startsWith("--base="));
const BASE = (arg ? arg.slice("--base=".length) : process.env.SMOKE_BASE || "http://localhost:3000").replace(/\/+$/, "");

let failures = 0;
let passes = 0;

function ok(name, detail = "") {
  passes++;
  console.log(`✓ ${name}${detail ? `  (${detail})` : ""}`);
}
function fail(name, detail) {
  failures++;
  console.log(`✗ ${name}  -> ${detail}`);
}
/** Runs a step; a thrown error (failed assertion or HTTP error) marks it failed. */
async function step(name, fn) {
  try {
    const detail = await fn();
    ok(name, typeof detail === "string" ? detail : "");
  } catch (err) {
    fail(name, err instanceof Error ? err.message : String(err));
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function eq(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function call(method, path, body, { allowError = false } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${method} ${path}: non-JSON response (HTTP ${res.status}): ${text.slice(0, 120)}`);
  }
  if (!res.ok && !allowError) throw new Error(`${method} ${path}: HTTP ${res.status} ${JSON.stringify(data)}`);
  return { status: res.status, data };
}
const get = (p) => call("GET", p).then((r) => r.data);
const post = (p, b) => call("POST", p, b).then((r) => r.data);

const RIYA = { billerId: "demo-finance", vehicleNo: "MH01AB1001", mobile: "9800000001" };
const ARJUN = { billerId: "demo-finance", vehicleNo: "MH01AB1002", mobile: "9800000002" };
const MEERA = { billerId: "volt-leasing", vehicleNo: "MH01AB1003", mobile: "9800000003" };
const KABIR = { billerId: "demo-finance", vehicleNo: "MH01AB1004", mobile: "9800000004" };
const BC_REF = /^BC[A-Z0-9]{10}$/;

const fetchBill = (req) => post("/api/cou/fetch", req);
const pay = (req) => post("/api/cou/pay", req);

function expectDue(r, amount, who) {
  eq(r.result, "BILL_DUE", `${who} result`);
  eq(r.responseCode, "000", `${who} responseCode`);
  eq(r.bill.amountPaise, amount, `${who} amountPaise`);
  const sum = r.bill.lines.reduce((s, l) => s + l.amountPaise, 0);
  eq(sum, amount, `${who} sum(lines)`);
  assert(/^F-[A-Z0-9]{10}$/.test(r.fetchRef), `${who} fetchRef format: ${r.fetchRef}`);
}

async function main() {
  console.log(`Smoke against ${BASE}\n`);
  const s = {};

  // a
  await step("a. reset demo data", async () => {
    const r = await post("/api/admin/reset");
    eq(r.ok, true, "reset ok");
  });

  // b
  await step("b. COU billers for EV_BAAS include demo-finance + volt-leasing", async () => {
    const r = await get("/api/cou/billers?category=EV_BAAS");
    assert(Array.isArray(r), "not an array");
    const ids = r.map((b) => b.id);
    assert(ids.includes("demo-finance") && ids.includes("volt-leasing"), `ids=${ids.join(",")}`);
    return ids.join(", ");
  });

  // c
  await step("c. Riya fetch -> BILL_DUE 672600", async () => {
    const r = await fetchBill(RIYA);
    expectDue(r, 672600, "Riya");
    eq(r.bill.customerName, "Riya S****", "masked name");
    eq(r.bill.arrearsPaise, 0, "arrears");
    s.riyaFetchRef = r.fetchRef;
    s.riyaPresentment = r.bill.presentmentId;
    return r.fetchRef;
  });
  await step("c. Riya fetch with 'mh-01 ab 1001' -> BILL_DUE 672600 (normalised)", async () => {
    const r = await fetchBill({ ...RIYA, vehicleNo: "mh-01 ab 1001" });
    expectDue(r, 672600, "Riya (raw input)");
    eq(r.bill.vehicleRegNo, "MH01AB1001", "vehicleRegNo");
    s.riyaFetchRef = r.fetchRef; // pay against the latest fetch
  });

  // d
  await step("d. Arjun fetch -> BILL_DUE 1188962 with arrears + late fee 9198", async () => {
    const r = await fetchBill(ARJUN);
    expectDue(r, 1188962, "Arjun");
    eq(r.bill.arrearsPaise, 542682, "arrearsPaise");
    eq(r.bill.lateFeePaise, 9198, "lateFeePaise");
    eq(r.bill.currentCyclePaise, 637082, "currentCyclePaise");
    eq(r.bill.overdue, true, "overdue");
    const arrears = r.bill.lines.filter((l) => l.kind === "ARREARS");
    const late = r.bill.lines.filter((l) => l.kind === "LATE_FEE");
    eq(arrears.length, 1, "ARREARS lines");
    eq(arrears[0].amountPaise, 542682, "ARREARS amount");
    eq(late.length, 1, "LATE_FEE lines");
    eq(late[0].amountPaise, 9198, "LATE_FEE amount");
  });

  // e
  await step("e. Meera fetch -> ALREADY_PAID 1218350, ref BCSEEDPAID01", async () => {
    const r = await fetchBill(MEERA);
    eq(r.result, "ALREADY_PAID", "result");
    eq(r.responseCode, "BFR001", "responseCode");
    eq(r.receipt.amountPaise, 1218350, "amount");
    eq(r.receipt.bbpsTxnRef, "BCSEEDPAID01", "ref");
  });

  // f
  await step("f. Kabir fetch -> NOT_GENERATED", async () => {
    const r = await fetchBill(KABIR);
    eq(r.result, "NOT_GENERATED", "result");
    eq(r.responseCode, "BFR001", "responseCode");
    assert(/^\d{4}-\d{2}-01$/.test(r.nextBillDate), `nextBillDate ${r.nextBillDate}`);
  });

  // g
  await step("g. Riya with wrong mobile -> NOT_FOUND (BFR002)", async () => {
    const r = await fetchBill({ ...RIYA, mobile: "9800000009" });
    eq(r.result, "NOT_FOUND", "result");
    eq(r.responseCode, "BFR002", "responseCode");
    assert(typeof r.message === "string" && r.message.length > 0, "message missing");
  });
  await step("g. unknown biller -> BILLER_UNAVAILABLE BFR003", async () => {
    const r = await fetchBill({ ...RIYA, billerId: "no-such-biller" });
    eq(r.result, "BILLER_UNAVAILABLE", "result");
    eq(r.responseCode, "BFR003", "responseCode");
  });

  // Baseline payment count before paying.
  let paymentsBefore = 0;
  await step("h. biller overview baseline (demo-finance)", async () => {
    const o = await get("/api/biller/overview?billerId=demo-finance");
    paymentsBefore = o.payments.length;
    s.collectedBefore = o.kpis.collectedPaise;
    return `payments=${paymentsBefore}, collected=${o.kpis.collectedPaise}`;
  });

  // h
  await step("h. pay Riya 672600 UPI -> SUCCESS, BC ref", async () => {
    const r = await pay({ fetchRef: s.riyaFetchRef, amountPaise: 672600, mode: "UPI" });
    eq(r.status, "SUCCESS", `status (${r.message || ""})`);
    eq(r.responseCode, "000", "responseCode");
    assert(BC_REF.test(r.receipt.bbpsTxnRef), `bbpsTxnRef ${r.receipt.bbpsTxnRef}`);
    eq(r.receipt.amountPaise, 672600, "receipt amount");
    assert(/^DP-/.test(r.couOrderId), `couOrderId ${r.couOrderId}`);
    s.riyaRef = r.receipt.bbpsTxnRef;
    return s.riyaRef;
  });
  await step("h. re-fetch Riya -> ALREADY_PAID with the same ref", async () => {
    const r = await fetchBill(RIYA);
    eq(r.result, "ALREADY_PAID", "result");
    eq(r.receipt.bbpsTxnRef, s.riyaRef, "ref");
    eq(r.receipt.amountPaise, 672600, "amount");
  });
  await step("h. NBBL txns include Riya FETCH + PAY with hop events and masked mobile", async () => {
    const list = await get("/api/nbbl/transactions?limit=200");
    assert(Array.isArray(list), "not an array");
    const fetchTxn = list.find((t) => t.ref === s.riyaFetchRef);
    const payTxn = list.find((t) => t.ref === s.riyaRef);
    assert(fetchTxn, `FETCH ${s.riyaFetchRef} missing`);
    assert(payTxn, `PAY ${s.riyaRef} missing`);
    eq(fetchTxn.type, "FETCH", "fetch type");
    eq(payTxn.type, "PAY", "pay type");
    eq(payTxn.status, "SUCCESS", "pay status");
    eq(payTxn.fetchRef, s.riyaFetchRef, "pay.fetchRef");
    eq(payTxn.amountPaise, 672600, "pay amount");
    for (const t of [fetchTxn, payTxn]) {
      assert(t.customerRefMasked.includes("98XXXXXX01"), `mask: ${t.customerRefMasked}`);
      assert(!t.customerRefMasked.includes("9800000001"), `unmasked: ${t.customerRefMasked}`);
    }
    const fd = await get(`/api/nbbl/transactions/${encodeURIComponent(s.riyaFetchRef)}`);
    const pd = await get(`/api/nbbl/transactions/${encodeURIComponent(s.riyaRef)}`);
    const fSteps = fd.events.map((e) => e.step).join(">");
    const pSteps = pd.events.map((e) => e.step).join(">");
    eq(fSteps, "COU_REQ>BILLER_REQ>BILLER_RESP>COU_RESP", "FETCH hops");
    eq(pSteps, "COU_REQ>PAY_REQ>ADVICE_ACK>COU_RESP", "PAY hops");
    const raw = JSON.stringify([fd, pd]);
    assert(!raw.includes("9800000001"), "raw mobile found in NBBL events");
    return `${fSteps} | ${pSteps}`;
  });
  await step("h. biller overview (demo-finance) shows the payment collected", async () => {
    const o = await get("/api/biller/overview?billerId=demo-finance");
    const p = o.payments.find((x) => x.bbpsTxnRef === s.riyaRef);
    assert(p, "payment row missing");
    eq(p.amountPaise, 672600, "payment amount");
    eq(o.payments.length, paymentsBefore + 1, "payments count");
    eq(o.kpis.collectedPaise, s.collectedBefore + 672600, "collectedPaise");
    s.paymentsAfterRiya = o.payments.length;
  });
  await step("h. OEM bills show Riya 2026-08 PAID", async () => {
    const bills = await get("/api/oem/bills?regNo=MH01AB1001");
    const aug = bills.find((b) => b.cycle === "2026-08");
    assert(aug, "Aug bill missing");
    eq(aug.paymentStatus, "PAID", "paymentStatus");
    eq(aug.paidRef, s.riyaRef, "paidRef");
  });

  // i
  await step("i. pay again with the old fetchRef -> rejected, no double charge", async () => {
    const r = await pay({ fetchRef: s.riyaFetchRef, amountPaise: 672600, mode: "UPI" });
    eq(r.status, "FAILED", "status");
    eq(r.responseCode, "BPR002", "responseCode");
    const o = await get("/api/biller/overview?billerId=demo-finance");
    eq(o.payments.length, s.paymentsAfterRiya, "payments count unchanged");
    return `${r.failureReason} ${r.responseCode}`;
  });

  // j
  await step("j. Arjun wrong amount -> BPR001", async () => {
    const f = await fetchBill(ARJUN);
    expectDue(f, 1188962, "Arjun");
    const r = await pay({ fetchRef: f.fetchRef, amountPaise: 1188961, mode: "UPI" });
    eq(r.status, "FAILED", "status");
    eq(r.responseCode, "BPR001", "responseCode");
  });
  await step("j. Arjun simulateFailure -> FAILED, still BILL_DUE", async () => {
    const f = await fetchBill(ARJUN);
    expectDue(f, 1188962, "Arjun");
    const r = await pay({ fetchRef: f.fetchRef, amountPaise: 1188962, mode: "UPI", simulateFailure: true });
    eq(r.status, "FAILED", "status");
    eq(r.failureReason, "PAYMENT_DECLINED", "failureReason");
    const again = await fetchBill(ARJUN);
    expectDue(again, 1188962, "Arjun after failure");
  });

  // k (must run last: generation bills a vehicle for the current month)
  await step("k. OEM +1600 km to Kabir, generate [kabir] -> 1 bill 837800", async () => {
    const vehicles = await get("/api/oem/vehicles");
    const kabir = vehicles.find((v) => v.regNo === "MH01AB1004");
    assert(kabir, "Kabir vehicle missing");
    const before = kabir.kmThisCycle;
    const row = await post(`/api/oem/vehicles/${kabir.id}/trips`, { km: 1600 });
    eq(row.kmThisCycle, before + 1600, "kmThisCycle after trip");
    const g = await post("/api/oem/bills/generate", { cycle: kabir.currentCycle, vehicleIds: [kabir.id] });
    eq(g.generated.length, 1, "generated count");
    eq(g.generated[0].regNo, "MH01AB1004", "generated regNo");
    eq(g.generated[0].totalPaise, 837800, "generated total");
    return `${g.generated[0].billNo}`;
  });
  await step("k. Kabir fetch -> BILL_DUE 837800", async () => {
    const r = await fetchBill(KABIR);
    expectDue(r, 837800, "Kabir");
  });
  await step("k. Meera still ALREADY_PAID", async () => {
    const r = await fetchBill(MEERA);
    eq(r.result, "ALREADY_PAID", "result");
    eq(r.receipt.bbpsTxnRef, "BCSEEDPAID01", "ref");
  });

  // l
  await step("l. reset demo data (leave clean)", async () => {
    const r = await post("/api/admin/reset");
    eq(r.ok, true, "reset ok");
  });

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(`✗ smoke crashed: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});
