/**
 * Running a sleep cycle for a corpus in the app: replay, consolidate, dream,
 * filter, journal (sleep.ts), and re-weigh case memory on its own history
 * (case-memory.ts). Triggered after every SLEEP_EVERY ratings on a corpus, or
 * from the Memory panel.
 */
import { retrieveFromRows, type SearchRow } from "./retrieve-core";
import { getStorageStatus } from "./storage";
import { loadSearchableChunks } from "./store.server";
import { parseCorpusScope } from "./corpus-scope";
import { sleep, emptyJournal, type SleepPassage } from "./sleep";
import { consolidateCases } from "./case-memory";
import { corpusMemory, saveSleep } from "./graphify/persist.server";
import { rankFiles } from "./search.server";

export const SLEEP_EVERY = 8;

export async function sleepCorpus(corpusId: string, opts: { budget?: number } = {}) {
  const started = performance.now();
  const scope = parseCorpusScope(corpusId);
  if (scope.kind !== "corpus") throw new Error("Sleep runs one corpus at a time.");
  const rows = (await loadSearchableChunks(scope)) as SearchRow[];
  const storage = getStorageStatus();
  const mem = await corpusMemory(scope.corpusId);
  const passages: SleepPassage[] = rows.map((r) => ({ chunkId: r.chunk.id, text: r.chunk.text, heading: r.chunk.heading, symbol: r.chunk.symbol, filepath: r.chunk.filepath, title: r.title }));
  const packed = (q: string, log: typeof mem.experience) =>
    retrieveFromRows({ query: q, queryVector: null, mode: "keyword", topK: 5, embeddingModel: null, rows, storage, corpusScope: scope, experience: log }).chunks.map((c) => c.chunkId);
  const result = sleep({ corpusId: scope.corpusId, passages, packed }, mem.experience, mem.journal ?? emptyJournal(), { budget: opts.budget ?? 24 });
  // Case memory ranks passages here, so the "files" it learned are chunk ids.
  const rankPassages = await rankFiles(scope.corpusId, { by: "passage" });
  const cases = consolidateCases(mem.cases, rankPassages, { minCases: 6 });
  await saveSleep(scope.corpusId, { experience: result.log, journal: result.journal, cases });
  return { cycle: result.cycle, cases: cases.journal.at(-1) ?? null, weights: cases.weights, tookMs: Math.round(performance.now() - started) };
}

/** Sleep if enough has been learned since the last time. Never throws into the caller. */
export async function maybeSleep(corpusId: string) {
  try {
    const mem = await corpusMemory(corpusId);
    if (mem.sinceSleep >= SLEEP_EVERY) await sleepCorpus(corpusId);
  } catch (error) {
    console.info("[sleep] skipped", error instanceof Error ? error.message : error);
  }
}
