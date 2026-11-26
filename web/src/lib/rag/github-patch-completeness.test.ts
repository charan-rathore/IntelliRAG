import "./testing/isolated-pglite-dir.mjs";
import "./testing/close-database.mjs";
import { it } from "node:test";
import assert from "node:assert/strict";
import { ingestFromUrl } from "./ingest.server.ts";
import { getDocumentBySlug } from "./store.server.ts";
import { githubPullDocuments } from "./github.ts";
it("review probe: refuses a nonempty but incomplete PR patch", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/files?per_page=100"))
      return Response.json([
        {
          filename: "policy.ts",
          status: "modified",
          additions: 2,
          deletions: 1,
          changes: 3,
          patch: "@@ -1 +1,2 @@\n-oldPolicy();\n+newPolicy();",
        },
      ]);
    return Response.json({
      title: "Change production approval policy",
      body: "Replace policy while preserving all approval requirements.",
      html_url: "https://github.com/probe/patch-completeness/pull/731",
      state: "open",
      changed_files: 1,
    });
  });
  await assert.rejects(
    ingestFromUrl("https://github.com/probe/patch-completeness/pull/731"),
    /incomplete or inconsistent/,
  );
});

const documentFor = (patch: string, additions?: number, deletions?: number) =>
  githubPullDocuments(
    {
      number: 9,
      title: "Fixture",
      state: "open",
      body: null,
      html_url: "https://github.com/probe/patch/pull/9",
      files: [{ filename: "source.txt", status: "modified", patch, additions, deletions }],
    },
    "probe",
    "patch",
  );
for (const [name, patch, additions, deletions] of [
  ["single replacement", "@@ -1 +1 @@\n-old\n+new", 1, 1],
  ["new file", "@@ -0,0 +1,2 @@\n+one\n+two", 2, 0],
  ["deleted file", "@@ -1,2 +0,0 @@\n-one\n-two", 0, 2],
  [
    "multiple hunks",
    "@@ -1 +1 @@ function\n-old\n+new\n@@ -9,2 +9,2 @@\n same\n-last\n+next",
    2,
    2,
  ],
  [
    "no final newline markers",
    "@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file",
    1,
    1,
  ],
  ["blank source line and plus text", "@@ -1,2 +1,2 @@\n \n-+old\n++new", 1, 1],
  ["final transport newline", "@@ -1 +1 @@\n-old\n+new\n", 1, 1],
  ["CRLF source content", "@@ -1 +1 @@\n-old\r\n+new\r", 1, 1],
] as const)
  it(`accepts legitimate ${name}`, () =>
    assert.equal(documentFor(patch, additions, deletions).length, 1));
for (const [name, patch, additions, deletions] of [
  ["short hunk", "@@ -1 +1,2 @@\n-old\n+new", 2, 1],
  ["missing whole hunk", "@@ -1 +1 @@\n-old\n+new", 2, 2],
  ["too many lines", "@@ -1 +1 @@\n-old\n+new\n+extra", 2, 1],
  ["short first hunk", "@@ -1 +1,2 @@\n-old\n+new\n@@ -9 +9 @@\n-a\n+b", 3, 2],
  ["missing hunk header", "-old\n+new", 1, 1],
  ["negative declared count", "@@ -1 +1 @@\n-old\n+new", -1, 1],
] as const)
  it(`rejects ${name}`, () =>
    assert.throws(() => documentFor(patch, additions, deletions), /incomplete or inconsistent/));

it("preserves final blank context and CRLF bytes through persistence", async (t) => {
  const patches = ["@@ -1,2 +1,2 @@\n-old\n+new\n ", "@@ -1 +1 @@\n-old\r\n+new\r"];
  let counter = 0;
  for (const patch of patches) {
    const id = 800 + counter++;
    const uri = `https://github.com/probe/patch-preservation/pull/${id}`;
    t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) =>
      String(input).includes("/files?")
        ? Response.json([
            { filename: "policy.ts", status: "modified", patch, additions: 1, deletions: 1 },
          ])
        : Response.json({
            title: "Preserve source patch bytes",
            body: "Approval policy source must retain all diff context.",
            html_url: uri,
            state: "open",
            changed_files: 1,
          }),
    );
    const result = await ingestFromUrl(uri);
    const stored = await getDocumentBySlug(result.titles[0]!);
    assert.ok(
      stored?.body.includes(`## policy.ts (modified)\n${patch}\n\nEnd of PR diff.`),
      JSON.stringify(stored?.body),
    );
  }
});
