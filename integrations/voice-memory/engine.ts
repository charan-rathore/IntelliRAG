import { contextReview } from "./context";
import { createHash, randomUUID } from "node:crypto";
import { parseText } from "../../../memorable/src/import/text/parse-text";
import {
  retrieveFromRows,
  type SearchRow,
} from "../../web/src/lib/rag/retrieve-core";
import { chunkDocument } from "../../web/src/lib/rag/chunking";
import { extractiveAnswer } from "../../web/src/lib/rag/extractive";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function importBundle(docs: Array<{ title: string; text: string }>) {
  if (!Array.isArray(docs) || !docs.length || docs.length > 10)
    throw Error("Add between 1 and 10 text documents.");
  const scope = "voice-" + randomUUID();
  const sources = docs.map((d) => {
    if (
      typeof d.title !== "string" ||
      typeof d.text !== "string" ||
      d.text.length < 40 ||
      d.text.length > 60000 ||
      d.title.length > 160
    )
      throw Error(
        "Each document needs a title and 40-60,000 characters of text.",
      );
    const text = d.text.replace(/\r\n?/g, "\n");
    const memory = parseText({ text, label: d.title });
    if (!memory.ok) throw Error("memoRABLE could not import this document.");
    return {
      id: randomUUID(),
      title: d.title,
      text,
      hash: hash(text),
      memory: memory.value,
    };
  });
  const rows: SearchRow[] = sources.flatMap((s) =>
    chunkDocument(s.text).map((c) => ({
      title: s.title,
      slug: s.id,
      indexedAt: null,
      corpusId: scope,
      chunk: {
        id: randomUUID(),
        document_id: s.id,
        ordinal: c.ordinal,
        text: c.text,
        token_count: c.tokenCount,
        heading: c.heading,
        embedding: null,
        embedding_model: null,
        content_hash: hash(c.text),
        created_at: new Date().toISOString(),
        filepath: null,
        language: null,
        symbol: null,
        chunk_kind: "prose",
        corpus_id: scope,
      },
    })),
  );
  return { scope, sources, rows };
}
export function validateEvidence(
  c: any,
  bundle: ReturnType<typeof importBundle>,
) {
  const source = bundle.sources.find((s) => s.id === c.sourceId);
  if (
    !source ||
    source.hash !== c.hash ||
    hash(source.text) !== c.hash ||
    !Number.isInteger(c.start) ||
    !Number.isInteger(c.end) ||
    c.start < 0 ||
    c.end <= c.start ||
    c.end > source.text.length ||
    source.text.slice(c.start, c.end) !== c.quote
  )
    throw Error("Source evidence does not match its original.");
  return true;
}
export function answer(
  question: string,
  bundle: ReturnType<typeof importBundle>,
) {
  if (
    typeof question !== "string" ||
    !question.trim() ||
    question.length > 4000
  )
    throw Error("Ask a question of 1-4,000 characters.");
  const start = performance.now();
  const found = retrieveFromRows({
    query: question,
    queryVector: null,
    mode: "keyword",
    topK: 3,
    embeddingModel: null,
    rows: bundle.rows,
    storage: {
      backend: "ephemeral",
      durable: false,
      denseAvailable: false,
      warning: null,
    },
    corpusScope: { kind: "corpus", corpusId: bundle.scope },
  });
  const evidence = found.chunks.flatMap((chunk) => {
    const source = bundle.sources.find((s) => s.id === chunk.documentId);
    if (!source) return [];
    const offset = source.text.indexOf(chunk.text);
    if (offset < 0 || source.text.indexOf(chunk.text, offset + 1) !== -1)
      return [];
    const c = {
      sourceId: source.id,
      title: source.title,
      hash: source.hash,
      start: offset,
      end: offset + chunk.text.length,
      firstLine: source.text.slice(0, offset).split("\n").length,
      lastLine: source.text.slice(0, offset + chunk.text.length).split("\n")
        .length,
      quote: chunk.text,
    };
    validateEvidence(c, bundle);
    return [c];
  });
  const chunks = found.chunks.filter((c) =>
    evidence.some((e) => e.sourceId === c.documentId && e.quote === c.text),
  );
  const refused =
    found.evidence === "insufficient" ||
    found.evidence === "negative_not_found" ||
    !chunks.length;
  return {
    question,
    context: contextReview(bundle, validateEvidence),
    answer: refused
      ? "I could not find supporting passages in these documents."
      : extractiveAnswer(question, chunks).replace(
          " Add a model in Settings to reason across them.",
          "",
        ),
    evidence: refused ? [] : evidence,
    refused,
    evidenceStatus: found.evidence,
    mode: "Local keyword retrieval + source excerpts. No generated synthesis.",
    latencyMs: Math.round(performance.now() - start),
  };
}
export function draft(
  result: ReturnType<typeof answer>,
  bundle: ReturnType<typeof importBundle>,
) {
  if (result.refused || !result.evidence.length)
    throw Error("Find supporting evidence before creating a draft.");
  result.evidence.forEach((c) => validateEvidence(c, bundle));
  const review = contextReview(bundle, validateEvidence);
  const refs = new Map<string, number>();
  const quote = (e: any) => {
    validateEvidence(e, bundle);
    const key = e.sourceId + ":" + e.start;
    if (!refs.has(key)) refs.set(key, refs.size + 1);
    return `"${e.quote}" [${refs.get(key)}: ${e.title}, line ${e.firstLine}]`;
  };
  const section = (name: string, items: any[]) =>
    items.length ? name + "\n" + items.map(quote).join("\n") + "\n\n" : "";
  const body =
    "Hi,\n\nBefore our next conversation, I would like to align on: " +
    result.question +
    "\n\n" +
    section(
      "Changes mentioned in the record (not independently confirmed as current)",
      review.groups.changes,
    ) +
    section("Open items that need an update", review.groups.open) +
    section("Conditions that must not be dropped", review.groups.conditions) +
    section(
      "Decision statements to reconcile (includes proposals and refusals)",
      review.groups.decisions,
    ) +
    (refs.size ? "" : section("Relevant source evidence", result.evidence)) +
    "Could you confirm which decision statements are current and authoritative, and the owner and next update for each unresolved item? If a later decision superseded one above, please point us to that record.\n\n" +
    "Suggested next step for review: reconcile any conflicting decision statements and satisfy the recorded conditions before communicating an unconditional commitment.\n\nThanks";
  return {
    subject:
      "Confirm decisions and open items: " + result.question.slice(0, 90),
    body,
    notice:
      "Rule-based review draft across all imported documents. May include off-topic signals. Check relevance, chronology, authority and recipients. Nothing sent.",
  };
}
