#!/usr/bin/env node
// Built from mcp/src by mcp/build.mjs. Do not edit.

// mcp/src/server.ts
import { createInterface } from "node:readline";
import { resolve } from "node:path";

// mcp/src/corpus.ts
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";

// web/src/lib/rag/types.ts
var EMBEDDING_MODEL = "gemini-embedding-2";
var CHUNK_SIZE_TOKENS = 512;
var CHUNK_OVERLAP_TOKENS = 25;
var RRF_K = 60;
var CONTEXT_TOKEN_BUDGET = 1400;
var CONTEXT_RELATIVE_FLOOR = 0.62;
var CONTEXT_ABSOLUTE_FLOOR = 0.24;
var CONTEXT_SOLO_MARGIN = 1.5;

// web/src/lib/rag/text.ts
var TOKEN_PATTERN = /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu;
var QUERY_STOPWORDS = /* @__PURE__ */ new Set([
  "the",
  "and",
  "for",
  "you",
  "with",
  "from",
  "that",
  "this",
  "what",
  "how",
  "why",
  "are",
  "was",
  "were",
  "into",
  "your",
  "a",
  "an",
  "of",
  "to",
  "in",
  "on",
  "or",
  "do",
  "does",
  "did",
  "is",
  "it",
  "as",
  "be",
  "by",
  "if",
  "not",
  "can",
  "should",
  "would",
  "could",
  "when",
  "which",
  "who",
  "whom",
  "been",
  "have",
  "has",
  "had",
  "will",
  "just",
  "about",
  "than",
  "then",
  "also",
  "only",
  "over",
  "after",
  "before",
  "between",
  "same",
  "each",
  "other",
  "more",
  "most",
  "such",
  "very",
  "right",
  "me",
  "my",
  "we",
  "our",
  "i",
  "explain",
  "describe",
  "tell",
  "show",
  "work",
  "works",
  "please",
  "thanks"
]);
var GENERIC_OPS_TERMS = /* @__PURE__ */ new Set([
  "node",
  "nodes",
  "memory",
  "cpu",
  "cpus",
  "ram",
  "resource",
  "resources",
  "server",
  "servers",
  "service",
  "services",
  "guide",
  "runbook",
  "error",
  "errors",
  "issue",
  "issues",
  "use",
  "using",
  "used",
  "handle",
  "handling",
  "system",
  "systems",
  "process",
  "limit",
  "limits",
  "timeout",
  "timeouts",
  "request",
  "requests",
  "cluster",
  "host",
  "free",
  "enough",
  "individual",
  "aggregate",
  "pattern",
  "failure",
  "failures"
]);
function tokenize(text) {
  const prepared = /[\u0080-\uFFFF]/.test(text) ? text.normalize("NFC") : text;
  return prepared.toLowerCase().match(TOKEN_PATTERN) ?? [];
}
function stemToken(token) {
  if (token.length < 5) return token;
  if (token.endsWith("ing") && token.length > 6) return token.slice(0, -3);
  if (token.endsWith("ers") && token.length > 6) return token.slice(0, -1);
  if (token.endsWith("ies") && token.length > 5) return `${token.slice(0, -3)}y`;
  if (token.endsWith("es") && token.length > 5) return token.slice(0, -2);
  if (token.endsWith("ed") && token.length > 5) {
    const minusD = token.slice(0, -1);
    if (minusD.endsWith("e")) return minusD;
    return token.slice(0, -2);
  }
  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 4) return token.slice(0, -1);
  return token;
}
function contentTokens(text) {
  return tokenize(text).filter((t) => t.length > 1 && !QUERY_STOPWORDS.has(t)).map(stemToken);
}
function bigrams(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length - 1; i += 1) {
    out.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return out;
}
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (Math.abs(a.length - b.length) > 2) return 99;
  const prev = new Array(b.length + 1);
  const cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 99) + 1, (cur[j - 1] ?? 99) + 1, (prev[j - 1] ?? 99) + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = cur[j] ?? 99;
  }
  return prev[b.length] ?? 99;
}
function expandTypos(queryTokens, vocab) {
  const extra = [];
  for (const raw of queryTokens) {
    if (vocab.has(raw) || raw.length < 5) continue;
    let best = null;
    let bestD = 99;
    let ties = 0;
    const max = raw.length >= 8 ? 2 : 1;
    for (const v of vocab) {
      if (Math.abs(v.length - raw.length) > max) continue;
      const d = levenshtein(raw, v);
      if (d < bestD) {
        bestD = d;
        best = v;
        ties = 1;
      } else if (d === bestD) {
        ties += 1;
      }
    }
    if (best && bestD <= max && ties === 1) extra.push(best);
  }
  return extra;
}
function tokenSetMatches(queryToken, doc) {
  if (doc.has(queryToken)) return true;
  const stemmed = stemToken(queryToken);
  if (doc.has(stemmed)) return true;
  if (queryToken.length < 4) return false;
  for (const t of doc) {
    if (t.length < 4) continue;
    if (t.startsWith(queryToken) || queryToken.startsWith(t)) return true;
  }
  return false;
}
function estimateTokens(text) {
  return Math.max(1, Math.ceil(text.trim().length / 4));
}
function cosineSimilarity(a, b) {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
function parseEmbedding(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    for (const n of parsed) {
      if (typeof n !== "number" || !Number.isFinite(n)) return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// web/src/lib/rag/chunking.ts
var SEPARATORS = ["\n## ", "\n### ", "\n#### ", "\n\n", "\n", ". ", " "];
var CODE_BOUNDARY = {
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
  hpp: /^\s*(?!\s*(?:return|if|else|while|for|switch|sizeof)\b)(?:static\s+|inline\s+|extern\s+)*[A-Za-z_][\w*: ]*?[*\s]\s*(\w+)\s*\(/m
};
function splitOnce(text, separator) {
  if (!separator) return [text];
  const parts = text.split(separator);
  if (parts.length === 1) return parts;
  const out = [];
  for (let i = 0; i < parts.length; i += 1) {
    const piece = i === 0 ? parts[i] : `${separator}${parts[i]}`;
    if (piece.length) out.push(piece);
  }
  return out;
}
function recursiveSplit(text, seps, targetChars) {
  if (text.length <= targetChars) return [text];
  const [sep2, ...rest] = seps;
  if (!sep2) {
    const pieces = [];
    for (let i = 0; i < text.length; ) {
      let end = Math.min(i + targetChars, text.length);
      const previous = text.charCodeAt(end - 1);
      const next = text.charCodeAt(end);
      if (previous >= 55296 && previous <= 56319 && next >= 56320 && next <= 57343) end += 1;
      pieces.push(text.slice(i, end));
      i = end;
    }
    return pieces;
  }
  const parts = splitOnce(text, sep2);
  const acc = [];
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
function symbolFrom(text, language) {
  const re = language ? CODE_BOUNDARY[language] : void 0;
  if (re) {
    const m = text.match(re);
    const name = m?.slice(1).find((g) => g);
    if (name) return name;
  }
  const any = text.match(
    /(?:export\s+)?(?:async\s+)?(?:function|class|const|def|fn|func)\s+(\w+)/
  );
  return any?.[1] ?? null;
}
function extractHeader(text) {
  const lines = text.split("\n");
  const header = [];
  let i = 0;
  for (; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (/^(import|from|package|using|#include|export \* from|export \{)/.test(trimmed) || /^\/\/|^#\s|^\/\*/.test(trimmed) || trimmed === "") {
      header.push(line);
      continue;
    }
    break;
  }
  while (header.length && !(header[header.length - 1] ?? "").trim()) header.pop();
  return { header: header.join("\n"), rest: lines.slice(i).join("\n") };
}
function splitCodeUnits(body, language, targetChars) {
  const { header, rest } = extractHeader(body);
  const re = language && CODE_BOUNDARY[language] || CODE_BOUNDARY.typescript;
  const lines = rest.split("\n");
  const units = [];
  let buf = [];
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
    if (i === 0) return `${header}

${u}`;
    const hint = header.split("\n").slice(0, 12).join("\n");
    return `${hint}

${u}`;
  });
}
function overlapTail(text, count) {
  let start = Math.max(0, text.length - count);
  const first = text.charCodeAt(start);
  const previous = text.charCodeAt(start - 1);
  if (first >= 56320 && first <= 57343 && previous >= 55296 && previous <= 56319) start -= 1;
  if (start > 0 && text[start - 1] !== "\n") {
    const nextLine = text.indexOf("\n", start);
    if (nextLine === -1) return "";
    start = nextLine + 1;
  }
  return text.slice(start).trim();
}
function chunkProse(body, chunkSize, overlap2, extra) {
  const targetChars = chunkSize * 4;
  const overlapChars = overlap2 * 4;
  const lines = body.split("\n");
  const tableHeadersByRow = /* @__PURE__ */ new Map();
  const separatorRow = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/;
  let fenceRun = null;
  const listIndents = [];
  const tableSpans = [];
  const rowSpanIdx = /* @__PURE__ */ new Map();
  const lineOffsets = [];
  {
    let off = 0;
    for (const l of lines) {
      lineOffsets.push(off);
      off += l.length + 1;
    }
  }
  for (let i = 0; i < lines.length - 2; i += 1) {
    const line = lines[i] ?? "";
    const indentWidth = line.charCodeAt(0) === 32 ? /^ */.exec(line)[0].length : 0;
    if (fenceRun === null && indentWidth < line.length) {
      while (listIndents.length && indentWidth < listIndents[listIndents.length - 1]) listIndents.pop();
      const fc = line.charAt(indentWidth);
      if (fc === "-" || fc === "*" || fc === "+" || fc >= "0" && fc <= "9") {
        const listMarker = /^( *)([-*+]|\d{1,9}[.)])( {1,4}|\t)/.exec(line);
        if (listMarker) {
          const padding = listMarker[3] === "	" ? 4 : listMarker[3].length;
          listIndents.push(indentWidth + listMarker[2].length + padding);
        }
      }
    }
    const firstNonWs = line.charAt(indentWidth);
    const fenceMatch = firstNonWs === "`" || firstNonWs === "~" ? /^(`{3,}|~{3,})/.exec(line.trim()) : null;
    if (fenceMatch) {
      const run2 = fenceMatch[1];
      const rest = line.trim().slice(run2.length);
      if (fenceRun === null) {
        if (run2[0] !== "`" || !rest.includes(run2)) {
          fenceRun = run2;
          continue;
        }
      } else {
        if (run2[0] === fenceRun[0] && run2.length >= fenceRun.length && !rest.trim()) fenceRun = null;
        continue;
      }
    }
    if (fenceRun !== null) continue;
    const header = line;
    const separator = lines[i + 1] ?? "";
    const activeListIndent = listIndents[listIndents.length - 1];
    if (/^\t/.test(line) || indentWidth >= 4 && (activeListIndent === void 0 || indentWidth > activeListIndent)) continue;
    if (!header.includes("|") || !separatorRow.test(separator.trim())) continue;
    const tableHeader = `${header}
${separator}`;
    let row = i + 2;
    for (; row < lines.length && (lines[row] ?? "").includes("|"); row += 1) {
      const rowText = lines[row] ?? "";
      const trimmedRow = rowText.trim();
      if (/^(#{1,6}\s|>\s?|[-*+]\s|\d{1,9}[.)]\s)/.test(trimmedRow)) break;
      if (trimmedRow.charCodeAt(0) === 96 || trimmedRow.charCodeAt(0) === 126) {
        const fenceStart = /^(`{3,}|~{3,})/.exec(trimmedRow);
        if (fenceStart && (fenceStart[1][0] !== "`" || !trimmedRow.slice(fenceStart[1].length).includes(fenceStart[1])))
          break;
      }
      const rowKey = rowText.trimStart();
      const existing = tableHeadersByRow.get(rowKey);
      if (existing === void 0) tableHeadersByRow.set(rowKey, tableHeader);
      else if (existing !== tableHeader) tableHeadersByRow.set(rowKey, "");
    }
    if (row > i + 2) {
      const lastRow = row - 1;
      const spanIdx = tableSpans.length;
      tableSpans.push([lineOffsets[i], (lineOffsets[lastRow] ?? body.length) + (lines[lastRow] ?? "").length]);
      for (let r = i + 2; r <= lastRow; r += 1) rowSpanIdx.set((lines[r] ?? "").trimStart(), spanIdx);
    }
    i = row - 1;
  }
  const longRows = [...tableHeadersByRow.keys()].filter((row) => row.length > targetChars);
  const rowMatchesFragment = (row, line) => line.length >= 20 ? row.includes(line) : line.length >= 6 && (row.includes(` ${line} `) || row.startsWith(`${line} `) || row.endsWith(` ${line}`));
  const standaloneLines = new Set(body.split("\n"));
  const raw = recursiveSplit(body, SEPARATORS, targetChars);
  const merged = [];
  for (const piece of raw) {
    const last = merged[merged.length - 1];
    if (last && estimateTokens(last) < chunkSize * 0.4 && estimateTokens(last + piece) <= chunkSize * 1.15) {
      merged[merged.length - 1] = `${last}${piece}`;
    } else {
      merged.push(piece);
    }
  }
  const sourceHeadings = [];
  let headingFence = null;
  let lineOffset = 0;
  for (const line of lines) {
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (headingFence) {
      if (fence && fence[1][0] === headingFence[0] && fence[1].length >= headingFence.length && !fence[2].trim()) headingFence = null;
    } else if (fence && (fence[1][0] !== "`" || !fence[2].includes("`"))) {
      headingFence = fence[1];
    } else {
      const heading = /^(#{1,4})\s+(.+)$/.exec(line);
      if (heading) sourceHeadings.push({ offset: lineOffset, level: heading[1].length, title: heading[2].trim() });
    }
    lineOffset += line.length + 1;
  }
  const stack = [];
  let headingIndex = 0;
  let pieceEnd = 0;
  const paths = merged.map((piece) => {
    pieceEnd += piece.length;
    let label = null;
    while (headingIndex < sourceHeadings.length && sourceHeadings[headingIndex].offset < pieceEnd) {
      const { level, title } = sourceHeadings[headingIndex++];
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, title });
      if (!label) label = stack.map((f) => f.title).join(" > ");
    }
    return label ?? (stack.length ? stack.map((f) => f.title).join(" > ") : null);
  });
  const withOverlap = [];
  for (let i = 0; i < merged.length; i += 1) {
    const prev = merged[i - 1] ?? "";
    const overlapText = overlapTail(prev, overlapChars);
    const text = (overlapText && i > 0 ? `${overlapText}
${merged[i]}` : merged[i]).trim();
    if (text) withOverlap.push(text);
  }
  const pieceStarts = [];
  {
    let off = 0;
    for (const p of merged) {
      pieceStarts.push(off);
      off += p.length;
    }
  }
  const needSpans = tableSpans.length > 0 && longRows.length > 0;
  const withTableHeaders = withOverlap.map((text, pieceIndex) => {
    const pieceStart = pieceStarts[pieceIndex] ?? -1;
    const prev = merged[pieceIndex - 1] ?? "";
    const overlapText = pieceIndex > 0 ? overlapTail(prev, overlapChars) : "";
    const pieceText = merged[pieceIndex] ?? "";
    const analysisText = (overlapText ? `${overlapText}
` : "") + pieceText;
    const lines2 = analysisText.split("\n");
    let lineSpanIdx = null;
    if (needSpans) {
      lineSpanIdx = new Array(lines2.length).fill(null);
      const textStartAbs = pieceStart - (overlapText ? overlapText.length + 1 : 0);
      let cursor = 0;
      for (let li = 0; li < lines2.length; li += 1) {
        const line = lines2[li];
        const at = text.indexOf(line, cursor);
        if (at !== -1) cursor = at + line.length;
        const absStart = textStartAbs + (at === -1 ? 0 : at);
        const idx = tableSpans.findIndex(([s, e]) => absStart >= s && absStart < e);
        lineSpanIdx[li] = idx === -1 ? null : idx;
      }
    }
    const missingHeaders = Array.from(
      new Set(
        lines2.map((line, li) => {
          const rowKey = line.charCodeAt(0) <= 32 && line.length ? line.trimStart() : line;
          const exact = tableHeadersByRow.get(rowKey);
          if (exact !== void 0) return exact;
          const spanIdx = lineSpanIdx ? lineSpanIdx[li] : null;
          if (standaloneLines.has(line) && spanIdx === null) return void 0;
          const candidates = spanIdx === null ? longRows : longRows.filter((row) => rowSpanIdx.get(row) === spanIdx);
          return candidates.find((row) => rowMatchesFragment(row, line)) ? tableHeadersByRow.get(candidates.find((row) => rowMatchesFragment(row, line))) ?? void 0 : void 0;
        }).filter((header) => Boolean(header && !text.includes(header)))
      )
    );
    return missingHeaders.length ? `${missingHeaders.join("\n")}
${text}` : text;
  });
  return withTableHeaders.map((text, ordinal) => ({
    ordinal,
    text,
    tokenCount: estimateTokens(text),
    heading: paths[ordinal] ?? null,
    symbol: extra.symbol,
    filepath: extra.filepath,
    language: extra.language,
    chunkKind: extra.chunkKind
  }));
}
function chunkDocument(body, opts = {}) {
  const normalized = body.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  const chunkSize = opts.chunkSize ?? CHUNK_SIZE_TOKENS;
  const overlap2 = opts.overlap ?? CHUNK_OVERLAP_TOKENS;
  const kind = opts.kind ?? "prose";
  const language = opts.language ?? null;
  const filepath = opts.filepath ?? null;
  const extras = { symbol: null, filepath, language, chunkKind: kind };
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
      chunkKind: "code"
    }));
  }
  return chunkProse(normalized, chunkSize, overlap2, extras);
}

