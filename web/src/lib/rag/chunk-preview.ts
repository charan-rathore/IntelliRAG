/**
 * Plain-text preview for chunk text shown in source cards.
 *
 * Chunks keep their original markdown for retrieval and citation, but the
 * cards render raw text, so readers see fence markers, heading hashes and
 * backticks as noise. This strips presentation syntax only: code content,
 * link text and words survive; ordering and punctuation are untouched.
 */
export function chunkPreview(text: string): string {
  let t = text;
  // fenced code blocks: drop fence markers and language tag, keep the code
  t = t.replace(/```[a-zA-Z0-9]*\r?\n?/g, "");
  // images keep their alt text
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  // links keep their link text
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // heading hashes, at line start or after whitespace/sentence punctuation
  // (the following-space requirement keeps "C#"-style words intact)
  t = t.replace(/(^|[\s.!?;:|])#{1,6}\s+/g, (_m, p1: string) => (/^[\s]|^$/.test(p1) ? p1 : `${p1} `));
  // inline code backticks
  t = t.replace(/`([^`]*)`/g, "$1");
  // bold / italic markers - the content may not hug the markers with
  // whitespace, so "2 * 3 * 4" keeps its multiplication operators
  t = t.replace(/\*\*(\S(?:[^*\n]*\S)?)\*\*/g, "$1");
  t = t.replace(/(^|\W)\*(\S(?:[^*\n]*\S)?)\*(?=\W|$)/g, "$1$2");
  t = t.replace(/\b__(\S(?:[^_\n]*\S)?)__\b/g, "$1");
  // collapse the whitespace the removals leave behind
  t = t.replace(/\s+/g, " ").trim();
  return t;
}
