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

function fenceMarker(line: string): { marker: string; length: number } | null {
  const m = line.match(FENCE_LINE);
  if (!m) return null;
  const run = m[1]!;
  const info = m[2] ?? "";
  if (info.includes(run[0]!)) return null;
  return { marker: run[0]!, length: run.length };
}

/** Closing fence: same marker character, run length at least the
 * opener's - a shorter run is code content, never a closer. */
function isClosingLine(line: string, marker: string, minLength: number): boolean {
  const m = line.match(marker === "`" ? /^ {0,3}(`+)[ \t]*$/ : /^ {0,3}(~+)[ \t]*$/);
  return !!m && m[1]!.length >= minLength;
}

type Segment = { kind: "code" | "prose"; text: string };

/** Split ORIGINAL answer text into code/prose before any HTML exists. */
function segmentAnswer(text: string): Segment[] {
  const segments: Segment[] = [];
  let prose: string[] = [];
  let code: string[] | null = null;
  let marker = "";
  let markerLength = 0;
  for (const line of text.split("\n")) {
    if (code === null) {
      const fence = fenceMarker(line);
      if (fence) {
        marker = fence.marker;
        markerLength = fence.length;
        code = [];
      } else {
        prose.push(line);
      }
    } else if (isClosingLine(line, marker, markerLength)) {
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

type InlinePiece = { kind: "code" | "prose"; text: string };

/**
 * Source-order inline span scan. At each backtick run of length N, the
 * next run of EXACTLY length N on the same line closes a code span;
 * everything between is shielded (no emphasis, no chips, no nested
 * interpretation), so a span opened by one backtick shields longer runs
 * inside it and vice versa. A run with no matching close stays literal
 * prose and scanning continues after it.
 */
export function scanInlineSpans(text: string): InlinePiece[] {
  const pieces: InlinePiece[] = [];
  let proseStart = 0;
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "`") {
      i += 1;
      continue;
    }
    let runEnd = i;
    while (runEnd < text.length && text[runEnd] === "`") runEnd += 1;
    const runLength = runEnd - i;
    let closeStart = -1;
    let j = runEnd;
    while (j < text.length && text[j] !== "\n") {
      if (text[j] === "`") {
        let closeEnd = j;
        while (closeEnd < text.length && text[closeEnd] === "`") closeEnd += 1;
        if (closeEnd - j === runLength) {
          closeStart = j;
          break;
        }
        j = closeEnd;
      } else {
        j += 1;
      }
    }
    if (closeStart === -1) {
      i = runEnd;
      continue;
    }
    if (i > proseStart) pieces.push({ kind: "prose", text: text.slice(proseStart, i) });
    pieces.push({ kind: "code", text: text.slice(runEnd, closeStart) });
    i = closeStart + runLength;
    proseStart = i;
  }
  if (proseStart < text.length) pieces.push({ kind: "prose", text: text.slice(proseStart) });
  return pieces;
}

/** Render one prose segment: shielded code spans (escaped verbatim, no
 * emphasis or chips inside) interleaved with prose pieces. */
function renderProseSegment(text: string, byIndex: Map<string, Citation>): string {
  return scanInlineSpans(text)
    .map((piece) =>
      piece.kind === "code" ? `<code>${escapeHtml(piece.text)}</code>` : renderProse(piece.text, byIndex),
    )
    .join("");
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

/** Literal source text: never interpret source markup or source-like citation markers. */
export function formatSourceExcerptsHtml(chunks: {text:string;title:string}[]) {
  const excerpts = chunks.slice(0,3).map((chunk,index) =>
    `<div class="whitespace-pre-wrap break-words">${escapeHtml(chunk.text)}</div><a class="cite-chip" href="#cite-${index+1}" title="${escapeHtml(chunk.title)}">[${index+1}]</a>`);
  return '<p>Relevant source excerpts</p><br>' + excerpts.join('<br><br>') + '<br><br><p>These are retrieved passages, not a generated recommendation. Only the packed source windows are shown, not necessarily whole documents or a complete answer. Add a model in Settings to reason across them.</p>';
}
