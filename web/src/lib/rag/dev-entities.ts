/**
 * Reading a developer's question the way a developer would: pull out the code
 * it names (file paths in tracebacks, dotted module paths, class and function
 * names, `backticked` code) and link each to the files that define it.
 *
 * Bug reports and pasted tracebacks name their code. Word matching treats
 * `sklearn.linear_model.RidgeClassifierCV` as a few common words; linking it
 * to the file that defines `class RidgeClassifierCV` is what a person does
 * first. This is the entity-linking step of code localization agents
 * (LocAgent, Chen et al., ACL 2025; Agentless, Xia et al., 2024), done without
 * a model: a definitions index built once per corpus.
 */
import { identifierWords } from "./sleep";

export interface DevEntities {
  paths: string[];
  modules: string[];
  symbols: string[];
}

const EXT = "(?:py|pyi|ts|tsx|js|jsx|mjs|go|rs|java|kt|rb|php|c|h|cc|cpp|hpp|cs|swift|scala|md|rst|toml|ya?ml|json)";
const PATH_RE = new RegExp(`[\\w.\\-/\\\\]*[\\w\\-]+\\.${EXT}\\b`, "g");
const DOTTED_RE = /\b[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*){1,6}\b/g;
const CAMEL_RE = /\b[A-Z][a-z0-9]+(?:[A-Z][A-Za-z0-9]*)+\b|\b[A-Z]{2,}[a-z]\w*\b/g;
const SNAKE_RE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;
const CALL_RE = /\b([A-Za-z_]\w{2,})\s*\(/g;
const TICK_RE = /`([^`\n]{2,80})`/g;
const NOISE = new Set(["self", "print", "len", "str", "int", "list", "dict", "set", "tuple", "type", "range", "isinstance", "super", "return", "import", "from", "assert", "lambda", "true", "false", "none", "null"]);

export function devEntities(text: string): DevEntities {
  const paths = new Set<string>(), modules = new Set<string>(), symbols = new Set<string>();
  for (const m of text.match(PATH_RE) ?? []) {
    const p = m.replace(/\\/g, "/").replace(/^.*?(?:site-packages|dist-packages|node_modules)\//, "").replace(/^\.?\//, "");
    if (p.split("/").pop()!.length > 3) paths.add(p);
  }
  const scrubbed = text.replace(PATH_RE, " ");
  for (const m of scrubbed.match(DOTTED_RE) ?? []) {
    const parts = m.split(".");
    // "e.g", "i.e", version strings and sentence ends aren't code.
    if (parts.some((x) => x.length < 2) || /^\d/.test(parts[1]!)) continue;
    modules.add(m);
    symbols.add(parts.at(-1)!);
  }
  for (const re of [CAMEL_RE, SNAKE_RE]) for (const m of scrubbed.match(re) ?? []) symbols.add(m);
  for (const m of scrubbed.matchAll(CALL_RE)) symbols.add(m[1]!);
  for (const m of text.matchAll(TICK_RE)) for (const w of m[1]!.match(/[A-Za-z_]\w{2,}/g) ?? []) if (/[A-Z_]/.test(w.slice(1)) || w.length > 5) symbols.add(w);
  return {
    paths: [...paths],
    modules: [...modules],
    symbols: [...symbols].filter((s) => s.length > 2 && !NOISE.has(s.toLowerCase())),
  };
}

const DEF_RE = /^[ \t]*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:def|class|function|interface|type|struct|enum|trait|fn|func|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;

/** Where each name is defined, file by file. Built once per corpus. */
export class DefinitionIndex {
  private defs = new Map<string, Set<string>>();
  private files: string[] = [];

  constructor(docs: Array<{ path: string; text: string }>) {
    const seen = new Set<string>();
    for (const d of docs) {
      if (!seen.has(d.path)) { seen.add(d.path); this.files.push(d.path); }
      for (const m of d.text.matchAll(DEF_RE)) {
        const name = m[1]!;
        let s = this.defs.get(name);
        if (!s) this.defs.set(name, (s = new Set()));
        s.add(d.path);
      }
    }
  }

  definedIn(name: string): string[] { return [...(this.defs.get(name) ?? [])]; }

  /**
   * Files the question's code points at, with a strength: a path it quotes
   * (3), a module path it names (2), a rarely defined name it uses (1, less
   * the more files define it). Names defined in many files say little.
   */
  link(e: DevEntities): Map<string, number> {
    const score = new Map<string, number>();
    const add = (f: string, w: number) => score.set(f, (score.get(f) ?? 0) + w);
    for (const p of e.paths) {
      const tail = p.split("/").slice(-3).join("/");
      for (const f of this.files) if (f.endsWith(tail) || (tail.split("/").length < 2 && f.endsWith("/" + tail))) add(f, 3);
    }
    for (const m of e.modules) {
      const parts = m.split(".");
      for (let cut = parts.length; cut >= 2; cut--) {
        const stem = parts.slice(0, cut).join("/");
        const hits = this.files.filter((f) => f.endsWith(`${stem}.py`) || f.endsWith(`${stem}/__init__.py`) || f.endsWith(`${stem}.ts`) || f.endsWith(`${stem}/index.ts`));
        if (hits.length) { for (const f of hits) add(f, cut === parts.length ? 2 : 1.5); break; }
      }
    }
    for (const s of e.symbols) {
      const where = this.definedIn(s);
      if (!where.length || where.length > 6) continue;
      for (const f of where) add(f, 1 / where.length);
    }
    return score;
  }
}

/** Words inside identifiers, for matching prose against code ("RidgeClassifierCV" → ridge classifier cv). */
export const symbolWords = (s: string) => identifierWords(s);
