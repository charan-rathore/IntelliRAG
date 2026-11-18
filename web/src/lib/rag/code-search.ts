/**
 * Code search: the search bar's engine. Built for how developers type into a
 * search box ("python remove all empty items in list", "fs.readFile utf8",
 * "path:src lang:ts retry backoff") against code and docs, not for answering.
 *
 * Lexical and explainable, like the rest of IntelliRAG, with the parts that
 * matter for code:
 *  - Identifier-aware tokens: `readJsonFile`, `read_json_file` and
 *    `fs.readFile` are split into their words and also kept whole, so both
 *    "read json file" and "readJsonFile" match (Husain et al., CodeSearchNet,
 *    2019: subtoken splitting is the strongest single lexical feature).
 *  - Fields (BM25F, Robertson et al. 2004): a match in a function's name or
 *    docstring counts for more than one in its body.
 *  - A developer lexicon: "dict" ~ "dictionary", "remove" ~ "delete", "str" ~
 *    "string". Expansions are weighted below the words typed.
 *  - Pseudo-relevance feedback (RM3; Lavrenko & Croft 2001, Abdul-Jaleel et
 *    al. 2004): terms common to the top results are added at lower weight.
 *  - Operators, as a search engine has them: "exact phrase", -exclude,
 *    path:, lang:, kind:code|prose, sym:.
 */
import { QUERY_STOPWORDS, stemToken } from "./text";

/* ------------------------------ tokenizing ------------------------------ */

/** Split identifiers into words: readJSONFile → read json file; read_json_file → read json file. */
export function splitIdentifier(id: string): string[] {
  return id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

/** Code-aware tokens: every word of every identifier, stemmed, plus whole identifiers. */
export function codeTokens(text: string, opts: { keepWhole?: boolean } = {}): string[] {
  const out: string[] = [];
  for (const raw of text.match(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*|\d+/g) ?? []) {
    const parts = raw.split(".").flatMap(splitIdentifier);
    for (const p of parts) if (p.length > 1 && !QUERY_STOPWORDS.has(p) && !CODE_NOISE.has(p)) out.push(stemToken(p));
    if (opts.keepWhole !== false && (parts.length > 1 || raw.includes("."))) out.push(raw.toLowerCase());
  }
  return out;
}

/** Keywords too common in code to tell functions apart. */
const CODE_NOISE = new Set(["def", "self", "return", "none", "true", "false", "args", "kwargs", "param", "params", "returns", "type", "rtype", "const", "let", "var", "function", "import", "from", "class", "pass", "elif", "else", "this", "new", "public", "private", "static", "void", "int", "py", "python"]);

/* ------------------------------- lexicon -------------------------------- */

/**
 * How developers' words map to code's words. Small and general on purpose:
 * abbreviations and near-synonyms any codebase uses, not a list tuned to one
 * benchmark (it was written before the evaluation ran, and tuned only on
 * CoSQA's training queries).
 */
const LEXICON: Record<string, string[]> = {
  dict: ["dictionary", "map"], dictionary: ["dict"], map: ["dict"],
  str: ["string"], string: ["str", "text"], text: ["str", "string"],
  int: ["integer", "number"], integer: ["int"], number: ["int", "float", "num"], num: ["number"],
  list: ["array", "items"], array: ["list"], arr: ["array", "list"],
  remove: ["delete", "strip", "drop"], delete: ["remove", "del"], drop: ["remove"],
  len: ["length", "size"], length: ["len", "size"], size: ["len", "length"], count: ["len", "number"],
  file: ["path", "open"], dir: ["directory", "folder"], directory: ["dir", "folder"], folder: ["dir", "directory"],
  convert: ["to", "cast", "parse"], parse: ["load", "read"], read: ["load", "open"], load: ["read"], write: ["save", "dump"], save: ["write", "dump"],
  check: ["is", "valid", "exists"], exists: ["exist", "check"], empty: ["none", "blank"], null: ["none"],
  get: ["fetch", "find"], find: ["search", "get", "index"], search: ["find"], first: ["head"], last: ["tail"],
  json: ["load", "dump"], url: ["http", "request"], http: ["request", "url"], request: ["http"],
  sort: ["order", "sorted"], reverse: ["reversed"], unique: ["set", "distinct", "duplicate"], duplicate: ["unique"],
  max: ["maximum", "largest"], min: ["minimum", "smallest"], sum: ["total", "add"],
  date: ["datetime", "time"], datetime: ["date", "time"], time: ["datetime", "timestamp"], timestamp: ["time"],
  lowercase: ["lower"], uppercase: ["upper"], split: ["separate", "tokenize"], join: ["concat", "concatenate"], concat: ["join"],
  random: ["rand", "shuffle"], replace: ["sub", "substitute"], regex: ["re", "pattern"], async: ["await", "promise"], promise: ["async"],
  error: ["exception", "raise"], exception: ["error", "raise"], retry: ["backoff", "attempt"], timeout: ["deadline"],
};

/* ------------------------------- queries -------------------------------- */

export interface ParsedQuery {
  /** Free words typed. */
  words: string[];
  /** "exact phrases" that must appear. */
  phrases: string[];
  /** -words that must not appear. */
  exclude: string[];
  path?: string;
  lang?: string;
  kind?: "code" | "prose";
  symbol?: string;
}

/** Parse operators the way a search engine does; everything else is free text. */
export function parseSearchQuery(q: string): ParsedQuery {
  const out: ParsedQuery = { words: [], phrases: [], exclude: [] };
  const re = /(-?)"([^"]+)"|(-?)(\w+):(\S+)|(-?)(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q))) {
    if (m[2] !== undefined) { (m[1] ? out.exclude : out.phrases).push(m[2]); continue; }
    if (m[4] !== undefined) {
      const key = m[4].toLowerCase(), val = m[5]!;
      if (key === "path" || key === "file") out.path = val.toLowerCase();
      else if (key === "lang" || key === "language") out.lang = val.toLowerCase();
      else if (key === "kind") out.kind = val.toLowerCase() === "prose" || val.toLowerCase() === "docs" ? "prose" : "code";
      else if (key === "sym" || key === "symbol") out.symbol = val.toLowerCase();
      else out.words.push(`${key}:${val}`);
      continue;
    }
    const w = m[7]!;
    if (m[6]) out.exclude.push(w);
    else out.words.push(w);
  }
  return out;
}

