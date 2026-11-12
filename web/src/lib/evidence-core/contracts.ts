/**
 * Evidence Core contracts · evidence-core/1
 *
 * ONE FILE, TWO REPOSITORIES. This file is vendored byte-for-byte into
 * memoRABLE (src/evidence-core/contracts.ts) and IntelliRAG
 * (web/src/lib/evidence-core/contracts.ts). Each repo's tests hash it and
 * compare against the shared fixture, so a change in one place fails CI until
 * it is copied to the other. See docs/adr/001-evidence-core.md.
 *
 * No imports, no runtime dependencies: both apps can load it unchanged.
 */

export const CONTRACT_VERSION = "evidence-core/1" as const;

/* ───────────────────────────── identities ───────────────────────────── */

/** Immutable. New ingestion creates a new version; it never mutates old output. */
export type SourceVersion = {
  id: string;
  workspaceId: string;
  sourceId: string;
  /** Lowercase hex SHA-256 of the exact bytes read. */
  contentHash: string;
  /** Parser/chunker that produced the readable text, e.g. "memorable-local@3". */
  parserVersion: string;
  /** Where the original bytes live: object storage URI, git blob URL, or "inline:". */
  storageUri: string;
  createdAt: string;
  /** Pages or regions the reader could not read. Visible state, never hidden. */
  unreadable?: Array<{ page?: number; reason: string }>;
};

/** How a span was located inside one SourceVersion. */
export type EvidenceLocator =
  | { kind: "lines"; start: number; end: number }
  | { kind: "page"; page: number; start?: number; end?: number }
  | { kind: "offset"; start: number; end: number }
  | { kind: "json-path"; path: string };

export type ExtractionMethod = "text" | "structured" | "ocr" | "model";

/** Every user-visible claim and citation resolves to exactly one of these. */
export type EvidenceSpan = {
  id: string;
  sourceVersionId: string;
  locator: EvidenceLocator;
  /** The exact characters read from the source version. Never paraphrased. */
  exactText: string;
  extractionMethod: ExtractionMethod;
  /** 0–1. Reader confidence for OCR/model extraction; 1 for exact text. */
  confidence: number;
};

/**
 * - supported:    stated by the source, exact-text evidence
 * - inferred:     drawn from the source by a parser or model, not stated verbatim
 * - needs_review: evidence exists but is weak (OCR, low confidence, changed on refine)
 * - unsupported:  no evidence; may only render as "not established"
 */
export type ClaimStatus = "supported" | "inferred" | "needs_review" | "unsupported";
export type ClaimAuthor = "source" | "parser" | "model" | "person";

export type Claim = {
  id: string;
  workspaceId: string;
  sourceVersionId: string;
  evidenceSpanIds: string[];
  /** Product-specific kind: a memoRABLE block kind, or "answer-sentence". */
  type: string;
  text: string;
  status: ClaimStatus;
  authoredBy: ClaimAuthor;
};

export type AnswerTrace = {
  id: string;
  workspaceId: string;
  corpusId: string;
  sourceVersionIds: string[];
  policyVersion: string;
  modelVersion: string;
  /** Evidence span ids, in citation order. */
  citations: string[];
  outcome: "answered" | "refused" | "extractive";
  costUsd: number;
  latencyMs: number;
  /** When present, must equal answerCacheKey(this). */
  cacheKey?: string;
};

export type EvidencePackage = {
  contractVersion: typeof CONTRACT_VERSION;
  workspaceId: string;
  sourceVersions: SourceVersion[];
  spans: EvidenceSpan[];
  claims: Claim[];
  answers: AnswerTrace[];
};

/**
 * Find `exactText` in a source body and return a line locator (1-based,
 * inclusive) plus UTF-16 offsets. Returns null when the text is absent:
 * a citation that cannot be found in its source version is not evidence.
 * Line endings are normalised so CRLF sources resolve the same as LF.
 */
export function locateExactText(
  body: string,
  exactText: string,
): { lines: { kind: "lines"; start: number; end: number }; offset: { kind: "offset"; start: number; end: number }; occurrences: number } | null {
  const src = body.replace(/\r\n?/g, "\n");
  const needle = exactText.replace(/\r\n?/g, "\n");
  if (!needle.trim()) return null;
  const start = src.indexOf(needle);
  if (start < 0) return null;
  let occurrences = 0;
  for (let at = start; at >= 0; at = src.indexOf(needle, at + 1)) occurrences += 1;
  const end = start + needle.length;
  const lineAt = (i: number) => src.slice(0, i).split("\n").length;
  return {
    lines: { kind: "lines", start: lineAt(start), end: lineAt(end - 1) },
    offset: { kind: "offset", start, end },
    occurrences,
  };
}

/**
 * Recover the source's own characters for a quoted passage.
 *
 * Both products store display excerpts that are whitespace-collapsed and may
 * be truncated with "…" (memoRABLE provenance excerpts, IntelliRAG citation
 * snippets). This matches the quoted words in order, tolerant only of
 * whitespace, and returns the body's exact substring, so a span still quotes
 * the source verbatim. Null means the source does not contain the passage.
 */
