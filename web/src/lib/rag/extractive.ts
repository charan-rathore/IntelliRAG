import { QUERY_STOPWORDS, tokenize } from './text';
import type { RetrievedChunk } from './types';

/** Select source paragraphs, without inventing an answer when no model is configured. */
export function extractiveAnswer(question: string, chunks: RetrievedChunk[]): string {
  const terms = new Set(tokenize(question).filter(t => !QUERY_STOPWORDS.has(t)));
  const extracts = chunks.slice(0, 3).map((chunk, index) => {
    const paragraphs = chunk.text.split(/\n\s*\n/).map((text, order) => ({
      text: text.trim(), order,
      score: new Set(tokenize(text).filter(t => terms.has(t))).size,
    })).filter(p => p.text.length > 35 && !p.text.includes('```'));
    const selected = paragraphs.sort((a,b) => b.score-a.score || a.order-b.order).slice(0, 2).sort((a,b) => a.order-b.order);
    const text = (selected.map(p => p.text).join('\n\n') || chunk.text).replace(/`/g, '').replace(/^#{1,6}\s+/gm, '').trim();
    const clipped = text.length > 700 ? `${text.slice(0, 700).replace(/\s+\S*$/, '')}…` : text;
    return `${clipped}\n[Source ${index + 1}]`;
  });
  return 'Relevant source excerpts\n\n' + extracts.join('\n\n') + '\n\nThese are retrieved passages, not a generated recommendation. Add a model in Settings to reason across them.';
}
