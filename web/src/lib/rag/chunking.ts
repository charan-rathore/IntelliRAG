import { CHUNK_OVERLAP_TOKENS, CHUNK_SIZE_TOKENS, type ChunkKind } from "./types";
import { estimateTokens } from "./text";

export type DraftChunk = {
  ordinal: number;
  text: string;
  tokenCount: number;
  heading: string | null;
  symbol: string | null;
  filepath: string | null;
  language: string | null;
  chunkKind: ChunkKind;
};

export type ChunkOptions = {
  chunkSize?: number;
  overlap?: number;
  kind?: ChunkKind;
  language?: string | null;
  filepath?: string | null;
};

const SEPARATORS = ["\n## ", "\n### ", "\n#### ", "\n\n", "\n", ". ", " "];

const CODE_BOUNDARY: Record<string, RegExp> = {
  typescript: /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|type|interface|enum)\s+(\w+)/m,
  tsx: /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|type|interface)\s+(\w+)/m,
  javascript: /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let)\s+(\w+)/m,
  python: /^(?:async\s+)?(?:def|class)\s+(\w+)/m,
  go: /^(?:func|type)\s+(\w+)/m,
  rust: /^(?:pub\s+)?(?:async\s+)?(?:fn|struct|enum|impl|trait)\s+(\w+)/m,
  java: /^\s*(?:(?:public|private|protected|static|final|abstract|synchronized)\s+)*(?:class|interface|enum|record)\s+(\w+)|^\s*(?:(?:public|private|protected|static|final|abstract|synchronized)\s+)+[\w<>[\]]+\s+(\w+)\s*\(/m,
  c: /^\s*(?!\s*(?:return|if|else|while|for|switch|sizeof)\b)(?:static\s+|inline\s+|extern\s+)*[A-Za-z_][\w* ]*?[*\s]\s*(\w+)\s*\(/m,
  h: /^\s*(?!\s*(?:return|if|else|while|for|switch|sizeof)\b)(?:static\s+|inline\s+|extern\s+)*[A-Za-z_][\w* ]*?[*\s]\s*(\w+)\s*\(/m,
  cpp: /^\s*(?!\s*(?:return|if|else|while|for|switch|sizeof)\b)(?:static\s+|inline\s+|extern\s+)*[A-Za-z_][\w*: ]*?[*\s]\s*(\w+)\s*\(/m,
  cc: /^\s*(?!\s*(?:return|if|else|while|for|switch|sizeof)\b)(?:static\s+|inline\s+|extern\s+)*[A-Za-z_][\w*: ]*?[*\s]\s*(\w+)\s*\(/m,
  hpp: /^\s*(?!\s*(?:return|if|else|while|for|switch|sizeof)\b)(?:static\s+|inline\s+|extern\s+)*[A-Za-z_][\w*: ]*?[*\s]\s*(\w+)\s*\(/m,
};

function splitOnce(text: string, separator: string): string[] {
  if (!separator) return [text];
  const parts = text.split(separator);
  if (parts.length === 1) return parts;
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const piece = i === 0 ? parts[i] : `${separator}${parts[i]}`;
    if (piece.length) out.push(piece);
  }
  return out;
}

function recursiveSplit(text: string, seps: string[], targetChars: number): string[] {
  if (text.length <= targetChars) return [text];
  const [sep, ...rest] = seps;
  if (!sep) {
    const pieces: string[] = [];
    for (let i = 0; i < text.length;) {
      let end = Math.min(i + targetChars, text.length);
      // A UTF-16 cut between a surrogate pair corrupts both chunks when
      // encoded for storage/embedding. Keep the whole code point together.
      const previous = text.charCodeAt(end - 1);
      const next = text.charCodeAt(end);
      if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end += 1;
      pieces.push(text.slice(i, end));
      i = end;
    }
    return pieces;
  }
  const parts = splitOnce(text, sep);
  const acc: string[] = [];
  let buf = "";
  for (const part of parts) {
    if ((buf + part).length <= targetChars) {
      buf += part;
      continue;
    }
    if (buf) acc.push(buf);
    if (part.length > targetChars) {
      acc.push(...recursiveSplit(part, rest, targetChars));
      buf = "";
    } else {
      buf = part;
    }
  }
  if (buf) acc.push(buf);
  return acc;
}

function symbolFrom(text: string, language: string | null): string | null {
  const re = language ? CODE_BOUNDARY[language] : undefined;
  if (re) {
    const m = text.match(re);
    const name = m?.slice(1).find((g) => g);
    if (name) return name;
  }
  const any = text.match(
    /(?:export\s+)?(?:async\s+)?(?:function|class|const|def|fn|func)\s+(\w+)/,
  );
  return any?.[1] ?? null;
}

function extractHeader(text: string): { header: string; rest: string } {
  const lines = text.split("\n");
  const header: string[] = [];
  let i = 0;
  for (; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (
      /^(import|from|package|using|#include|export \* from|export \{)/.test(trimmed) ||
      /^\/\/|^#\s|^\/\*/.test(trimmed) ||
      trimmed === ""
    ) {
      header.push(line);
      continue;
    }
    break;
  }
  while (header.length && !(header[header.length - 1] ?? "").trim()) header.pop();
  return { header: header.join("\n"), rest: lines.slice(i).join("\n") };
}

function splitCodeUnits(body: string, language: string | null, targetChars: number): string[] {
  const { header, rest } = extractHeader(body);
  const re = (language && CODE_BOUNDARY[language]) || CODE_BOUNDARY.typescript;
  const lines = rest.split("\n");
  const units: string[] = [];
  let buf: string[] = [];
  let bufChars = 0;
  let hasContent = false;
  const flush = () => {
    const text = buf.join("\n").trim();
    if (text) units.push(text);
    buf = [];
    bufChars = 0;
    hasContent = false;
  };
  for (const line of lines) {
    if (re.test(line) && hasContent) flush();
    bufChars += line.length + (buf.length ? 1 : 0);
    hasContent ||= line.trim().length > 0;
    buf.push(line);
    if (bufChars > targetChars * 1.6) {
      const joined = buf.join("\n");
      const parts = recursiveSplit(joined, ["\n\n", "\n"], targetChars);
      units.push(...parts.slice(0, -1));
      const tail = parts[parts.length - 1] ?? "";
      buf = tail.split("\n");
      bufChars = tail.length;
      hasContent = tail.trim().length > 0;
    }
  }
  flush();
  if (!units.length) return header ? [body] : recursiveSplit(body, ["\n\n", "\n"], targetChars);
  return units.map((u, i) => {
    if (!header) return u;
    if (i === 0) return `${header}\n\n${u}`;
    const hint = header.split("\n").slice(0, 12).join("\n");
    return `${hint}\n\n${u}`;
  });
}

function overlapTail(text: string, count: number): string {
  let start = Math.max(0, text.length - count);
  const first = text.charCodeAt(start);
  const previous = text.charCodeAt(start - 1);
  if (first >= 0xdc00 && first <= 0xdfff && previous >= 0xd800 && previous <= 0xdbff) start -= 1;
  return text.slice(start).trim();
}

function chunkProse(body: string, chunkSize: number, overlap: number, extra: Omit<DraftChunk, "ordinal" | "text" | "tokenCount" | "heading"> & { heading?: string | null }): DraftChunk[] {
  const targetChars = chunkSize * 4;
  const overlapChars = overlap * 4;
  const lines = body.split("\n");
  const tableHeadersByRow = new Map<string, string>();
  const separatorRow = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/;
  // Track the actual opening fence: marker char and run length. A fence
  // closes only on the same marker with a run at least as long, so a tilde
  // run inside a backtick fence (or vice versa) stays code.
  let fenceRun: string | null = null;
  const listIndents: number[] = [];
  const tableSpans: Array<[number, number]> = [];
  const rowSpanIdx = new Map<string, number>();
  const lineOffsets: number[] = [];
  {
    let off = 0;
    for (const l of lines) {
      lineOffsets.push(off);
      off += l.length + 1;
    }
  }
  for (let i = 0; i < lines.length - 2; i += 1) {
    const line = lines[i] ?? "";
    const indentWidth = line.charCodeAt(0) === 32 ? /^ */.exec(line)![0].length : 0;
    if (fenceRun === null && indentWidth < line.length) {
      while (listIndents.length && indentWidth < listIndents[listIndents.length - 1]!) listIndents.pop();
      // Cheap first-char gate before the marker regex.
      const fc = line.charAt(indentWidth);
      if (fc === "-" || fc === "*" || fc === "+" || (fc >= "0" && fc <= "9")) {
        // CommonMark allows one to four spaces (or a tab) between the marker
        // and the content; the content indent follows the actual padding.
        const listMarker = /^( *)([-*+]|\d{1,9}[.)])( {1,4}|\t)/.exec(line);
        if (listMarker) {
          const padding = listMarker[3] === "\t" ? 4 : listMarker[3]!.length;
          listIndents.push(indentWidth + listMarker[2]!.length + padding);
        }
      }
    }
    // Cheap gate: only lines starting with ` or ~ can be fences, so the
    // trim+regex only runs for them.
    const firstNonWs = line.charAt(indentWidth);
    const fenceMatch =
      firstNonWs === "`" || firstNonWs === "~" ? /^(`{3,}|~{3,})/.exec(line.trim()) : null;
    if (fenceMatch) {
      const run = fenceMatch[1]!;
      // A run that opens and closes on the same line is an inline code span,
      // not a fence: leave the fence state alone. A closing fence must also
      // carry nothing after the run (CommonMark).
      const rest = line.trim().slice(run.length);
      if (fenceRun === null) {
        // Only backtick runs can close on the same line (inline code span);
        // tilde fences may legally carry tildes in their info string.
        if (run[0] !== "`" || !rest.includes(run)) {
          fenceRun = run;
          continue;
        }
      } else {
        if (run[0] === fenceRun[0] && run.length >= fenceRun.length && !rest.trim()) fenceRun = null;
        continue;
      }
    }
    if (fenceRun !== null) continue;
    const header = line;
    const separator = lines[i + 1] ?? "";
    // Indented code block only when deeper than the surrounding list content;
    // a table nested at a list item's content indent is list content.
    const activeListIndent = listIndents[listIndents.length - 1];
    if (/^\t/.test(line) || (indentWidth >= 4 && (activeListIndent === undefined || indentWidth > activeListIndent))) continue;
    if (!header.includes("|") || !separatorRow.test(separator.trim())) continue;
    const tableHeader = `${header}\n${separator}`;
    let row = i + 2;
    for (; row < lines.length && (lines[row] ?? "").includes("|"); row += 1) {
      const rowText = lines[row] ?? "";
      const trimmedRow = rowText.trim();
      // A heading, list item, quote or fence that follows the table without a
      // blank line starts a new block; it is not a table row. Ordered-list
      // markers cap at nine digits (CommonMark), and a fence run that closes
      // on the same line is an inline code span, not a fence.
      if (/^(#{1,6}\s|>\s?|[-*+]\s|\d{1,9}[.)]\s)/.test(trimmedRow)) break;
      if (trimmedRow.charCodeAt(0) === 96 || trimmedRow.charCodeAt(0) === 126) {
        const fenceStart = /^(`{3,}|~{3,})/.exec(trimmedRow);
        // Only backtick runs can be same-line inline code; a tilde run is a fence.
        if (
          fenceStart &&
          (fenceStart[1]![0] !== "`" || !trimmedRow.slice(fenceStart[1]!.length).includes(fenceStart[1]!))
        )
          break;
      }
      // Keys are indent-normalized: a chunk's first line loses its leading
      // whitespace to the chunk-level trim, and list-nested rows carry the
      // list's content indent in the source.
      const rowKey = rowText.trimStart();
      const existing = tableHeadersByRow.get(rowKey);
      // A row string shared by two tables is ambiguous: poison it rather than
      // let the later table's header overwrite the earlier one's.
      if (existing === undefined) tableHeadersByRow.set(rowKey, tableHeader);
      else if (existing !== tableHeader) tableHeadersByRow.set(rowKey, "");
    }
    if (row > i + 2) {
      const lastRow = row - 1;
      const spanIdx = tableSpans.length;
      tableSpans.push([lineOffsets[i]!, (lineOffsets[lastRow] ?? body.length) + (lines[lastRow] ?? "").length]);
      for (let r = i + 2; r <= lastRow; r += 1) rowSpanIdx.set((lines[r] ?? "").trimStart(), spanIdx);
    }
    // Advance past the whole table so a delimiter-shaped data row inside it
    // cannot be re-read as a separator starting a new table.
    i = row - 1;
  }
  const longRows = [...tableHeadersByRow.keys()].filter((row) => row.length > targetChars);
  // One predicate for both the guard and the row selection below, so the
  // chosen row is always the one where the fragment is boundary-aligned.
  const rowMatchesFragment = (row: string, line: string): boolean =>
    line.length >= 20
      ? row.includes(line)
      : line.length >= 6 &&
        (row.includes(` ${line} `) || row.startsWith(`${line} `) || row.endsWith(` ${line}`));
  // A line that appears verbatim as its own line anywhere in the document is
  // prose, not a row fragment: never reconstruct provenance for it. This
  // stops quoted sentences from inheriting a table header.
  const standaloneLines = new Set(body.split("\n"));
  const raw = recursiveSplit(body, SEPARATORS, targetChars);
  const merged: string[] = [];
  for (const piece of raw) {
    const last = merged[merged.length - 1];
    if (last && estimateTokens(last) < chunkSize * 0.4 && estimateTokens(last + piece) <= chunkSize * 1.15) {
      merged[merged.length - 1] = `${last}${piece}`;
    } else {
      merged.push(piece);
    }
  }
  // Track the heading path across pieces so a chunk deep inside a long
  // section still carries its section context ("Guide > Install > Linux").
  const stack: Array<{ level: number; title: string }> = [];
  const paths: Array<string | null> = merged.map((piece) => {
    // Label the chunk with the path as of its FIRST heading (the section the
    // chunk starts in); later headings in a merged piece only inform the
    // stack for following chunks.
    const headings = piece.matchAll(/^(#{1,4})\s+(.+)$/gm);
    let label: string | null = null;
    for (const m of headings) {
      const level = m[1]!.length;
      const title = m[2]!.trim();
      while (stack.length && stack[stack.length - 1]!.level >= level) stack.pop();
      stack.push({ level, title });
      if (!label) label = stack.map((f) => f.title).join(" > ");
    }
    return label ?? (stack.length ? stack.map((f) => f.title).join(" > ") : null);
  });
  const withOverlap: string[] = [];
  for (let i = 0; i < merged.length; i += 1) {
    const prev = merged[i - 1] ?? "";
    const overlapText = overlapTail(prev, overlapChars);
    const text = (overlapText && i > 0 ? `${overlapText}\n${merged[i]}` : merged[i]).trim();
    if (text) withOverlap.push(text);
  }
  const pieceStarts: number[] = [];
  {
    let off = 0;
    for (const p of merged) {
      pieceStarts.push(off);
      off += p.length;
    }
  }
  // Line-level table-span membership is only needed when over-long rows can
  // split into fragments; skip the offset walk otherwise.
  const needSpans = tableSpans.length > 0 && longRows.length > 0;
  const withTableHeaders = withOverlap.map((text, pieceIndex) => {
    // Classify each line by where it sits in the source document: a fragment
    // line that comes from inside a table span is table content even when the
    // same text also exists as standalone prose elsewhere. Overlap lines come
    // from the previous piece's tail, so anchor the walk there.
    const pieceStart = pieceStarts[pieceIndex] ?? -1;
    const prev = merged[pieceIndex - 1] ?? "";
    const overlapText = pieceIndex > 0 ? overlapTail(prev, overlapChars) : "";
    // Analyze the untrimmed assembly so line offsets stay exact; the chunk
    // text itself is trimmed, which would shift the first line's offset.
    const pieceText = merged[pieceIndex] ?? "";
    const analysisText = (overlapText ? `${overlapText}\n` : "") + pieceText;
    const lines = analysisText.split("\n");
    let lineSpanIdx: Array<number | null> | null = null;
    if (needSpans) {
      lineSpanIdx = new Array<number | null>(lines.length).fill(null);
      const textStartAbs = pieceStart - (overlapText ? overlapText.length + 1 : 0);
      let cursor = 0;
      for (let li = 0; li < lines.length; li += 1) {
        const line = lines[li]!;
        const at = text.indexOf(line, cursor);
        if (at !== -1) cursor = at + line.length;
        const absStart = textStartAbs + (at === -1 ? 0 : at);
        const idx = tableSpans.findIndex(([s, e]) => absStart >= s && absStart < e);
        lineSpanIdx[li] = idx === -1 ? null : idx;
      }
    }
    const missingHeaders = Array.from(
      new Set(
        lines
          .map((line, li) => {
            const rowKey = line.charCodeAt(0) <= 32 && line.length ? line.trimStart() : line;
            const exact = tableHeadersByRow.get(rowKey);
            if (exact !== undefined) return exact;
            // Fragments of an over-long row no longer equal the stored row;
            // match them against the row with the shared boundary predicate,
            // and when the line's source span is known, only against the rows
            // of that table.
            const spanIdx = lineSpanIdx ? lineSpanIdx[li]! : null;
            if (standaloneLines.has(line) && spanIdx === null) return undefined;
            const candidates = spanIdx === null ? longRows : longRows.filter((row) => rowSpanIdx.get(row) === spanIdx);
            return candidates.find((row) => rowMatchesFragment(row, line))
              ? tableHeadersByRow.get(candidates.find((row) => rowMatchesFragment(row, line))!) ?? undefined
              : undefined;
          })
          .filter((header): header is string => Boolean(header && !text.includes(header))),
      ),
    );
    return missingHeaders.length ? `${missingHeaders.join("\n")}\n${text}` : text;
  });
  return withTableHeaders.map((text, ordinal) => ({
    ordinal,
    text,
    tokenCount: estimateTokens(text),
    heading: paths[ordinal] ?? null,
    symbol: extra.symbol,
    filepath: extra.filepath,
    language: extra.language,
    chunkKind: extra.chunkKind,
  }));
}

export function chunkDocument(body: string, opts: ChunkOptions = {}): DraftChunk[] {
  const normalized = body.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const chunkSize = opts.chunkSize ?? CHUNK_SIZE_TOKENS;
  const overlap = opts.overlap ?? CHUNK_OVERLAP_TOKENS;
  const kind: ChunkKind = opts.kind ?? "prose";
  const language = opts.language ?? null;
  const filepath = opts.filepath ?? null;
  const extras = { symbol: null as string | null, filepath, language, chunkKind: kind };

  if (kind === "code") {
    const targetChars = chunkSize * 4;
    const units = splitCodeUnits(normalized, language, targetChars);
    return units.map((text, ordinal) => ({
      ordinal,
      text,
      tokenCount: estimateTokens(text),
      heading: symbolFrom(text, language),
      symbol: symbolFrom(text, language),
      filepath,
      language,
      chunkKind: "code" as const,
    }));
  }

  return chunkProse(normalized, chunkSize, overlap, extras);
}
