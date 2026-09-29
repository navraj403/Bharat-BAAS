// Truncate every app table and load the demo seed (supabase/seed.sql).
// Usage: npm run db:seed   (PM / integrator only). Same SQL as resetAndSeed() in src/lib/db/seed.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Add it to .env.local (Supabase transaction pooler URI).");
  process.exit(1);
}

const seedSql = readFileSync(join(import.meta.dirname, "..", "supabase", "seed.sql"), "utf8");
const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
try {
  await sql.begin((tx) => tx.unsafe(seedSql));
  console.log("seeded supabase/seed.sql");
} catch (err) {
  console.error("seed failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
