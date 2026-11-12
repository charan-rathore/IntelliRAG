import type { Citation } from "../rag/types";
import { locateExactText, recoverExactText, type Claim, type EvidenceSpan, type SourceVersion } from "./contracts.ts";

/**
 * Citation → canonical EvidenceSpan, or null when the source does not contain it.
 * Citation offsets point into the packed chunk, not the document, so the span
 * is located by its text in the source version's body.
 */
export function citationToSpan(
  citation: Pick<Citation, "chunkId" | "textSnippet">,
  source: { version: SourceVersion; body: string },
): EvidenceSpan | null {
  const exact = recoverExactText(source.body, citation.textSnippet);
  if (!exact) return null;
  const found = locateExactText(source.body, exact);
  if (!found) return null;
  return {
    id: `span_${source.version.id}_${found.offset.start}_${found.offset.end}`,
    sourceVersionId: source.version.id,
    locator: found.lines,
    exactText: exact,
    extractionMethod: "text",
    confidence: 1,
  };
}

/** One answer sentence → a Claim whose status follows the evidence it actually has. */
export function answerSentenceClaim(input: {
  id: string;
  workspaceId: string;
  text: string;
  version: SourceVersion;
  spans: Array<EvidenceSpan | null>;
}): Claim {
  const resolved = input.spans.filter((s): s is EvidenceSpan => s !== null);
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    sourceVersionId: input.version.id,
    evidenceSpanIds: resolved.map((s) => s.id),
    type: "answer-sentence",
    text: input.text,
    status:
      resolved.length === 0 ? "unsupported" : resolved.length < input.spans.length ? "needs_review" : "supported",
    authoredBy: "model",
  };
}
