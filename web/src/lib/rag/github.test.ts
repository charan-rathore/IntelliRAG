import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  filterGithubTree,
  parseGithubUrl,
  shouldIngestGithubPath,
} from "./github.ts";
import { chunkDocument } from "./chunking.ts";

describe("GitHub URL parsing", () => {
  it("treats a repo root as repository ingestion, not README.md", () => {
    const t = parseGithubUrl("https://github.com/charan-rathore/intellirag-web");
    assert.deepEqual(t, {
      kind: "repo",
      owner: "charan-rathore",
      repo: "intellirag-web",
      ref: null,
    });
  });

  it("parses blob and tree URLs", () => {
    const blob = parseGithubUrl(
      "https://github.com/charan-rathore/intellirag-web/blob/main/src/lib/rag/retrieve.server.ts",
    );
    assert.equal(blob?.kind, "blob");
    if (blob?.kind === "blob") assert.equal(blob.path, "src/lib/rag/retrieve.server.ts");
    const tree = parseGithubUrl("https://github.com/charan-rathore/intellirag-web/tree/main/src/lib/rag");
    assert.equal(tree?.kind, "tree");
  });
});

describe("GitHub file filters", () => {
  it("skips vendor, binaries, and lockfiles", () => {
    assert.equal(shouldIngestGithubPath("node_modules/foo/index.js"), false);
    assert.equal(shouldIngestGithubPath("dist/app.js"), false);
    assert.equal(shouldIngestGithubPath("package-lock.json"), false);
    assert.equal(shouldIngestGithubPath("sql/vector--0.1.0--0.1.1.sql"), false);
    assert.equal(shouldIngestGithubPath("src/hnsw.c"), true);
  });

  it("filters a recursive tree", () => {
    const files = filterGithubTree([
      { path: "README.md", type: "blob", size: 100 },
      { path: "src/lib/rag/query.server.ts", type: "blob", size: 200 },
      { path: "node_modules/x/index.js", type: "blob", size: 200 },
      { path: "photo.png", type: "blob", size: 200 },
    ]);
    assert.deepEqual(
      files.map((f) => f.path).sort(),
      ["README.md", "src/lib/rag/query.server.ts"],
    );
  });
});

describe("code-aware chunking", () => {
  it("keeps functions together and records the symbol", () => {
    const src = `
import { foo } from "./foo";

export function retrieve() {
  return 1;
}

export function classifyIntent(q: string) {
  return q;
}
`.trim();
    const chunks = chunkDocument(src, { kind: "code", language: "typescript", filepath: "src/lib/rag/retrieve.server.ts" });
    assert.ok(chunks.length >= 2);
    assert.ok(chunks.some((c) => c.symbol === "retrieve"));
    assert.ok(chunks.some((c) => c.symbol === "classifyIntent"));
    assert.ok(chunks.every((c) => c.chunkKind === "code"));
    assert.ok(chunks.every((c) => c.filepath === "src/lib/rag/retrieve.server.ts"));
  });
});
