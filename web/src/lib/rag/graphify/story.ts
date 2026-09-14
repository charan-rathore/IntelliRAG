import type { Citation, RetrievedChunk } from '../types';
import type { GraphLink, GraphNode } from './schema';

/** Only cited chunks may create an answered_from edge or receive answer feedback. */
export function citedSourceSlugs(chunks: Pick<RetrievedChunk, 'chunkId' | 'slug'>[], citations: Pick<Citation, 'chunkId'>[]): string[] {
  const ids = new Set(citations.map(c => c.chunkId));
  return [...new Set(chunks.filter(c => ids.has(c.chunkId)).map(c => c.slug))];
}

export function explainConnection(edge: GraphLink, from: GraphNode, to: GraphNode): string {
  if (edge.confidence === 'USER_EDITED') return `You connected “${from.label}” and “${to.label}” as “${edge.relation}”. This helps the search follow your context; it does not establish a source fact.`;
  if (edge.confidence !== 'EXTRACTED') return `“${from.label}” and “${to.label}” share a lexical connection. It is a clue for finding related passages, not proof that one caused the other.`;
  if (edge.relation === 'answered_from') return 'A saved answer cited this document. Follow the source to check what supported that answer; a past citation does not make every future answer correct.';
  if (edge.relation === 'declares') return 'This declaration was found in the source code. The recorded line lets you inspect its definition; it does not infer runtime calls.';
  if (edge.relation === 'contains') return 'This heading was extracted from the document. It gives you a precise entry point into the original source.';
  return `The source records “${edge.relation}” between these nodes. Open the evidence to check the surrounding context.`;
}
