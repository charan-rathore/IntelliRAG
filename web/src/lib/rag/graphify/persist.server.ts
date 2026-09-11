/**
 * Graphify sidecar store: graph.json + memory/ + .graphify_learning.json
 * kept together. Mirrors graphify-out/ so repeat queries skip Flash.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { listDocuments, getDocumentBySlug } from "../store.server";
import { SEED_DOCUMENTS } from "../corpus";
import { getSql, vercelWithoutDatabase } from "@/lib/db";
import { extractCorpus, questionHash, GRAPH_EXTRACTOR_VERSION } from "./extract";
import { lookupCache, preferredSlugs, queryGraph } from "./query";
import { applyGraphEdits, scopeGraph, EMPTY_EDITS, type GraphEdits } from "./edits";
import { reflect } from "./reflect";
import type { CacheEntry, GraphOutcome, GraphState, MemoryDoc } from "./schema";

const TMP = "/tmp/intellirag-graphify.json";
type G = typeof globalThis & { __intelliragGraph?: GraphState };

function empty(): GraphState {
  return {
    graph: extractCorpus(SEED_DOCUMENTS),
    memory: [],
    cache: [],
    learning: null,
  };
}

function loadDisk(): GraphState | null {
  try {
    return JSON.parse(readFileSync(TMP, "utf8")) as GraphState;
  } catch {
    return null;
  }
}

function saveDisk(state: GraphState) {
  try {
    mkdirSync(dirname(TMP), { recursive: true });
    writeFileSync(TMP, JSON.stringify(state), { mode: 0o600 });
  } catch {
    // /tmp is best-effort on serverless
  }
}

function mem(): GraphState {
  const g = globalThis as G;
  if (!g.__intelliragGraph) {
    g.__intelliragGraph = loadDisk() ?? empty();
    if (!g.__intelliragGraph.graph?.nodes?.length) {
      g.__intelliragGraph.graph = extractCorpus(SEED_DOCUMENTS);
    }
  }
  return g.__intelliragGraph;
}

async function saveSql(state: GraphState) {
  if (vercelWithoutDatabase()) return;
  try {
    const sql = await getSql();
    const payload = JSON.stringify(state);
    await sql`
      insert into graphify_state (id, payload, updated_at)
      values ('default', ${payload}, now())
      on conflict (id) do update set payload = ${payload}, updated_at = now()
    `;
  } catch {
    // table may not exist yet on a fresh PGLite
  }
}

async function loadSql(): Promise<GraphState | null> {
  if (vercelWithoutDatabase()) return null;
  try {
    const sql = await getSql();
    const rows = await sql<{ payload: string }>`
      select payload from graphify_state where id = 'default' limit 1
    `;
    if (!rows[0]?.payload) return null;
    return JSON.parse(rows[0].payload) as GraphState;
  } catch {
    return null;
  }
}

export async function ensureGraph(): Promise<GraphState> {
  const g = globalThis as G;
  if (!g.__intelliragGraph) {
    const fromSql = await loadSql();
    g.__intelliragGraph = fromSql ?? loadDisk() ?? empty();
    if (!g.__intelliragGraph.graph?.nodes?.length) {
      g.__intelliragGraph.graph = extractCorpus(SEED_DOCUMENTS);
    }
  }
  const state = g.__intelliragGraph;
  const documents = await listDocuments();
  const fingerprint = GRAPH_EXTRACTOR_VERSION + ":answerability-v4:" + JSON.stringify(documents.map(d => [d.slug, d.version]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  if (state.corpusFingerprint !== fingerprint) {
    const rows = await Promise.all(documents.map(d => getDocumentBySlug(d.slug)));
    const docs = rows.filter((d): d is NonNullable<typeof d> => d !== null);
    state.graph = extractCorpus(docs);
    // A changed source invalidates cached answers and their embedded citation snapshots.
    state.cache = [];
    // Feedback also refers to a source revision; discard it until memory stores versions.
    state.memory = [];
    state.learning = reflect(state);
    state.corpusFingerprint = fingerprint;
    await persist(state);
  }
  return state;
}

async function persist(state: GraphState) {
  saveDisk(state);
  await saveSql(state);
}

export async function graphSnapshot() {
  const state = await ensureGraph();
  const preferred = state.learning?.nodes.filter((n) => n.verdict === "preferred").length ?? 0;
  return {
    nodeCount: state.graph.nodes.length,
    edgeCount: state.graph.links.length,
    memoryCount: state.memory.length,
    cacheCount: state.cache.length,
    preferred,
    contested: state.learning?.nodes.filter((n) => n.verdict === "contested").length ?? 0,
    nodes: state.graph.nodes,
    links: state.graph.links,
    learning: state.learning,
  };
}

export async function findCachedAnswer(question: string, corpusId = "seed-lab", options: { policy?: string; edits?: GraphEdits; skipCache?: boolean } = {}) {
  const state = await ensureGraph();
  const graph = applyGraphEdits(scopeGraph(state.graph, corpusId), options.edits ?? EMPTY_EDITS);
  const hit = options.skipCache ? null : lookupCache(state, question, corpusId, options.policy);
  const preferred = preferredSlugs({ ...state, graph }, question);
  const subgraph = queryGraph(graph, question);
  return { hit, preferred, subgraph };
}

export async function saveQueryResult(input: {
  question: string;
  policy?: string;
  answer: string;
  sourceNodes: string[];
  sourceSlugs: string[];
  coverage: string;
  citations: unknown;
  candidates: unknown;
  chunks: unknown;
  contextTokens: number;
  corpusId?: string;
  outcome?: GraphOutcome | null;
}) {
  const state = await ensureGraph();
  const hash = questionHash(input.question);
  const now = new Date().toISOString();
  const qid = `query:${input.corpusId ?? "seed-lab"}:${hash}`;
  if (!state.graph.nodes.some((n) => n.id === qid)) {
    state.graph.nodes.push({
      id: qid,
      label: input.question.slice(0, 120),
      source_file: "memory",
      source_location: now,
      file_type: "query",
      kind: "query",
      corpusId: input.corpusId ?? "seed-lab",
      community: 99,
    });
  }
  for (const slug of input.sourceSlugs) {
    const docId = `doc:${slug}`;
    const exists = state.graph.links.some(
      (e) => e.source === qid && e.target === docId && e.relation === "answered_from",
    );
    if (!exists) {
      state.graph.links.push({
        source: qid,
        target: docId,
        relation: "answered_from",
        confidence: "EXTRACTED",
      });
    }
  }
  const memory: MemoryDoc = {
    corpusId: input.corpusId ?? "seed-lab",
    id: crypto.randomUUID(),
    type: "query",
    date: now,
    question: input.question,
    questionHash: hash,
    answer: input.answer,
    outcome: input.outcome ?? null,
    correction: null,
    source_nodes: input.sourceNodes,
    source_slugs: input.sourceSlugs,
  };
  state.memory.unshift(memory);
  state.memory = state.memory.slice(0, 200);
  const retainedQueries = new Set(state.memory.map(m => `query:${m.corpusId ?? "seed-lab"}:${m.questionHash}`));
  state.graph.nodes = state.graph.nodes.filter(n => n.kind !== "query" || retainedQueries.has(n.id));
  const retainedIds = new Set(state.graph.nodes.map(n => n.id));
  state.graph.links = state.graph.links.filter(e => retainedIds.has(e.source) && retainedIds.has(e.target));

  const existing = state.cache.find(
    (c) => c.questionHash === hash && (c.corpusId ?? "seed-lab") === (input.corpusId ?? "seed-lab") && (c.policy ?? "") === (input.policy ?? ""),
  );
  const entry: CacheEntry = {
    policy: input.policy,
    questionHash: hash,
    question: input.question,
    answer: input.answer,
    sourceSlugs: input.sourceSlugs,
    sourceNodes: input.sourceNodes,
    coverage: input.coverage,
    citations: input.citations,
    candidates: input.candidates,
    chunks: input.chunks,
    contextTokens: input.contextTokens,
    outcome: input.outcome ?? existing?.outcome ?? null,
    hitCount: (existing?.hitCount ?? 0) + 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    corpusId: input.corpusId ?? existing?.corpusId ?? "seed-lab",
  };
  state.cache = [
    entry,
    ...state.cache.filter(
      (c) => !(c.questionHash === hash && (c.corpusId ?? "seed-lab") === entry.corpusId && (c.policy ?? "") === (entry.policy ?? "")),
    ),
  ].slice(0, 80);
  state.learning = reflect(state);
  await persist(state);
  return { memoryId: memory.id, hash };
}

export async function recordOutcome(input: {
  question: string;
  outcome: GraphOutcome;
  correction?: string;
  corpusId?: string;
}) {
  const state = await ensureGraph();
  const hash = questionHash(input.question);
  const latest = state.memory.find((m) => m.questionHash === hash && (m.corpusId ?? "seed-lab") === (input.corpusId ?? "seed-lab"));
  if (latest) {
    latest.outcome = input.outcome;
    latest.correction = input.correction ?? null;
  }
  for (const cache of state.cache.filter(c => c.questionHash === hash && (c.corpusId ?? "seed-lab") === (input.corpusId ?? "seed-lab"))) {
    cache.outcome = input.outcome;
    cache.updatedAt = new Date().toISOString();
    if (input.outcome === "dead_end" || input.outcome === "corrected") cache.answer = "";
  }
  state.learning = reflect(state);
  await persist(state);
  return graphSnapshot();
}

export async function bumpCacheHit(hash: string, corpusId = "seed-lab", policy = "") {
  const state = await ensureGraph();
  const cache = state.cache.find((c) => c.questionHash === hash && (c.corpusId ?? "seed-lab") === corpusId && (c.policy ?? "") === policy);
  if (cache) {
    cache.hitCount += 1;
    cache.updatedAt = new Date().toISOString();
    await persist(state);
  }
}

export { mem };
