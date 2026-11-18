/**
 * Retrieval entrypoint. Dense cosine + BM25 + RRF, then a calibrated lexical/title mix.
 * This is not a learned cross-encoder. MMR is not part of the current retrieval execution path.
 */
import { retrieveFromRows, type RetrieveResult, type SearchRow } from "./retrieve-core";
import { buildIdf, type IdF } from "./ranking";
import type { ExperienceLog } from "./experience";
import { AMBIGUOUS_SYSTEM, GROUNDED_SYSTEM, NEGATIVE_SYSTEM } from "./evidence";
import { getStorageStatus } from "./storage";
import { loadSearchableChunks } from "./store.server";
import type { CorpusScope } from "./corpus-scope";
import { parseCorpusScope } from "./corpus-scope";
import type { RetrievedChunk, RetrievalMode } from "./types";

export async function retrieve(opts: {
  query: string;
  queryVector: number[] | null;
  mode: RetrievalMode;
  topK: number;
  embeddingModel: string | null;
  preferredSlugs?: string[];
  corpus?: string | null;
  experience?: ExperienceLog | null;
}): Promise<RetrieveResult> {
  const corpusScope: CorpusScope = parseCorpusScope(opts.corpus);
  const rows = (await loadSearchableChunks(corpusScope)) as SearchRow[];
  return retrieveFromRows({
    ...opts,
    rows,
    storage: getStorageStatus(),
    corpusScope,
  });
}

/**
 * idf over a corpus's searchable chunks, for reading a conversation's turns
 * (session-intent.ts). Cached by the chunk set it was built from.
 */
const IDF_CACHE = new Map<string, { key: string; idf: IdF }>();
export async function sessionIdf(corpus: string | null): Promise<IdF> {
  const scope: CorpusScope = parseCorpusScope(corpus);
  const rows = (await loadSearchableChunks(scope)) as SearchRow[];
  const scopeKey = scope.kind === "all" ? "*" : scope.corpusId;
  const key = `${rows.length}:${rows.map((r) => r.chunk.id).join(",").length}:${rows[0]?.chunk.id ?? ""}:${rows.at(-1)?.chunk.id ?? ""}`;
  const hit = IDF_CACHE.get(scopeKey);
  if (hit && hit.key === key) return hit.idf;
  const idf = buildIdf(rows.map((r) => `${r.title}\n${r.chunk.text}`));
  IDF_CACHE.set(scopeKey, { key, idf });
  return idf;
}

export function buildContext(
  query: string,
  chunks: RetrievedChunk[],
  kind: "positive" | "negative_not_found" | "ambiguous" = "positive",
) {
  const sources = chunks
    .map((c, i) => {
      const loc = [c.title, c.filepath, c.heading ?? c.symbol].filter(Boolean).join(". ");
      return `[Source ${i + 1}] ${loc}\n${c.text}`;
    })
    .join("\n\n");
  const system =
    kind === "negative_not_found" ? NEGATIVE_SYSTEM
    : kind === "ambiguous" ? AMBIGUOUS_SYSTEM
    : GROUNDED_SYSTEM;
  const user = `Sources:\n${sources}\n\nQuestion: ${query}\n\nAnswer with a complete, readable response:`;
  return { system, user };
}
