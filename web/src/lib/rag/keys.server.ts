import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getRequest, setCookie } from "@tanstack/react-start/server";
import type { KeyProvider } from "./types";

/**
 * Server-only key vault.
 *
 * Sources, in order:
 *  1. process.env (GEMINI_API_KEY / OPENROUTER_API_KEY) — durable, never shipped
 *     to the browser. Preferred for deploy (Vercel server env, not VITE_).
 *  2. Workspace file + /tmp + in-process global — survives Vite HMR and preview
 *     restarts in this sandbox. Never written into git, never returned to the
 *     client.
 *  3. httpOnly cookies set by Settings — required on Vercel because each
 *     serverless isolate has its own /tmp and memory. The cookie is never
 *     readable from page JavaScript.
 *
 * Client-submitted keys on query/embed requests are ignored. Env keys cannot
 * be overwritten from the browser.
 */
type Stored = { gemini?: string; openrouter?: string };

const TMP_PATH = "/tmp/intellirag-lab-keys.json";
const WORKSPACE_PATH = "/workspace/.data/lab-keys.json";
const COOKIE_OR = "ir_or";
const COOKIE_GM = "ir_gm";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

type GlobalKeys = typeof globalThis & { __intelliragLabKeys?: Stored };

function g(): GlobalKeys {
  return globalThis as GlobalKeys;
}

function readPath(path: string): Stored {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Stored;
    return {
      gemini: parsed.gemini?.trim() || undefined,
      openrouter: parsed.openrouter?.trim() || undefined,
    };
  } catch {
    return {};
  }
}

function writePath(path: string, stored: Stored) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    if (!stored.gemini && !stored.openrouter) {
      try {
        unlinkSync(path);
      } catch {
        // ignore
      }
      return;
    }
    writeFileSync(path, JSON.stringify(stored), { mode: 0o600 });
  } catch {
    // preview-only persistence; env vars remain the durable production path
  }
}

function readDisk(): Stored {
  const workspace = readPath(WORKSPACE_PATH);
  const tmp = readPath(TMP_PATH);
  return {
    gemini: tmp.gemini || workspace.gemini,
    openrouter: tmp.openrouter || workspace.openrouter,
  };
}

function writeDisk(stored: Stored) {
  writePath(TMP_PATH, stored);
  writePath(WORKSPACE_PATH, stored);
}

function memory(): Stored {
  if (!g().__intelliragLabKeys) g().__intelliragLabKeys = readDisk();
  return g().__intelliragLabKeys!;
}

function parseCookieHeader(header: string | null | undefined): Stored {
  if (!header) return {};
  const out: Stored = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    let value = part.slice(idx + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch {
      // keep raw
    }
    if (name === COOKIE_OR && value) out.openrouter = value;
    if (name === COOKIE_GM && value) out.gemini = value;
  }
  return out;
}

function cookiesFromRequestContext(): Stored {
  try {
    return parseCookieHeader(getRequest()?.headers.get("cookie"));
  } catch {
    return {};
  }
}

function applyCookieKeys(cookies: Stored) {
  const mem = memory();
  let changed = false;
  if (cookies.openrouter && !mem.openrouter && !envOpenRouter()) {
    mem.openrouter = cookies.openrouter;
    changed = true;
  }
  if (cookies.gemini && !mem.gemini && !envGemini()) {
    mem.gemini = cookies.gemini;
    changed = true;
  }
  if (changed) {
    g().__intelliragLabKeys = mem;
    writeDisk(mem);
  }
}

/** Pull Settings cookies into this isolate before query / eval / snapshot. */
export function hydrateKeysFromRequest(request: Request | null | undefined) {
  applyCookieKeys(parseCookieHeader(request?.headers.get("cookie")));
}

