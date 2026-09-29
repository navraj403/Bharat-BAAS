// Print row counts per app table and the seeded bill totals (no connection details are printed).
// Usage: node --env-file=.env.local scripts/db-verify.mjs
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const tables = [
  "oem_plans", "oem_vehicles", "oem_trips", "oem_bills",
  "biller_billers", "biller_customers", "biller_receivables", "biller_presentments", "biller_payments",
  "nbbl_billers", "nbbl_transactions", "nbbl_events", "nbbl_complaints", "nbbl_complaint_events",
  "cou_payments", "cou_complaints",
];
const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
try {
  for (const t of tables) {
    const [{ n }] = await sql.unsafe(`select count(*)::int as n from ${t}`);
    console.log(`${t.padEnd(22)} ${n}`);
  }
  const bills = await sql`
    select v.reg_no, b.cycle, b.km_driven, b.subtotal_paise, b.gst_paise, b.total_paise,
           b.due_date < current_date as past_due, b.payment_status
    from oem_bills b join oem_vehicles v on v.id = b.vehicle_id order by v.reg_no, b.cycle`;
  console.log("\nbills:");
  for (const b of bills) console.log(`  ${b.reg_no} ${b.cycle} ${b.km_driven}km sub=${b.subtotal_paise} gst=${b.gst_paise} total=${b.total_paise} pastDue=${b.past_due} ${b.payment_status}`);
  const due = await sql`
    select c.name, sum(r.total_paise + r.late_fee_paise)::int as due
    from biller_receivables r join biller_customers c on c.id = r.customer_id
    where r.status <> 'PAID' group by c.name order by c.name`;
  console.log("\nopen receivables (total + late fee):");
  for (const d of due) console.log(`  ${d.name} ${d.due}`);
  const km = await sql`
    select v.reg_no, coalesce(sum(t.km) filter (where t.recorded_at >= date_trunc('month', now())), 0)::int as km_this_cycle
    from oem_vehicles v left join oem_trips t on t.vehicle_id = v.id group by v.reg_no order by v.reg_no`;
  console.log("\nkm this cycle:");
  for (const k of km) console.log(`  ${k.reg_no} ${k.km_this_cycle}`);
} catch (err) {
  console.error("verify failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