/* -------------------------------- index --------------------------------- */

export interface SearchDoc {
  id: string;
  /** Function, class or heading name, if any. */
  name?: string | null;
  /** Docstring or the prose around it. */
  doc?: string | null;
  body: string;
  path?: string | null;
  lang?: string | null;
  kind?: "code" | "prose";
}

export interface SearchOptions {
  k1?: number;
  b?: number;
  /** BM25F field weights. */
  nameWeight?: number;
  docWeight?: number;
  /** Weight of a lexicon expansion relative to a typed word. */
  synonymWeight?: number;
  /** RM3: feedback docs, expansion terms, weight of the expansion. 0 docs turns it off. */
  prfDocs?: number;
  prfTerms?: number;
  prfWeight?: number;
  useLexicon?: boolean;
  /** Weight of learned associations (see learnAssociations) relative to a typed word. */
  associationWeight?: number;
  associationsPerTerm?: number;
}

export const DEFAULT_SEARCH: Required<SearchOptions> = {
  // Tuned on 500 CoSQA training queries (scripts/cosqa-bench.ts --tune), never on dev.
  // The lexicon and RM3 didn't help there, so they're available but off.
  k1: 1.2, b: 0.75, nameWeight: 4, docWeight: 2, synonymWeight: 0.35, prfDocs: 0, prfTerms: 8, prfWeight: 0.3, useLexicon: false, associationWeight: 0.35, associationsPerTerm: 2,
};

/**
 * What searchers' words tend to mean in code, learned from pairs of a query and
 * the result that answered it: a statistical translation table in the spirit of
 * Berger & Lafferty (SIGIR 1999), scored by positive PMI. The product learns
 * the same thing from its experience log (questions and the passages people
 * confirmed); the benchmark learns it from CoSQA's training pairs.
 */
