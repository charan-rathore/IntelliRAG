/**
 * Builds the exact context string the generator sees for one eval arm, and
 * the per-chunk texts that MUST be stored as judging contexts. Judging a
 * fuller text than the generator saw credits evidence the model never
 * received, so both come from this one function.
 *
 * @param {object} args
 * @param {string} args.arm - 'no-context' | 'bm25' | 'intellirag' | 'oracle' | 'full-context'
 * @param {string[]} args.selectedIds - chunk ids selected for this arm
 * @param {Map<string,string>} args.packedText - trimmed passage text per chunk id (intellirag)
 * @param {(id: string) => {title: string, text: string}} args.chunkById - full chunk lookup
 * @param {string} args.source - frozen full source document (full-context arm)
 * @returns {{ context: string, seenTexts: string[] }}
 */
export function buildGeneratorContext({ arm, selectedIds, packedText, chunkById, source }) {
  if (arm === 'no-context') return { context: '', seenTexts: [] };
  if (arm === 'full-context') return { context: `[Source 1] p-queue README\n${source}`, seenTexts: [source] };
  const seenTexts = selectedIds.map((id) =>
    (arm === 'intellirag' ? packedText.get(id) : undefined) ?? chunkById(id).text);
  const context = selectedIds
    .map((id, i) => `[Source ${i + 1}] ${chunkById(id).title}\n${seenTexts[i]}`)
    .join('\n\n');
  return { context, seenTexts };
}
