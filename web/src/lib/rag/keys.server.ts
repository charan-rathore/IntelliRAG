import { getRequest, setCookie } from "@tanstack/react-start/server";
import type { KeyProvider } from "./types";

/** Browser keys belong to a request, never a process, disk file, or another visitor. */
type Stored = { gemini?: string; openrouter?: string };
const COOKIE_OR = "ir_or";
const COOKIE_GM = "ir_gm";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
const perRequest = new WeakMap<Request, Stored>();

function parseCookies(request: Request): Stored {
  const out: Stored = {};
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    let value = part.slice(separator + 1).trim();
    try { value = decodeURIComponent(value); } catch { continue; }
    if (name === COOKIE_OR && value) out.openrouter = value;
    if (name === COOKIE_GM && value) out.gemini = value;
  }
  return out;
}
function requestKeys(): Stored {
  let request: Request;
  try { request = getRequest(); } catch { return {}; }
  if (!request) return {};
  if (!perRequest.has(request)) perRequest.set(request, parseCookies(request));
  return perRequest.get(request)!;
}
export function hydrateKeysFromRequest(request: Request | null | undefined) {
  if (request && !perRequest.has(request)) perRequest.set(request, parseCookies(request));
}
function secureCookie() {
  try { return new URL(getRequest().url).protocol === "https:"; } catch { return true; }
}
function cookieLine(name: string, value: string | undefined): string {
  return `${name}=${encodeURIComponent(value ?? "")}; Path=/; HttpOnly; SameSite=Strict${secureCookie() ? "; Secure" : ""}; Max-Age=${value ? COOKIE_MAX_AGE : 0}`;
}
export function labKeySetCookieHeaders(): string[] {
  const keys = requestKeys();
  return [cookieLine(COOKIE_OR, keys.openrouter), cookieLine(COOKIE_GM, keys.gemini)];
}
export function writeLabKeyCookies() {
  const keys = requestKeys();
  const options = { path: "/", httpOnly: true, secure: secureCookie(), sameSite: "strict" as const };
  setCookie(COOKIE_OR, keys.openrouter ?? "", { ...options, maxAge: keys.openrouter ? COOKIE_MAX_AGE : 0 });
  setCookie(COOKIE_GM, keys.gemini ?? "", { ...options, maxAge: keys.gemini ? COOKIE_MAX_AGE : 0 });
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

function envXai() {
  return process.env.XAI_API_KEY?.trim() || undefined;
}

export function getLabKeys() {
  const mem = requestKeys();
  return {
    gemini: envGemini() || mem.gemini,
    openrouter: envOpenRouter() || mem.openrouter,
  };
}

export function keyStatus() {
  const envG = Boolean(envGemini());
  const envO = Boolean(envOpenRouter());
  const envX = Boolean(envXai());
  const gemini = Boolean(getLabKeys().gemini);
  const openrouter = Boolean(getLabKeys().openrouter);
  return {
    hasGeminiKey: gemini,
    hasOpenRouterKey: openrouter,
    hasXaiKey: envX,
    hasServerKey: gemini || openrouter || envX,
    geminiFromEnv: envG,
    openRouterFromEnv: envO,
    xaiFromEnv: envX,
    embeddingVia: (gemini ? "google" : openrouter ? "openrouter" : null) as
      | KeyProvider
      | null,
    generationVia: (openrouter
      ? "openrouter"
      : gemini
        ? "google"
        : envX
          ? "xai"
          : null) as KeyProvider | null,
  };
}

export function setMemoryKeys(input: {
  gemini?: string;
  openrouter?: string;
  clearGemini?: boolean;
  clearOpenRouter?: boolean;
}) {
  const mem = requestKeys();
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
      : envXai()
        ? { provider: "xai" as const, apiKey: envXai()! }
        : null;
  return { embed, generate };
}
