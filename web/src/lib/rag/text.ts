const TOKEN_PATTERN = /[a-z0-9]+/g;

export const QUERY_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "you",
  "with",
  "from",
  "that",
  "this",
  "what",
  "how",
  "why",
  "are",
  "was",
  "were",
  "into",
  "your",
  "a",
  "an",
  "of",
  "to",
  "in",
  "on",
  "or",
  "do",
  "does",
  "did",
  "is",
  "it",
  "as",
  "be",
  "by",
  "if",
  "not",
  "can",
  "should",
  "would",
  "could",
  "when",
  "which",
  "who",
  "whom",
  "been",
  "have",
  "has",
  "had",
  "will",
  "just",
  "about",
  "than",
  "then",
  "also",
  "only",
  "over",
  "after",
  "before",
  "between",
  "same",
  "each",
  "other",
  "more",
  "most",
  "such",
  "very",
  "right",
  "me",
  "my",
  "we",
  "our",
  "i",
  "explain",
  "describe",
  "tell",
  "show",
  "work",
  "works",
  "please",
  "thanks",
]);

/** Shared ops vocabulary that must not let unrelated runbooks ride into context. */
export const GENERIC_OPS_TERMS = new Set([
  "node",
  "nodes",
  "memory",
  "cpu",
  "cpus",
  "ram",
  "resource",
  "resources",
  "server",
  "servers",
  "service",
  "services",
  "guide",
  "runbook",
  "error",
  "errors",
  "issue",
  "issues",
  "use",
  "using",
  "used",
  "handle",
  "handling",
  "system",
  "systems",
  "process",
  "limit",
  "limits",
  "timeout",
  "timeouts",
  "request",
  "requests",
  "cluster",
  "host",
  "free",
  "enough",
  "individual",
  "aggregate",
  "pattern",
  "failure",
  "failures",
]);

export function tokenize(text: string): string[] {
  return text.toLowerCase().match(TOKEN_PATTERN) ?? [];
}

export function stemToken(token: string): string {
  if (token.length < 5) return token;
  if (token.endsWith("ing") && token.length > 6) return token.slice(0, -3);
  if (token.endsWith("ers") && token.length > 6) return token.slice(0, -1);
  if (token.endsWith("ies") && token.length > 5) return `${token.slice(0, -3)}y`;
  if (token.endsWith("es") && token.length > 5) return token.slice(0, -2);
  if (token.endsWith("ed") && token.length > 5) {
    const minusD = token.slice(0, -1);
    // cached → cache, expired → expire; stamped → stamp
    if (minusD.endsWith("e")) return minusD;
    return token.slice(0, -2);
  }
  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 4) return token.slice(0, -1);
  return token;
}

export function contentTokens(text: string): string[] {
  return tokenize(text)
    .filter((t) => t.length > 1 && !QUERY_STOPWORDS.has(t))
    .map(stemToken);
}

export function bigrams(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length - 1; i += 1) {
    out.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return out;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (Math.abs(a.length - b.length) > 2) return 99;
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 99) + 1, (cur[j - 1] ?? 99) + 1, (prev[j - 1] ?? 99) + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = cur[j] ?? 99;
  }
  return prev[b.length] ?? 99;
}

/** Repair obvious typos against the corpus vocabulary (distance 1, or 2 for long tokens). */
export function expandTypos(queryTokens: string[], vocab: Set<string>): string[] {
  const extra: string[] = [];
  for (const raw of queryTokens) {
    if (vocab.has(raw) || raw.length < 5) continue;
    let best: string | null = null;
    let bestD = 99;
    let ties = 0;
    const max = raw.length >= 8 ? 2 : 1;
    for (const v of vocab) {
      if (Math.abs(v.length - raw.length) > max) continue;
      const d = levenshtein(raw, v);
      if (d < bestD) {
        bestD = d;
        best = v;
        ties = 1;
      } else if (d === bestD) {
        ties += 1;
      }
    }
    if (best && bestD <= max && ties === 1) extra.push(best);
  }
  return extra;
}

export function tokenSetMatches(queryToken: string, doc: Set<string>): boolean {
  if (doc.has(queryToken)) return true;
  const stemmed = stemToken(queryToken);
  if (doc.has(stemmed)) return true;
  if (queryToken.length < 4) return false;
  for (const t of doc) {
    if (t.length < 4) continue;
    if (t.startsWith(queryToken) || queryToken.startsWith(t)) return true;
  }
  return false;
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.trim().length / 4));
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "document";
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function l2Normalize(values: number[]): number[] {
  let sum = 0;
  for (const v of values) sum += v * v;
  const mag = Math.sqrt(sum);
  if (mag === 0) return values;
  return values.map((v) => v / mag);
}

export function parseEmbedding(raw: string | null): number[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed.map((n) => Number(n));
  } catch {
    return null;
  }
}

export function snippet(text: string, max = 280): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}
