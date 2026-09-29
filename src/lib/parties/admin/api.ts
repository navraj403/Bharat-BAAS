/**
 * Admin (DB explorer + demo reset): PUBLIC API. Owner: agent C.
 * Read-only except `reset`. Only tables in `APP_TABLES` may be read.
 */
import { sql } from "@/lib/db/client";
import { APP_TABLES, findAppTable } from "@/lib/db/tables";
import { resetAndSeed } from "@/lib/db/seed";
import type {
  AdminTableRows,
  AdminTableSummary,
  JsonValue,
  ResetResponse,
} from "@/lib/domain/types";

const ORDER_COLS = ["created_at", "recorded_at", "paid_at", "at"];

function jsonSafe(v: unknown): JsonValue {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return Number(v);
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonSafe(x)]));
  }
  return v as JsonValue;
}

/** `GET /api/admin/tables`. Every APP_TABLES entry with its row count. */
export async function listTables(): Promise<AdminTableSummary[]> {
  return Promise.all(
    APP_TABLES.map(async ({ party, table }) => {
      // `table` comes from the static whitelist only.
      const [r] = await sql.unsafe(`select count(*)::int as n from "${table}"`);
      return { party, table, rows: r.n as number };
    }),
  );
}

/** `GET /api/admin/tables/:name`. Up to 100 rows, newest first; null if not whitelisted. */
export async function getTableRows(name: string): Promise<AdminTableRows | null> {
  const entry = findAppTable(name);
  if (!entry) return null;
  const { party, table } = entry;
  const cols = await sql`select column_name from information_schema.columns
    where table_schema = 'public' and table_name = ${table} order by ordinal_position`;
  const columns = cols.map((c) => c.column_name as string);
  const orderCol = ORDER_COLS.find((c) => columns.includes(c)) ?? columns[0];
  const rows = await sql.unsafe(`select * from "${table}" order by "${orderCol}" desc limit 100`);
  return {
    party,
    table,
    columns,
    rows: rows.map((r) => jsonSafe(r) as Record<string, JsonValue>),
  };
}

/** `POST /api/admin/reset`. Truncate + seed. */
export async function reset(): Promise<ResetResponse> {
  await resetAndSeed();
  return { ok: true };
}
