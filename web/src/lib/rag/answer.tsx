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
