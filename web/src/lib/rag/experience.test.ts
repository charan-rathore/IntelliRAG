import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chunkDocument } from "./chunking.ts";
import { retrieveFromRows, type SearchRow } from "./retrieve-core.ts";
import { emptyExperience, fingerprint, lintExperience, recallExperience, recordExperience, MAX_ASKED_PER_PASSAGE } from "./experience.ts";

const P = { chunkId: "readme#3", text: "Put queue execution on hold. Start (or resume) executing enqueued tasks within concurrency limit." };

describe("filing rated answers", () => {
  it("attaches the question's wording to the passages it was answered from", () => {
    const log = recordExperience(emptyExperience(), { corpusId: "c", question: "hold jobs back and release them later", passages: [P], vote: 1 });
    const r = recallExperience(log, "c", [P], "release held jobs later");
    assert.match(r.expansions.get(P.chunkId) ?? "", /hold jobs back/);
    assert.ok((r.boost.get(P.chunkId) ?? 0) > 0);
  });

  it("lets the latest rating of a wording win", () => {
    let log = recordExperience(emptyExperience(), { corpusId: "c", question: "hold jobs back", passages: [P], vote: 1 });
    log = recordExperience(log, { corpusId: "c", question: "Hold  jobs back", passages: [P], vote: -1 });
    const e = Object.values(log.entries)[0]!;
    assert.equal(e.asked.length, 1);
    assert.equal(e.asked[0]!.vote, -1);
    assert.equal(recallExperience(log, "c", [P], "hold jobs back").expansions.size, 0);
  });

  it("demotes a passage for questions like one rated a dead end on it", () => {
    const log = recordExperience(emptyExperience(), { corpusId: "c", question: "how do I pause the queue forever", passages: [P], vote: -1 });
    assert.ok((recallExperience(log, "c", [P], "how do I pause the queue forever?").demote.get(P.chunkId) ?? 0) > 0);
    assert.equal(recallExperience(log, "c", [P], "what is the default concurrency").demote.size, 0);
  });

  it("keeps a bounded number of wordings per passage", () => {
    let log = emptyExperience();
    for (let i = 0; i < MAX_ASKED_PER_PASSAGE + 5; i++) log = recordExperience(log, { corpusId: "c", question: `question ${i}`, passages: [P], vote: 1 });
    assert.equal(Object.values(log.entries)[0]!.asked.length, MAX_ASKED_PER_PASSAGE);
  });

  it("keeps corpora apart", () => {
    const log = recordExperience(emptyExperience(), { corpusId: "a", question: "hold jobs back", passages: [P], vote: 1 });
    assert.equal(recallExperience(log, "b", [P], "hold jobs back").expansions.size, 0);
  });
});

describe("staleness", () => {
  it("stops using a link once the passage text changes", () => {
    const log = recordExperience(emptyExperience(), { corpusId: "c", question: "hold jobs back", passages: [P], vote: 1 });
    const edited = { ...P, text: P.text + " Changed." };
    assert.equal(recallExperience(log, "c", [edited], "hold jobs back").expansions.size, 0);
    assert.notEqual(fingerprint(P.text), fingerprint(edited.text));
  });

  it("drops stale links and lists contested passages in a lint pass", () => {
    let log = recordExperience(emptyExperience(), { corpusId: "c", question: "hold jobs back", passages: [P], vote: 1 });
    log = recordExperience(log, { corpusId: "c", question: "pause forever", passages: [P], vote: -1 });
    log = recordExperience(log, { corpusId: "c", question: "gone", passages: [{ chunkId: "old#1", text: "removed" }], vote: 1 });
    const report = lintExperience(log, [{ corpusId: "c", ...P }]);
    assert.equal(report.stale, 1);
    assert.deepEqual(report.contested, [P.chunkId]);
    assert.equal(Object.keys(report.log.entries).length, 1);
  });
});

describe("retrieval with experience", () => {
  const body = "# queue\n\n## Pausing\n\nPut queue execution on hold. Start (or resume) executing enqueued tasks within concurrency limit.\n\n## Concurrency\n\nConcurrency limit. Minimum 1. Default Infinity.\n\n## Timeouts\n\nPer-operation timeout in milliseconds. Operations fail with a TimeoutError.";
  const rows = chunkDocument(body, { filepath: "readme.md", chunkSize: 40 }).map((c) => ({ title: "queue README", slug: "queue", indexedAt: null, corpusId: "t",
    chunk: { id: `q:${c.ordinal}`, document_id: "queue", ordinal: c.ordinal, text: c.text, token_count: c.tokenCount, heading: c.heading, embedding: null, embedding_model: null,
      content_hash: String(c.ordinal), created_at: "", filepath: c.filepath, language: c.language, symbol: c.symbol, chunk_kind: c.chunkKind, corpus_id: "t" } })) as SearchRow[];
  const ask = (query: string, experience: ReturnType<typeof emptyExperience> | null) => retrieveFromRows({ query, queryVector: null, mode: "keyword", topK: 5, embeddingModel: null, rows,
    corpusScope: { kind: "corpus", corpusId: "t" }, storage: { backend: "ephemeral", durable: false, denseAvailable: false, warning: null } as never, experience });
  const pausing = rows.find((r) => r.chunk.text.includes("on hold"))!;

  it("finds a passage through wording people confirmed for it", () => {
    const q = "freeze my jobs and let them go later";
    assert.ok(!ask(q, null).chunks.some((c) => c.chunkId === pausing.chunk.id));
    const log = recordExperience(emptyExperience(), { corpusId: "t", question: "freeze jobs then let them go", passages: [{ chunkId: pausing.chunk.id, text: pausing.chunk.text }], vote: 1 });
    assert.equal(ask(q, log).chunks[0]?.chunkId, pausing.chunk.id);
  });

  it("can't make a question about something the source never names look answered", () => {
    const log = recordExperience(emptyExperience(), { corpusId: "t", question: "pause Kubernetes jobs", passages: [{ chunkId: pausing.chunk.id, text: pausing.chunk.text }], vote: 1 });
    const r = ask("How do I pause Kubernetes jobs?", log);
    assert.equal(r.evidence, "insufficient");
    assert.equal(r.chunks.length, 0);
  });

  it("changes nothing when there is no experience", () => {
    const a = ask("What is the default concurrency?", null), b = ask("What is the default concurrency?", emptyExperience());
    assert.deepEqual(a.chunks.map((c) => c.chunkId), b.chunks.map((c) => c.chunkId));
  });
});