export type Associations = Map<string, Array<{ term: string; weight: number }>>;

export function learnAssociations(pairs: Array<{ query: string; doc: string }>, opts: { minCount?: number; perTerm?: number; docTerms?: number } = {}): Associations {
  const minCount = opts.minCount ?? 3, perTerm = opts.perTerm ?? 8, docTerms = opts.docTerms ?? 40;
  const qCount = new Map<string, number>(), dCount = new Map<string, number>(), co = new Map<string, Map<string, number>>();
  for (const { query, doc } of pairs) {
    const qs = new Set(codeTokens(query, { keepWhole: false }));
    const ds = new Set(codeTokens(doc, { keepWhole: false }).slice(0, docTerms * 4));
    for (const q of qs) qCount.set(q, (qCount.get(q) ?? 0) + 1);
    for (const d of ds) dCount.set(d, (dCount.get(d) ?? 0) + 1);
    for (const q of qs) {
      let row = co.get(q);
      if (!row) co.set(q, (row = new Map()));
      for (const d of ds) if (d !== q) row.set(d, (row.get(d) ?? 0) + 1);
    }
  }
  const n = pairs.length;
  const out: Associations = new Map();
  for (const [q, row] of co) {
    const list: Array<{ term: string; weight: number }> = [];
    for (const [d, c] of row) {
      if (c < minCount) continue;
      const pmi = Math.log((c * n) / (qCount.get(q)! * dCount.get(d)!));
      if (pmi > 0) list.push({ term: d, weight: pmi * Math.min(1, c / 10) });
    }
    list.sort((a, b) => b.weight - a.weight || (a.term < b.term ? -1 : 1));
    if (list.length) out.set(q, list.slice(0, perTerm));
  }
  return out;
}

interface Indexed { id: string; tf: Map<string, number>; len: number; doc: SearchDoc }

export interface SearchHit { id: string; score: number; matched: string[] }

/** Leading `def name(` / `function name(` / `class Name` / `name = (` → name. */
export function nameOf(code: string): string | null {
  const m = /(?:def|function|class|func|fn)\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/.exec(code);
  return m ? (m[1] ?? m[2] ?? null) : null;
}

