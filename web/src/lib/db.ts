import { isMigrationFile, pendingMigrations } from "../../scripts/migration-plan.mjs";
import { getDatabaseUrl, isServerlessRuntime, pgliteDataDir } from "./rag/storage";

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
    // Safe metadata only - the raw error can carry paths and is kept on the
    // DbBootFailure record (server-only) instead of ordinary output.
    console.error(
      "[db] PGLite unavailable on this runtime; using ephemeral corpus " +
        `(${err instanceof Error ? err.name : typeof err})`,
    );
  }
}

/**
 * Active backend: **Neon** when `DATABASE_URL` is set. Locally without a URL,
 * file-backed **PGLite**. On Vercel without `DATABASE_URL`, SQL is not used,
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
  transaction<T>(work: (sql: Sql) => Promise<T>): Promise<T>;
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

/**
 * Init state lives on globalThis as promises: dev HMR creates new instances of
 * this module, and two instances racing module-level state would open a second
 * pool or run two concurrent PGLite migration passes (whose duplicate
 * `_migrations` insert rejects. and would get memoized, poisoning every later
 * `getSql()`). A failed PGLite init records one typed boot failure (see
 * `recordBootFailure`): later callers observe the same incident instead of
 * implicitly reopening the store.
 */
const globalRef = globalThis as typeof globalThis & {
  __pgSqlPromise__?: Promise<Sql>;
  __pgliteInstance__?: Promise<import("@electric-sql/pglite").PGlite>;
  __pgliteMigrateChain__?: Promise<void>;
  __pgliteBootFailure__?: DbBootFailure;
  /** Test-only seam: replaces the PGlite constructor so failure paths can be
   * exercised without booting a real embedded database. Never set at runtime. */
  __intelliragPgliteCtorForTests__?: unknown;
};

/** Where a PGLite bootstrap attempt failed: opening the configured store, or
 * applying app migrations on an open store. */
export type DbBootFailureStage = "opening configured store" | "app migrations";

/** Server-side record of the failed bootstrap attempt. The raw `cause` and
 * the `storeDir` path stay in this in-process object only - never logged in
 * ordinary output and never serialized to clients. */
export interface DbBootFailure {
  stage: DbBootFailureStage;
  incidentId: string;
  reasonClass: string;
  cause: unknown;
  at: string;
  /** Identity of the configured store that failed (pgliteDataDir()). */
  storeDir: string;
  /** Whether the raw cause message matches the corpus-fallback classifier
   * (/pglite|ENOENT|_libs|disabled on Vercel/i, the store.server.ts
   * dbUnavailable regex) - i.e. the classification the un-wrapped error
   * would have received downstream. */
  regexMatched: boolean;
  /** Whether policy marks the corpus ephemeral for this failure
   * (migration-stage always; opening-stage only when isPgliteFsError). */
  markedEphemeral: boolean;
}

/**
 * Record the failed bootstrap attempt for the currently configured store and
 * return the stable record. One failed attempt per configured store per
 * process: a repeated failure for the SAME store keeps the first record
 * (stable incidentId, no implicit retry). The storeDir comparison is a
 * stale-record guard for the test-only data-dir override path, NOT
 * multi-store support: only the latest failed store is remembered (no
 * history), and the ephemeral flag stays process-global. The supported
 * deployment scope is one immutable configured store per process
 * (pgliteDataDir has no per-request input; cwd/env could technically change,
 * so immutability is an assumption of the deployment, not a proven
 * invariant). Retrying a failed store is an operator decision - fix the
 * cause and restart the process.
 *
 * The ordinary log line carries safe metadata only (stage, incidentId,
 * reasonClass); the raw cause (paths, wasm internals) stays on the record.
 */
