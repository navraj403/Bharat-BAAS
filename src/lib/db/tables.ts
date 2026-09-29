import type { Party } from "@/lib/domain/types";

/**
 * Every app table, grouped by owning party, in display order.
 * This is the WHITELIST for the DB explorer (admin/api): never interpolate a table name
 * that is not in this list.
 */
export const APP_TABLES: ReadonlyArray<{ party: Party; table: string }> = [
  { party: "oem", table: "oem_plans" },
  { party: "oem", table: "oem_vehicles" },
  { party: "oem", table: "oem_trips" },
  { party: "oem", table: "oem_bills" },
  { party: "biller", table: "biller_billers" },
  { party: "biller", table: "biller_customers" },
  { party: "biller", table: "biller_receivables" },
  { party: "biller", table: "biller_presentments" },
  { party: "biller", table: "biller_payments" },
  { party: "nbbl", table: "nbbl_billers" },
  { party: "nbbl", table: "nbbl_transactions" },
  { party: "nbbl", table: "nbbl_events" },
  { party: "cou", table: "cou_payments" },
];

/** Returns the whitelisted entry for `name`, or undefined. */
export function findAppTable(name: string): { party: Party; table: string } | undefined {
  return APP_TABLES.find((t) => t.table === name);
}
