const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "intellirag-memory-readiness-"));
const snapshot = path.join(dir, "memory.json");
const originalLoad = Module._load;
const originalTs = require.extensions[".ts"];
require.extensions[".ts"] = (mod, file) =>
  mod._compile(
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    file,
  );
Module._load = function (id, parent, ...rest) {
  if (parent?.filename?.endsWith("/rag/memory.server.ts")) {
    if (id === "node:fs")
      return {
        ...fs,
        readFileSync: (p, ...args) =>
          fs.readFileSync(p === "/tmp/intellirag-memory.json" ? snapshot : p, ...args),
        writeFileSync: (p, ...args) =>
          fs.writeFileSync(p === "/tmp/intellirag-memory.json" ? snapshot : p, ...args),
      };
    // Suggestions are unrelated to embedding readiness; no SQL or provider is opened.
    if (id === "./suggested-questions.server") return { seedPredictedQuestions: async () => {} };
  }
  return originalLoad.call(this, id, parent, ...rest);
};
const store = require("../src/lib/rag/memory.server.ts");
test.after(() => {
  Module._load = originalLoad;
  if (originalTs) require.extensions[".ts"] = originalTs;
  else delete require.extensions[".ts"];
  fs.rmSync(dir, { recursive: true, force: true });
});

test("memory readiness follows each document across partial and mixed-model replacement", async () => {
  const oldV = process.env.VERCEL;
  const oldD = process.env.DATABASE_URL;
  delete process.env.VERCEL;
  delete process.env.DATABASE_URL;
  store.resetMemoryForTests();
  try {
    const a = await store.upsertDocument({
      title: "Memory readiness a",
      body: "Workers enforce queue backpressure. ".repeat(240),
      sourceType: "markdown",
      sourceUri: "test://memory-ready-a",
    });
    const b = await store.upsertDocument({
      title: "Memory readiness b",
      body: "Timeout starts after execution begins. ".repeat(240),
      sourceType: "markdown",
      sourceUri: "test://memory-ready-b",
    });
    const chunks = await store.loadSearchableChunks({ kind: "all" });
    const rows = (id) => chunks.filter((r) => r.chunk.document_id === id);
    const updates = (id, model) =>
      rows(id).map((r) => ({ id: r.chunk.id, embedding: [0.1, 0.2], model }));
    assert.ok(rows(a.id).length > 1);
    await store.saveChunkEmbeddings([...updates(a.id, "model-a"), ...updates(b.id, "model-b")]);
    assert.equal((await store.getDocumentBySlug(a.slug)).embedding_model, "model-a");
    assert.equal((await store.getDocumentBySlug(b.slug)).embedding_model, "model-b");
    await store.saveChunkEmbeddings([
      { id: rows(a.id)[0].chunk.id, embedding: [0.4, 0.5], model: "model-c" },
    ]);
    assert.equal((await store.getDocumentBySlug(a.slug)).embedding_model, null);
    assert.equal((await store.getDocumentBySlug(a.slug)).indexed_at, null);
    assert.ok((await store.getDocumentBySlug(b.slug)).indexed_at);
    await store.replaceChunks(b.id, "Direct replacement. ".repeat(180), undefined, b.corpusId);
    assert.equal((await store.getDocumentBySlug(b.slug)).indexed_at, null);
    assert.equal((await store.getDocumentBySlug(b.slug)).embedding_model, null);
  } finally {
    store.resetMemoryForTests();
    if (oldV === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = oldV;
    if (oldD === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = oldD;
  }
});


test("direct ephemeral replacement never exposes an empty or partial chunk set", async () => {
  store.resetMemoryForTests();
  try {
    const doc = await store.upsertDocument({ title: "Revision visibility", body: "Old approved amount. ".repeat(200), sourceType: "markdown", sourceUri: "test://atomic-replacement" });
    const replacement = store.replaceChunks(doc.id, "New approved amount. ".repeat(240), undefined, doc.corpusId);
    const rows = (await store.loadSearchableChunks({ kind: "all" })).filter(r => r.chunk.document_id === doc.id);
    assert.ok(rows.length > 1);
    const expected = await replacement;
    assert.equal(rows.length, expected);
    assert.ok(rows.every(r => r.chunk.text.includes("New approved amount")));
  } finally { store.resetMemoryForTests(); }
});
