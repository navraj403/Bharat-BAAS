/**
 * Admin (DB explorer + demo reset): PUBLIC API. Owner: agent C.
 * Signatures are FINAL (P0). Read-only except `reset`. Only tables in `APP_TABLES`
 * (src/lib/db/tables.ts) may be read; never interpolate any other name.
 */
import type { AdminTableRows, AdminTableSummary, ResetResponse } from "@/lib/domain/types";

/** `GET /api/admin/tables`. Every APP_TABLES entry with its row count, in APP_TABLES order. */
export async function listTables(): Promise<AdminTableSummary[]> {
  throw new Error("NotImplemented");
}

/**
 * `GET /api/admin/tables/:name`. Up to 100 rows, newest first (by created_at / recorded_at /
 * paid_at / at when the table has one, else primary key), values JSON-safe (Dates → ISO strings).
 * Name not whitelisted → null (route → 404).
 */
export async function getTableRows(name: string): Promise<AdminTableRows | null> {
  void name;
  throw new Error("NotImplemented");
}

/** `POST /api/admin/reset`. Calls `resetAndSeed()` from src/lib/db/seed.ts. */
export async function reset(): Promise<ResetResponse> {
  throw new Error("NotImplemented");
}
