import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chunkDocument } from "./chunking.ts";
import { retrieveFromRows, type SearchRow } from "./retrieve-core.ts";
import { emptyExperience, fingerprint, lintExperience, recallExperience, recordExperience, passagesToRate, MAX_ASKED_PER_PASSAGE } from "./experience.ts";

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

describe("filing against an excerpt of a passage", () => {
  const FULL = "Concurrency limit. Minimum 1. Default Infinity.\n\nPer-operation timeout in milliseconds. Operations fail with a TimeoutError.\n\nPut queue execution on hold.";
  const EXCERPT = FULL.slice(0, FULL.indexOf("\n\nPer-operation"));
  const full = { chunkId: "q#1", text: FULL };
  const excerpt = { chunkId: "q#1", text: EXCERPT, sourceFingerprint: fingerprint(FULL) };

  it("keeps earlier votes when the same passage is later filed as a packed excerpt of it", () => {
    let log = recordExperience(emptyExperience(), { corpusId: "c", question: "what is the default concurrency", passages: [full], vote: 1 });
    log = recordExperience(log, { corpusId: "c", question: "limit on parallel jobs", passages: [excerpt], vote: -1 });
    const e = Object.values(log.entries)[0]!;
    assert.deepEqual(e.asked.map((a) => a.vote), [1, -1]);
    assert.equal(e.fingerprint, fingerprint(FULL));
  });

  it("recalls what was filed from an excerpt, because it is filed against the whole passage", () => {
    const log = recordExperience(emptyExperience(), { corpusId: "c", question: "what is the default concurrency", passages: [excerpt], vote: 1 });
    assert.ok((recallExperience(log, "c", [full], "default concurrency value").boost.get("q#1") ?? 0) > 0);
  });

  it("still starts over when the passage itself changes", () => {
    let log = recordExperience(emptyExperience(), { corpusId: "c", question: "what is the default concurrency", passages: [excerpt], vote: 1 });
    const edited = FULL.replace("Default Infinity", "Default 4");
    assert.equal(recallExperience(log, "c", [{ chunkId: "q#1", text: edited }], "default concurrency value").boost.size, 0);
    log = recordExperience(log, { corpusId: "c", question: "limit on parallel jobs", passages: [{ chunkId: "q#1", text: EXCERPT, sourceFingerprint: fingerprint(edited) }], vote: -1 });
    assert.deepEqual(Object.values(log.entries)[0]!.asked.map((a) => a.vote), [-1]);
  });

  it("without a source fingerprint the text is the source, as before", () => {
    const log = recordExperience(emptyExperience(), { corpusId: "c", question: "what is the default concurrency", passages: [full], vote: 1 });
    assert.equal(Object.values(log.entries)[0]!.fingerprint, fingerprint(FULL));
  });
});

describe("which passages a rating is filed against", () => {
  const FULL = "Concurrency limit. Minimum 1. Default Infinity.\n\nPer-operation timeout in milliseconds.";
  const cachedExcerpt = { chunkId: "q#1", text: "Concurrency limit. Minimum 1. Default Infinity.", sourceFingerprint: fingerprint(FULL) };

  it("files an excerpted answer against the stored whole chunk when its source is unchanged", () => {
    const out = passagesToRate([cachedExcerpt], new Map([["q#1", FULL]]));
    assert.deepEqual(out, [{ chunkId: "q#1", text: FULL, sourceFingerprint: fingerprint(FULL) }]);
  });

  it("drops a rating about older text when the stored chunk has changed since", () => {
    assert.deepEqual(passagesToRate([cachedExcerpt], new Map([["q#1", FULL.replace("Infinity", "4")]])), []);
  });

  it("does not take a carried fingerprint as proof: one that matches nothing stored is dropped", () => {
    assert.deepEqual(passagesToRate([{ ...cachedExcerpt, sourceFingerprint: "forged" }], new Map([["q#1", FULL]])), []);
  });

  it("drops passages no longer stored", () => {
    assert.deepEqual(passagesToRate([cachedExcerpt], new Map()), []);
  });

  it("older cached answers without a fingerprint: the whole stored chunk is filed, an excerpt or changed text never is (any change to the passage makes a link stale)", () => {
    let log = recordExperience(emptyExperience(), { corpusId: "c", question: "default concurrency", passages: [{ chunkId: "q#1", text: FULL }], vote: 1 });
    log = recordExperience(log, { corpusId: "c", question: "parallel limit", passages: [{ chunkId: "q#1", text: FULL }], vote: 1 });
    const stored = new Map([["q#1", FULL]]);
    const whole = passagesToRate([{ chunkId: "q#1", text: FULL }], stored);
    assert.deepEqual(whole, [{ chunkId: "q#1", text: FULL, sourceFingerprint: fingerprint(FULL) }]);
    // an excerpt of an unchanged chunk, and the same excerpt after an edit elsewhere in the chunk, are both unprovable
    assert.deepEqual(passagesToRate([{ chunkId: "q#1", text: FULL.slice(0, 20) }], stored), []);
    assert.deepEqual(passagesToRate([{ chunkId: "q#1", text: FULL.slice(0, 20) }], new Map([["q#1", FULL + " Changed."]])), []);
    assert.deepEqual(passagesToRate([{ chunkId: "q#1", text: "" }], stored), []);
    // dropping the excerpt leaves the earlier votes untouched
    const after = passagesToRate([{ chunkId: "q#1", text: FULL.slice(0, 20) }], stored);
    if (after.length) log = recordExperience(log, { corpusId: "c", question: "how many at once", passages: after, vote: 1 });
    assert.deepEqual(Object.values(log.entries)[0]!.asked.map((a) => a.vote), [1, 1]);
  });

  it("survives JSON serialization of a retrieved chunk", () => {
    const r = JSON.parse(JSON.stringify({ chunkId: "q#1", text: "x", sourceFingerprint: fingerprint(FULL) }));
    assert.equal(passagesToRate([r], new Map([["q#1", FULL]]))[0]!.sourceFingerprint, fingerprint(FULL));
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

  it("marks every packed chunk with the fingerprint of its whole stored text", () => {
    const r = ask("What is the default concurrency limit and the timeout?", null);
    assert.ok(r.chunks.length > 0);
    for (const c of r.chunks) assert.equal(c.sourceFingerprint, fingerprint(rows.find((x) => x.chunk.id === c.chunkId)!.chunk.text));
  });
});