// mcp/src/corpus.ts
var PROSE = /* @__PURE__ */ new Set([".md", ".mdx", ".markdown", ".txt", ".rst", ".adoc"]);
var CODE = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".rb": "ruby",
  ".kt": "kotlin",
  ".swift": "swift",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cs": "csharp"
};
var SKIP_DIRS = /* @__PURE__ */ new Set(["node_modules", ".git", "dist", "build", ".next", "out", "coverage", "vendor", "target", ".venv", "venv", "__pycache__", ".turbo", ".cache"]);
var LIMITS = { files: 4e3, bytesPerFile: 4e5, totalBytes: 4e7 };
var hash = (s) => createHash("sha256").update(s).digest("hex");
function kindOf(path) {
  const ext = extname(path).toLowerCase();
  if (PROSE.has(ext)) return { kind: "prose", language: null };
  const language = CODE[ext];
  return language ? { kind: "code", language } : null;
}
function rowsFor(corpusId, files) {
  const rows = [];
  for (const f of files) {
    const k = kindOf(f.path);
    if (!k) continue;
    for (const c of chunkDocument(f.text, { filepath: f.path, kind: k.kind, language: k.language })) {
      rows.push({
        title: f.path,
        slug: f.path,
        indexedAt: null,
        corpusId,
        chunk: {
          id: `${f.path}#${c.ordinal}`,
          document_id: f.path,
          ordinal: c.ordinal,
          text: c.text,
          token_count: c.tokenCount,
          heading: c.heading,
          embedding: null,
          embedding_model: null,
          content_hash: hash(c.text),
          created_at: "",
          filepath: c.filepath,
          language: c.language,
          symbol: c.symbol,
          chunk_kind: c.chunkKind,
          corpus_id: corpusId
        }
      });
    }
  }
  return rows;
}
function readFolder(root, include = "all") {
  const out = [];
  let total = 0;
  const walk = (dir) => {
    let names;
    try {
      names = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of names) {
      if (out.length >= LIMITS.files || total >= LIMITS.totalBytes) return;
      if (name.startsWith(".") && name !== ".github") continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(full);
        continue;
      }
      const k = kindOf(name);
      if (!k || include === "docs" && k.kind !== "prose" || st.size > LIMITS.bytesPerFile) continue;
      const text = readFileSync(full, "utf8");
      if (text.includes("\0")) continue;
      total += text.length;
      out.push({ path: relative(root, full).split(sep).join("/"), text });
    }
  };
  walk(root);
  return out;
}
function folderCorpus(path, include = "all") {
  const files = readFolder(path, include);
  const id = `local:${hash(path).slice(0, 10)}`;
  return { id, label: path.split(/[\\/]/).filter(Boolean).at(-1) ?? path, origin: path, rows: rowsFor(id, files), files: files.length, indexedAt: (/* @__PURE__ */ new Date()).toISOString() };
}
var GH = "https://api.github.com";
async function githubCorpus(repo, opts = {}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`Expected owner/repo, got "${repo}"`);
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "intellirag-mcp" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const get = async (url) => {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(2e4) });
    if (!r.ok) throw new Error(`GitHub ${r.status} for ${url.replace(GH, "")}${r.status === 403 || r.status === 429 ? " (rate limited or blocked: set GITHUB_TOKEN)" : ""}`);
    return r.json();
  };
  const sha = (await get(`${GH}/repos/${repo}/commits/${encodeURIComponent(opts.ref ?? "HEAD")}`)).sha;
  const tree = await get(`${GH}/repos/${repo}/git/trees/${sha}?recursive=1`);
  const include = opts.include ?? "docs";
  const wanted = tree.tree.filter((n) => n.type === "blob" && (n.size ?? 0) <= LIMITS.bytesPerFile && !n.path.split("/").some((p) => SKIP_DIRS.has(p))).filter((n) => {
    const k = kindOf(n.path);
    return k && (include === "all" || k.kind === "prose");
  }).slice(0, include === "all" ? 800 : 300);
  const files = [];
  for (let i = 0; i < wanted.length; i += 8) {
    const batch = await Promise.all(wanted.slice(i, i + 8).map(async (n) => {
      const r = await fetch(`https://raw.githubusercontent.com/${repo}/${sha}/${n.path}`, { headers: { "User-Agent": "intellirag-mcp" }, signal: AbortSignal.timeout(2e4) });
      return r.ok ? { path: n.path, text: await r.text() } : null;
    }));
    for (const f of batch) if (f) files.push(f);
  }
  const id = `github:${repo}@${sha.slice(0, 12)}`;
  return { id, label: repo, origin: `${repo}@${sha}`, rows: rowsFor(id, files), files: files.length, indexedAt: (/* @__PURE__ */ new Date()).toISOString() };
}

