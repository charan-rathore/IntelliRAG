// Generates web/src/lib/rag/perfect-sets.generated.ts: gperf-style perfect
// hash membership tables for the compile-time-known token sets in text.ts.
// Technique after Lemire, "Billion-query-per-second lookup tables in C++"
// (Oct 2026): slot = (length + asso[key[p1]] + asso[key[p2]]) & mask, one
// slot computation + one string comparison, no probing. Deterministic
// (seeded PRNG, fixed search order). Re-run after editing the sets:
//   npx tsx scripts/generate-perfect-sets.ts
import { writeFileSync } from "node:fs";
import { QUERY_STOPWORDS, GENERIC_OPS_TERMS } from "../src/lib/rag/text.ts";

type Pos = { kind: "start" | "end"; i: number };
// Fixed search order: cheaper 2-position forms first, then 3-position.
const CANDIDATE_POSITIONS: Pos[][] = [
  [{ kind: "start", i: 0 }, { kind: "end", i: 0 }],
  [{ kind: "start", i: 0 }, { kind: "start", i: 1 }],
  [{ kind: "start", i: 1 }, { kind: "end", i: 0 }],
  [{ kind: "start", i: 0 }, { kind: "end", i: 1 }],
  [{ kind: "start", i: 1 }, { kind: "end", i: 1 }],
  [{ kind: "start", i: 2 }, { kind: "end", i: 0 }],
  [{ kind: "start", i: 0 }, { kind: "start", i: 2 }],
  [{ kind: "start", i: 2 }, { kind: "end", i: 1 }],
  [{ kind: "start", i: 0 }, { kind: "start", i: 5 }],
  [{ kind: "start", i: 0 }, { kind: "start", i: 2 }, { kind: "end", i: 0 }],
  [{ kind: "start", i: 0 }, { kind: "end", i: 0 }, { kind: "end", i: 1 }],
  [{ kind: "start", i: 0 }, { kind: "start", i: 1 }, { kind: "end", i: 0 }],
  [{ kind: "start", i: 1 }, { kind: "end", i: 0 }, { kind: "end", i: 1 }],
  [{ kind: "start", i: 0 }, { kind: "start", i: 1 }, { kind: "start", i: 2 }],
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0);
  };
}

function charAt(key: string, pos: Pos): number {
  const idx = pos.kind === "start" ? pos.i : key.length - 1 - pos.i;
  return idx >= 0 && idx < key.length ? key.charCodeAt(idx) : -1;
}

function findPerfectHash(keys: string[]) {
  for (let sizePow = Math.max(4, Math.ceil(Math.log2(keys.length * 2))); sizePow <= 12; sizePow++) {
    const tableSize = 2 ** sizePow;
    const mask = tableSize - 1;
    for (const positions of CANDIDATE_POSITIONS) {
      // Skip combos whose (length, chars at positions) signature cannot
      // distinguish two keys: no assignment of asso values can separate them.
      const sig = new Set<string>();
      let distinguishable = true;
      for (const k of keys) {
        const s = k.length + "|" + positions.map((p) => charAt(k, p)).join(",");
        if (sig.has(s)) { distinguishable = false; break; }
        sig.add(s);
      }
      if (!distinguishable) continue;
      let maxCode = 0;
      for (const k of keys) for (const p of positions) {
        const c = charAt(k, p);
        if (c > maxCode) maxCode = c;
      }
      const rand = mulberry32(0x9e3779b9);
      for (let trial = 0; trial < 100_000; trial++) {
        const asso = new Array<number>(maxCode + 1);
        for (let i = 0; i <= maxCode; i++) asso[i] = rand() % tableSize;
        const used = new Uint8Array(tableSize);
        let ok = true;
        for (const k of keys) {
          let h = k.length;
          for (const p of positions) {
            const c = charAt(k, p);
            if (c >= 0) h += asso[c]!;
          }
          const s = h & mask;
          if (used[s]) { ok = false; break; }
          used[s] = 1;
        }
        if (ok) {
          const slots = new Array<string | null>(tableSize).fill(null);
          for (const k of keys) {
            let h = k.length;
            for (const p of positions) {
              const c = charAt(k, p);
              if (c >= 0) h += asso[c]!;
            }
            slots[h & mask] = k;
          }
          return { positions, asso, slots, tableSize };
        }
      }
    }
  }
  throw new Error("no perfect hash found within bounds");
}

function emit(name: string, keys: string[], fnName: string): string {
  const { positions, asso, slots, tableSize } = findPerfectHash(keys);
  const maxLen = Math.max(...keys.map((k) => k.length));
  if (keys.some((k) => k.length === 0)) throw new Error("empty key unsupported");
  // Specialized, position-inlined function: no position-array iteration, no
  // per-position branch objects. Contribution rules match the generator:
  // out-of-range position or char code >= ASSO.length contributes 0.
  const lines: string[] = [];
  positions.forEach((p, idx) => {
    const c = `c${idx}`;
    if (p.kind === "start") {
      lines.push(p.i === 0
        ? `  const ${c} = t.charCodeAt(0);`
        : `  const ${c} = n > ${p.i} ? t.charCodeAt(${p.i}) : -1;`);
    } else {
      lines.push(p.i === 0
        ? `  const ${c} = t.charCodeAt(n - 1);`
        : `  const ${c} = n > ${p.i} ? t.charCodeAt(n - 1 - ${p.i}) : -1;`);
    }
    lines.push(`  if (${c} >= 0 && ${c} < ${name}_ASSO.length) h += ${name}_ASSO[${c}]!;`);
  });
  return `
const ${name}_ASSO = [${asso.join(",")}];
const ${name}_MASK = ${tableSize - 1};
const ${name}_SLOTS: readonly (string | null)[] = [${slots.map((s) => (s === null ? "null" : JSON.stringify(s))).join(",")}];

export function ${fnName}(t: string): boolean {
  const n = t.length;
  if (n === 0 || n > ${maxLen}) return false;
  let h = n;
${lines.join("\n")}
  return ${name}_SLOTS[h & ${name}_MASK] === t;
}
`;
}

const header = `// Generated by scripts/generate-perfect-sets.ts - do not edit by hand.
// Perfect-hash membership for the compile-time-known token sets in text.ts.
// slot = (length + asso[key[p1]] + asso[key[p2]]) & mask, then one string
// comparison against the single candidate (non-members can share a slot, so
// the comparison is required for correctness, not just collision handling).

`;

const stopDef = emit("STOPWORD", [...QUERY_STOPWORDS].sort(), "isQueryStopword");
const opsDef = emit("OPS", [...GENERIC_OPS_TERMS].sort(), "isGenericOpsTerm");

writeFileSync(new URL("../src/lib/rag/perfect-sets.generated.ts", import.meta.url), header + stopDef + opsDef);
console.log(`stopwords: ${QUERY_STOPWORDS.size} keys, ops terms: ${GENERIC_OPS_TERMS.size} keys`);
console.log("wrote src/lib/rag/perfect-sets.generated.ts");
