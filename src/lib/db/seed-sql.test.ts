import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SEED_SQL } from "./seed-sql.generated";
import { APP_TABLES } from "./tables";

const root = join(__dirname, "..", "..", "..");

describe("seed SQL", () => {
  it("generated module matches supabase/seed.sql (run `npm run db:gen-seed` if this fails)", () => {
    const file = readFileSync(join(root, "supabase", "seed.sql"), "utf8").replace(/\r\n/g, "\n");
    expect(SEED_SQL).toBe(file);
  });

  it("truncates every app table", () => {
    const truncate = SEED_SQL.slice(SEED_SQL.indexOf("truncate table"), SEED_SQL.indexOf(";", SEED_SQL.indexOf("truncate table")));
    for (const { table } of APP_TABLES) expect(truncate).toContain(table);
  });

  it("every app table is created by the migration", () => {
    const migration = readFileSync(join(root, "supabase", "migrations", "0001_init.sql"), "utf8");
    for (const { table } of APP_TABLES) expect(migration).toContain(`create table if not exists ${table} (`);
  });
});