function recordBootFailure(stage: DbBootFailureStage, cause: unknown): DbBootFailure {
  const storeDir = pgliteDataDir();
  const existing = globalRef.__pgliteBootFailure__;
  if (existing && existing.storeDir === storeDir) return existing;
  const msg = cause instanceof Error ? cause.message : String(cause);
  const regexMatched = /pglite|ENOENT|_libs|disabled on Vercel/i.test(msg);
  const failure: DbBootFailure = {
    stage,
    incidentId: `db-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    reasonClass: isPgliteFsError(cause)
      ? "pglite-fs"
      : cause instanceof Error
        ? cause.name
        : "unknown",
    cause,
    at: new Date().toISOString(),
    storeDir,
    regexMatched,
    markedEphemeral: stage === "app migrations" || isPgliteFsError(cause),
  };
  globalRef.__pgliteBootFailure__ = failure;
  console.error(
    `[db] configured store failed while ${stage} ` +
      `(incident ${failure.incidentId}, reason ${failure.reasonClass}, ` +
      `fallback-classifier ${regexMatched ? "matched" : "unmatched"}); ` +
      "no automatic retry - fix the cause and restart the process.",
  );
  return failure;
}

/**
 * API-safe view of a recorded boot failure: name, stage, incidentId and a
 * short message serialize to clients; the raw cause (wasm internals, paths,
 * keys) stays server-side on the DbBootFailure record.
 */
export class DbUnavailableError extends Error {
  readonly stage: DbBootFailureStage;
  readonly incidentId: string;
  /** Corpus-fallback classification, exactly what the un-wrapped error would
   * have received at store.server.ts dbUnavailable: first-failure errors
   * classify by the raw cause message; errors served from the recorded
   * failure classify like the "PGLite is disabled" short-circuit they
   * replace (ephemeral flag set) or by the raw message when unmarked. */
  readonly fallbackEligible: boolean;
  constructor(failure: DbBootFailure, fallbackEligible: boolean) {
    super(`Storage unavailable while ${failure.stage} (incident ${failure.incidentId}).`);
    this.name = "DbUnavailableError";
    this.stage = failure.stage;
    this.incidentId = failure.incidentId;
    this.fallbackEligible = fallbackEligible;
  }
  toJSON() {
    return {
      name: this.name,
      stage: this.stage,
      incidentId: this.incidentId,
      message: this.message,
    };
  }
}

/**
 * Structural brand check for DbUnavailableError. instanceof alone is
 * module-identity dependent: under HMR, a consumer module (e.g.
 * store.server.ts) can retain an older db.ts class while the error comes
 * from a newer instance. Match the stable public shape instead.
 */
export function isDbUnavailableError(err: unknown): err is DbUnavailableError {
  if (err instanceof DbUnavailableError) return true;
  if (typeof err !== "object" || err === null) return false;
  const e = err as Record<string, unknown>;
  return (
    e.name === "DbUnavailableError" &&
    typeof e.incidentId === "string" &&
    typeof e.fallbackEligible === "boolean" &&
    (e.stage === "opening configured store" || e.stage === "app migrations")
  );
}

/**
 * The recorded bootstrap failure as a typed error, when the currently
 * configured store is the one that failed; null otherwise. The typed error
 * carries the fallback classification the old flow produced: when the
 * failure marked the corpus ephemeral, later callers used to hit the
 * "PGLite is disabled" short-circuit (which the dbUnavailable classifier
 * matches), so the typed error is eligible too; an unmarked failure keeps
 * its raw-message classification. Used by every getSql/ensureDbReady/
 * getPglite entry point and by the migration-queue guard.
 */
function recordedBootFailureError(): DbUnavailableError | null {
  if (currentDbSource() !== "pglite") return null;
  const failure = globalRef.__pgliteBootFailure__;
  if (!failure || failure.storeDir !== pgliteDataDir()) return null;
  return new DbUnavailableError(
    failure,
    globalEphemeral.__intelliragForceEphemeral__ === true || failure.regexMatched,
  );
}

/**
 * Result-type parity: Postgres sends every value as text plus a type OID. the
 * JS value is the DRIVER's parsing choice, and pg and PGLite disagree (pg:
 * int8 -> string, date -> local-midnight Date; PGLite: int8 -> BigInt, which
 * JSON.stringify rejects, date -> UTC Date). Normalize both so preview and
 * production return identical, JSON-safe shapes:
 *   int8/bigint (incl. count(*)) -> number (past 2^53 loses precision. cast
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
  sql.transaction = (work) => work(sql); // Nested work already uses the enclosing transaction client.
  return sql;
}

function createNeonSql(): Promise<Sql> {
  globalRef.__pgSqlPromise__ ??= (async () => {
    const url = getDatabaseUrl();
    if (!url) throw new Error("DATABASE_URL is not set");
    // Regular Postgres driver: node-postgres (`pg`). works directly with Neon's
    // pooled endpoint. One pool per process; warm serverless instances reuse it.
    const { Pool, types } = await import("pg");
    types.setTypeParser(OID_INT8, Number);
    types.setTypeParser(OID_DATE, identity);
    types.setTypeParser(OID_INTERVAL, identity);
    const pool = new Pool({
      connectionString: url,
      max: 4,
      connectionTimeoutMillis: 8000,
      idleTimeoutMillis: 20000,
      statement_timeout: 15000,
    });
    const sql = toSql(async <T>(text: string, params: unknown[]) => {
      const res = await pool.query(text, params);
      return res.rows as T[];
    });
    sql.transaction = async (work) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tx = toSql(
          async <T>(text: string, params: unknown[]) =>
            (await client.query(text, params)).rows as T[],
        );
        const result = await work(tx);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    };
    return sql;
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
    // Test-only constructor seam, honored solely under an explicit env flag
    // so the global alone is inert outside the failure-injection tests.
    const testSeam =
      typeof process !== "undefined" && process.env?.INTELLIRAG_TEST_SEAM === "1"
        ? globalRef.__intelliragPgliteCtorForTests__
        : undefined;
    const PGliteCtor = (testSeam ?? PGlite) as typeof PGlite;
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
    const pg = new PGliteCtor({
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
    const failure = recordBootFailure("opening configured store", err);
    globalRef.__pgliteInstance__ = undefined;
    if (isPgliteFsError(err)) markEphemeral(err);
    throw new DbUnavailableError(failure, failure.regexMatched);
  });
  const pg = await globalRef.__pgliteInstance__;

  // Apply migrations/ (the single schema source) so preview matches production.
  // SQL is inlined by the bundler via import.meta.glob (no runtime fs); applied
  // files are tracked in _migrations. The glob does not descend, so the opt-in
  // auth schema under migrations/auth/ stays out. Runs once per module instance
  //. so an HMR reload after adding a migration file applies it live. with
  // passes serialized on a global chain so concurrent callers never
  // double-apply.
  // Vite inlines migrations via import.meta.glob (no runtime fs). tsx/node
  // (tests, scripts) has no glob, so read the same directory from disk. Keys
  // keep the "/migrations/" shape; migrationName() keys by basename, so both
  // appliers agree on what has been applied.
  const loadMigrationSql = async (): Promise<Record<string, string>> => {
    // Vite statically replaces import.meta.glob during transformation, so it
    // must be called by full name - under tsx/node (tests, scripts) the
    // property does not exist and the call throws, falling through to disk.
    try {
      return import.meta.glob("/migrations/*.sql", {
        query: "?raw",
        import: "default",
        eager: true,
      }) as Record<string, string>;
    } catch {
      // no bundler glob - read the same directory from disk below
    }
    const { readdirSync, readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { join } = await import("node:path");
    const dir = fileURLToPath(new URL("../../migrations/", import.meta.url));
    const out: Record<string, string> = {};
    for (const file of readdirSync(dir)) {
      if (!isMigrationFile(file)) continue;
      out[`/migrations/${file}`] = readFileSync(join(dir, file), "utf8");
    }
    return out;
  };

  const migrate = async (): Promise<void> => {
    const migrations = await loadMigrationSql();
    const doneRows = await pg.query<{ name: string }>("select name from _migrations");
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
    .then(async () => {
      // HMR creates a second instance of this module with its own module-
      // local sqlPromise, so its pass may have been queued here before
      // another instance's pass failed and closed the shared PGLite
      // instance. Re-check the recorded failure at the head of the queue:
      // a stale pass must never run migrations on a closed store.
      const stale = recordedBootFailureError();
      if (stale) throw stale;
      await migrate();
    });
  globalRef.__pgliteMigrateChain__ = pass;
  try {
    await pass;
  } catch (err) {
    // A failed bootstrap must not leak the WASM runtime - a live PGLite
    // instance keeps the event loop held and the process never exits. Record
    // the incident first, then close it, drop the cached handles, and go
    // ephemeral so callers fall back to the memory corpus instead of hanging.
    // The recorded failure makes every later getSql() observe the same
    // incident instead of re-running migrations on a reopened store.
    // A queued pass from a second module instance (HMR) surfaces here with
    // the ALREADY-recorded typed error: the original failing pass recorded,
    // closed and marked, so this pass must not re-close or re-mark.
    const alreadyRecorded = isDbUnavailableError(err);
    const failure = recordBootFailure("app migrations", err);
    globalRef.__pgliteInstance__ = undefined;
    globalRef.__pgliteMigrateChain__ = undefined;
    if (!alreadyRecorded) {
      try {
        await pg.close();
      } catch {
        // best effort
      }
      markEphemeral(err);
      throw new DbUnavailableError(failure, failure.regexMatched);
    }
    throw err;
  }

  const sql = toSql(
    async <T>(text: string, params: unknown[]) => (await pg.query<T>(text, params)).rows,
  );
  sql.transaction = (work) =>
    pg.transaction((tx) =>
      work(
        toSql(async <T>(text: string, params: unknown[]) => (await tx.query<T>(text, params)).rows),
      ),
    );
  return sql;
}

let sqlPromise: Promise<Sql> | null = null;

async function createSql(): Promise<Sql> {
  if (typeof window !== "undefined") {
    throw new Error(
      "@/lib/db is server-only. call getSql() from a createServerFn handler " +
        "or a server route loader, never from client code.",
    );
  }
  // One failed attempt per configured store per process: after a recorded
  // PGLite bootstrap failure, every caller observes the same typed incident
  // instead of implicitly reopening the store. This check precedes the
  // ephemeral short-circuit so callers see the incident even when the failure
  // also marked the store ephemeral (fallback policy itself is unchanged).
  // The record is scoped to the PGLite path: with DATABASE_URL set, Neon is
  // the configured store and a stale PGLite record must not shadow it.
  const recorded = recordedBootFailureError();
  if (recorded) throw recorded;
  if (vercelWithoutDatabase()) {
    throw new Error("PGLite is disabled on Vercel without DATABASE_URL");
  }
  return currentDbSource() === "neon" ? createNeonSql() : createPgliteSql();
}

/**
 * Get the shared, **server-only** SQL client. Neon when `DATABASE_URL` is set,
 * otherwise the local PGLite fallback. Memoized. safe to call per request.
 *
 * Schema comes from `migrations/*.sql`, auto-applied before the first query on
 * both backends. define tables there, never inline in server functions.
 */
export function getSql(): Promise<Sql> {
  sqlPromise ??= createSql().catch((err) => {
    // Don't memoize failures. A PGLite bootstrap failure is already recorded
    // (recordBootFailure), so the next call observes the same typed incident
    // instead of reopening the store; Neon failures keep their fresh retry.
    sqlPromise = null;
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
  // Keep the recorded incident observable here even after the corpus was
  // marked ephemeral (which otherwise short-circuits with a generic error).
  const recorded = recordedBootFailureError();
  if (recorded) throw recorded;
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
 *   `.data/pglite` and apply `migrations/*.sql`. Idempotent. concurrent callers
 *   share one promise. On Vercel without DATABASE_URL this path is skipped.
 * - **Neon**: no-op (pool is created lazily on first query).
 *
 * Vite `configureServer` awaits this at dev startup; production imports of this
 * module kick it off immediately (see bottom of file).
 */
export function ensureDbReady(): Promise<void> {
  // A recorded bootstrap failure stays observable here: without this check,
  // a failure that marked the corpus ephemeral would make later readiness
  // calls resolve successfully for a store that never opened.
  const recorded = recordedBootFailureError();
  if (recorded) return Promise.reject(recorded);
  if (currentDbSource() !== "pglite") return Promise.resolve();
  if (vercelWithoutDatabase()) return Promise.resolve();
  return getSql().then(() => undefined);
}

// Server-only eager start: kick PGLite bootstrap as soon as this module loads in
// Node. Client bundles never hit this path (`getSql` throws in the browser).
// Skip entirely on serverless. constructing PGlite there throws
// `ENOENT: open '/var/task/_libs/pglite.data'` and blanks the app.
const globalBoot = globalThis as typeof globalThis & {
  __pgBootstrapPromise__?: Promise<void>;
};
if (typeof window === "undefined" && currentDbSource() === "pglite" && !vercelWithoutDatabase()) {
  globalBoot.__pgBootstrapPromise__ ??= ensureDbReady().catch((err) => {
    globalBoot.__pgBootstrapPromise__ = undefined;
    if (isPgliteFsError(err)) markEphemeral(err);
    // Safe metadata only; raw errors can carry paths and stay on the
    // server-only failure record.
    console.error(
      isDbUnavailableError(err)
        ? `[db] PGLite bootstrap failed while ${err.stage} (incident ${err.incidentId})`
        : `[db] PGLite bootstrap failed (unexpected ${err instanceof Error ? err.name : typeof err})`,
    );
  });
}
