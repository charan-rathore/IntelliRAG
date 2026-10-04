import { estimateTokens } from "./text";
import { phraseBoost, weightedRecall, type IdF } from "./ranking";
import type { RetrievedChunk } from "./types";

/**
 * Passage-level context packing.
 *
 * Retrieval ranks whole chunks (about 500 tokens), but only a few chunks fit the token
 * budget and most of each chunk is unrelated to the question. This step splits the
 * top-ranked chunks into sentence-sized units, scores each unit against the query with the
 * same idf-weighted term overlap the reranker uses, and fills the same token budget with the
 * best units. The answer-bearing sentence from a lower-ranked chunk no longer loses its place
 * to filler inside a higher-ranked one. Chunks that already fit are returned untouched.
 */

const MAX_CANDIDATES = 8;
const NEIGHBOR_SHARE = 0.3;
const SECTION_SHARE = 0.5;

export function splitUnits(text: string): string[] {
  const units: string[] = [];
  for (const line of text.split(/\n+/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    for (const part of trimmed.split(/(?<=[.!?])\s+(?=[A-Z`*[(_])/)) {
      if (part.trim()) units.push(part.trim());
    }
  }
  return units;
}

export function compactContext(opts: {
  query: string;
  terms: string[];
  idf: IdF;
  ranked: RetrievedChunk[];
  keywordScores: Map<string, number>;
  denseScores: Map<string, number>;
  maxTokens: number;
  /** Drop units scoring below this share of the best unit. 0 fills the whole budget; ~0.2 keeps most evidence at far fewer tokens. */
  minUnitShare?: number;
}): RetrievedChunk[] {
  const lexicalOnly = opts.denseScores.size === 0;
  const candidates = opts.ranked
    .filter((c) => (lexicalOnly ? (opts.keywordScores.get(c.chunkId) ?? 0) > 0 : true))
    .slice(0, MAX_CANDIDATES);
  if (!candidates.length) return [];
  const total = candidates.reduce((n, c) => n + c.tokenCount, 0);
  if (total <= opts.maxTokens) return candidates.map((c, i) => ({ ...c, rank: i + 1 }));

  const peak = Math.max(candidates[0]!.score, 1e-9);
  type Unit = { chunk: number; index: number; text: string; tokens: number; score: number };
  const units: Unit[] = [];
  const seen = new Set<string>();
  candidates.forEach((chunk, ci) => {
    const parts = splitUnits(chunk.text);
    const base = parts.map(
      (p) => weightedRecall(opts.terms, p, opts.idf) + 0.5 * phraseBoost(opts.query, p),
    );
    // Text under a heading that matches the question is usually its answer, even when the
    // answering sentence shares no words with the question.
    const section: number[] = [];
    let headingScore = 0;
    parts.forEach((p, i) => {
      if (/^#{1,6}\s/.test(p)) headingScore = base[i]!;
      section[i] = headingScore;
    });
    parts.forEach((text, index) => {
      const key = text.replace(/\s+/g, " ");
      if (seen.has(key)) return;
      seen.add(key);
      const near = Math.max(base[index - 1] ?? 0, base[index + 1] ?? 0);
      // A unit inherits a little of its neighbours' score and its chunk's rank prior, so ties break toward the better chunk.
      const score =
        (Math.max(base[index]!, SECTION_SHARE * section[index]!) + NEIGHBOR_SHARE * near) *
        (0.8 + 0.2 * (chunk.score / peak));
      units.push({ chunk: ci, index, text, tokens: Math.max(1, estimateTokens(text)), score });
    });
  });
  units.sort((a, b) => b.score - a.score);
  const picked: Unit[] = [];
  let used = 0;
  const floor = (units[0]?.score ?? 0) * (opts.minUnitShare ?? 0);
  for (const u of units) {
    if (u.score <= 0 || u.score < floor) break;
    if (used + u.tokens > opts.maxTokens) continue;
    picked.push(u);
    used += u.tokens;
  }
  const out: RetrievedChunk[] = [];
  candidates.forEach((chunk, ci) => {
    const mine = picked.filter((u) => u.chunk === ci).sort((a, b) => a.index - b.index);
    if (!mine.length) return;
    let text = "";
    let prev = -2;
    for (const u of mine) {
      text += (text ? (u.index === prev + 1 ? "\n" : "\n…\n") : "") + u.text;
      prev = u.index;
    }
    out.push({
      ...chunk,
      text,
      tokenCount: mine.reduce((n, u) => n + u.tokens, 0),
      rank: out.length + 1,
    });
  });
  return out;
}
