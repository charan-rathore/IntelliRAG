import type { RetrievedChunk } from './types';

/** Show each already-budgeted context window verbatim. No semantic selection. */
export function extractiveAnswer(_question: string, chunks: RetrievedChunk[]): string {
  const extracts = chunks.slice(0, 3).map((chunk, index) => `${chunk.text}\n[Source ${index + 1}]`);
  return 'Relevant source excerpts\n\n' + extracts.join('\n\n') + '\n\nThese are retrieved passages, not a generated recommendation. Only the packed source windows are shown, not necessarily whole documents or a complete answer. Add a model in Settings to reason across them.';
}
