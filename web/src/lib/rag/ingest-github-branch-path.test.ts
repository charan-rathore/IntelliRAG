import "./testing/isolated-pglite-dir.mjs";
import "./testing/close-database.mjs";
import assert from "node:assert/strict";
import { it } from "node:test";
import { ingestFromUrl } from "./ingest.server";
import { getDocumentBySlug } from "./store.server";

it("imports a GitHub blob and subtree from a branch containing slashes", async (t) => {
  const owner = "charan-rathore";
  const repo = "npm-cli";
  const branch = "fix/skip-update-check-offline";
  const file = "lib/cli/update-notifier.js";
  const sha = "c00ca0e9d9ccc13231c9d7b98ea3c67d3d1950fc";
  const treeSha = "f".repeat(40);
  const api = `/repos/${owner}/${repo}`;
  const content = "module.exports = async npm => { if (npm.config.get('offline')) return null }";
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === `${api}/commits/fix`) return new Response(null, { status: 422 });
    if (url.pathname === `${api}/git/matching-refs/heads/fix/`) {
      return Response.json([{ ref: `refs/heads/${branch}` }]);
    }
    if (url.pathname === `${api}/git/matching-refs/tags/fix/`) return Response.json([]);
    if (url.pathname === `${api}/commits/${encodeURIComponent(branch)}`) {
      return Response.json({ sha, commit: { tree: { sha: treeSha } } });
    }
    if (url.pathname === `${api}/git/trees/${treeSha}`) {
      return Response.json({ tree: [
        { path: file, type: "blob", size: content.length },
        { path: "other/unrelated.js", type: "blob", size: content.length },
      ] });
    }
    assert.equal(url.href, `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${file}`);
    return new Response(content);
  });

  const blob = await ingestFromUrl(`https://github.com/${owner}/${repo}/blob/${branch}/${file}`);
  assert.equal(blob.ingested, 1);
  const stored = await getDocumentBySlug(blob.titles[0]!);
  assert.equal(stored?.source_uri, `https://github.com/${owner}/${repo}/blob/${sha}/${file}`);
  assert.equal(stored?.body, content);

  const tree = await ingestFromUrl(`https://github.com/${owner}/${repo}/tree/${branch}/lib/cli`);
  assert.equal(tree.corpusId, blob.corpusId);
  assert.deepEqual(tree.titles, blob.titles);
  assert.equal(tree.skipped, 1);
});
