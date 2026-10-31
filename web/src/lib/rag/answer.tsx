import type { Citation } from "./types";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Line-boundary, same-marker fences - the same conservative rules as
// chunk-preview.ts, duplicated because this change predates that module
// on main; a follow-up can unify once both land. Mid-line markers are
// never treated as fences: ambiguous stays verbatim.
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\n]*?)[ \t]*$/;

function fenceMarker(line: string): string | null {
  const m = line.match(FENCE_LINE);
  if (!m) return null;
  const marker = m[1]![0]!;
  const info = m[2] ?? "";
  if (info.includes(marker)) return null;
  return marker;
}

function isClosingLine(line: string, marker: string): boolean {
  return (marker === "`" ? /^ {0,3}`{3,}[ \t]*$/ : /^ {0,3}~{3,}[ \t]*$/).test(line);
}

type Segment = { kind: "code" | "prose"; text: string };

/** Split ORIGINAL answer text into code/prose before any HTML exists. */
function segmentAnswer(text: string): Segment[] {
  const segments: Segment[] = [];
  let prose: string[] = [];
  let code: string[] | null = null;
  let marker = "";
  for (const line of text.split("\n")) {
    if (code === null) {
      const fence = fenceMarker(line);
      if (fence) {
        marker = fence;
        code = [];
      } else {
        prose.push(line);
      }
    } else if (isClosingLine(line, marker)) {
      segments.push({ kind: "prose", text: prose.join("\n") });
      prose = [];
      segments.push({ kind: "code", text: code.join("\n") });
      code = null;
    } else {
      code.push(line);
    }
  }
  segments.push({ kind: "prose", text: prose.join("\n") });
  if (code !== null) segments.push({ kind: "code", text: code.join("\n") });
  return segments;
}

function renderProse(piece: string, byIndex: Map<string, Citation>): string {
  // Transforms run on escaped SOURCE text only, never on generated HTML.
  // Boundary-hugging emphasis: 2**3+4**5 and a**b**c stay verbatim;
  // `;` and `&` are boundaries because quotes are &quot; at this point.
  let html = escapeHtml(piece).replace(
    /(^|[\s("';])\*\*(\S(?:[^*\n]*\S)?)\*\*(?=[\s)"'.,;:!?&]|$)/g,
    "$1<strong>$2</strong>",
  );
  // Citation chips are inserted LAST so their markup and title
  // attributes are never touched by markdown transforms.
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
  return html;
}

/** Single-backtick spans within prose: exactly one per side, not
 * adjacent to other backticks. Strays stay visible. */
function renderInlineSpans(text: string, byIndex: Map<string, Citation>): string {
  const pieces = text.split(/((?<!`)`[^`\n]+`(?!`))/g);
  return pieces
    .map((piece, j) =>
      j % 2 === 1 ? `<code>${escapeHtml(piece.slice(1, -1))}</code>` : renderProse(piece, byIndex),
    )
    .join("");
}

/** Render one prose segment. Matched multi-backtick regions (equal-length
 * runs, single line) are protected as a WHOLE: their content is escaped
 * verbatim inside <code>, never emphasis- or chip-transformed - so
 * ``x **bold** y`` and `` `__init__` `` keep every byte. Unmatched runs
 * stay plain prose (emphasis still applies, matching CommonMark). */
function renderProseSegment(text: string, byIndex: Map<string, Citation>): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(/(?<!`)(`{2,})(?!`)(.*?)(?<!`)\1(?!`)/g)) {
    out += renderInlineSpans(text.slice(last, m.index), byIndex);
    out += `<code>${escapeHtml(m[2]!)}</code>`;
    last = m.index! + m[0].length;
  }
  out += renderInlineSpans(text.slice(last), byIndex);
  return out;
}

export function formatAnswerHtml(text: string, citations: Citation[]) {
  const byIndex = new Map(citations.map((c) => [String(c.sourceIndex), c]));
  const out: string[] = [];
  for (const segment of segmentAnswer(text)) {
    if (segment.kind === "code") {
      // Literal code: escaping only. No chips, no emphasis.
      out.push(`<code>${escapeHtml(segment.text).replace(/\n/g, "<br>")}</code>`);
      continue;
    }
    // Fence marker lines were dropped; their line boundaries survive as
    // one break each, so prose and code never merge into one word.
    out.push(renderProseSegment(segment.text.replace(/^\n+|\n+$/g, ""), byIndex));
  }
  return out.join("<br>").replace(/\n/g, "<br>");
}
