import { pendingMigrations } from "../../scripts/migration-plan.mjs";
import {
  getDatabaseUrl,
  isServerlessRuntime,
  pgliteDataDir,
} from "./rag/storage";

/** Which database backend is active. */
export type DbSource = "neon" | "pglite";

function isPgliteFsError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /pglite|ENOENT|_libs/i.test(msg);
}

const globalEphemeral = globalThis as typeof globalThis & {
  __intelliragForceEphemeral__?: boolean;
};

function markEphemeral(err?: unknown) {
  globalEphemeral.__intelliragForceEphemeral__ = true;
  if (err) {
    console.error(
      "[db] PGLite unavailable on this runtime; using ephemeral corpus",
      err,
    );
  }
}

/**
 * Active backend: **Neon** when `DATABASE_URL` is set. Locally without a URL,
 * file-backed **PGLite**. On Vercel without `DATABASE_URL`, SQL is not used —
 * `vercelWithoutDatabase()` is true and the RAG corpus is ephemeral memory
 * with dense retrieval disabled.
 *
 * Values are read at call time. Vite can replace `process.env.VERCEL` with
 * `undefined` when the sandbox builds the server bundle, which previously
 * froze production onto the PGLite path (`ENOENT /var/task/_libs/pglite.data`).
 */
export function currentDbSource(): DbSource {
  return getDatabaseUrl() ? "neon" : "pglite";
}

export const dbSource: DbSource = currentDbSource();

/** Vercel/Lambda functions cannot open PGLite's wasm image. Use the memory corpus instead. */
export function vercelWithoutDatabase() {
  if (globalEphemeral.__intelliragForceEphemeral__) return true;
  if (getDatabaseUrl()) return false;
  return isServerlessRuntime();
}

/**
 * Minimal shared SQL surface, satisfied by both Neon and PGLite. Both the
 * tagged-template and `.query()` forms resolve to an array of row objects:
 *
 *   const sql = await getSql();
 *   const rows = await sql`select * from todos where id = ${id}`; // parameterized
 *   const rows2 = await sql.query("select * from todos where id = $1", [id]);
 */
export interface Sql {
  <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]>;
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<T[]>;
}

/**
 * Init state lives on globalThis as promises: dev HMR creates new instances of
 * this module, and two instances racing module-level state would open a second
 * pool or run two concurrent PGLite migration passes (whose duplicate
 * `_migrations` insert rejects — and would get memoized, poisoning every later
 * `getSql()`). A failed init clears its slot so the next call retries.
 */
const globalRef = globalThis as typeof globalThis & {
  __pgSqlPromise__?: Promise<Sql>;
  __pgliteInstance__?: Promise<import("@electric-sql/pglite").PGlite>;
  __pgliteMigrateChain__?: Promise<void>;
};

/**
 * Result-type parity: Postgres sends every value as text plus a type OID — the
 * JS value is the DRIVER's parsing choice, and pg and PGLite disagree (pg:
 * int8 -> string, date -> local-midnight Date; PGLite: int8 -> BigInt, which
 * JSON.stringify rejects, date -> UTC Date). Normalize both so preview and
 * production return identical, JSON-safe shapes:
 *   int8/bigint (incl. count(*)) -> number (past 2^53 loses precision — cast
 *                                   `::text` if you ever need huge integers)
 *   date                         -> 'YYYY-MM-DD' string
 *   interval                     -> Postgres interval text
 * numeric already comes back as a string on both (arbitrary precision).
 */
const OID_INT8 = 20;
const OID_DATE = 1082;
const OID_INTERVAL = 1186;
const identity = (v: string) => v;

type Run = <T>(text: string, params: unknown[]) => Promise<T[]>;

/** Wrap a query runner in the tagged-template + `.query()` `Sql` surface. */
function toSql(run: Run): Sql {
  const sql = (async <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]> => {
    // Rebuild with $1, $2, … placeholders so values stay parameterized.
    let text = strings[0];
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    return run<T>(text, values);
  }) as unknown as Sql;
  sql.query = <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
    run<T>(text, params);
  return sql;
}

