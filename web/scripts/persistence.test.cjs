const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const Module = require("node:module");
const { PGlite } = require("@electric-sql/pglite");
require.extensions[".ts"] = (mod, file) =>
  mod._compile(
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    file,
  );

test("failed replacement rolls back document metadata and all chunks; retry succeeds", async () => {
  const pg = new PGlite();
  await pg.waitReady;
  for (const name of fs
    .readdirSync(path.join(__dirname, "../migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await pg.exec(fs.readFileSync(path.join(__dirname, "../migrations", name), "utf8"));
  let rejectChunks = false;
  function wrap(client, inTransaction = false) {
    const query = async (text, params = []) => {
      if (rejectChunks && /insert into chunks/i.test(text))
        throw new Error("injected chunk write failure");
      return (await client.query(text, params)).rows;
    };
    const sql = (parts, ...params) =>
      query(
        parts.reduce((s, p, i) => s + (i ? "$" + i : "") + p, ""),
        params,
      );
    sql.query = query;
    sql.transaction = inTransaction
      ? (work) => work(sql)
      : (work) => pg.transaction((tx) => work(wrap(tx, true)));
    return sql;
  }
  const sql = wrap(pg),
    originalLoad = Module._load;
  Module._load = function (id, ...args) {
    if (id === "@/lib/db") return { getSql: async () => sql, vercelWithoutDatabase: () => false };
    return originalLoad.call(this, id, ...args);
  };
  try {
    const { upsertDocument } = require("../src/lib/rag/store.server.ts");
    const input = {
      title: "Rollback fixture",
      slugHint: "rollback-fixture",
      sourceType: "markdown",
      body: "## Recovery\nRetry budget is seven attempts.",
      corpusId: "test-rollback",
    };
    const first = await upsertDocument(input);
    const before = await sql.query("select * from documents where id=$1", [first.id]);
    const chunks = await sql.query("select * from chunks where document_id=$1 order by ordinal", [
      first.id,
    ]);
    rejectChunks = true;
    await assert.rejects(
      upsertDocument({ ...input, body: "## Recovery\nRetry budget is nine attempts." }),
      /injected chunk write failure/,
    );
    assert.deepEqual(await sql.query("select * from documents where id=$1", [first.id]), before);
    assert.deepEqual(
      await sql.query("select * from chunks where document_id=$1 order by ordinal", [first.id]),
      chunks,
    );
    rejectChunks = false;
    const retry = await upsertDocument({
      ...input,
      body: "## Recovery\nRetry budget is nine attempts.",
    });
    assert.equal(retry.version, 2);
    assert.match(
      (await sql.query("select text from chunks where document_id=$1", [first.id]))[0].text,
      /nine/,
    );
    const unchanged = await upsertDocument({
      ...input,
      body: "## Recovery\nRetry budget is nine attempts.",
    });
    assert.equal(unchanged.skipped, true);
    assert.equal(unchanged.version, 2);
    // Evaluation migration exists on the actual SQL engine.
    await sql.query(
      "insert into evaluation_runs(id,dataset_hash,index_hash,verdict,payload) values ('run-test','fixture-hash','index-hash','fail','{}')",
    );
    assert.equal((await sql.query("select id from evaluation_runs"))[0].id, "run-test");
  } finally {
    Module._load = originalLoad;
    await pg.close();
  }
});
