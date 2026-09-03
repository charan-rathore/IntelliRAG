import type { StorageStatus } from "./types";

function databaseUrl(): string | undefined {
  const raw = typeof process !== "undefined" ? process.env.DATABASE_URL : undefined;
  return raw && raw.trim() ? raw.trim() : undefined;
}

export function isVercelRuntime(): boolean {
  return Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
}

/**
 * Durable embeddings require Postgres.
 * - Neon when DATABASE_URL is set (production)
 * - File-backed PGLite locally so cold starts keep vectors
 * - Vercel without DATABASE_URL cannot persist; dense retrieval is disabled
 */
export function getStorageStatus(): StorageStatus {
  if (databaseUrl()) {
    return {
      backend: "neon",
      durable: true,
      denseAvailable: true,
      warning: null,
    };
  }
  if (isVercelRuntime()) {
    return {
      backend: "ephemeral",
      durable: false,
      denseAvailable: false,
      warning:
        "DATABASE_URL is required on Vercel. Without it, embeddings do not survive cold starts and dense retrieval is disabled. Keyword (BM25) search still runs on seed text.",
    };
  }
  return {
    backend: "pglite",
    durable: true,
    denseAvailable: true,
    warning: null,
  };
}

export function pgliteDataDir(): string {
  return `${process.cwd()}/.data/pglite`;
}