function cookieLine(name: string, value: string | undefined): string {
  const secure = Boolean(process.env.VERCEL);
  const flags = `Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
  if (!value) return `${name}=; ${flags}; Max-Age=0`;
  return `${name}=${encodeURIComponent(value)}; ${flags}; Max-Age=${COOKIE_MAX_AGE}`;
}

export function labKeySetCookieHeaders(): string[] {
  const mem = memory();
  return [cookieLine(COOKIE_OR, mem.openrouter), cookieLine(COOKIE_GM, mem.gemini)];
}

export function writeLabKeyCookies() {
  try {
    const mem = memory();
    const secure = Boolean(process.env.VERCEL);
    const common = { path: "/", httpOnly: true, secure, sameSite: "lax" as const };
    setCookie(COOKIE_OR, mem.openrouter ?? "", {
      ...common,
      maxAge: mem.openrouter ? COOKIE_MAX_AGE : 0,
    });
    setCookie(COOKIE_GM, mem.gemini ?? "", {
      ...common,
      maxAge: mem.gemini ? COOKIE_MAX_AGE : 0,
    });
  } catch {
    // API routes set Set-Cookie on the Response instead.
  }
}

export function classifyKey(raw: string): KeyProvider | "unknown" {
  const key = raw.trim();
  if (!key) return "unknown";
  if (key.startsWith("sk-or-")) return "openrouter";
  if (key.startsWith("AIza")) return "google";
  return "unknown";
}

function envGemini() {
  return process.env.GEMINI_API_KEY?.trim() || undefined;
}

function envOpenRouter() {
  return process.env.OPENROUTER_API_KEY?.trim() || undefined;
}

export function getLabKeys() {
  applyCookieKeys(cookiesFromRequestContext());
  const mem = memory();
  return {
    gemini: envGemini() || mem.gemini,
    openrouter: envOpenRouter() || mem.openrouter,
  };
}

export function keyStatus() {
  applyCookieKeys(cookiesFromRequestContext());
  const envG = Boolean(envGemini());
  const envO = Boolean(envOpenRouter());
  const gemini = Boolean(getLabKeys().gemini);
  const openrouter = Boolean(getLabKeys().openrouter);
  return {
    hasGeminiKey: gemini,
    hasOpenRouterKey: openrouter,
    hasServerKey: gemini || openrouter,
    geminiFromEnv: envG,
    openRouterFromEnv: envO,
    embeddingVia: (gemini ? "google" : openrouter ? "openrouter" : null) as
      | KeyProvider
      | null,
    generationVia: (openrouter ? "openrouter" : gemini ? "google" : null) as
      | KeyProvider
      | null,
  };
}

export function setMemoryKeys(input: {
  gemini?: string;
  openrouter?: string;
  clearGemini?: boolean;
  clearOpenRouter?: boolean;
}) {
  const mem = memory();
  if (input.clearGemini && !envGemini()) delete mem.gemini;
  if (input.clearOpenRouter && !envOpenRouter()) delete mem.openrouter;

  const incoming: string[] = [];
  if (input.gemini?.trim()) incoming.push(input.gemini.trim());
  if (input.openrouter?.trim()) incoming.push(input.openrouter.trim());

  for (const raw of incoming) {
    const kind = classifyKey(raw);
    if (kind === "openrouter") {
      if (!envOpenRouter()) mem.openrouter = raw;
    } else if (kind === "google") {
      if (!envGemini()) mem.gemini = raw;
    } else if (input.openrouter?.trim() === raw) {
      if (!envOpenRouter()) mem.openrouter = raw;
    } else if (!envGemini()) {
      mem.gemini = raw;
    }
  }

  g().__intelliragLabKeys = mem;
  writeDisk(mem);
  writeLabKeyCookies();
  return keyStatus();
}

export function resolveRuntime(): {
  embed: { provider: KeyProvider; apiKey: string } | null;
  generate: { provider: KeyProvider; apiKey: string } | null;
} {
  const keys = getLabKeys();
  const embed = keys.gemini
    ? { provider: "google" as const, apiKey: keys.gemini }
    : keys.openrouter
      ? { provider: "openrouter" as const, apiKey: keys.openrouter }
      : null;
  const generate = keys.openrouter
    ? { provider: "openrouter" as const, apiKey: keys.openrouter }
    : keys.gemini
      ? { provider: "google" as const, apiKey: keys.gemini }
      : null;
  return { embed, generate };
}