function createNeonSql(): Promise<Sql> {
  globalRef.__pgSqlPromise__ ??= (async () => {
    const url = getDatabaseUrl();
    if (!url) throw new Error("DATABASE_URL is not set");
    // Regular Postgres driver: node-postgres (`pg`) — works directly with Neon's
    // pooled endpoint. One pool per process; warm serverless instances reuse it.
    const { Pool, types } = await import("pg");
    types.setTypeParser(OID_INT8, Number);
    types.setTypeParser(OID_DATE, identity);
    types.setTypeParser(OID_INTERVAL, identity);
    const pool = new Pool({ connectionString: url });
    return toSql(async <T>(text: string, params: unknown[]) => {
      const res = await pool.query(text, params);
      return res.rows as T[];
    });
  })().catch((err) => {
    globalRef.__pgSqlPromise__ = undefined;
    throw err;
  });
  return globalRef.__pgSqlPromise__;
}

async function createPgliteSql(): Promise<Sql> {
  if (vercelWithoutDatabase()) {
    throw new Error("PGLite is disabled on Vercel without DATABASE_URL");
  }
  // Embedded Postgres, imported on demand so it never loads on the Neon path
  // or on Vercel. File-backed PGLite under .data/pglite so restart keeps vectors.
  globalRef.__pgliteInstance__ ??= (async () => {
    if (vercelWithoutDatabase()) {
      throw new Error("PGLite is disabled on Vercel without DATABASE_URL");
    }
    const { PGlite } = await import("@electric-sql/pglite");
    const { existsSync, readFileSync, mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const readAsset = (name: string) => {
      for (const dir of [
        join(process.cwd(), "_libs"),
        process.cwd(),
        join(process.cwd(), "node_modules/@electric-sql/pglite/dist"),
      ]) {
        const p = join(dir, name);
        if (existsSync(p)) return readFileSync(p);
      }
      return null;
    };
    const data = readAsset("pglite.data");
    const wasm = readAsset("pglite.wasm");
    const initdb = readAsset("initdb.wasm");
    const dataDir = pgliteDataDir();
    mkdirSync(dataDir, { recursive: true });
    const pg = new PGlite({
      dataDir,
      parsers: {
        [OID_INT8]: Number,
        [OID_DATE]: identity,
        [OID_INTERVAL]: identity,
      },
      ...(data ? { fsBundle: new Blob([data]) } : {}),
      ...(wasm ? { pgliteWasmModule: await WebAssembly.compile(wasm) } : {}),
      ...(initdb ? { initdbWasmModule: await WebAssembly.compile(initdb) } : {}),
    });
    await pg.waitReady;
    await pg.exec(
      "create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())",
    );
    return pg;
  })().catch((err) => {
    globalRef.__pgliteInstance__ = undefined;
    if (isPgliteFsError(err)) markEphemeral(err);
    throw err;
  });
  const pg = await globalRef.__pgliteInstance__;

  // Apply migrations/ (the single schema source) so preview matches production.
  // SQL is inlined by the bundler via import.meta.glob (no runtime fs); applied
  // files are tracked in _migrations. The glob does not descend, so the opt-in
  // auth schema under migrations/auth/ stays out. Runs once per module instance
  // — so an HMR reload after adding a migration file applies it live — with
  // passes serialized on a global chain so concurrent callers never
  // double-apply.
  const migrate = async (): Promise<void> => {
    const migrations = import.meta.glob("/migrations/*.sql", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    const doneRows = await pg.query<{ name: string }>(
      "select name from _migrations",
    );
    const done = doneRows.rows.map((r) => r.name);
    for (const { name, path } of pendingMigrations(Object.keys(migrations), done)) {
      // Apply + record atomically (parity with scripts/migrate.mjs) so a failed
      // statement can't leave a file half-applied but untracked.
      await pg.transaction(async (tx) => {
        await tx.exec(migrations[path]);
        await tx.query("insert into _migrations (name) values ($1)", [name]);
      });
    }
  };
  const pass = (globalRef.__pgliteMigrateChain__ ?? Promise.resolve())
    .catch(() => undefined) // an earlier failed pass must not wedge the chain
    .then(migrate);
  globalRef.__pgliteMigrateChain__ = pass;
  await pass;

  return toSql(async <T>(text: string, params: unknown[]) => {
    const result = await pg.query<T>(text, params);
    return result.rows;
  });
}

let sqlPromise: Promise<Sql> | null = null;

async function createSql(): Promise<Sql> {
  if (typeof window !== "undefined") {
    throw new Error(
      "@/lib/db is server-only — call getSql() from a createServerFn handler " +
        "or a server route loader, never from client code.",
    );
  }
  if (vercelWithoutDatabase()) {
    throw new Error("PGLite is disabled on Vercel without DATABASE_URL");
  }
  return currentDbSource() === "neon" ? createNeonSql() : createPgliteSql();
}

/**
 * Get the shared, **server-only** SQL client. Neon when `DATABASE_URL` is set,
 * otherwise the local PGLite fallback. Memoized — safe to call per request.
 *
 * Schema comes from `migrations/*.sql`, auto-applied before the first query on
 * both backends — define tables there, never inline in server functions.
 */
export function getSql(): Promise<Sql> {
  sqlPromise ??= createSql().catch((err) => {
    sqlPromise = null; // don't memoize failures — let the next call retry
    if (isPgliteFsError(err)) markEphemeral(err);
    throw err;
  });
  return sqlPromise;
}

/**
 * The shared PGLite instance (preview only), with `migrations/*.sql` applied.
 * Lets Better Auth persist to the SAME embedded DB as app data in preview (via a
 * Kysely dialect). Throws when `DATABASE_URL` is set (that path uses Neon).
 */
export async function getPglite(): Promise<import("@electric-sql/pglite").PGlite> {
  if (vercelWithoutDatabase()) {
    throw new Error("PGLite is disabled on Vercel without DATABASE_URL");
  }
  if (currentDbSource() !== "pglite") {
    throw new Error("getPglite() is only available on the PGLite fallback (no DATABASE_URL)");
  }
  await getSql();
  const pg = await globalRef.__pgliteInstance__;
  if (!pg) throw new Error("PGLite instance failed to initialize");
  return pg;
}

/**
 * Finish DB bootstrap before the server handles traffic.
 *
 * - **PGLite** (local / no `DATABASE_URL`): open the file-backed DB at
 *   `.data/pglite` and apply `migrations/*.sql`. Idempotent — concurrent callers
 *   share one promise. On Vercel without DATABASE_URL this path is skipped.
 * - **Neon**: no-op (pool is created lazily on first query).
 *
 * Vite `configureServer` awaits this at dev startup; production imports of this
 * module kick it off immediately (see bottom of file).
 */
export function ensureDbReady(): Promise<void> {
  if (currentDbSource() !== "pglite") return Promise.resolve();
  if (vercelWithoutDatabase()) return Promise.resolve();
  return getSql().then(() => undefined);
}

// Server-only eager start: kick PGLite bootstrap as soon as this module loads in
// Node. Client bundles never hit this path (`getSql` throws in the browser).
// Skip entirely on serverless — constructing PGlite there throws
// `ENOENT: open '/var/task/_libs/pglite.data'` and blanks the app.
const globalBoot = globalThis as typeof globalThis & {
  __pgBootstrapPromise__?: Promise<void>;
};
if (
  typeof window === "undefined" &&
  currentDbSource() === "pglite" &&
  !vercelWithoutDatabase()
) {
  globalBoot.__pgBootstrapPromise__ ??= ensureDbReady().catch((err) => {
    globalBoot.__pgBootstrapPromise__ = undefined;
    if (isPgliteFsError(err)) markEphemeral(err);
    console.error("[db] PGLite bootstrap failed:", err);
  });
}
