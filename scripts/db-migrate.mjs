// Apply supabase/migrations/*.sql to DATABASE_URL, in filename order.
// Usage: npm run db:migrate   (node --env-file=.env.local scripts/db-migrate.mjs)
// Migrations must be idempotent (create ... if not exists); every file runs on every call.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Add it to .env.local (Supabase transaction pooler URI).");
  process.exit(1);
}

const dir = join(import.meta.dirname, "..", "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
try {
  for (const file of files) {
    const text = readFileSync(join(dir, file), "utf8");
    await sql.begin((tx) => tx.unsafe(text));
    console.log(`applied ${file}`);
  }
  console.log(`done: ${files.length} migration(s)`);
} catch (err) {
  console.error("migration failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
