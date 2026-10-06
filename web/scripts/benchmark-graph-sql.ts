import { writeFileSync } from "node:fs";
import { getSql } from "../src/lib/db";
import { upsertDocument, loadSearchableChunks, loadChunksByIds } from "../src/lib/rag/store.server";
import {
  rememberRetrievedVectors,
  vectorGraphLookup,
} from "../src/lib/rag/graphify/persist.server";
import { graphFirstRetrieve } from "../src/lib/rag/graph-first";
import { retrieveFromRows } from "../src/lib/rag/retrieve-core";
import { getStorageStatus } from "../src/lib/rag/storage";
const scope = { kind: "corpus" as const, corpusId: "sql-benchmark" };
const model = "synthetic-sql-128";
const doc = await upsertDocument({
  title: "Queue timeout guide",
  body: "Queue tasks timeout starts at execution, not while waiting in the queue.",
  sourceType: "markdown",
  slugHint: "sql-graph-benchmark",
  corpusId: scope.corpusId,
});
const sql = await getSql();
await sql.query("delete from chunks where document_id=$1", [doc.id]);
const records = Array.from({ length: 1000 }, (_, i) => ({
  id: `sql-bench-${i}`,
  document_id: doc.id,
  ordinal: i,
  text:
    i === 0
      ? "Queue tasks timeout starts at execution, not while waiting in the queue."
      : `Other topic ${i} colors shapes recipes.`,
  token_count: 20,
  embedding: JSON.stringify(Array.from({ length: 128 }, (_, j) => (j === i % 128 ? 1 : 0))),
  embedding_model: model,
  content_hash: `sql-bench-${i}`,
  corpus_id: scope.corpusId,
}));
await sql.query(
  `insert into chunks (id,document_id,ordinal,text,token_count,embedding,embedding_model,content_hash,corpus_id)
 select id,document_id,ordinal,text,token_count,embedding,embedding_model,content_hash,corpus_id from jsonb_to_recordset($1::jsonb) as t(id text,document_id text,ordinal int,text text,token_count int,embedding text,embedding_model text,content_hash text,corpus_id text)`,
  [JSON.stringify(records)],
);
await sql.query("update documents set embedding_model=$1 where id=$2", [model, doc.id]);
await rememberRetrievedVectors(["sql-bench-0"], model, 128, scope.corpusId);
const opts = {
  query: "When do queue tasks start timeout execution?",
  queryVector: JSON.parse(records[0].embedding),
  embeddingModel: model,
  mode: "hybrid" as const,
  topK: 5,
  storage: getStorageStatus(),
  scope,
};
const graph: number[] = [];
const full: number[] = [];
let candidateFetches = 0;
let fullLoads = 0;
for (let i = 0; i < 25; i++) {
  let start = performance.now();
  const r = await graphFirstRetrieve(opts, {
    lookup: vectorGraphLookup,
    fetch: async (ids, s) => {
      candidateFetches++;
      return loadChunksByIds(ids, s);
    },
    full: async () => {
      fullLoads++;
      return retrieveFromRows({
        ...opts,
        rows: await loadSearchableChunks(scope),
        corpusScope: scope,
      });
    },
  });
  const g = performance.now() - start;
  if (r.vectorTrace.route !== "graph") throw new Error("graph miss");
  start = performance.now();
  retrieveFromRows({ ...opts, rows: await loadSearchableChunks(scope), corpusScope: scope });
  const f = performance.now() - start;
  if (i >= 5) {
    graph.push(g);
    full.push(f);
  }
}
const stats = (x: number[]) => {
  const a = [...x].sort((a, b) => a - b);
  return {
    median_ms: a[Math.floor(a.length / 2)],
    p95_ms: a[Math.floor(a.length * 0.95)],
    n: a.length,
  };
};
const result = {
  scope:
    "Local PGLite 1000 synthetic-vector chunk retrieval benchmark. Graph includes document-version validation SQL, primary-key candidate fetch, vector identity check, rerank/evidence. Full includes full row fetch/rerank. Excludes provider, SSE and post-retrieval learning persistence. Five warmups, 20 measured iterations.",
  chunks: 1000,
  dimensions: 128,
  resident_vectors: 1,
  graph: stats(graph),
  full: stats(full),
  candidateFetches,
  fullLoads,
};
writeFileSync("docs/graph-first/sql-benchmark.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(0);
