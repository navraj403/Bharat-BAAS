/**
 * Demo data reset. SERVER ONLY. Used by `admin/api.reset()` (POST /api/admin/reset).
 *
 * The SQL is supabase/seed.sql (single source of truth), embedded as a string module so it works
 * on Vercel serverless without reading repo files at runtime. seed.sql starts with
 * `truncate … restart identity cascade` over every app table, then inserts the §4 seed.
 * scripts/db-seed.mjs runs the same file for `npm run db:seed`.
 */
import { getSql } from "./client";
import { SEED_SQL } from "./seed-sql.generated";

/** Truncate all app tables and reload the seed, atomically. */
export async function resetAndSeed(): Promise<void> {
  await getSql().begin((tx) => tx.unsafe(SEED_SQL));
}
