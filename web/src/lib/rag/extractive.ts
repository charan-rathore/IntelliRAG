import { tokenize } from './text';
import { isQueryStopword } from './perfect-sets.generated';
import type { RetrievedChunk } from './types';

/** Select source paragraphs, without inventing an answer when no model is configured. */
export function extractiveAnswer(question: string, chunks: RetrievedChunk[]): string {
  const terms = new Set(tokenize(question).filter(t => !isQueryStopword(t)));
  const extracts = chunks.slice(0, 3).map((chunk, index) => {
    const paragraphs = chunk.text.split(/\n\s*\n/).map((text, order) => ({
      text: text.trim(), order,
      score: new Set(tokenize(text).filter(t => terms.has(t))).size,
    })).filter(p => p.text.length > 0 && !/^#{1,6}\s+[^\n]+$/.test(p.text) && !p.text.includes('```'));
    // Do not drop conditions, exceptions or revisions merely to shorten an
    // already small source. Ranking is only needed when the budget is tight.
    const completeText = paragraphs.map(p => p.text).join('\n\n');
    const selected = completeText.length <= 700 ? paragraphs
      : paragraphs.sort((a,b) => b.score-a.score || a.order-b.order).slice(0, 2).sort((a,b) => a.order-b.order);
    const text = (selected.map(p => p.text).join('\n\n') || chunk.text).replace(/`/g, '').replace(/^#{1,6}\s+/gm, '').trim();
    const clipped = text.length > 700 ? `${text.slice(0, 700).replace(/\s+\S*$/, '')}…` : text;
    return `${clipped}\n[Source ${index + 1}]`;
  });
  return 'Relevant source excerpts\n\n' + extracts.join('\n\n') + '\n\nThese are retrieved passages, not a generated recommendation. Add a model in Settings to reason across them.';
}