export function recoverExactText(body: string, quoted: string): string | null {
  const words = quoted.replace(/…$/u, "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(words.map(esc).join("\\s+")).exec(body.replace(/\r\n?/g, "\n"));
  return match ? match[0] : null;
}

/* ───────────────────────────── invariants ───────────────────────────── */

export type ContractIssue = { path: string; rule: string; message: string };

const HEX64 = /^[0-9a-f]{64}$/;

function locatorIssue(l: EvidenceLocator): string | null {
  const int = (n: unknown) => typeof n === "number" && Number.isInteger(n);
  switch (l.kind) {
    case "lines":
      return int(l.start) && int(l.end) && l.start >= 1 && l.end >= l.start ? null : "line range must be 1-based and ordered";
    case "page":
      if (!int(l.page) || l.page < 1) return "page must be ≥ 1";
      if ((l.start === undefined) !== (l.end === undefined)) return "page offsets come in pairs";
      return l.start === undefined || (int(l.start) && int(l.end) && l.start >= 0 && (l.end as number) > l.start) ? null : "page offsets must be ordered";
    case "offset":
      return int(l.start) && int(l.end) && l.start >= 0 && l.end > l.start ? null : "offsets must be ordered and non-empty";
    case "json-path":
      return typeof l.path === "string" && l.path.length > 0 ? null : "json path is empty";
    default:
      return "unknown locator kind";
  }
}

/**
 * Cached answers are valid only for the same workspace, corpus, source
 * versions and policy/model variant. Order-insensitive in source versions.
 */
export function answerCacheKey(t: Pick<AnswerTrace, "workspaceId" | "corpusId" | "sourceVersionIds" | "policyVersion" | "modelVersion">): string {
  return [
    CONTRACT_VERSION,
    `ws=${t.workspaceId}`,
    `corpus=${t.corpusId}`,
    `src=${[...t.sourceVersionIds].sort().join(",")}`,
    `policy=${t.policyVersion}`,
    `model=${t.modelVersion}`,
  ].join("|");
}

/** All invariants at once. An empty array means the package may be rendered. */
export function validateEvidencePackage(pkg: EvidencePackage): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const add = (path: string, rule: string, message: string) => issues.push({ path, rule, message });

  if (pkg.contractVersion !== CONTRACT_VERSION)
    add("contractVersion", "version", `expected ${CONTRACT_VERSION}`);

  const versions = new Map<string, SourceVersion>();
  pkg.sourceVersions.forEach((v, i) => {
    const p = `sourceVersions[${i}]`;
    if (versions.has(v.id)) add(p, "unique-id", `duplicate source version ${v.id}`);
    versions.set(v.id, v);
    if (v.workspaceId !== pkg.workspaceId) add(p, "workspace", "source version belongs to another workspace");
    if (!HEX64.test(v.contentHash)) add(p, "content-hash", "contentHash must be lowercase hex SHA-256");
    if (!v.parserVersion) add(p, "parser-version", "parserVersion is required");
    if (!v.storageUri) add(p, "storage-uri", "storageUri is required");
  });

  const spans = new Map<string, EvidenceSpan>();
  pkg.spans.forEach((s, i) => {
    const p = `spans[${i}]`;
    if (spans.has(s.id)) add(p, "unique-id", `duplicate span ${s.id}`);
    spans.set(s.id, s);
    if (!versions.has(s.sourceVersionId)) add(p, "span-version", `span points at unknown source version ${s.sourceVersionId}`);
    if (!s.exactText || !s.exactText.trim()) add(p, "exact-text", "a span must carry the exact text it cites");
    const loc = locatorIssue(s.locator);
    if (loc) add(`${p}.locator`, "locator", loc);
    if (!(s.confidence >= 0 && s.confidence <= 1)) add(p, "confidence", "confidence must be within 0–1");
  });

  pkg.claims.forEach((c, i) => {
    const p = `claims[${i}]`;
    if (c.workspaceId !== pkg.workspaceId) add(p, "workspace", "claim belongs to another workspace");
    if (!versions.has(c.sourceVersionId)) add(p, "claim-version", "claim points at unknown source version");
    const own = c.evidenceSpanIds.map((id) => spans.get(id));
    if (own.some((s) => !s)) add(p, "claim-span", "claim cites a span that does not exist");
    if (own.some((s) => s && s.sourceVersionId !== c.sourceVersionId))
      add(p, "claim-span-version", "claim cites a span from a different source version");
    if (c.status !== "unsupported" && c.evidenceSpanIds.length === 0)
      add(p, "provenance", "only an unsupported claim may have no evidence");
    if (c.status === "unsupported" && c.evidenceSpanIds.length > 0)
      add(p, "provenance", "a claim with evidence is not unsupported; mark it needs_review instead");
    const weak = own.some((s) => s && (s.extractionMethod === "ocr" || s.confidence < 0.8));
    if (c.status === "supported" && weak)
      add(p, "weak-evidence", "OCR or low-confidence evidence must surface as needs_review, never as plain fact");
    if (c.status === "supported" && own.length > 0 && own.every((s) => s && s.extractionMethod === "model"))
      add(p, "model-evidence", "model-extracted text alone cannot make a claim supported");
  });

  pkg.answers.forEach((a, i) => {
    const p = `answers[${i}]`;
    if (a.workspaceId !== pkg.workspaceId) add(p, "workspace", "answer belongs to another workspace");
    for (const id of a.sourceVersionIds)
      if (!versions.has(id)) add(p, "answer-version", `answer depends on unknown source version ${id}`);
    a.citations.forEach((id, j) => {
      const s = spans.get(id);
      if (!s) add(`${p}.citations[${j}]`, "citation-span", `citation ${id} does not resolve to a span`);
      else if (!a.sourceVersionIds.includes(s.sourceVersionId))
        add(`${p}.citations[${j}]`, "citation-version", "citation comes from a source version the answer does not declare");
    });
    if (a.outcome === "answered" && a.citations.length === 0)
      add(p, "grounding", "an answered outcome must cite evidence; otherwise it is refused or extractive");
    if (a.cacheKey !== undefined && a.cacheKey !== answerCacheKey(a))
      add(p, "cache-key", "cache key does not bind workspace, corpus, source versions, policy and model");
  });

  return issues;
}
