/**
 * Graphify sidecar store: graph.json + memory/ + .graphify_learning.json
 * kept together. Mirrors graphify-out/ so repeat queries skip Flash.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SEED_DOCUMENTS } from "../corpus";
import { getSql, vercelWithoutDatabase } from "@/lib/db";
import { extractCorpus, questionHash } from "./extract";
import { lookupCache, preferredSlugs, queryGraph } from "./query";
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
  return g.__intelliragGraph;
}

function persist(state: GraphState) {
  saveDisk(state);
  void saveSql(state);
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

export async function findCachedAnswer(question: string, corpusId = "seed-lab") {
  const state = await ensureGraph();
  const hit = lookupCache(state, question, corpusId);
  const preferred = preferredSlugs(state, question);
  const subgraph = queryGraph(state.graph, question);
  return { hit, preferred, subgraph };
}

export async function saveQueryResult(input: {
  question: string;
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
  const qid = `query:${hash}`;
  if (!state.graph.nodes.some((n) => n.id === qid)) {
    state.graph.nodes.push({
      id: qid,
      label: input.question.slice(0, 120),
      source_file: "memory",
      source_location: now,
      file_type: "query",
      kind: "query",
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

  const existing = state.cache.find(
    (c) => c.questionHash === hash && (c.corpusId ?? "seed-lab") === (input.corpusId ?? "seed-lab"),
  );
  const entry: CacheEntry = {
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
      (c) => !(c.questionHash === hash && (c.corpusId ?? "seed-lab") === entry.corpusId),
    ),
  ].slice(0, 80);
  state.learning = reflect(state);
  persist(state);
  return { memoryId: memory.id, hash };
}

export async function recordOutcome(input: {
  question: string;
  outcome: GraphOutcome;
  correction?: string;
}) {
  const state = await ensureGraph();
  const hash = questionHash(input.question);
  const latest = state.memory.find((m) => m.questionHash === hash);
  if (latest) {
    latest.outcome = input.outcome;
    latest.correction = input.correction ?? null;
  }
  const cache = state.cache.find((c) => c.questionHash === hash);
  if (cache) {
    cache.outcome = input.outcome;
    cache.updatedAt = new Date().toISOString();
    if (input.outcome === "dead_end") cache.answer = "";
    if (input.outcome === "corrected" && input.correction) cache.answer = input.correction;
  }
  state.learning = reflect(state);
  persist(state);
  return graphSnapshot();
}

export async function bumpCacheHit(hash: string) {
  const state = await ensureGraph();
  const cache = state.cache.find((c) => c.questionHash === hash);
  if (cache) {
    cache.hitCount += 1;
    cache.updatedAt = new Date().toISOString();
    persist(state);
  }
}

export { mem };
