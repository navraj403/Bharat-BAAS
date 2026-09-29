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
import postgres, { type TransactionSql } from "postgres";

/** OID of the Postgres `date` type. */
const DATE_OID = 1082;

function createSql(url: string) {
  return postgres(url, {
    prepare: false,
    // Serverless: keep each lambda to one connection; local dev can use a few.
    max: process.env.VERCEL ? 1 : 5,
    idle_timeout: 20,
    // No pipelining (I, P2). With prepare:false postgres.js sends Parse/Describe/Flush first and
    // Bind/Execute/Sync on a second round trip. When a query is pipelined behind another on the same
    // connection, the Supabase transaction pooler (Supavisor) can hand the server connection back
    // on the first query's ReadyForQuery mid-way through the second, leaving the backend stuck in
    // "active / ClientRead" and the client waiting forever. Five such hangs exhaust the pool and
    // every route stalls. 0 = one in-flight query per connection; extra queries wait in the queue.
    // @ts-expect-error max_pipeline is a runtime option of postgres.js 3.4 missing from its typings.
    max_pipeline: 0,
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
export type Tx = TransactionSql<{ date: string }>;

// The key is versioned so a dev-server hot reload after a client-option change builds a fresh pool
// instead of reusing one created with the old options (the old one is closed in getSql).
const GLOBAL_KEY = "__bharatBaasSqlV2";
const LEGACY_KEYS = ["__bharatBaasSql"] as const;
const globalForDb = globalThis as typeof globalThis & Record<string, Db | undefined>;

/** Returns the process-wide client, creating it on first use. */
export function getSql(): Db {
  const cached = globalForDb[GLOBAL_KEY];
  if (cached) return cached;
  for (const k of LEGACY_KEYS) {
    const old = globalForDb[k];
    if (old) {
      globalForDb[k] = undefined;
      void old.end({ timeout: 1 }).catch(() => {});
    }
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add the Supabase transaction pooler URI to .env.local " +
        "(and to the Vercel project env). See .env.example.",
    );
  }
  const client = createSql(url);
  globalForDb[GLOBAL_KEY] = client;
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
  // A reserved connection plus explicit BEGIN/COMMIT instead of sql.begin(): postgres.js only
  // marks a sql.begin() connection as reserved through a hook that is skipped when
  // max_pipeline is 0 (it then fails with UNSAFE_TRANSACTION). Queries on the reserved
  // connection run one at a time, and the pooler keeps it pinned while the transaction is open.
  const conn = await getSql().reserve();
  try {
    await conn`begin`;
    try {
      const result = await fn(conn as unknown as Tx);
      await conn`commit`;
      return result;
    } catch (err) {
      await conn`rollback`.catch(() => {});
      throw err;
    }
  } finally {
    conn.release();
  }
}

/** True for a Postgres unique_violation (SQLSTATE 23505), e.g. a lost insert race. */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "23505";
}

/** Close the pool (scripts/tests only; never in route handlers). */
export async function closeSql(): Promise<void> {
  const client = globalForDb[GLOBAL_KEY];
  if (client) {
    globalForDb[GLOBAL_KEY] = undefined;
    await client.end({ timeout: 5 });
  }
}
