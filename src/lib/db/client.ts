/**
 * postgres.js client for Supabase (transaction pooler, port 6543). SERVER ONLY.
 *
 * - `prepare: false` is required by the transaction pooler.
 * - One client per process, cached on `globalThis` so Next dev hot reloads don't leak pools.
 * - Connection is lazy: importing this module never connects or throws (so `next build`
 *   works without DATABASE_URL). The first query throws a clear error if it is missing.
 *
 * Type mapping (read this before writing repos):
 * - `integer` → number. `bigint` (e.g. `count(*)`, `sum(int)`) → STRING: cast in SQL
 *   (`count(*)::int`, `sum(x)::int`) to get a number.
 * - `date` → `YYYY-MM-DD` string (custom parser below; matches `IsoDate` in types.ts).
 * - `timestamptz` → JS `Date`: convert with `.toISOString()` for DTOs (`IsoDateTime`).
 * - `jsonb` → parsed JSON. Pass JSON params with `sql.json(value)`.
 * - `uuid[]` params: `sql.array(ids, 'uuid')` or `${ids}::uuid[]`.
 * - Columns come back snake_case; map to the camelCase DTOs explicitly in repo code.
 */
import postgres from "postgres";

/** OID of the Postgres `date` type. */
const DATE_OID = 1082;

function createSql(url: string) {
  return postgres(url, {
    prepare: false,
    // Serverless: keep each lambda to one connection; local dev can use a few.
    max: process.env.VERCEL ? 1 : 5,
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
    types: {
      date: {
        to: DATE_OID,
        from: [DATE_OID],
        serialize: (x: string) => x,
        parse: (x: string) => x,
      },
    },
  });
}

/** The configured client type (includes the custom `date` parser). */
export type Db = ReturnType<typeof createSql>;
/** A transaction handle, as passed to `withTx` callbacks. */
export type Tx = Parameters<Parameters<Db["begin"]>[0]>[0];

const globalForDb = globalThis as typeof globalThis & { __bharatBaasSql?: Db };

/** Returns the process-wide client, creating it on first use. */
export function getSql(): Db {
  if (globalForDb.__bharatBaasSql) return globalForDb.__bharatBaasSql;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add the Supabase transaction pooler URI to .env.local " +
        "(and to the Vercel project env). See .env.example.",
    );
  }
  const client = createSql(url);
  globalForDb.__bharatBaasSql = client;
  return client;
}

/**
 * Lazy `sql` tagged template: `await sql\`select 1\``, `sql.json(x)`, `sql.unsafe(...)`.
 * Connects on first use (see getSql).
 */
export const sql: Db = new Proxy(function lazySql() {} as unknown as Db, {
  apply(_target, _thisArg, args: unknown[]) {
    return Reflect.apply(getSql() as unknown as (...a: unknown[]) => unknown, undefined, args);
  },
  get(_target, prop) {
    const real = getSql();
    const value: unknown = Reflect.get(real, prop);
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(real) : value;
  },
});

/**
 * Run `fn` in a transaction (BEGIN … COMMIT, ROLLBACK on throw).
 * Use the `tx` handle for every query inside: `await withTx(async (tx) => { await tx\`...\` })`.
 */
export async function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const result = await getSql().begin(fn);
  return result as T;
}

/** Close the pool (scripts/tests only; never in route handlers). */
export async function closeSql(): Promise<void> {
  const client = globalForDb.__bharatBaasSql;
  if (client) {
    globalForDb.__bharatBaasSql = undefined;
    await client.end({ timeout: 5 });
  }
}
