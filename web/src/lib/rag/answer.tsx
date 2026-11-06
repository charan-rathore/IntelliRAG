import type { Citation } from "./types";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "\u0026amp;")
    .replaceAll("<", "\u0026lt;")
    .replaceAll(">", "\u0026gt;")
    .replaceAll('"', "\u0026quot;");
}

export function formatAnswerHtml(text: string, citations: Citation[]) {
  const byIndex = new Map(citations.map((c) => [String(c.sourceIndex), c]));
  let html = escapeHtml(text);
  html = html.replace(/(\[Source\s+(\d+)\]\s*)+/gi, (match) => {
    const nums = [...match.matchAll(/\[Source\s+(\d+)\]/gi)].map((m) => m[1]!);
    const unique = [...new Set(nums)];
    return unique
      .map((num) => {
        const cite = byIndex.get(num);
        const title = cite?.title ?? `Source ${num}`;
        return `<a class="cite-chip" href="#cite-${num}" title="${escapeHtml(title)}">[${num}]</a>`;
      })
      .join("");
  });
  return html
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br>");
}

/** Literal source text: never interpret source markup or source-like citation markers. */
export function formatSourceExcerptsHtml(chunks: {text:string;title:string}[]) {
  const excerpts = chunks.slice(0,3).map((chunk,index) =>
    `<div class="whitespace-pre-wrap break-words">${escapeHtml(chunk.text)}</div><a class="cite-chip" href="#cite-${index+1}" title="${escapeHtml(chunk.title)}">[${index+1}]</a>`);
  return '<p>Relevant source excerpts</p><br>' + excerpts.join('<br><br>') + '<br><br><p>These are retrieved passages, not a generated recommendation. Only the packed source windows are shown, not necessarily whole documents or a complete answer. Add a model in Settings to reason across them.</p>';
}
