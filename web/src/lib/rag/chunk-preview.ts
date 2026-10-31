/**
 * Plain-text preview for chunk text shown in source cards.
 *
 * Chunks keep their original markdown for retrieval and citation, but the
 * cards render raw text, so fence markers, heading hashes and backticks
 * show as noise. This strips only the presentation syntax that is
 * unambiguous, and prefers leaving markdown VISIBLE over altering
 * evidence: anything ambiguous - a mid-line fence, an unmatched or
 * mixed-marker fence, multi-backtick spans - stays exactly as written.
 *
 * What is cleaned, conservatively:
 * - Fenced code blocks whose opening and closing markers are whole lines
 *   of the SAME marker character (``` or ~~~, any language tag): the two
 *   marker lines are dropped, the code bytes between them are verbatim.
 *   An opening marker line with no matching closing line makes the rest
 *   of the chunk code, kept verbatim.
 * - Inline code spans of exactly one backtick on each side, not adjacent
 *   to other backticks: the two delimiters are dropped, content verbatim.
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

function isFenceLine(line: string): { marker: string } | null {
  const m = line.match(FENCE_LINE);
  if (!m) return null;
  const marker = m[1][0];
  const info = m[2] ?? "";
  if (marker === "`" && info.includes("`")) return null;
  if (marker === "~" && info.includes("~")) return null;
  return { marker };
}

function isClosingLine(line: string, marker: string): boolean {
  const re = marker === "`" ? /^ {0,3}`{3,}[ \t]*$/ : /^ {0,3}~{3,}[ \t]*$/;
  return re.test(line);
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
  for (const line of text.split("\n")) {
    if (code === null) {
      const fence = isFenceLine(line);
      if (fence) {
        code = [];
        fenceMarker = fence.marker;
      } else {
        prose.push(line);
      }
    } else if (isClosingLine(line, fenceMarker)) {
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
    // Inline code spans: exactly one backtick per side, not adjacent to
    // other backticks. Multi-backtick spans and stray backticks stay
    // visible rather than being misquoted. Pieces carry their own
    // surrounding whitespace, so they concatenate directly.
    const pieces = segment.text.split(/((?<!`)`[^`\n]+`(?!`))/g);
    out.push(
      pieces.map((piece, j) => (j % 2 === 1 ? piece.slice(1, -1) : cleanProse(piece))).join(""),
    );
  }
  return collapseWhitespace(out.join(" "));
}
