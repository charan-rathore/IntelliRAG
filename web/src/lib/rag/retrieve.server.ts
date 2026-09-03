/**
 * Retrieval entrypoint. Dense cosine + BM25 + RRF, then a calibrated lexical/title mix.
 * This is not a learned cross-encoder. MMR is not part of the current retrieval execution path.
 */
import { retrieveFromRows, type RetrieveResult, type SearchRow } from "./retrieve-core";
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

export function buildContext(
  query: string,
  chunks: RetrievedChunk[],
  kind: "positive" | "negative_not_found" | "ambiguous" = "positive",
) {
  const sources = chunks
    .map((c, i) => {
      const loc = [c.title, c.filepath, c.heading ?? c.symbol].filter(Boolean).join(" — ");
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
