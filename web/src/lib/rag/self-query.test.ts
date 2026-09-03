import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chunkDocument } from "./chunking.ts";
import { retrieveFromRows, type SearchRow } from "./retrieve-core.ts";
import type { ChunkRow } from "./types.ts";

const FILES = [
  "src/lib/rag/ingest.server.ts",
  "src/lib/rag/retrieve.server.ts",
  "src/lib/rag/query.server.ts",
  "src/lib/rag/intents.ts",
  "src/lib/rag/types.ts",
  "src/lib/rag/store.server.ts",
  "src/lib/rag/eval.server.ts",
] as const;

const durable = {
  backend: "pglite" as const,
  durable: true,
  denseAvailable: true,
  warning: null,
};

function rowsFromSelf(): SearchRow[] {
  const rows: SearchRow[] = [];
  for (const filepath of FILES) {
    const body = readFileSync(join(process.cwd(), filepath), "utf8");
    const slug = filepath.replaceAll("/", "-");
    for (const draft of chunkDocument(body, {
      kind: "code",
      filepath,
      language: "typescript",
    })) {
      const chunk: ChunkRow = {
        id: `${slug}:${draft.ordinal}`,
        document_id: slug,
        ordinal: draft.ordinal,
        text: draft.text,
        token_count: draft.tokenCount,
        heading: draft.heading,
        embedding: null,
        embedding_model: null,
        content_hash: `${slug}:${draft.ordinal}`,
        created_at: "2026-01-01T00:00:00.000Z",
        filepath,
        language: "typescript",
        symbol: draft.symbol,
        chunk_kind: "code",
        corpus_id: "seed-lab",
      };
      rows.push({
        chunk,
        title: filepath,
        slug,
        indexedAt: "2026-01-01T00:00:00.000Z",
        corpusId: "seed-lab",
      });
    }
  }
  return rows;
}

function ask(query: string) {
  return retrieveFromRows({
    query,
    queryVector: null,
    mode: "keyword",
    topK: 5,
    embeddingModel: "gemini-embedding-2",
    rows: rowsFromSelf(),
    storage: durable,
  });
}

function packedText(result: ReturnType<typeof ask>) {
  return result.chunks.map((c) => c.text).join("\n");
}

describe("self-query against current IntelliRAG sources", () => {
  it("says a GitHub repo root enumerates the tree, not only README.md", () => {
    const r = ask(
      "When I paste a GitHub repository root URL into IntelliRAG, does it index the repository or only the README?",
    );
    assert.equal(r.chunks[0]?.filepath, "src/lib/rag/ingest.server.ts");
    assert.match(packedText(r), /enumerates the git tree|not index only README|not a single README/i);
  });

  it("says there is no learned cross-encoder", () => {
    const r = ask("Does IntelliRAG currently use a learned cross-encoder reranker?");
    assert.equal(r.chunks[0]?.filepath, "src/lib/rag/retrieve.server.ts");
    assert.match(packedText(r), /not a learned[\s/*]*cross-encoder/i);
  });

  it("says MMR is not in the execution path", () => {
    const r = ask("Is MMR actually part of the current retrieval execution path?");
    assert.equal(r.chunks[0]?.filepath, "src/lib/rag/retrieve.server.ts");
    assert.match(packedText(r), /MMR is not part of the current retrieval execution path/i);
  });

  it("explains that 0.55 is not an absolute cosine cut", () => {
    const r = ask("Does a 0.55 context cliff mean candidates below similarity 0.55 are removed?");
    assert.equal(r.chunks[0]?.filepath, "src/lib/rag/types.ts");
    assert.match(packedText(r), /not an absolute 0\.55 cosine|NOT an absolute cosine/i);
  });

  it("says off-topic is evidence-based, not a weather regex", () => {
    const r = ask("How does IntelliRAG determine that a question is off-topic?");
    const files = r.chunks.map((c) => c.filepath);
    assert.ok(
      files.includes("src/lib/rag/query.server.ts") || files.includes("src/lib/rag/intents.ts"),
      files.join(","),
    );
    assert.match(
      packedText(r),
      /not a weather\/joke\/recipe regex|retrieved evidence, not regexes/i,
    );
  });

  it("says Vercel without DATABASE_URL is ephemeral memory", () => {
    const r = ask("What happens on Vercel when DATABASE_URL is missing?");
    assert.equal(r.chunks[0]?.filepath, "src/lib/rag/store.server.ts");
    assert.match(packedText(r), /ephemeral|cold starts/i);
  });
});
