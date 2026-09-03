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
  java: /^(?:public|private|protected)?\s*(?:static\s+)?(?:class|interface|enum|void|\w+)\s+(\w+)/m,
  c: /^(?:static\s+|inline\s+|extern\s+)*[\w\s\*]+\s+(\w+)\s*\(/m,
  h: /^(?:static\s+|inline\s+|extern\s+)*[\w\s\*]+\s+(\w+)\s*\(/m,
  cpp: /^(?:static\s+|inline\s+|extern\s+)*[\w\s\*:]+\s+(\w+)\s*\(/m,
  cc: /^(?:static\s+|inline\s+|extern\s+)*[\w\s\*:]+\s+(\w+)\s*\(/m,
  hpp: /^(?:static\s+|inline\s+|extern\s+)*[\w\s\*:]+\s+(\w+)\s*\(/m,
};

function currentHeading(text: string): string | null {
  const match = text.match(/^#{1,4}\s+(.+)$/m);
  return match?.[1]?.trim() ?? null;
}

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
    for (let i = 0; i < text.length; i += targetChars) {
      pieces.push(text.slice(i, i + targetChars));
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
    if (m?.[1]) return m[1];
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
  const flush = () => {
    const text = buf.join("\n").trim();
    if (text) units.push(text);
    buf = [];
  };
  for (const line of lines) {
    if (re.test(line) && buf.join("\n").trim().length > 0) flush();
    buf.push(line);
    if (buf.join("\n").length > targetChars * 1.6) {
      const joined = buf.join("\n");
      const parts = recursiveSplit(joined, ["\n\n", "\n"], targetChars);
      units.push(...parts.slice(0, -1));
      buf = (parts[parts.length - 1] ?? "").split("\n");
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

function chunkProse(body: string, chunkSize: number, overlap: number, extra: Omit<DraftChunk, "ordinal" | "text" | "tokenCount" | "heading"> & { heading?: string | null }): DraftChunk[] {
  const targetChars = chunkSize * 4;
  const overlapChars = overlap * 4;
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
  const withOverlap: string[] = [];
  for (let i = 0; i < merged.length; i += 1) {
    const prev = merged[i - 1] ?? "";
    const overlapText = prev.slice(Math.max(0, prev.length - overlapChars)).trim();
    const text = (overlapText && i > 0 ? `${overlapText}\n${merged[i]}` : merged[i]).trim();
    if (text) withOverlap.push(text);
  }
  return withOverlap.map((text, ordinal) => ({
    ordinal,
    text,
    tokenCount: estimateTokens(text),
    heading: currentHeading(text),
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
