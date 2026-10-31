/**
 * Plain-text preview for chunk text shown in source cards.
 *
 * Chunks keep their original markdown for retrieval and citation, but the
 * cards render raw text, so fence markers, heading hashes and backticks
 * show as noise. This strips only the presentation syntax that is
 * unambiguous, and prefers leaving markdown VISIBLE over altering
 * evidence. Mid-line fence markers remain visible. Unmatched inline
 * runs remain prose, where the normal emphasis rules still apply.
 *
 * What is cleaned, conservatively:
 * - Whole-line fenced blocks with same-character closing runs at least
 *   as long as the opener: marker lines are dropped; code content is
 *   retained with whitespace collapsed for the card preview. An unclosed
 *   opener treats the remainder as code; its opener is dropped.
 * - Same-line inline code spans, paired in source order with equal-length
 *   backtick runs: outer delimiters are dropped and content is protected
 *   from prose rules. Preview whitespace is still collapsed.
 * - Heading hashes, link/image syntax, and boundary-hugging emphasis in
 *   prose, where literals (2**3+4**5, __init__, C#, *p) survive by rule.
 *
 * Explicit tradeoff: NOT idempotent when preserved code content itself
 * looks like markdown. Cards always render from source chunk text, never
 * from a previous preview, so first-pass literal preservation is the
 * guarantee that matters.
 */
function collapseWhitespace(t: string): string {
  return t.replace(/\s+/g, " ").trim();
}

/** Presentation cleanup for PROSE segments only. */
function cleanProse(t: string): string {
  // images keep their alt text
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  // links keep their link text
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // heading hashes, at line start or after whitespace/sentence punctuation
  // (the following-space requirement keeps "C#"-style words intact)
  t = t.replace(/(^|[\s.!?;:|])#{1,6}\s+/g, (_m, p1: string) => (/^[\s]|^$/.test(p1) ? p1 : `${p1} `));
  // Emphasis markers. Both delimiters must sit at a word boundary so
  // literals like 2**3+4**5 and a*b keep their operators, and `__`
  // emphasis additionally requires a phrase (dunder identifiers like
  // __init__ are always content in this corpus, never bold).
  t = t.replace(/(^|[\s("'])\*\*(\S(?:[^*\n]*\S)?)\*\*(?=[\s)"'.,;:!?]|$)/g, "$1$2");
  t = t.replace(/(^|[\s("'])\*(\S(?:[^*\n]*\S)?)\*(?=[\s)"'.,;:!?]|$)/g, "$1$2");
  t = t.replace(/(^|[\s("'])__(\S(?:[^_\n]*\S)?)__(?=[\s)"'.,;:!?]|$)/g, (m: string, p: string, c: string) =>
    c.includes(" ") ? `${p}${c}` : m,
  );
  return t;
}

// A fence marker LINE: optional indent, at least three of one marker
// character, then only an info string (which for a backtick fence cannot
// contain backticks, and for a tilde fence cannot contain tildes). A
// mid-line ``` or ~~~ never matches, so it is never deleted from prose.
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\n]*?)[ \t]*$/;

function isFenceLine(line: string): { marker: string; length: number } | null {
  const m = line.match(FENCE_LINE);
  if (!m) return null;
  const run = m[1];
  const marker = run[0];
  const info = m[2] ?? "";
  if (info.includes(marker)) return null;
  return { marker, length: run.length };
}

/** Closing fence: same marker character, run length at least the
 * opener's - a shorter run is code content, never a closer. */
function isClosingLine(line: string, marker: string, minLength: number): boolean {
  const m = line.match(marker === "`" ? /^ {0,3}(`+)[ \t]*$/ : /^ {0,3}(~+)[ \t]*$/);
  return !!m && m[1]![0] === marker && m[1]!.length >= minLength;
}

/**
 * Source-order inline span scan (mirrors answer.tsx; unify once both
 * branches land on main). At each backtick run of length N, the next
 * run of EXACTLY length N on the same line closes a code span;
 * everything between is shielded from the prose rules. A run with no
 * matching close stays literal prose and scanning continues after it.
 */
function scanInlineSpans(text: string): { kind: "code" | "prose"; text: string }[] {
  const pieces: { kind: "code" | "prose"; text: string }[] = [];
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

/** Inline spans in prose: code content verbatim (delimiters stripped),
 * prose pieces through the prose rules. */
function renderSingleSpans(text: string): string {
  return scanInlineSpans(text)
    .map((piece) => (piece.kind === "code" ? piece.text : cleanProse(piece.text)))
    .join("");
}

export function chunkPreview(text: string, chunkKind?: "prose" | "code"): string {
  if (chunkKind === "code") {
    // Raw code chunk: whitespace normalization only.
    return collapseWhitespace(text);
  }

  // Line pass: split into fenced-code and prose segments. Fences must be
  // whole lines with matching marker characters; anything else is prose
  // and keeps every byte it started with.
  const segments: { kind: "code" | "prose"; text: string }[] = [];
  let prose: string[] = [];
  let code: string[] | null = null;
  let fenceMarker = "";
  let fenceLength = 0;
  for (const line of text.split("\n")) {
    if (code === null) {
      const fence = isFenceLine(line);
      if (fence) {
        code = [];
        fenceMarker = fence.marker;
        fenceLength = fence.length;
      } else {
        prose.push(line);
      }
    } else if (isClosingLine(line, fenceMarker, fenceLength)) {
      segments.push({ kind: "prose", text: prose.join("\n") });
      prose = [];
      segments.push({ kind: "code", text: code.join("\n") });
      code = null;
    } else {
      code.push(line);
    }
  }
  if (code !== null) {
    // Unterminated fence: the remainder is code, verbatim.
    segments.push({ kind: "prose", text: prose.join("\n") });
    segments.push({ kind: "code", text: code.join("\n") });
  } else {
    segments.push({ kind: "prose", text: prose.join("\n") });
  }

  const out: string[] = [];
  for (const segment of segments) {
    if (segment.kind === "code") {
      out.push(collapseWhitespace(segment.text));
      continue;
    }
    // Inline spans via the source-order scanner: code content verbatim
    // (delimiters stripped), prose through the prose rules, unmatched
    // runs stay prose. Multi-backtick regions are shielded as a whole, so
    // emphasis rules never reach inside ``x **bold** y``.
    out.push(renderSingleSpans(segment.text));
  }
  return collapseWhitespace(out.join(" "));
}