/** First docstring or leading comment block. */
export function docOf(code: string): string | null {
  const m = /"""([\s\S]*?)"""|'''([\s\S]*?)'''|\/\*\*([\s\S]*?)\*\/|^\s*((?:(?:#|\/\/)[^\n]*\n)+)/m.exec(code);
  return m ? (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").trim() : null;
}

export class CodeSearchIndex {
  private docs: Indexed[] = [];
  private df = new Map<string, number>();
  private avgLen = 0;
  constructor(docs: SearchDoc[], private opts: Required<SearchOptions> = DEFAULT_SEARCH, private associations: Associations | null = null) {
    for (const d of docs) {
      const tf = new Map<string, number>();
      const add = (tokens: string[], w: number) => { for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + w); };
      const name = d.name ?? nameOf(d.body);
      const doc = d.doc ?? docOf(d.body);
      add(codeTokens(d.body), 1);
      if (name) add(codeTokens(name), opts.nameWeight);
      if (doc) add(codeTokens(doc, { keepWhole: false }), opts.docWeight - 1); // the docstring is in the body already
      if (d.path) add(codeTokens(d.path), 1);
      let len = 0;
      for (const v of tf.values()) len += v;
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.push({ id: d.id, tf, len, doc: d });
    }
    this.avgLen = this.docs.reduce((a, d) => a + d.len, 0) / Math.max(1, this.docs.length);
  }

  get size() { return this.docs.length; }
  idf(t: string) { const n = this.docs.length, df = this.df.get(t) ?? 0; return Math.log(1 + (n - df + 0.5) / (df + 0.5)); }
  has(t: string) { return this.df.has(t); }

  /** Weighted query terms: typed words at 1, lexicon expansions lower. */
  queryTerms(words: string[]): Map<string, number> {
    const q = new Map<string, number>();
    const put = (t: string, w: number) => { if (w > (q.get(t) ?? 0)) q.set(t, w); };
    for (const w of words) {
      for (const t of codeTokens(w)) put(t, 1);
      if (!this.opts.useLexicon) continue;
      for (const raw of splitIdentifier(w)) for (const syn of LEXICON[raw] ?? []) for (const t of codeTokens(syn)) put(t, this.opts.synonymWeight);
    }
    if (this.associations && this.opts.associationWeight > 0) {
      const typed = [...q.entries()].filter(([, w]) => w === 1).map(([t]) => t);
      for (const t of typed) {
        const list = (this.associations.get(t) ?? []).slice(0, this.opts.associationsPerTerm);
        const top = list[0]?.weight ?? 0;
        for (const a of list) put(a.term, this.opts.associationWeight * (a.weight / top));
      }
    }
    return q;
  }

  private scoreAll(q: Map<string, number>): Array<{ i: number; score: number }> {
    const { k1, b } = this.opts;
    const out: Array<{ i: number; score: number }> = [];
    const idf = new Map([...q.keys()].map((t) => [t, this.idf(t)]));
    this.docs.forEach((d, i) => {
      let s = 0;
      for (const [t, w] of q) {
        const f = d.tf.get(t);
        if (!f) continue;
        s += w * idf.get(t)! * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / this.avgLen)));
      }
      if (s > 0) out.push({ i, score: s });
    });
    return out.sort((x, y) => y.score - x.score);
  }

  search(query: string | ParsedQuery, topK = 10): SearchHit[] {
    const p = typeof query === "string" ? parseSearchQuery(query) : query;
    let q = this.queryTerms([...p.words, ...p.phrases]);
    if (!q.size) return [];
    let ranked = this.scoreAll(q);
    // RM3: the commonest distinctive terms of the top results join the query.
    if (this.opts.prfDocs > 0 && ranked.length > 1) {
      const fb = new Map<string, number>();
      const top = ranked.slice(0, this.opts.prfDocs);
      const total = top.reduce((a, r) => a + r.score, 0) || 1;
      for (const r of top) {
        const d = this.docs[r.i]!;
        for (const [t, f] of d.tf) fb.set(t, (fb.get(t) ?? 0) + (r.score / total) * (f / d.len) * this.idf(t));
      }
      const extra = [...fb].filter(([t]) => !q.has(t)).sort((a, b) => b[1] - a[1]).slice(0, this.opts.prfTerms);
      const max = extra[0]?.[1] ?? 0;
      if (max > 0) {
        q = new Map(q);
        for (const [t, v] of extra) q.set(t, this.opts.prfWeight * (v / max));
        ranked = this.scoreAll(q);
      }
    }
    const typed = new Set(this.queryTerms(p.words).keys());
    const hits: SearchHit[] = [];
    for (const r of ranked) {
      const d = this.docs[r.i]!;
      if (!passesFilters(d.doc, p)) continue;
      hits.push({ id: d.id, score: r.score, matched: [...typed].filter((t) => d.tf.has(t)) });
      if (hits.length >= topK) break;
    }
    return hits;
  }

  doc(id: string) { return this.docs.find((d) => d.id === id)?.doc; }
}

function passesFilters(d: SearchDoc, p: ParsedQuery): boolean {
  const body = d.body.toLowerCase();
  if (p.path && !(d.path ?? "").toLowerCase().includes(p.path)) return false;
  if (p.lang && (d.lang ?? "").toLowerCase() !== p.lang && !(d.path ?? "").toLowerCase().endsWith(`.${p.lang}`)) return false;
  if (p.kind && (d.kind ?? "code") !== p.kind) return false;
  if (p.symbol && !((d.name ?? nameOf(d.body) ?? "").toLowerCase().includes(p.symbol))) return false;
  for (const ph of p.phrases) if (!body.includes(ph.toLowerCase())) return false;
  for (const x of p.exclude) if (body.includes(x.toLowerCase())) return false;
  return true;
}

/* --------------------------- did you mean / suggest --------------------------- */

