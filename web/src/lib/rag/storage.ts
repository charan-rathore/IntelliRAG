import type { StorageStatus } from "./types";

/**
 * Read a process env var by dynamic key so Vite/Nitro cannot replace it with
 * `undefined` at build time (the sandbox has no `VERCEL` / `DATABASE_URL`).
 */
function runtimeEnv(name: string): string | undefined {
  if (typeof process === "undefined") return undefined;
  try {
    const bag = process.env;
    const value = bag?.[name];
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

function safeCwd(): string {
  try {
    return typeof process.cwd === "function" ? process.cwd() : "";
  } catch {
    return "";
  }
}

export function getDatabaseUrl(): string | undefined {
  return runtimeEnv("DATABASE_URL");
}

/**
 * True on Vercel/Lambda even when `process.env.VERCEL` was stripped at build.
 * The live crash was `ENOENT … /var/task/_libs/pglite.data` — cwd is the
 * signal that cannot be faked by the bundler.
 */
export function isServerlessRuntime(cwd = safeCwd()): boolean {
  if (cwd === "/var/task" || cwd.startsWith("/var/task/")) return true;
  if (cwd.startsWith("/opt/nodejs")) return true;
  // Split so static `process.env.VERCEL` replacement cannot see a literal.
  const vercel = ["VE", "RCEL"].join("");
  if (runtimeEnv(vercel) || runtimeEnv(`${vercel}_ENV`) || runtimeEnv(`${vercel}_URL`)) {
    return true;
  }
  if (
    runtimeEnv("AWS_LAMBDA_FUNCTION_NAME") ||
    runtimeEnv("LAMBDA_TASK_ROOT") ||
    runtimeEnv("NOW_REGION")
  ) {
    return true;
  }
  return false;
}

export function isVercelRuntime(): boolean {
  return isServerlessRuntime();
}

/**
 * Durable embeddings require Postgres.
 * - Neon when DATABASE_URL is set (production)
 * - File-backed PGLite locally so cold starts keep vectors
 * - Vercel without DATABASE_URL cannot persist; dense retrieval is disabled
 */
export function getStorageStatus(): StorageStatus {
  if (getDatabaseUrl()) {
    return {
      backend: "neon",
      durable: true,
      denseAvailable: true,
      warning: null,
    };
  }
  if (isServerlessRuntime()) {
    return {
      backend: "ephemeral",
      durable: false,
      denseAvailable: false,
      warning:
        "Running without a Postgres URL on serverless. Keyword search still works on seed text; embeddings do not survive cold starts.",
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
  if (isServerlessRuntime()) return "/tmp/intellirag-pglite";
  return `${safeCwd()}/.data/pglite`;
}