// web/src/lib/rag/coverage-pack.ts
var FUNCTION_WORDS = new Set(
  "about above across after again against all also among any because been before being below between both but can could did does doing done down during each either else even ever every few further had has have having here into its itself just like make many may might more most much must near need neither never now off often once only other otherwise our ours out over own per rather same should since some such than their them then there these they those though through thus too under until upon very was way were when where whether which while who whom whose will within without would yes yet your yours able actually already always another anyone anything currently establish exactly instead really something still want wants we us use using used one two three four five six seven eight nine ten eleven twelve twenty thirty forty fifty hundred thousand single double half".split(" ")
);
function coverageTerms(query) {
  return [...new Set(contentTokens(query).filter((t) => t.length >= 3 && !FUNCTION_WORDS.has(t) && !/^\d+$/.test(t)))];
}
function surfaceTerm(query, stem) {
  for (const w of tokenize(query)) if (stemToken(w) === stem) return w;
  return stem;
}
function paragraphUnits(text) {
  const raw = [];
  for (let at = 0, m, re = /\n[^\S\n]*\n\s*/g; ; ) {
    m = re.exec(text);
    const end = m ? m.index : text.length;
    if (text.slice(at, end).trim()) raw.push([at, end]);
    if (!m) break;
    at = m.index + m[0].length;
  }
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    let [a, b] = raw[i];
    const fences = () => (text.slice(a, b).match(/^\s*```/gm) ?? []).length;
    const headingOnly = () => /^\s*#{1,6}\s/.test(text.slice(a, b)) && !text.slice(a, b).trim().includes("\n");
    while (i + 1 < raw.length && (fences() % 2 === 1 || headingOnly())) b = raw[++i][1];
    out.push([a, b]);
  }
  return out;
}
function bagOf(text) {
  const bag = /* @__PURE__ */ new Map();
  for (const t of contentTokens(text)) bag.set(t, (bag.get(t) ?? 0) + 1);
  return bag;
}
function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [t, v] of a) {
    na += v * v;
    const w = b.get(t);
    if (w) dot += v * w;
  }
  for (const v of b.values()) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
function packByCoverage(input) {
  const lambda = input.lambda ?? 0.6;
  const maxSources = input.maxSources ?? 4;
  const terms = [...new Set(input.terms)];
  const rawW = terms.map((t) => input.idf.get(t) ?? 1);
  const wSum = rawW.reduce((s, x) => s + x, 0) || 1;
  const weight = new Map(terms.map((t, i) => [t, rawW[i] / wSum]));
  const sources = input.pool.map((chunk, src) => {
    const spans = paragraphUnits(chunk.text);
    const units = spans.map(([a, b], i) => {
      const text = chunk.text.slice(a, b);
      const doc = new Set(contentTokens(text));
      return {
        src,
        lo: i,
        hi: i,
        text,
        cost: estimateTokens(text),
        terms: new Set(terms.filter((t) => tokenSetMatches(t, doc))),
        bag: bagOf(text)
      };
    });
    return { chunk, primary: input.primary.has(chunk.chunkId), spans, units };
  });
  const rel = (u) => {
    const s = sources[u.src];
    if (!s.primary) return 0;
    return Math.max(0, s.chunk.score) * (u.terms.size ? 1 : 0.25);
  };
  const all = sources.flatMap((s) => s.units);
  let beta = input.beta ?? 0;
  if (input.beta == null && all.length > 1) {
    const top = [...all].sort((a, b) => rel(b) + cov(b, /* @__PURE__ */ new Set()) - (rel(a) + cov(a, /* @__PURE__ */ new Set()))).slice(0, 24);
    const meanCost = top.reduce((s, u) => s + u.cost, 0) / top.length;
    const kBar = Math.max(2, input.budget / Math.max(1, meanCost));
    const meanGain = top.reduce((s, u) => s + lambda * rel(u) + cov(u, /* @__PURE__ */ new Set()), 0) / top.length;
    let simSum = 0;
    let pairs = 0;
    for (let i = 0; i < top.length; i++)
      for (let j = i + 1; j < top.length; j++) {
        simSum += cosine(top[i].bag, top[j].bag);
        pairs++;
      }
    const meanSim = pairs ? simSum / pairs : 0;
    beta = Math.min(2, Math.max(0, meanGain / ((kBar - 1) * meanSim + 1e-6)));
  }
  function cov(u, covered2) {
    let g = 0;
    for (const t of u.terms) if (!covered2.has(t)) g += weight.get(t) ?? 0;
    return g;
  }
  const spanText = (s, lo, hi) => s.chunk.text.slice(s.spans[lo][0], s.spans[hi][1]);
  function objective(state2) {
    const covered2 = /* @__PURE__ */ new Set();
    let relSum = 0;
    let tokens = 0;
    const bags = [];
    for (const [src, [lo, hi]] of state2) {
      const s = sources[src];
      tokens += estimateTokens(spanText(s, lo, hi));
      for (let i = lo; i <= hi; i++) {
        const u = s.units[i];
        for (const t of u.terms) covered2.add(t);
        relSum += rel(u);
        bags.push(u.bag);
      }
    }
    let red = 0;
    for (let i = 0; i < bags.length; i++) for (let j = i + 1; j < bags.length; j++) red += cosine(bags[i], bags[j]);
    let c = 0;
    for (const t of covered2) c += weight.get(t) ?? 0;
    return { value: c + lambda * relSum - beta * red, covered: covered2, tokens };
  }
  const state = /* @__PURE__ */ new Map();
  const steps = [];
  for (const id of input.seed ?? []) {
    const src = sources.findIndex((s) => s.chunk.chunkId === id);
    if (src < 0 || !sources[src].units.length) continue;
    const next = new Map(state);
    next.set(src, [0, sources[src].units.length - 1]);
    if (objective(next).tokens > input.budget) continue;
    state.set(src, [0, sources[src].units.length - 1]);
    steps.push({ chunkId: id, paragraphs: [0, sources[src].units.length - 1], gain: 0, cost: objective(state).tokens, covers: [] });
  }
  let current2 = objective(state);
  for (; ; ) {
    let best = null;
    for (const s of sources) {
      const src = sources.indexOf(s);
      const have = state.get(src);
      if (!have && state.size >= maxSources) continue;
      for (let i = 0; i < s.units.length; i++) {
        if (have && i >= have[0] && i <= have[1]) continue;
        const lo = have ? Math.min(have[0], i) : i;
        const hi = have ? Math.max(have[1], i) : i;
        const next = new Map(state);
        next.set(src, [lo, hi]);
        const val = objective(next);
        if (val.tokens > input.budget) continue;
        const gain = val.value - current2.value;
        const cost = val.tokens - current2.tokens;
        if (gain <= 1e-9 || cost <= 0) continue;
        const ratio2 = gain / cost;
        if (!best || ratio2 > best.ratio) {
          best = { src, lo, hi, gain, cost, ratio: ratio2, covers: [...val.covered].filter((t) => !current2.covered.has(t)) };
        }
      }
    }
    if (!best) break;
    state.set(best.src, [best.lo, best.hi]);
    current2 = objective(state);
    steps.push({ chunkId: sources[best.src].chunk.chunkId, paragraphs: [best.lo, best.hi], gain: best.gain, cost: best.cost, covers: best.covers });
  }
  let single = null;
  for (const [src, s] of sources.entries())
    for (let i = 0; i < s.units.length; i++) {
      const st = /* @__PURE__ */ new Map([[src, [i, i]]]);
      const v = objective(st);
      if (v.tokens <= input.budget && (!single || v.value > single.value)) single = { state: st, value: v.value };
    }
  let winner = "greedy";
  let finalState = new Map(state);
  if (single && single.value > current2.value + 1e-9) {
    winner = "single";
    finalState = single.state;
  }
  let filled = 0;
  for (; ; ) {
    let pick2 = null;
    const cur = objective(finalState);
    for (const [src, s] of sources.entries()) {
      if (!s.primary) continue;
      const have = finalState.get(src);
      const options = have ? [[have[0] - 1, have[1]], [have[0], have[1] + 1]] : finalState.size < maxSources ? [[0, 0]] : [];
      for (const [lo, hi] of options) {
        if (lo < 0 || hi >= s.units.length) continue;
        const next = new Map(finalState);
        next.set(src, [lo, hi]);
        const tokens = objective(next).tokens;
        if (tokens > input.budget) continue;
        const added = have ? s.units[lo < have[0] ? lo : hi] : s.units[0];
        const priority = Math.max(0.01, s.chunk.score) * (1 + added.terms.size) * (have ? 1 : 0.5) / Math.max(1, tokens - cur.tokens);
        if (!pick2 || priority > pick2.priority) pick2 = { src, lo, hi, priority };
      }
    }
    if (!pick2) break;
    finalState.set(pick2.src, [pick2.lo, pick2.hi]);
    filled++;
  }
  const fin = objective(finalState);
  const packed = [...finalState.entries()].sort((a, b) => a[0] - b[0]).map(([src, [lo, hi]], i) => {
    const s = sources[src];
    const whole = lo === 0 && hi === s.spans.length - 1;
    const text = whole ? s.chunk.text : spanText(s, lo, hi);
    return { ...s.chunk, text, tokenCount: whole ? s.chunk.tokenCount : estimateTokens(text), rank: i + 1 };
  });
  const covered = terms.filter((t) => fin.covered.has(t));
  const missing = terms.filter((t) => !fin.covered.has(t));
  const ratio = covered.reduce((s, t) => s + (weight.get(t) ?? 0), 0);
  return {
    packed,
    report: { covered, missing, ratio, beta, steps, usedTokens: fin.tokens, budget: input.budget, winner, filled }
  };
}
function coverageReportOf(packed, terms, idf, budget) {
  const uniq = [...new Set(terms)];
  const raw = uniq.map((t) => idf.get(t) ?? 1);
  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  const doc = new Set(packed.flatMap((c) => contentTokens(c.text)));
  const covered = uniq.filter((t) => tokenSetMatches(t, doc));
  const missing = uniq.filter((t) => !covered.includes(t));
  const ratio = covered.reduce((a, t) => a + raw[uniq.indexOf(t)] / sum, 0);
  return {
    covered,
    missing,
    ratio,
    beta: 0,
    steps: [],
    usedTokens: packed.reduce((n, c) => n + c.tokenCount, 0),
    budget,
    winner: "greedy",
    filled: 0
  };
}
function absentSubject(query, vocab) {
  const named = [];
  for (const sentence of query.split(/(?<=[.?!:;])\s+/)) {
    const words = sentence.match(/[A-Za-z][\w.-]*[\w]|[A-Za-z]/g) ?? [];
    named.push(...words.filter((w, i) => i > 0 && /^[A-Z][a-z]{2,}/.test(w) || /[a-z][A-Z]/.test(w) || /[.\d]/.test(w.slice(1))));
  }
  const absent = [];
  for (const w of named) {
    const parts = contentTokens(w).filter((t) => t.length >= 3);
    if (parts.length && parts.every((t) => !tokenSetMatches(t, vocab))) absent.push(w);
  }
  return [...new Set(absent)];
}

// web/src/lib/rag/corpus-scope.ts
var SEED_CORPUS_ID = "seed-lab";

// web/src/lib/rag/ranking.ts
var SCORE_SEMANTICS = "Dense = raw cosine. Keyword = raw BM25. Hybrid = raw RRF (1/(60+rank)). Rerank = calibrated mix (not a cross-encoder, not confidence). The context gate is calibrated-score floor 0.24 AND 62% of rank-1. not an absolute 0.55 cosine threshold.";
function buildIdf(corpusTexts) {
  const df = /* @__PURE__ */ new Map();
  const n = Math.max(1, corpusTexts.length);
  for (const text of corpusTexts) {
    const seen = new Set(contentTokens(text));
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const idf = /* @__PURE__ */ new Map();
  for (const [t, c] of df) {
    const raw = Math.log(1 + (n - c + 0.5) / (c + 0.5));
    idf.set(t, GENERIC_OPS_TERMS.has(t) ? raw * 0.2 : raw);
  }
  return idf;
}
function queryTerms(query, vocab) {
  const base = contentTokens(query);
  const extra = expandTypos(base, vocab);
  return [.../* @__PURE__ */ new Set([...base, ...extra])];
}
function corpusVocab(texts) {
  const v = /* @__PURE__ */ new Set();
  for (const text of texts) for (const t of contentTokens(text)) v.add(t);
  return v;
}
function termWeight(term, idf) {
  if (QUERY_STOPWORDS.has(term)) return 0;
  const generic = GENERIC_OPS_TERMS.has(term) ? 0.2 : 1;
  return (idf.get(term) ?? Math.log(8)) * generic;
}
function weightedRecall(terms, text, idf) {
  if (!terms.length) return 0;
  const doc = new Set(contentTokens(text));
  let num = 0;
  let den = 0;
  for (const t of terms) {
    const w = termWeight(t, idf);
    if (w <= 0) continue;
    den += w;
    if (tokenSetMatches(t, doc)) num += w;
  }
  return den === 0 ? 0 : num / den;
}
function phraseBoost(query, text) {
  const q = contentTokens(query);
  const grams = bigrams(q).filter((g) => {
    const [a, b] = g.split(" ");
    return Boolean(a && b && !GENERIC_OPS_TERMS.has(a) && !GENERIC_OPS_TERMS.has(b));
  });
  const hay = contentTokens(text).join(" ");
  const hayRaw = text.toLowerCase();
  let hits = 0;
  let den = grams.length;
  for (const g of grams) {
    if (hay.includes(g)) hits += 1;
  }
  const named = query.match(/\bnode\s+[a-z0-9]\b/gi) ?? [];
  den += named.length;
  for (const n of named) {
    if (hayRaw.includes(n.toLowerCase())) hits += 1;
  }
  if (!den) return 0;
  return hits / den;
}
function topicalBoost(query, title, text) {
  const q = queryTokenSet(query);
  const d = new Set(contentTokens(`${title}
${text}`));
  let b = 0;
  if (looksLikeStampede(q) && hasAny(d, ["stampede", "redis"])) b += 0.28;
  if (looksLikeFragmentation(q) && hasAny(d, ["fragmentation", "pending"])) b += 0.22;
  if (looksLikeServerlessPg(q) && hasAny(d, ["pgbouncer", "postgres"])) b += 0.22;
  return Math.min(0.34, b);
}
function maxNorm(values, value) {
  const hi = Math.max(0, ...values);
  if (hi <= 1e-9) return 0;
  return value / hi;
}
var ENTITY_TERMS = /* @__PURE__ */ new Set([
  "postgres",
  "pgbouncer",
  "redis",
  "redlock",
  "kubernetes",
  "k8s",
  "docker",
  "tls",
  "aiohttp",
  "asyncio",
  "terraform",
  "nginx"
]);
function entityTermsInQuery(query) {
  return contentTokens(query).filter((t) => ENTITY_TERMS.has(t));
}
function hasAny(hay, terms) {
  return terms.some((t) => tokenSetMatches(t, hay));
}
function queryTokenSet(query) {
  return new Set(contentTokens(query));
}
function looksLikeStampede(q) {
  return hasAny(q, ["cache", "cached", "stampede"]) && hasAny(q, ["hundred", "sudden", "expensive", "disappear", "recompute", "popular", "thundering", "herd"]);
}
function looksLikeFragmentation(q) {
  return hasAny(q, ["pending", "pod", "scatter", "fragment", "schedul"]) || hasAny(q, ["2gi", "2gib"]);
}
function looksLikeServerlessPg(q) {
  return hasAny(q, ["postgres", "pgbouncer"]) && hasAny(q, ["pool", "serverless", "bouncer"]);
}
function expandQueryCues(query) {
  const q = queryTokenSet(query);
  const extra = [];
  if (looksLikeStampede(q)) extra.push("stampede", "redis", "ttl", "jitter", "lock");
  if (looksLikeFragmentation(q)) extra.push("fragmentation", "pending", "kubernetes");
  if (looksLikeServerlessPg(q)) extra.push("pgbouncer", "postgres", "transaction");
  return extra;
}
function calibratedScore(input) {
  const { dense, bm25Norm, idfRecall, titleRecall, phrase } = input;
  if (dense == null) {
    return 0.34 * bm25Norm + 0.32 * idfRecall + 0.2 * titleRecall + 0.14 * phrase;
  }
  return 0.46 * Math.max(0, dense) + 0.18 * bm25Norm + 0.2 * idfRecall + 0.1 * titleRecall + 0.06 * phrase;
}
function rrfFuse(dense, keyword, topK) {
  const scores = /* @__PURE__ */ new Map();
  const byId = /* @__PURE__ */ new Map();
  dense.forEach((c, i) => {
    scores.set(c.chunkId, (scores.get(c.chunkId) ?? 0) + 1 / (RRF_K + i + 1));
    byId.set(c.chunkId, c);
  });
  keyword.forEach((c, i) => {
    scores.set(c.chunkId, (scores.get(c.chunkId) ?? 0) + 1 / (RRF_K + i + 1));
    if (!byId.has(c.chunkId)) byId.set(c.chunkId, c);
  });
  const fused = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, topK).map(([id, score], rank) => {
    const base = byId.get(id);
    return { ...base, score, rank: rank + 1, retriever: "hybrid" };
  });
  return { fused, scores };
}
function rerankCalibrated(opts) {
  const bm25Raw = opts.candidates.map((c) => opts.keywordScores.get(c.chunkId) ?? 0);
  const signals = /* @__PURE__ */ new Map();
  const scored = opts.candidates.map((c) => {
    const dense = opts.denseScores.has(c.chunkId) ? opts.denseScores.get(c.chunkId) ?? null : null;
    const bm25 = opts.keywordScores.get(c.chunkId) ?? 0;
    const idfRecall = weightedRecall(opts.terms, `${c.title}
${c.heading ?? ""}
${c.text}`, opts.idf);
    const titleRecall = weightedRecall(opts.terms, `${c.title} ${c.heading ?? ""}`, opts.idf);
    const phrase = phraseBoost(opts.query, `${c.title}
${c.text}`);
    const topical = (c.corpusId ?? SEED_CORPUS_ID) === SEED_CORPUS_ID ? topicalBoost(opts.query, c.title, c.text) : 0;
    let score = Math.min(
      1,
      calibratedScore({
        dense,
        bm25Norm: maxNorm(bm25Raw, bm25),
        idfRecall,
        titleRecall,
        phrase
      }) + topical
    );
    const ents = entityTermsInQuery(opts.query);
    const titleTok = new Set(contentTokens(`${c.title} ${c.heading ?? ""}`));
    if ((c.corpusId ?? SEED_CORPUS_ID) === SEED_CORPUS_ID && ents.some((e) => tokenSetMatches(e, titleTok))) score = Math.min(1, score + 0.12);
    if (opts.preferredSlugs?.includes(c.slug)) score = Math.min(1, score + 0.03);
    const link = opts.codeLinks?.get(c.slug);
    if (link) score = Math.min(1, score + Math.min(CODE_LINK_CAP, CODE_LINK_STEP * link));
    const pathCost = opts.graphPathCosts?.get(c.chunkId);
    if (pathCost !== void 0) score = Math.min(1, score + 0.04 / (1 + pathCost));
    const learnedBoost = opts.learnedBoost?.get(c.chunkId);
    if (learnedBoost) score = Math.min(1, score + learnedBoost);
    const learnedSignal = opts.learned?.get(c.chunkId);
    const demoted = opts.demote?.get(c.chunkId);
    if (demoted) score = Math.max(0, score - demoted);
    signals.set(c.chunkId, { idfRecall, titleRecall, phrase, topical, dense, bm25, ...learnedSignal !== void 0 ? { learned: learnedSignal } : {} });
    return { chunk: c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const scores = /* @__PURE__ */ new Map();
  const ranked = scored.map((s, i) => {
    scores.set(s.chunk.chunkId, s.score);
    return { ...s.chunk, score: s.score, rank: i + 1 };
  });
  return { ranked, scores, signals };
}
var LEARNED_SUPPORT = 0.45;
var CODE_LINK_STEP = 0.12;
var CODE_LINK_CAP = 0.3;
function isSupported(signals, calibrated) {
  if ((signals.learned ?? 0) >= LEARNED_SUPPORT && calibrated > 0) return true;
  if (calibrated < CONTEXT_ABSOLUTE_FLOOR) return false;
  if (signals.idfRecall >= 0.18) return true;
  if (signals.titleRecall >= 0.22) return true;
  if (signals.phrase >= 0.2) return true;
  if (signals.topical >= 0.18) return true;
  if ((signals.dense ?? 0) >= 0.52 && (signals.idfRecall >= 0.05 || signals.titleRecall >= 0.08)) {
    return true;
  }
  if ((signals.dense ?? 0) >= 0.62 && calibrated >= 0.32) return true;
  if (signals.dense == null && signals.idfRecall < 0.1 && signals.titleRecall < 0.12 && signals.topical < 0.18) {
    return false;
  }
  return false;
}
function distinctiveDocHits(query, ranked, idf) {
  const terms = contentTokens(query).filter((t) => !GENERIC_OPS_TERMS.has(t) && (idf.get(t) ?? 0) > 0.4);
  const slugs = [];
  for (const c of ranked.slice(0, 8)) {
    const title = new Set(contentTokens(`${c.title} ${c.heading ?? ""}`));
    const hit = terms.some((t) => tokenSetMatches(t, title));
    if (hit && !slugs.includes(c.slug)) slugs.push(c.slug);
  }
  return slugs;
}
function queryLooksMultiSource(query, ranked, idf) {
  const hits = distinctiveDocHits(query, ranked, idf);
  if (hits.length >= 2) return true;
  const q = query.toLowerCase();
  if (/\band\b|\bshared by\b|\bboth\b|\bversus\b|\bvs\.?\b/.test(q) && hits.length >= 2) return true;
  return false;
}
function selectContext(ranked, signals, opts) {
  const relativeFloor = opts.relativeFloor ?? CONTEXT_RELATIVE_FLOOR;
  const soloMargin = opts.soloMargin ?? CONTEXT_SOLO_MARGIN;
  const dropReasons = /* @__PURE__ */ new Map();
  const maxTokens = opts.maxTokens ?? CONTEXT_TOKEN_BUDGET;
  const underspecified = distinctiveTerms(opts.query).length === 0;
  if (underspecified) {
    const qtok = contentTokens(opts.query);
    const mentioning = ranked.filter((c) => {
      if (c.score < 0.1) {
        dropReasons.set(c.chunkId, "Underspecified query: calibrated score < 0.10. Inspect only.");
        return false;
      }
      const doc = new Set(contentTokens(`${c.title}
${c.text}`));
      const hit = qtok.some((t) => tokenSetMatches(t, doc));
      if (!hit) {
        dropReasons.set(
          c.chunkId,
          "Underspecified query: no overlap with the generic question terms. Inspect only."
        );
      }
      return hit;
    });
    const packed2 = [];
    const seen = /* @__PURE__ */ new Set();
    for (const chunk of mentioning) {
      if (packed2.length >= Math.min(3, opts.topK ?? 3)) {
        dropReasons.set(chunk.chunkId, "Outside the packed context window (max 3 supported chunks).");
        continue;
      }
      if (seen.has(chunk.slug)) {
        dropReasons.set(chunk.chunkId, "Duplicate document. a stronger chunk from this source is already packed.");
        continue;
      }
      packed2.push({ ...chunk, rank: packed2.length + 1 });
      seen.add(chunk.slug);
    }
    return { packed: packed2, dropReasons };
  }
  const supported = [];
  for (const c of ranked) {
    const sig = signals.get(c.chunkId) ?? {
      idfRecall: 0,
      titleRecall: 0,
      phrase: 0,
      topical: 0,
      dense: null,
      bm25: null
    };
    if (!isSupported(sig, c.score)) {
      dropReasons.set(
        c.chunkId,
        `Rejected: calibrated ${c.score.toFixed(2)} failed the support gate (absolute floor ${CONTEXT_ABSOLUTE_FLOOR}, need distinctive overlap or strong cosine). Inspect only.`
      );
      continue;
    }
    supported.push(c);
  }
  if (!supported.length) return { packed: [], dropReasons };
  const peak = supported[0].score;
  const afterCliff = [];
  for (const c of supported) {
    if (c.chunkId !== supported[0].chunkId && c.score < peak * relativeFloor) {
      dropReasons.set(
        c.chunkId,
        `Below relative floor: ${c.score.toFixed(2)} < ${relativeFloor} \xD7 rank-1 ${peak.toFixed(2)} (${(peak * relativeFloor).toFixed(2)}). Not an absolute 0.55 cosine cut. Inspect only.`
      );
      continue;
    }
    afterCliff.push(c);
  }
  const coordinating = /\band\b|\bshared by\b|\bboth\b|\bversus\b|\bvs\.?\b/.test(opts.query.toLowerCase());
  const exclusive = entityTermsInQuery(opts.query);
  if (exclusive.length === 1 && !coordinating) {
    const holding = afterCliff.filter((c) => {
      const doc = new Set(contentTokens(`${c.title}
${c.text}`));
      return exclusive.every((t) => tokenSetMatches(t, doc));
    });
    if (holding.length) {
      for (const c of afterCliff) {
        if (!holding.includes(c)) {
          dropReasons.set(
            c.chunkId,
            `Missing required entity term (${exclusive.join(", ")}). Inspect only.`
          );
        }
      }
      afterCliff.length = 0;
      afterCliff.push(...holding);
    }
  } else if (exclusive.length >= 1 && coordinating) {
    const holding = afterCliff.filter((c) => {
      const doc = new Set(contentTokens(`${c.title}
${c.text}`));
      return exclusive.some((t) => tokenSetMatches(t, doc)) || hasAny(doc, ["pool", "exhaustion", "stampede"]);
    });
    if (holding.length) {
      for (const c of afterCliff) {
        if (!holding.includes(c)) {
          dropReasons.set(
            c.chunkId,
            `No overlap with the named entities (${exclusive.join(", ")}). Inspect only.`
          );
        }
      }
      afterCliff.length = 0;
      afterCliff.push(...holding);
    }
  }
  const multi = queryLooksMultiSource(opts.query, afterCliff, opts.idf);
  const second = afterCliff[1];
  let pool = afterCliff;
  if (!multi && second && peak >= second.score * soloMargin) {
    for (const c of afterCliff.slice(1)) {
      if (c.slug === afterCliff[0].slug) continue;
      dropReasons.set(
        c.chunkId,
        `Rank-1 margin: ${peak.toFixed(2)} is \u2265 ${soloMargin}\xD7 stronger than ${second.score.toFixed(2)}. Only the top source packed.`
      );
    }
    pool = afterCliff.filter((c) => c.slug === afterCliff[0].slug).slice(0, 2);
    if (!pool.length) pool = [afterCliff[0]];
  }
  const packed = [];
  const seenText = /* @__PURE__ */ new Set();
  let used = 0;
  const cap = Math.min(3, opts.topK ?? 3);
  for (const chunk of pool) {
    if (packed.length >= cap) {
      dropReasons.set(chunk.chunkId, "Outside the packed context window (max 3 supported chunks).");
      continue;
    }
    const normalizedText = chunk.text.replace(/\s+/g, " ").trim();
    if (seenText.has(normalizedText)) {
      dropReasons.set(chunk.chunkId, "Duplicate passage. the same text is already packed.");
      continue;
    }
    if (used + chunk.tokenCount > maxTokens && packed.length) {
      const part = bestPassage(chunk, opts.query, opts.idf, maxTokens - used);
      if (part && !seenText.has(part.text.replace(/\s+/g, " ").trim())) {
        packed.push({ ...part, rank: packed.length + 1 });
        seenText.add(part.text.replace(/\s+/g, " ").trim());
        used += part.tokenCount;
        continue;
      }
      dropReasons.set(chunk.chunkId, "Outside the context token budget.");
      continue;
    }
    packed.push({ ...chunk, rank: packed.length + 1 });
    seenText.add(normalizedText);
    used += chunk.tokenCount;
  }
  return { packed, dropReasons };
}
var COVERAGE_POOL_SIZE = 8;
var COVERAGE_SECONDARY_FLOOR = 0.1;
function selectContextCoverage(ranked, signals, opts) {
  if (distinctiveTerms(opts.query).length === 0) {
    return { ...selectContext(ranked, signals, { ...opts, topK: 3 }), coverage: null };
  }
  const dropReasons = /* @__PURE__ */ new Map();
  const primary = /* @__PURE__ */ new Set();
  for (const c of ranked) {
    const sig = signals.get(c.chunkId);
    if (sig && isSupported(sig, c.score)) primary.add(c.chunkId);
    else
      dropReasons.set(
        c.chunkId,
        `Not supported on its own: calibrated ${c.score.toFixed(2)} failed the support gate (floor ${CONTEXT_ABSOLUTE_FLOOR}). Eligible only to cover a question term nothing else covers.`
      );
  }
  if (!primary.size) return { packed: [], dropReasons, coverage: null };
  let candidates = ranked.slice(0, COVERAGE_POOL_SIZE).filter(
    (c) => primary.has(c.chunkId) || c.score >= COVERAGE_SECONDARY_FLOOR
  );
  for (const c of ranked) if (primary.has(c.chunkId) && !candidates.includes(c)) candidates.push(c);
  if (opts.allowedSlugs) {
    for (const c of candidates)
      if (!opts.allowedSlugs.has(c.slug)) dropReasons.set(c.chunkId, `Document not accepted by the context gate (${c.slug}). Inspect only.`);
    candidates = candidates.filter((c) => opts.allowedSlugs.has(c.slug));
  }
  const coordinating = /\band\b|\bshared by\b|\bboth\b|\bversus\b|\bvs\.?\b/.test(opts.query.toLowerCase());
  const exclusive = entityTermsInQuery(opts.query);
  if (exclusive.length === 1 && !coordinating) {
    const holding = candidates.filter((c) => {
      const doc = new Set(contentTokens(`${c.title}
${c.text}`));
      return exclusive.every((t) => tokenSetMatches(t, doc));
    });
    if (holding.some((c) => primary.has(c.chunkId))) {
      for (const c of candidates)
        if (!holding.includes(c)) dropReasons.set(c.chunkId, `Missing required entity term (${exclusive.join(", ")}). Inspect only.`);
      candidates = holding;
    }
  }
  const { packed, report } = packByCoverage({
    pool: candidates,
    primary,
    terms: coverageTerms(opts.query),
    idf: opts.idf,
    budget: opts.maxTokens ?? CONTEXT_TOKEN_BUDGET,
    seed: opts.anchor ? [opts.anchor] : []
  });
  if (!packed.some((c) => primary.has(c.chunkId))) return { packed: [], dropReasons, coverage: report };
  const packedIds = new Set(packed.map((c) => c.chunkId));
  for (const c of candidates) {
    if (packedIds.has(c.chunkId)) dropReasons.delete(c.chunkId);
    else if (!dropReasons.has(c.chunkId) || primary.has(c.chunkId))
      dropReasons.set(
        c.chunkId,
        "Coverage packer: no paragraph added an uncovered question term or enough relevance per token within the context budget."
      );
  }
  return { packed, dropReasons, coverage: report };
}
var MIN_PASSAGE_TOKENS = 120;
function bestPassage(chunk, query, idf, room) {
  if (room < MIN_PASSAGE_TOKENS || !chunk.text || chunk.tokenCount <= 0) return null;
  const spans = [];
  for (let at = 0, m, re = /\n[^\S\n]*\n\s*/g; ; ) {
    m = re.exec(chunk.text);
    const end = m ? m.index : chunk.text.length;
    if (chunk.text.slice(at, end).trim()) spans.push([at, end]);
    if (!m) break;
    at = m.index + m[0].length;
  }
  const paras = spans.map(([a, b]) => chunk.text.slice(a, b));
  if (paras.length < 2) return null;
  const terms = [...new Set(distinctiveTerms(query))];
  if (!terms.length) return null;
  const perChar = chunk.tokenCount / Math.max(1, chunk.text.length);
  const cost = paras.map((p) => Math.ceil((p.length + 2) * perChar));
  const weight = paras.map((p) => {
    const doc = new Set(contentTokens(p));
    return terms.reduce((s, t) => tokenSetMatches(t, doc) ? s + (idf.get(t) ?? 1) : s, 0);
  });
  let best = -1;
  for (let i = 0; i < paras.length; i++)
    if (cost[i] <= room && (best < 0 || weight[i] > weight[best])) best = i;
  if (best < 0 || weight[best] <= 0) return null;
  let lo = best, hi = best, spent = cost[best];
  for (; ; ) {
    const left = lo > 0 && spent + cost[lo - 1] <= room ? weight[lo - 1] : -1;
    const right = hi < paras.length - 1 && spent + cost[hi + 1] <= room ? weight[hi + 1] : -1;
    if (left < 0 && right < 0) break;
    if (right >= left) spent += cost[++hi];
    else spent += cost[--lo];
  }
  const text = chunk.text.slice(spans[lo][0], spans[hi][1]);
  const tokenCount = estimateTokens(text);
  if (tokenCount > room) return null;
  if (tokenCount < MIN_PASSAGE_TOKENS) return null;
  return { ...chunk, text, tokenCount };
}
function payloadQuery(query) {
  if (!/ignore (the )?(indexed )?corpus|answer from memory|from your (own )?knowledge/i.test(query)) {
    return query;
  }
  const idx = query.lastIndexOf(":");
  if (idx >= 0 && idx < query.length - 3) {
    const rest = query.slice(idx + 1).trim();
    if (rest.length > 8) return rest;
  }
  return query;
}
function retrievalQuery(query, vocab) {
  const extra = expandTypos(contentTokens(query), vocab);
  if (!extra.length) return query;
  return `${query} ${extra.join(" ")}`;
}
function distinctiveTerms(query) {
  return contentTokens(query).filter(
    (t) => t.length >= 4 && !GENERIC_OPS_TERMS.has(t) && !QUERY_STOPWORDS.has(t)
  );
}

// web/src/lib/rag/query-focus.ts
var WORD = "[\\p{L}\\p{N}][\\p{L}\\p{N}-]*";
var SUBJECT_PREDICATES = [
  "produce",
  "create",
  "make",
  "generate",
  "form",
  "cause",
  "support",
  "handle",
  "store",
  "process",
  "use"
];
var SUBJECT_FOCUS = new RegExp(
  `\\bhow\\s+(?:does|did)\\s+(?:(?:a|an|the)\\s+)?(${WORD})\\s+(?:${SUBJECT_PREDICATES.join("|")})\\b`,
  "iu"
);
var OBJECT_FOCUS = new RegExp(
  `(?:^|[.!?]\\s+)(?:(?:tell|show|give)\\s+(?:me|us)|(?:explain|describe))\\s+(?:the|a|an)\\s+(${WORD}(?:\\s+${WORD}){0,2})(?=[.!?]|$)`,
  "giu"
);
function topicTerms(phrase) {
  return [...new Set(distinctiveTerms(phrase))];
}
function explicitFocusTerms(query) {
  const subject = SUBJECT_FOCUS.exec(query.trim());
  if (subject?.[1]) {
    const terms = topicTerms(subject[1]);
    return terms.length ? terms : null;
  }
  OBJECT_FOCUS.lastIndex = 0;
  const object = OBJECT_FOCUS.exec(query.trim());
  if (object?.[1]) {
    const terms = topicTerms(object[1]);
    return terms.length ? terms : null;
  }
  return null;
}
function missingExplicitFocusTerms(query, packedTokens) {
  const terms = explicitFocusTerms(query);
  if (!terms?.length) return [];
  return terms.filter((term) => !tokenSetMatches(term, packedTokens));
}

// web/src/lib/rag/evidence.ts
var MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
function extractQueryDates(query) {
  const forms = [];
  const monthAlt = MONTHS.join("|");
  const dmy = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthAlt})\\s+(\\d{4})\\b`, "gi");
  let m;
  while (m = dmy.exec(query)) {
    forms.push(dateForms(Number(m[1]), m[2].toLowerCase(), m[3]));
  }
  const mdy = new RegExp(`\\b(${monthAlt})\\s+(\\d{1,2})(?:st|nd|rd|th)?,??\\s+(\\d{4})\\b`, "gi");
  while (m = mdy.exec(query)) {
    forms.push(dateForms(Number(m[2]), m[1].toLowerCase(), m[3]));
  }
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  while (m = iso.exec(query)) {
    forms.push(dateForms(Number(m[3]), MONTHS[Number(m[2]) - 1] ?? "", m[1]));
  }
  return forms;
}
function dateForms(day, month, year) {
  if (!month) return [];
  const mm = String(MONTHS.indexOf(month) + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return [
    `${day} ${month} ${year}`,
    `${month} ${day}, ${year}`,
    `${month} ${day} ${year}`,
    `${year}-${mm}-${dd}`
  ];
}
function hasTerm(packedLower, term) {
  return new RegExp(`\\b${term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(packedLower);
}
var ABSENCE = /^(does|do|is|are|did)\b.+\b(recommend|mention|include|support|use|say|cover|describe)\b/i;
var ABSENCE_VERBS = /* @__PURE__ */ new Set([
  "recommend",
  "mention",
  "include",
  "support",
  "describe",
  "cover",
  "explain",
  "say",
  "use"
]);
var PACKED_DENSE_SUPPORT = 0.68;
function probeTermsNotInText(query, text) {
  const doc = new Set(contentTokens(text));
  return distinctiveTerms(query).filter(
    (t) => t.length >= 5 && !ABSENCE_VERBS.has(t) && !tokenSetMatches(t, doc)
  );
}
function queryChunkSupport(query, packed) {
  const supportQuery = payloadQuery(query);
  const terms = distinctiveTerms(supportQuery);
  const packedTokens = new Set(packed.flatMap((c) => contentTokens(`${c.title}
${c.text}`)));
  const hits = terms.filter((t) => tokenSetMatches(t, packedTokens));
  return {
    terms,
    hits,
    ratio: terms.length ? hits.length / terms.length : 0,
    packedTokens
  };
}
function looksLikeBypassInstruction(query) {
  return /ignore (the )?(indexed )?(corpus|sources?|documents?|runbook|readme)|answer from memory|from your (own )?knowledge|pretend (a )?source/i.test(
    query
  );
}
function gate(kind, note, extras = {}) {
  return {
    kind,
    note,
    supportTermCount: extras.supportTermCount ?? 0,
    supportHitCount: extras.supportHitCount ?? 0,
    packedTopDense: extras.packedTopDense ?? null,
    packedTopLexical: extras.packedTopLexical ?? 0,
    clearedForInsufficient: extras.clearedForInsufficient ?? false,
    denseRank1Slug: extras.denseRank1Slug ?? null,
    rerankRank1Slug: extras.rerankRank1Slug ?? null,
    denseRerankDisagree: extras.denseRerankDisagree ?? false,
    probe: extras.probe
  };
}
function classifyEvidence(opts) {
  const rerankRank1Slug = opts.ranked[0]?.slug ?? null;
  const denseRank1Slug = opts.denseRank1Slug ?? null;
  const disagree = Boolean(denseRank1Slug && rerankRank1Slug && denseRank1Slug !== rerankRank1Slug);
  const base = {
    denseRank1Slug,
    rerankRank1Slug,
    denseRerankDisagree: disagree
  };
  if (!opts.packed.length) {
    return gate(
      "insufficient",
      "No retrieved chunk passed the calibrated support gate. The corpus does not contain enough evidence.",
      base
    );
  }
  const packedText = opts.packed.map((c) => c.text).join("\n");
  const slugs = [...new Set(opts.packed.map((c) => c.slug))];
  const top = opts.packed[0];
  const second = opts.packed[1];
  const close = second && top.score > 0 ? second.score / top.score >= 0.78 && second.slug !== top.slug : false;
  const topSig = opts.signals.get(top.chunkId);
  const packedTopDense = topSig?.dense ?? null;
  const packedTopLexical = (topSig?.idfRecall ?? 0) + (topSig?.titleRecall ?? 0) + (topSig?.topical ?? 0);
  const support = queryChunkSupport(opts.query, opts.packed);
  const stats = {
    ...base,
    supportTermCount: support.terms.length,
    supportHitCount: support.hits.length,
    packedTopDense,
    packedTopLexical
  };
  const explicitFocusApplies = support.hits.length === 1 && (packedTopDense == null || packedTopDense < PACKED_DENSE_SUPPORT) || support.hits.length === 0 && packedTopDense == null;
  if (explicitFocusApplies) {
    const missingFocus = missingExplicitFocusTerms(opts.query, support.packedTokens);
    if (missingFocus.length) {
      return gate(
        "insufficient",
        "The question names an explicit focus that is absent from the packed passages; a single generic overlap does not establish an answer.",
        { ...stats, clearedForInsufficient: true }
      );
    }
  }
  const requestedCredentials = opts.query.match(/\b(?:passwords?|credentials?|api[ _-]?keys?|database_url|secrets?)\b/gi) ?? [];
  const missingCredentials = requestedCredentials.filter((term) => {
    const normalized = term.toLowerCase().replace(/[ _-]/g, "").replace(/s$/, "");
    return !packedText.toLowerCase().replace(/[ _-]/g, "").includes(normalized);
  });
  if (missingCredentials.length) {
    return gate("insufficient", "The requested credential field is not present in the retrieved passages; topic overlap does not establish its value.", { ...stats, clearedForInsufficient: true });
  }
  const packedLower = packedText.toLowerCase();
  const missingDates = extractQueryDates(opts.query).filter(
    (forms) => !forms.some((f) => packedLower.includes(f))
  );
  if (missingDates.length) {
    return gate("insufficient", "The question names a specific date that is not present in the retrieved passages; the passages do not establish date-bound events.", { ...stats, clearedForInsufficient: true });
  }
  const artifactIds = opts.query.match(/\b(?=\w*\d)(?=\w*[a-z])[a-z0-9]+(?:\.[a-z0-9]+)+\b/gi) ?? [];
  const missingArtifacts = artifactIds.filter((id) => !packedLower.includes(id.toLowerCase()));
  if (missingArtifacts.length) {
    return gate("insufficient", "The named artifact identifier is not present in the retrieved passages. Similar vocabulary does not answer this question.", { ...stats, clearedForInsufficient: true });
  }
  const requestedCommercial = opts.query.match(/\b(?:slas?|uptime|pricing|prices?|costs?|contractual|warrant(?:y|ies)|discounts?|refunds?|billing)\b/gi) ?? [];
  const missingCommercial = [...new Set(requestedCommercial.map((t) => t.toLowerCase()))].filter(
    (term) => !hasTerm(packedLower, term)
  );
  if (missingCommercial.length) {
    return gate("insufficient", "The requested commercial or contractual fact is not stated in the retrieved passages; topic overlap does not establish it.", { ...stats, clearedForInsufficient: true });
  }
  if (ABSENCE.test(opts.query.trim())) {
    const missing = probeTermsNotInText(opts.query, `${top.title}
${packedText}`);
    const relevantTitle = distinctiveTerms(opts.query).some(
      (t) => tokenSetMatches(t, new Set(contentTokens(top.title)))
    );
    if (relevantTitle && missing.length) {
      return gate(
        "negative_not_found",
        `The indexed source \u201C${top.title}\u201D was retrieved; ${missing.join(", ")} is not in that text.`,
        { ...stats, probe: missing[0] }
      );
    }
  }
  const identifiers = opts.query.match(/\b[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*\b/g) ?? [];
  const normalizedEvidence = packedText.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (identifiers.some((name) => !normalizedEvidence.includes(name.toLowerCase()))) {
    return gate("insufficient", "The named API is not present in the retrieved passages. Similar vocabulary from another library does not answer this question.", { ...stats, clearedForInsufficient: true });
  }
  if (!distinctiveTerms(opts.query).length) {
    return gate(
      "ambiguous",
      "The question has no distinctive entity. Several indexed sources may apply. do not treat one as the only answer.",
      stats
    );
  }
  const noOverlap = support.hits.length === 0;
  if (looksLikeBypassInstruction(opts.query) && (noOverlap || support.ratio < 0.5)) {
    return gate(
      "insufficient",
      "The question asks to skip the corpus or answer from memory, and packed chunks do not support the remaining question.",
      { ...stats, clearedForInsufficient: true }
    );
  }
  if (noOverlap && packedTopDense != null && packedTopDense < PACKED_DENSE_SUPPORT) {
    return gate(
      "insufficient",
      "Packed chunks have no distinctive overlap with the question and are not a strong dense match. Nearby unrelated documents are not evidence.",
      { ...stats, clearedForInsufficient: true }
    );
  }
  if (slugs.length >= 2 && close) {
    return gate(
      "ambiguous",
      "Several indexed sources are similarly relevant. Distinguish what each one actually states.",
      stats
    );
  }
  return gate("positive", "Packed chunks have distinctive overlap with the question or a strong dense match.", stats);
}

// web/src/lib/rag/bm25.ts
var BM25Index = class {
  k1 = 1.5;
  b = 0.75;
  ids = [];
  texts = [];
  tfs = [];
  lengths = [];
  avgLen = 0;
  df = /* @__PURE__ */ new Map();
  postings = /* @__PURE__ */ new Map();
  constructor(chunks) {
    for (const chunk of chunks) {
      const tokens = contentTokens(chunk.text);
      if (!tokens.length) continue;
      const i = this.ids.length;
      this.ids.push(chunk.id);
      this.texts.push(chunk.text);
      this.lengths.push(tokens.length);
      const tf = /* @__PURE__ */ new Map();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      this.tfs.push(tf);
      for (const term of tf.keys()) {
        this.df.set(term, (this.df.get(term) ?? 0) + 1);
        let list = this.postings.get(term);
        if (!list) this.postings.set(term, list = []);
        list.push(i);
      }
    }
    const n = this.ids.length;
    if (!n) return;
    this.avgLen = this.lengths.reduce((a, b) => a + b, 0) / n;
  }
  search(query, topK) {
    const q = contentTokens(query);
    if (!q.length || !this.ids.length) return [];
    const candidates = /* @__PURE__ */ new Set();
    for (const term of q) for (const i of this.postings.get(term) ?? []) candidates.add(i);
    const scored = [];
    for (const i of [...candidates].sort((a, b) => a - b)) {
      const score = this.score(q, this.tfs[i], this.lengths[i]);
      if (score > 0) scored.push({ i, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map(({ i, score }) => ({
      id: this.ids[i],
      text: this.texts[i],
      score
    }));
  }
  score(query, tf, len) {
    let score = 0;
    const n = this.ids.length;
    for (const term of query) {
      const df = this.df.get(term);
      if (!df) continue;
      const freq = tf.get(term) ?? 0;
      if (!freq) continue;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      const denom = freq + this.k1 * (1 - this.b + this.b * len / this.avgLen);
      score += idf * (freq * (this.k1 + 1) / denom);
    }
    return score;
  }
};

// web/src/lib/rag/trace.ts
var STOP = /* @__PURE__ */ new Set([
  "the",
  "and",
  "for",
  "you",
  "with",
  "from",
  "that",
  "this",
  "what",
  "how",
  "why",
  "are",
  "was",
  "were",
  "into",
  "your",
  "a",
  "an",
  "of",
  "to",
  "in",
  "on",
  "or",
  "do",
  "does",
  "is",
  "it",
  "as"
]);
function overlapTerms(query, text, limit = 5) {
  const q = tokenize(query).filter((t) => t.length > 2 && !STOP.has(t));
  const doc = new Set(tokenize(text));
  const hits = [];
  for (const t of q) {
    if (doc.has(t) && !hits.includes(t)) hits.push(t);
    if (hits.length >= limit) break;
  }
  return hits;
}

// web/src/lib/rag/experience.ts
var MAX_ASKED_PER_PASSAGE = 16;
var MAX_DREAMS_PER_PASSAGE = 3;
function trim(asked) {
  let dreams = asked.filter((a) => a.by === "dream");
  if (dreams.length > MAX_DREAMS_PER_PASSAGE) {
    const drop = new Set(dreams.slice(0, dreams.length - MAX_DREAMS_PER_PASSAGE));
    asked = asked.filter((a) => !drop.has(a));
  }
  while (asked.length > MAX_ASKED_PER_PASSAGE) {
    const i = asked.findIndex((a) => a.by === "dream");
    asked = i >= 0 ? asked.filter((_, j) => j !== i) : asked.slice(1);
  }
  return asked;
}
var DEFAULT_EXPERIENCE_POLICY = { boost: 0.25, boostFloor: 0.2, demoteBy: 0.12, demoteSimilarity: 0.5, fuse: true };
var emptyExperience = () => ({ version: 1, entries: {} });
function fingerprint(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
var keyOf = (corpusId, chunkId) => `${corpusId}\0${chunkId}`;
var normalize = (q) => q.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
function recordExperience(log, input) {
  const at = input.at ?? (/* @__PURE__ */ new Date()).toISOString();
  const entries = { ...log.entries };
  const nq = normalize(input.question);
  if (!nq) return log;
  for (const p of input.passages) {
    const key = keyOf(input.corpusId, p.chunkId);
    const fp = fingerprint(p.text);
    const prev = entries[key];
    let asked = prev && prev.fingerprint === fp ? prev.asked.filter((a) => normalize(a.q) !== nq) : [];
    if (!input.dream && input.vote < 0) {
      const qt = new Set(contentTokens(input.question));
      asked = asked.filter((a) => a.by !== "dream" || overlap(qt, new Set(contentTokens(a.q))) < 0.5);
    }
    if (input.dream && prev && prev.fingerprint === fp && prev.asked.some((a) => !a.by && normalize(a.q) === nq)) continue;
    asked.push(input.dream ? { q: input.question.trim(), vote: input.vote, at, by: "dream", strategy: input.dream.strategy } : { q: input.question.trim(), vote: input.vote, at });
    entries[key] = { corpusId: input.corpusId, chunkId: p.chunkId, fingerprint: fp, asked: trim(asked) };
  }
  return { version: 1, entries };
}
function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / Math.min(a.size, b.size);
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}
function recallExperience(log, corpusId, passages, question, policy = {}) {
  const expansions = /* @__PURE__ */ new Map();
  const demote = /* @__PURE__ */ new Map();
  const boost = /* @__PURE__ */ new Map();
  const learned = /* @__PURE__ */ new Map();
  if (!log) return { expansions, boost, learned, demote, used: 0 };
  const qTokens = new Set(contentTokens(question));
  const pol = { ...DEFAULT_EXPERIENCE_POLICY, ...policy };
  const threshold = pol.demoteSimilarity;
  const by = pol.demoteBy;
  let used = 0;
  for (const p of passages) {
    const e = log.entries[keyOf(corpusId, p.chunkId)];
    if (!e || e.fingerprint !== fingerprint(p.text)) continue;
    const positive = e.asked.filter((a) => a.vote > 0).map((a) => a.q);
    if (positive.length) {
      const scored = positive.map((q) => ({ q, sim: overlap(qTokens, new Set(contentTokens(q))) }));
      const alike = scored.filter((x) => x.sim >= pol.boostFloor);
      if (alike.length) {
        expansions.set(p.chunkId, alike.map((x) => x.q).join("\n"));
        used += alike.length;
        const near = e.asked.filter((a) => overlap(qTokens, new Set(contentTokens(a.q))) >= pol.boostFloor);
        const pos = near.filter((a) => a.vote > 0).length;
        const neg = near.length - pos;
        const reliability = (pos + 1) / (near.length + 2);
        const sim = Math.max(...alike.map((x) => x.sim));
        if (neg < pos) {
          boost.set(p.chunkId, pol.boost * sim * reliability);
          learned.set(p.chunkId, sim * reliability);
        }
      }
    }
    const deadSimilar = e.asked.some((a) => a.vote < 0 && jaccard(qTokens, new Set(contentTokens(a.q))) >= threshold);
    if (deadSimilar) demote.set(p.chunkId, by);
  }
  return { expansions, boost, learned, demote, used };
}

// web/src/lib/rag/dev-entities.ts
var EXT = "(?:py|pyi|ts|tsx|js|jsx|mjs|go|rs|java|kt|rb|php|c|h|cc|cpp|hpp|cs|swift|scala|md|rst|toml|ya?ml|json)";
var PATH_RE = new RegExp(`[\\w.\\-/\\\\]*[\\w\\-]+\\.${EXT}\\b`, "g");
var DOTTED_RE = /\b[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*){1,6}\b/g;
var CAMEL_RE = /\b[A-Z][a-z0-9]+(?:[A-Z][A-Za-z0-9]*)+\b|\b[A-Z]{2,}[a-z]\w*\b/g;
var SNAKE_RE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;
var CALL_RE = /\b([A-Za-z_]\w{2,})\s*\(/g;
var TICK_RE = /`([^`\n]{2,80})`/g;
var NOISE = /* @__PURE__ */ new Set(["self", "print", "len", "str", "int", "list", "dict", "set", "tuple", "type", "range", "isinstance", "super", "return", "import", "from", "assert", "lambda", "true", "false", "none", "null"]);
function devEntities(text) {
  const paths = /* @__PURE__ */ new Set(), modules = /* @__PURE__ */ new Set(), symbols = /* @__PURE__ */ new Set();
  for (const m of text.match(PATH_RE) ?? []) {
    const p = m.replace(/\\/g, "/").replace(/^.*?(?:site-packages|dist-packages|node_modules)\//, "").replace(/^\.?\//, "");
    if (p.split("/").pop().length > 3) paths.add(p);
  }
  const scrubbed = text.replace(PATH_RE, " ");
  for (const m of scrubbed.match(DOTTED_RE) ?? []) {
    const parts = m.split(".");
    if (parts.some((x) => x.length < 2) || /^\d/.test(parts[1])) continue;
    modules.add(m);
    symbols.add(parts.at(-1));
  }
  for (const re of [CAMEL_RE, SNAKE_RE]) for (const m of scrubbed.match(re) ?? []) symbols.add(m);
  for (const m of scrubbed.matchAll(CALL_RE)) symbols.add(m[1]);
  for (const m of text.matchAll(TICK_RE)) for (const w of m[1].match(/[A-Za-z_]\w{2,}/g) ?? []) if (/[A-Z_]/.test(w.slice(1)) || w.length > 5) symbols.add(w);
  return {
    paths: [...paths],
    modules: [...modules],
    symbols: [...symbols].filter((s) => s.length > 2 && !NOISE.has(s.toLowerCase()))
  };
}
var DEF_RE = /^[ \t]*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:def|class|function|interface|type|struct|enum|trait|fn|func|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
var DefinitionIndex = class {
  defs = /* @__PURE__ */ new Map();
  files = [];
  constructor(docs) {
    const seen = /* @__PURE__ */ new Set();
    for (const d of docs) {
      if (!seen.has(d.path)) {
        seen.add(d.path);
        this.files.push(d.path);
      }
      for (const m of d.text.matchAll(DEF_RE)) {
        const name = m[1];
        let s = this.defs.get(name);
        if (!s) this.defs.set(name, s = /* @__PURE__ */ new Set());
        s.add(d.path);
      }
    }
  }
  definedIn(name) {
    return [...this.defs.get(name) ?? []];
  }
  /**
   * Files the question's code points at, with a strength: a path it quotes
   * (3), a module path it names (2), a rarely defined name it uses (1, less
   * the more files define it). Names defined in many files say little.
   */
  link(e) {
    const score = /* @__PURE__ */ new Map();
    const add = (f, w) => score.set(f, (score.get(f) ?? 0) + w);
    for (const p of e.paths) {
      const tail = p.split("/").slice(-3).join("/");
      for (const f of this.files) if (f.endsWith(tail) || tail.split("/").length < 2 && f.endsWith("/" + tail)) add(f, 3);
    }
    for (const m of e.modules) {
      const parts = m.split(".");
      for (let cut = parts.length; cut >= 2; cut--) {
        const stem = parts.slice(0, cut).join("/");
        const hits = this.files.filter((f) => f.endsWith(`${stem}.py`) || f.endsWith(`${stem}/__init__.py`) || f.endsWith(`${stem}.ts`) || f.endsWith(`${stem}/index.ts`));
        if (hits.length) {
          for (const f of hits) add(f, cut === parts.length ? 2 : 1.5);
          break;
        }
      }
    }
    for (const s of e.symbols) {
      const where = this.definedIn(s);
      if (!where.length || where.length > 6) continue;
      for (const f of where) add(f, 1 / where.length);
    }
    return score;
  }
};

// web/src/lib/rag/retrieve-core.ts
var INDEX_CACHE = /* @__PURE__ */ new WeakMap();
var indexStats = { builds: 0, hits: 0 };
function fingerprint2(rows) {
  let h = 2166136261;
  for (const r of rows) {
    const s = r.chunk.id + (r.chunk.content_hash ?? "") + r.title;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return h >>> 0;
}
function indexFor(all, scoped, scopeKey) {
  let byScope = INDEX_CACHE.get(all);
  if (!byScope) INDEX_CACHE.set(all, byScope = /* @__PURE__ */ new Map());
  const fp = fingerprint2(scoped);
  const hit = byScope.get(scopeKey);
  if (hit && hit.fp === fp) {
    indexStats.hits++;
    return hit.index;
  }
  indexStats.builds++;
  const index = new BM25Index(scoped.map((r) => ({ id: r.chunk.id, text: `${r.title}
${r.chunk.text}` })));
  byScope.set(scopeKey, { fp, index });
  return index;
}
var DEF_CACHE = /* @__PURE__ */ new WeakMap();
function defsFor(all, scoped, scopeKey) {
  let byScope = DEF_CACHE.get(all);
  if (!byScope) DEF_CACHE.set(all, byScope = /* @__PURE__ */ new Map());
  const fp = fingerprint2(scoped);
  const hit = byScope.get(scopeKey);
  if (hit && hit.fp === fp) return hit.defs;
  const defs = new DefinitionIndex(scoped.filter((r) => r.chunk.chunk_kind === "code").map((r) => ({ path: r.slug, text: r.chunk.text })));
  byScope.set(scopeKey, { fp, defs });
  return defs;
}
function toRetrieved(chunkId, meta, score, rank, retriever) {
  const row = meta.get(chunkId);
  if (!row) return null;
  return {
    chunkId,
    documentId: row.chunk.document_id,
    slug: row.slug,
    title: row.title,
    text: row.chunk.text,
    heading: row.chunk.heading,
    score,
    rank,
    retriever,
    tokenCount: row.chunk.token_count,
    indexedAt: row.indexedAt,
    embeddingModel: row.chunk.embedding_model,
    filepath: row.chunk.filepath,
    language: row.chunk.language,
    symbol: row.chunk.symbol,
    chunkKind: row.chunk.chunk_kind ?? "prose",
    corpusId: row.corpusId || row.chunk.corpus_id || SEED_CORPUS_ID
  };
}
var DEFAULT_CONTEXT_PACKING = "rank";
function firstSlugRanks(chunks) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const c of chunks) {
    if (seen.has(c.slug)) continue;
    seen.add(c.slug);
    out.push({
      slug: c.slug,
      title: c.title,
      score: c.score,
      rank: out.length + 1,
      corpusId: c.corpusId
    });
  }
  return out;
}
function rankMap(chunks) {
  const map = /* @__PURE__ */ new Map();
  for (const c of chunks) {
    if (!map.has(c.chunkId)) map.set(c.chunkId, c.rank);
  }
  return map;
}
function retrieveFromRows(opts) {
  const scope = opts.corpusScope ?? { kind: "corpus", corpusId: SEED_CORPUS_ID };
  const scopedRows = scope.kind === "all" ? opts.rows : opts.rows.filter((r) => (r.corpusId || r.chunk.corpus_id || SEED_CORPUS_ID) === scope.corpusId);
  const meta = /* @__PURE__ */ new Map();
  for (const row of scopedRows) meta.set(row.chunk.id, row);
  const query = payloadQuery(opts.query);
  const experienceCorpus = scope.kind === "corpus" ? scope.corpusId : null;
  const recall = experienceCorpus && opts.experience ? recallExperience(opts.experience, experienceCorpus, scopedRows.map((r) => ({ chunkId: r.chunk.id, text: r.chunk.text })), query, opts.experiencePolicy) : null;
  const texts = scopedRows.map((r) => `${r.title}
${r.chunk.text}`);
  const idf = buildIdf(texts);
  const sourceVocab = corpusVocab(texts);
  let vocab = sourceVocab;
  if (recall?.expansions.size) {
    const learnedText = [...recall.expansions.values()];
    vocab = /* @__PURE__ */ new Set([...sourceVocab, ...corpusVocab(learnedText)]);
    const rarest = Math.max(0, ...idf.values());
    for (const t of vocab) if (!idf.has(t)) idf.set(t, rarest);
  }
  const cues = scope.kind === "corpus" && scope.corpusId === SEED_CORPUS_ID ? expandQueryCues(query) : [];
  const terms = [.../* @__PURE__ */ new Set([...queryTerms(query, vocab), ...cues])];
  const bm25Query = `${retrievalQuery(query, vocab)} ${cues.join(" ")}`.trim();
  const retrieveN = Math.min(80, Math.max(scopedRows.length, opts.topK * 4, 10));
  let dense = [];
  let keyword = [];
  const denseScores = /* @__PURE__ */ new Map();
  const keywordScores = /* @__PURE__ */ new Map();
  const expectedModel = opts.embeddingModel ?? EMBEDDING_MODEL;
  let compatible = 0;
  let modelMatch = true;
  const queryEmbeddingProduced = Boolean(opts.queryVector?.length);
  const denseWanted = opts.mode !== "keyword";
  let skippedReason = null;
  if (!opts.storage.denseAvailable && denseWanted) {
    skippedReason = "Durable embeddings are unavailable (ephemeral Vercel storage). Fell back to BM25.";
  } else if (denseWanted && !queryEmbeddingProduced) {
    skippedReason = "Query embedding was not produced. Fell back to BM25.";
  }
  const denseStart = performance.now();
  if (denseWanted && queryEmbeddingProduced && opts.storage.denseAvailable && opts.queryVector) {
    const scored = [];
    for (const row of scopedRows) {
      const model = row.chunk.embedding_model;
      if (model && model !== expectedModel) {
        modelMatch = false;
        continue;
      }
      const vec = parseEmbedding(row.chunk.embedding);
      if (!vec || vec.length !== opts.queryVector.length) continue;
      compatible += 1;
      scored.push({ id: row.chunk.id, score: cosineSimilarity(opts.queryVector, vec) });
    }
    if (!compatible) {
      skippedReason = "No stored vectors matched the query embedding model/dimension. Query embedding alone is not dense retrieval. Fell back to BM25.";
    } else {
      scored.sort((a, b) => b.score - a.score);
      for (const s of scored) denseScores.set(s.id, s.score);
      dense = scored.slice(0, retrieveN).map((s, i) => toRetrieved(s.id, meta, s.score, i + 1, "dense")).filter((c) => Boolean(c));
    }
  }
  const denseMs = performance.now() - denseStart;
  const kwStart = performance.now();
  if (opts.mode !== "dense" || !dense.length) {
    const index = indexFor(opts.rows, scopedRows, scope.kind === "all" ? "*" : scope.corpusId);
    const lexicalQuery = terms.join(" ") || bm25Query;
    const hits = index.search(lexicalQuery, retrieveN);
    for (const s of hits) keywordScores.set(s.id, s.score);
    keyword = hits.map((s, i) => toRetrieved(s.id, meta, s.score, i + 1, "keyword")).filter((c) => Boolean(c));
    if (scopedRows.length <= 80) {
      for (const row of scopedRows) {
        if (keywordScores.has(row.chunk.id)) continue;
        keywordScores.set(row.chunk.id, 0);
        const extra = toRetrieved(row.chunk.id, meta, 0, keyword.length + 1, "keyword");
        if (extra) keyword.push(extra);
      }
    }
  }
  if (recall?.expansions.size && (opts.experiencePolicy?.fuse ?? true)) {
    const learned = new BM25Index([...recall.expansions].map(([id, text]) => ({ id, text })));
    const hits = learned.search(terms.join(" ") || bm25Query, retrieveN);
    if (hits.length) {
      const rrf = /* @__PURE__ */ new Map();
      keyword.forEach((c, i) => rrf.set(c.chunkId, 1 / (RRF_K + i + 1)));
      hits.forEach((h, i) => rrf.set(h.id, (rrf.get(h.id) ?? 0) + 1 / (RRF_K + i + 1)));
      const byId = new Map(keyword.map((c) => [c.chunkId, c]));
      for (const h of hits) {
        if (byId.has(h.id)) continue;
        const extra = toRetrieved(h.id, meta, 0, 0, "keyword");
        if (extra) {
          byId.set(h.id, extra);
          if (!keywordScores.has(h.id)) keywordScores.set(h.id, 0);
        }
      }
      keyword = [...byId.values()].sort((a, b) => (rrf.get(b.chunkId) ?? 0) - (rrf.get(a.chunkId) ?? 0)).map((c, i) => ({ ...c, rank: i + 1 }));
    }
  }
  let codeLinks;
  if (opts.linkCode !== false && scope.kind === "corpus" && scope.corpusId !== SEED_CORPUS_ID && scopedRows.some((r) => r.chunk.chunk_kind === "code")) {
    const ents = devEntities(opts.query);
    if (ents.paths.length || ents.modules.length || ents.symbols.length) {
      const link = defsFor(opts.rows, scopedRows, scope.corpusId).link(ents);
      if (link.size) {
        codeLinks = new Map([...link].sort((a, b) => b[1] - a[1]).slice(0, 4));
        const have = new Set(keyword.map((c) => c.chunkId));
        for (const row of scopedRows) {
          if (!codeLinks.has(row.slug) || have.has(row.chunk.id)) continue;
          const extra = toRetrieved(row.chunk.id, meta, 0, keyword.length + 1, "keyword");
          if (extra) {
            keyword.push(extra);
            have.add(row.chunk.id);
            if (!keywordScores.has(row.chunk.id)) keywordScores.set(row.chunk.id, 0);
          }
        }
      }
    }
  }
  const keywordMs = performance.now() - kwStart;
  const useHybrid = Boolean(dense.length && keyword.length && opts.mode === "hybrid");
  const fusedPack = useHybrid ? rrfFuse(dense, keyword, retrieveN) : null;
  const fused = fusedPack?.fused ?? (dense.length && opts.mode === "dense" ? dense : keyword.length ? keyword : dense);
  const rerankStart = performance.now();
  const { ranked, scores: rerankScores, signals } = rerankCalibrated({
    query,
    candidates: fused,
    denseScores,
    keywordScores,
    idf,
    terms,
    preferredSlugs: opts.preferredSlugs,
    graphPathCosts: opts.graphPathCosts,
    expansions: recall?.expansions,
    demote: recall?.demote,
    learnedBoost: recall?.boost,
    learned: recall?.learned,
    codeLinks
  });
  const rerankMs = performance.now() - rerankStart;
  const assembleStart = performance.now();
  const packing = opts.packing ?? DEFAULT_CONTEXT_PACKING;
  const gateDecision = selectContext(ranked, signals, {
    query,
    idf,
    maxTokens: CONTEXT_TOKEN_BUDGET,
    topK: Math.min(opts.packingPolicy?.maxPassages ?? 3, opts.topK),
    relativeFloor: opts.packingPolicy?.relativeFloor,
    soloMargin: opts.packingPolicy?.soloMargin
  });
  const coverageDecision = packing === "coverage" && gateDecision.packed.length ? selectContextCoverage(ranked, signals, {
    query,
    idf,
    maxTokens: CONTEXT_TOKEN_BUDGET,
    anchor: gateDecision.packed[0]?.chunkId ?? null,
    allowedSlugs: new Set(gateDecision.packed.map((c) => c.slug))
  }) : null;
  const useCoverage = Boolean(coverageDecision?.packed.length);
  const packed = useCoverage ? coverageDecision.packed : gateDecision.packed;
  const dropReasons = useCoverage ? coverageDecision.dropReasons : gateDecision.dropReasons;
  const rawCoverage = useCoverage ? coverageDecision.coverage : packed.length ? coverageReportOf(packed, coverageTerms(query), idf, CONTEXT_TOKEN_BUDGET) : null;
  const coverage = rawCoverage && {
    ...rawCoverage,
    covered: rawCoverage.covered.map((t) => surfaceTerm(query, t)),
    missing: rawCoverage.missing.map((t) => surfaceTerm(query, t))
  };
  const assembleMs = performance.now() - assembleStart;
  const packedIds = new Set(packed.map((c) => c.chunkId));
  const denseSlugRanks = firstSlugRanks(dense);
  const classified = classifyEvidence({
    query,
    packed: gateDecision.packed,
    ranked,
    signals,
    denseRank1Slug: denseSlugRanks[0]?.slug ?? null
  });
  const absent = classified.kind === "positive" ? absentSubject(query, sourceVocab) : [];
  const evidence = absent.length ? { ...classified, kind: "insufficient", note: `The source never mentions ${absent.map((t) => `\u201C${t}\u201D`).join(", ")}, which the question is about.` } : classified;
  const gatedPacked = evidence.kind === "insufficient" ? [] : packed;
  const gatedIds = new Set(gatedPacked.map((c) => c.chunkId));
  if (evidence.kind === "insufficient") {
    for (const c of packed) {
      if (!dropReasons.has(c.chunkId)) {
        dropReasons.set(c.chunkId, evidence.note);
      }
    }
  }
  const denseRanks = rankMap(dense);
  const keywordRanks = rankMap(keyword);
  const fusedRanks = rankMap(fused);
  const candidates = ranked.slice(0, 12).map((c, i) => {
    const usedInContext = gatedIds.has(c.chunkId);
    return {
      ...c,
      rank: i + 1,
      scores: {
        dense: denseScores.has(c.chunkId) ? denseScores.get(c.chunkId) : null,
        keyword: keywordScores.has(c.chunkId) ? keywordScores.get(c.chunkId) : null,
        hybrid: fusedPack?.scores.has(c.chunkId) ? fusedPack.scores.get(c.chunkId) : null,
        rerank: rerankScores.get(c.chunkId) ?? c.score
      },
      usedInContext,
      cited: false,
      overlapTerms: overlapTerms(opts.query, c.text),
      dropReason: usedInContext ? void 0 : dropReasons.get(c.chunkId),
      ranks: {
        dense: denseRanks.get(c.chunkId) ?? null,
        keyword: keywordRanks.get(c.chunkId) ?? null,
        fused: fusedRanks.get(c.chunkId) ?? null,
        rerank: i + 1
      }
    };
  });
  const denseDiag = {
    queryEmbeddingProduced,
    compatibleStoredVectors: compatible,
    denseCandidatesProduced: dense.length,
    embeddingModelMatch: modelMatch,
    embeddingModelExpected: expectedModel,
    skippedReason
  };
  const resolvedMode = opts.mode === "hybrid" && dense.length ? "hybrid" : dense.length && opts.mode === "dense" ? "dense" : "keyword";
  const corpusId = scope.kind === "all" ? null : scope.corpusId;
  const evidenceGate = {
    ...evidence,
    clearedForInsufficient: evidence.kind === "insufficient" && packed.length > 0
  };
  return {
    chunks: gatedPacked,
    candidates,
    trace: {
      query: opts.query,
      mode: resolvedMode,
      candidateCount: fused.length,
      usedCount: gatedPacked.length,
      candidates,
      dense: denseDiag,
      evidence: evidence.kind,
      evidenceGate,
      storage: opts.storage,
      scoreSemantics: SCORE_SEMANTICS,
      corpusId,
      corpusScope: scope.kind,
      coverage: evidence.kind === "insufficient" ? null : coverage
    },
    denseMs,
    keywordMs,
    rerankMs,
    assembleMs,
    candidateCount: fused.length,
    contextTokens: gatedPacked.reduce((n, c) => n + c.tokenCount, 0),
    evidence: evidence.kind,
    evidenceNote: evidence.note,
    evidenceGate,
    probe: evidence.probe,
    dense: denseDiag,
    actualMode: resolvedMode,
    corpusId,
    corpusScope: scope.kind,
    coverage: evidence.kind === "insufficient" ? null : coverage,
    stages: {
      dense: denseSlugRanks,
      keyword: firstSlugRanks(keyword),
      fused: firstSlugRanks(fused),
      rerank: firstSlugRanks(ranked)
    }
  };
}

// web/src/lib/rag/session-intent.ts
var SWITCH = /^\s*(separately|unrelated|different (question|topic)|new (question|topic)|switching (topics?|gears)|on another note|another thing|changing (the )?subject)\b/i;
var FOLLOW_OPENERS = /^\s*(and|also|but|so|then|ok(ay)?|what about|how about|what if|why not|same for|instead|or)\b/i;
var DEICTIC = /\b(it|its|it's|that|this|these|those|they|them|their|there|then|one|ones|same|such|either|both)\b/i;
function ownTerms(query) {
  return [...new Set(distinctiveTerms(query.replace(SWITCH, " ")))];
}
function topicTerms2(query) {
  return [...new Set(contentTokens(query.replace(SWITCH, " ")).filter((t) => t.length >= 4))];
}
function carryable(term, idf, floor) {
  const v = rawIdf(term, idf);
  return v !== void 0 && v >= floor;
}
function rawIdf(term, idf) {
  const v = idf.get(term);
  return v === void 0 ? void 0 : GENERIC_OPS_TERMS.has(term) ? v / 0.2 : v;
}
function selfSufficient(own, idf) {
  const strong = own.filter((t) => (idf.get(t) ?? 0) >= 1.2);
  return strong.length >= 2;
}
function classifyTurn(query, history, idf) {
  if (!history.length) return "fresh";
  if (SWITCH.test(query)) return "switch";
  const own = ownTerms(query);
  const elliptical = FOLLOW_OPENERS.test(query) || DEICTIC.test(query) || own.length <= 2;
  if (elliptical) return "follow-up";
  const focus = new Set(history.flatMap((t) => topicTerms2(t.query)));
  const shared = own.filter((t) => focus.has(t)).length;
  if (shared > 0) return "related";
  return selfSufficient(own, idf) ? "switch" : "follow-up";
}
function sessionFocus(history, idf, opts = {}) {
  const decay = opts.decay ?? 0.55;
  const useFeedback = opts.feedback ?? true;
  const start = topicStart(history, idf);
  const focus = /* @__PURE__ */ new Map();
  const floor = idfFloor(idf);
  const add = (term, weight, from, age) => {
    if (QUERY_STOPWORDS.has(term) || weight <= 0 || !carryable(term, idf, floor)) return;
    const prev = focus.get(term);
    if (!prev || prev.weight < weight) focus.set(term, { term, weight: (prev?.weight ?? 0) * 0.5 + weight, from, age: prev ? Math.min(prev.age, age) : age });
  };
  const banned = /* @__PURE__ */ new Set();
  for (let i = history.length - 1; i >= start; i--) {
    const turn = history[i];
    const age = history.length - i;
    const w = decay ** (age - 1);
    if (!turn.refused) {
      const answered = new Set((turn.packed ?? []).flatMap((p) => contentTokens(`${p.heading ?? ""}
${p.text}`)));
      for (const t of topicTerms2(turn.query)) add(t, w * (answered.has(t) ? 1 : 0.25) * Math.sqrt(rawIdf(t, idf) ?? 1), "question", age);
    }
    const top = !turn.refused ? turn.packed?.[0] : void 0;
    if (top?.heading) for (const t of contentTokens(top.heading).filter((x) => x.length >= 4).slice(0, 2)) add(t, 0.5 * w * Math.sqrt(rawIdf(t, idf) ?? 1), "answer", age);
    if (useFeedback && turn.feedback && turn.packed) {
      for (const chunk of turn.packed) {
        const vote = turn.feedback[chunk.chunkId];
        if (!vote) continue;
        const terms = topTerms(chunk.text, idf, 6);
        if (vote > 0) for (const t of terms) add(t, 0.6 * w * Math.sqrt(rawIdf(t, idf) ?? 1), "feedback", age);
        else for (const t of terms) banned.add(t);
      }
    }
  }
  for (const t of banned) focus.delete(t);
  return focus;
}
function idfFloor(_idf) {
  return 0.2;
}
function topTerms(text, idf, k) {
  const tf = /* @__PURE__ */ new Map();
  for (const t of contentTokens(text)) if (t.length >= 4) tf.set(t, (tf.get(t) ?? 0) + 1);
  return [...tf].map(([t, f]) => ({ t, s: Math.log(1 + f) * (idf.get(t) ?? 0) })).sort((a, b) => b.s - a.s || (a.t < b.t ? -1 : 1)).slice(0, k).map((x) => x.t);
}
function topicStart(history, idf) {
  for (let i = history.length - 1; i > 0; i--) {
    if (classifyTurn(history[i].query, history.slice(0, i), idf) === "switch") return i;
  }
  return 0;
}
function planTurn(query, history, idf, opts = {}) {
  const own = ownTerms(query);
  const mode = classifyTurn(query, history, idf);
  if (mode === "fresh" || mode === "switch") {
    return { mode, resolved: query, carried: [], own, usedContext: false, why: mode === "switch" ? "New topic: searched on its own." : "First question: searched as asked." };
  }
  const from = topicStart(history, idf);
  const prior = history.slice(from).filter((t) => !t.refused);
  const window = mode === "related" ? prior.slice(-1) : prior;
  const focus = sessionFocus(history, idf, opts);
  const liked = [...focus.values()].filter((c) => c.from === "feedback").sort((a, b) => b.weight - a.weight).slice(0, 3).map((c) => c.term);
  const resolved = [...window.map((t) => t.query), query, ...liked].join(" ").trim();
  const ownSet = new Set(contentTokens(query));
  const carried = [...focus.values()].filter((c) => !ownSet.has(c.term)).sort((a, b) => b.weight - a.weight || (a.term < b.term ? -1 : 1)).slice(0, opts.maxCarried ?? 5);
  if (!window.length && !liked.length) return { mode, resolved: query, carried: [], own, usedContext: false, why: "Nothing earlier in the conversation to add." };
  const why = `${mode === "follow-up" ? "Read as a follow-up" : "Same topic"}: searched together with ${window.length === 1 ? "the previous question" : `the ${window.length} earlier questions on this topic`}${carried.length ? ` (about ${carried.slice(0, 3).map((c) => c.term).join(", ")})` : ""}.`;
  return { mode, resolved, carried, own, usedContext: true, why };
}
function ownTermsUncovered(own, packedTexts) {
  if (!own.length) return [];
  const words = new Set(packedTexts.flatMap((t) => contentTokens(t)));
  return own.filter((t) => !words.has(t));
}
function mustRefuse(plan, packedTexts) {
  if (!plan.usedContext || !packedTexts.length) return false;
  const missing = ownTermsUncovered(plan.own, packedTexts);
  return plan.own.length > 0 && missing.length === plan.own.length;
}

// mcp/src/engine.ts
import { existsSync, mkdirSync, readFileSync as readFileSync2, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join as join2 } from "node:path";
var HOME = process.env.INTELLIRAG_HOME || join2(homedir(), ".intellirag");
var experiences = /* @__PURE__ */ new Map();
var fileFor = (c) => join2(HOME, `experience-${c.origin.replace(/[^\w.-]+/g, "_").slice(-120)}.json`);
function experienceOf(c) {
  let log = experiences.get(c.id);
  if (!log) {
    try {
      log = existsSync(fileFor(c)) ? JSON.parse(readFileSync2(fileFor(c), "utf8")) : emptyExperience();
    } catch {
      log = emptyExperience();
    }
    experiences.set(c.id, log);
  }
  return log;
}
function saveExperience(c, log) {
  experiences.set(c.id, log);
  try {
    mkdirSync(HOME, { recursive: true });
    writeFileSync(fileFor(c), JSON.stringify(log));
  } catch {
  }
}
var STORAGE = { backend: "ephemeral", durable: false, denseAvailable: false, warning: null };
var idfCache = /* @__PURE__ */ new WeakMap();
var idfOf = (c) => {
  let v = idfCache.get(c);
  if (!v) idfCache.set(c, v = buildIdf(c.rows.map((r) => `${r.title}
${r.chunk.text}`)));
  return v;
};
var sessions = /* @__PURE__ */ new Map();
function sessionOf(id) {
  if (!id) return [];
  let s = sessions.get(id);
  if (!s) sessions.set(id, s = []);
  return s;
}
function resetSession(id) {
  sessions.delete(id);
}
function run(corpus, query, topK) {
  return retrieveFromRows({
    query,
    queryVector: null,
    mode: "keyword",
    topK,
    embeddingModel: null,
    rows: corpus.rows,
    storage: STORAGE,
    corpusScope: { kind: "corpus", corpusId: corpus.id },
    experience: experienceOf(corpus)
  });
}
var toPassage = (c) => ({
  ref: c.chunkId,
  file: c.filepath ?? c.slug,
  heading: c.heading,
  symbol: c.symbol ?? null,
  score: Number(c.score.toFixed(3)),
  text: c.text
});
function search(corpus, query, topK = 8) {
  const r = run(corpus, query, topK);
  const byId = new Map(corpus.rows.map((row) => [row.chunk.id, row]));
  return r.candidates.slice(0, topK).map((c) => {
    const row = byId.get(c.chunkId);
    return toPassage({ chunkId: c.chunkId, filepath: row?.chunk.filepath, slug: c.slug ?? row?.slug ?? "", heading: row?.chunk.heading ?? null, symbol: row?.chunk.symbol, score: c.score ?? 0, text: row?.chunk.text ?? "" });
  });
}
function ask(corpus, question, sessionId) {
  const history = sessionOf(sessionId);
  const plan = history.length ? planTurn(question, history, idfOf(corpus)) : null;
  const searched = plan?.usedContext ? plan.resolved : question;
  const r = run(corpus, searched, 5);
  let passages = r.chunks.map(toPassage);
  let refused = r.evidence === "insufficient" || passages.length === 0;
  let reason = refused ? "Nothing in this corpus passed the support gate for this question." : r.evidenceNote || "Supported passages, strongest first.";
  if (!refused && plan && mustRefuse(plan, passages.map((p) => `${p.heading ?? ""}
${p.text}`))) {
    refused = true;
    reason = `The conversation found passages, but none mention what this question asks (${plan.own.join(", ")}).`;
  }
  if (refused) passages = [];
  if (sessionId) {
    history.push({ query: question, refused, packed: passages.map((p) => ({ chunkId: p.ref, text: p.text, heading: p.heading })) });
    if (history.length > 12) history.splice(0, history.length - 12);
  }
  return {
    corpus: corpus.id,
    origin: corpus.origin,
    question,
    searched,
    reading: plan ? { mode: plan.mode, why: plan.why, about: plan.carried.map((c) => c.term) } : null,
    refused,
    reason,
    passages,
    coverage: r.coverage && !refused ? { covered: r.coverage.covered, missing: r.coverage.missing } : null
  };
}
function feedback(sessionId, ref, helpful, corpus, text) {
  const history = sessions.get(sessionId);
  const turn = history?.slice().reverse().find((t) => t.packed?.some((p) => p.chunkId === ref)) ?? history?.at(-1);
  if (!turn) return false;
  const passage = turn.packed?.find((p) => p.chunkId === ref);
  turn.feedback = { ...turn.feedback ?? {}, [ref]: helpful ? 1 : -1 };
  const body = passage?.text ?? text ?? corpus?.rows.find((r) => r.chunk.id === ref)?.chunk.text;
  if (corpus && body) {
    saveExperience(corpus, recordExperience(experienceOf(corpus), { corpusId: corpus.id, question: turn.query, passages: [{ chunkId: ref, text: body }], vote: helpful ? 1 : -1 }));
  }
  return true;
}

// mcp/src/server.ts
var VERSION = "0.1.0";
var PROTOCOL = "2025-06-18";
var corpora = /* @__PURE__ */ new Map();
var current = null;
var corpusArg = { type: "string", description: "Corpus id from index_folder or index_github. Defaults to the last one indexed." };
var TOOLS = [
  {
    name: "index_folder",
    description: "Index a folder on this machine (docs and source) so questions can be answered from it. Use the repository you are working in.",
    inputSchema: { type: "object", properties: { path: { type: "string", description: "Folder to index. Defaults to the server's working directory." }, include: { type: "string", enum: ["all", "docs"], description: "all: docs and source (default). docs: Markdown and text only." } } }
  },
  {
    name: "index_github",
    description: "Index a public GitHub repository pinned to one commit. Docs only by default; include all to add source files.",
    inputSchema: { type: "object", required: ["repo"], properties: { repo: { type: "string", description: "owner/repo" }, ref: { type: "string", description: "Branch, tag or commit. Default: the default branch's head." }, include: { type: "string", enum: ["docs", "all"] } } }
  },
  {
    name: "ask",
    description: "Supported evidence for a question, or a refusal when the corpus does not support an answer. Pass the same session for follow-ups: they are read with the earlier questions on their topic. Cite passages by file and heading; never answer past what they say.",
    inputSchema: { type: "object", required: ["question"], properties: { question: { type: "string" }, session: { type: "string", description: "Any stable id for this task's conversation." }, corpus: corpusArg } }
  },
  {
    name: "search",
    description: "Ranked candidate passages before the support gate, for exploring a corpus. Not evidence: use ask for anything you will state as fact.",
    inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" }, limit: { type: "number", minimum: 1, maximum: 20 }, corpus: corpusArg } }
  },
  {
    name: "feedback",
    description: "Mark a passage (from ask, or a search result that answered the session's last question) helpful or not. The corpus remembers it across sessions: later questions worded like this one find that passage.",
    inputSchema: { type: "object", required: ["session", "ref", "helpful"], properties: { session: { type: "string" }, ref: { type: "string", description: "A passage ref from ask." }, helpful: { type: "boolean" } } }
  },
  {
    name: "new_topic",
    description: "Forget a session's earlier questions, so the next one is searched on its own.",
    inputSchema: { type: "object", required: ["session"], properties: { session: { type: "string" } } }
  },
  {
    name: "sources",
    description: "The corpora indexed in this session: id, origin (path or owner/repo@sha), files and passages.",
    inputSchema: { type: "object", properties: {} }
  }
];
function pick(id) {
  const c = id ? corpora.get(id) : current;
  if (!c) throw new Error(id ? `No corpus "${id}". Call sources to list them.` : "Nothing indexed yet. Call index_folder or index_github first.");
  return c;
}
function keep(c) {
  corpora.set(c.id, c);
  current = c;
  return { corpus: c.id, origin: c.origin, files: c.files, passages: c.rows.length };
}
function render(answer) {
  const lines = [];
  if (answer.reading?.mode && answer.reading.mode !== "fresh") lines.push(`Reading: ${answer.reading.why}`);
  if (answer.refused) {
    lines.push(`REFUSED. ${answer.reason}`, "Say the source does not establish this. Do not answer from memory.");
  } else {
    lines.push(`${answer.passages.length} supported passage${answer.passages.length === 1 ? "" : "s"} from ${answer.origin}:`);
    for (const p of answer.passages) lines.push("", `[${p.ref}] ${p.file}${p.heading ? ` \u203A ${p.heading}` : ""}${p.symbol ? ` (${p.symbol})` : ""}`, p.text);
    if (answer.coverage?.missing.length) lines.push("", `Not mentioned in any passage: ${answer.coverage.missing.join(", ")}. Don't claim those parts.`);
  }
  return lines.join("\n");
}
async function call(name, a) {
  switch (name) {
    case "index_folder": {
      const r = keep(folderCorpus(resolve(a.path ?? process.cwd()), a.include ?? "all"));
      return { text: `Indexed ${r.files} files (${r.passages} passages) as ${r.corpus}.`, data: r };
    }
    case "index_github": {
      const r = keep(await githubCorpus(a.repo, { ref: a.ref, include: a.include, token: process.env.GITHUB_TOKEN }));
      return { text: `Indexed ${r.files} files (${r.passages} passages) from ${r.origin} as ${r.corpus}.`, data: r };
    }
    case "ask": {
      if (typeof a.question !== "string") throw new Error("Missing or invalid required argument: question (a string to answer from the corpus).");
      const r = ask(pick(a.corpus), a.question, a.session);
      return { text: render(r), data: r };
    }
    case "search": {
      if (typeof a.query !== "string") throw new Error("Missing or invalid required argument: query (a string to rank passages for).");
      const r = search(pick(a.corpus), a.query, Math.min(20, Math.max(1, Number(a.limit) || 8)));
      return { text: r.map((p) => `[${p.ref}] ${p.score} ${p.file}${p.heading ? ` \u203A ${p.heading}` : ""}`).join("\n") || "No candidates.", data: r };
    }
    case "feedback": {
      const ok = feedback(String(a.session), String(a.ref), Boolean(a.helpful), current ?? void 0);
      return { text: ok ? "Noted. Questions worded like this one will find that passage." : "Ask something in this session first.", data: { ok } };
    }
    case "new_topic": {
      resetSession(String(a.session));
      return { text: "The next question will be searched on its own.", data: { ok: true } };
    }
    case "sources": {
      const r = [...corpora.values()].map((c) => ({ corpus: c.id, origin: c.origin, files: c.files, passages: c.rows.length, current: c === current }));
      return { text: r.map((c) => `${c.current ? "*" : " "} ${c.corpus}  ${c.origin}  ${c.files} files`).join("\n") || "Nothing indexed yet.", data: r };
    }
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}
var send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
async function handle(msg) {
  const { id, method, params } = msg ?? {};
  if (id === void 0) return;
  try {
    if (method === "initialize") {
      return send({ jsonrpc: "2.0", id, result: {
        protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: "intellirag", version: VERSION },
        instructions: "Index a folder or a GitHub repo, then ask. Answers are supported passages or a refusal; cite them and never go past them. Reuse one session id per task so follow-ups are understood."
      } });
    }
    if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
    if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    if (method === "tools/call") {
      try {
        const out = await call(params?.name, params?.arguments ?? {});
        return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: out.text }], structuredContent: { result: out.data } } });
      } catch (e) {
        return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true } });
      }
    }
    return send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (e) {
    return send({ jsonrpc: "2.0", id, error: { code: -32603, message: e instanceof Error ? e.message : String(e) } });
  }
}
var chain = Promise.resolve();
var rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }
  chain = chain.then(() => handle(msg));
});
if (process.env.INTELLIRAG_INDEX) {
  try {
    keep(folderCorpus(resolve(process.env.INTELLIRAG_INDEX)));
  } catch {
  }
}