function editDistance(a: string, b: string, max = 2): number {
  // Optimal string alignment: a swapped pair of letters ("pasue") is one edit.
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let pp: number[] = [], prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, pp[j - 2]! + 1);
      cur[j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    pp = prev; prev = cur;
  }
  return prev[b.length]!;
}

/**
 * "Did you mean": each typed word the corpus doesn't have, replaced by the
 * commonest corpus word within one edit (two for long words). Null when every
 * word is known or nothing is close.
 */
export function didYouMean(query: string, vocab: Map<string, number>): string | null {
  let changed = false;
  const out = query.split(/(\s+)/).map((tok) => {
    const w = tok.toLowerCase();
    if (!/^[a-z][a-z0-9_]{2,}$/.test(w) || vocab.has(w) || vocab.has(stemToken(w)) || QUERY_STOPWORDS.has(w)) return tok;
    const max = w.length >= 8 ? 2 : 1;
    let best: { t: string; f: number; d: number } | null = null;
    for (const [t, f] of vocab) {
      if (t.length < 3 || t.includes(".")) continue;
      const d = editDistance(w, t, max);
      if (d <= max && (!best || d < best.d || (d === best.d && f > best.f))) best = { t, f, d };
    }
    if (!best) return tok;
    changed = true;
    return best.t;
  });
  return changed ? out.join("") : null;
}

/** Surface words with their document frequency, for suggestions and spelling. */
export function surfaceVocab(docs: SearchDoc[]): Map<string, number> {
  const v = new Map<string, number>();
  for (const d of docs) {
    const seen = new Set<string>();
    for (const raw of `${d.name ?? ""} ${d.doc ?? ""} ${d.body}`.match(/[A-Za-z][A-Za-z0-9_]*/g) ?? []) {
      for (const w of [raw.toLowerCase(), ...splitIdentifier(raw)]) if (w.length > 2 && !seen.has(w)) { seen.add(w); v.set(w, (v.get(w) ?? 0) + 1); }
    }
  }
  return v;
}

/**
 * Completions for the word being typed, from the corpus's own vocabulary and
 * symbols, commonest first; earlier questions people asked rank above both.
 */
export function suggest(prefix: string, vocab: Map<string, number>, opts: { asked?: string[]; limit?: number } = {}): string[] {
  const limit = opts.limit ?? 8;
  const head = prefix.replace(/\S+$/, "");
  const last = (/\S+$/.exec(prefix)?.[0] ?? "").toLowerCase();
  const out: string[] = [];
  for (const q of opts.asked ?? []) if (q.toLowerCase().startsWith(prefix.toLowerCase()) && q.length > prefix.length && !out.includes(q)) out.push(q);
  if (last.length >= 2) {
    const words = [...vocab].filter(([t]) => t.startsWith(last) && t !== last).sort((a, b) => b[1] - a[1]).slice(0, limit);
    for (const [t] of words) out.push(`${head}${t}`);
  }
  return out.slice(0, limit);
}

/* -------------------------------- snippets -------------------------------- */

/**
 * The best window of a result for its query: the lines with the most matched
 * terms, with those terms marked. Returns plain text and match ranges, so the
 * caller decides how to render (never HTML from source).
 */
export function snippet(text: string, terms: string[], lines = 4): { text: string; marks: Array<[number, number]>; startLine: number } {
  const all = text.split("\n");
  const want = new Set(terms);
  const hitsPerLine = all.map((l) => codeTokens(l).filter((t) => want.has(t)).length);
  let bestStart = 0, best = -1;
  for (let i = 0; i < all.length; i++) {
    let s = 0;
    for (let j = i; j < Math.min(all.length, i + lines); j++) s += hitsPerLine[j]!;
    if (s > best) { best = s; bestStart = i; }
  }
  const window = all.slice(bestStart, bestStart + lines).join("\n");
  const marks: Array<[number, number]> = [];
  for (const m of window.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const toks = codeTokens(m[0]);
    if (toks.some((t) => want.has(t))) marks.push([m.index!, m.index! + m[0].length]);
  }
  return { text: window, marks, startLine: bestStart + 1 };
}
