# IntelliRAG Live

Browser RAG console over a small ops corpus. Hybrid retrieval (`gemini-embedding-2` cosine + BM25 + RRF + calibrated IDF/title rerank) then Gemini 3.7 Flash writes a grounded answer with citations.

There is **no learned cross-encoder** and **MMR is not in the retrieval path**. Context packing uses a calibrated score floor (0.24) plus a relative drop versus rank-1 — that is not “similarity must be ≥ 0.55”.

GitHub **repository** URLs enumerate the git tree (text/code files, with size and vendor filters). A blob URL still indexes that one file.

- Source: [`charan-rathore/IntelliRAG`](https://github.com/charan-rathore/IntelliRAG) — this folder (`web/`)
- Live: [intellirag-web.vercel.app](https://intellirag-web.vercel.app)
- Python platform: sibling [`rag-platform/`](../rag-platform/) in the same repo

## Models

| Job | Model | Why |
|---|---|---|
| Index + query vectors | `gemini-embedding-2` (768-d, Google prefixes) | Same vector space or retrieval is noise |
| Answers | `gemini-3.7-flash` via OpenRouter (`google/gemini-3.7-flash`) | Generation is a different job than embedding |

## Retrieval and grounding

- **Hybrid only when both channels fire.** Dense cosine needs durable storage and compatible stored vectors. Without `DATABASE_URL` on Vercel, dense is disabled (fail-closed) and corpus health will not claim stored vectors.
- **Corpus isolation.** Default scope is `seed-lab`. GitHub ingest lands in `github:{owner}/{repo}@{shortSha}`. `/api/query` accepts `corpus` (`all` is explicit advanced mode). The lab UI has a corpus selector.
- **Evidence gate** (after packing, not a ranking retune): `positive | negative_not_found | insufficient | ambiguous`. Insufficient / out-of-corpus / “answer from memory” → deterministic “Not in the indexed corpus.” with no citations.
- **Packing.** Absolute calibrated floor **0.24** and **62% of rank-1**; solo-pack if rank-1 ≥ 1.35× rank-2.

Ranking constants in `src/lib/rag/ranking.ts` are frozen against unseen-paraphrase results. Do not retune them to chase that set.

## Bars crossed (local, hybrid)

Last measured on file-backed PGLite at `.data/pglite` with OpenRouter embeddings. This is **not** a Neon / Vercel preview proof.

| Check | Result |
|---|---|
| Seed A–N (`corpus=seed-lab`) | **14/14** |
| 10 frozen unseen paraphrases (U1–U10) | **10/10** — do not retune ranking from these |
| pgvector tree ingest | 46 files → corpus `github:pgvector/pgvector@e48241b`; 5 questions packed **10 distinct non-README** files |
| After ingest, seed-scope K / L / N | **PASS** — no `pgvector-*` leak; N refuses |
| Local cold start (PGLite) | **PASS** |
| Neon / Vercel preview cold start | **not proven** — `DATABASE_URL` was never wired on this build |

Still true after isolation: rerank can still beat a correct dense hit (case E; HNSW insert). L/M can still pack extra **seed** docs — ranking, not isolation.

Harness: `npm run dev` then `node scripts/acceptance-hybrid.mjs` (phases: `embed`, `cold-health`, `an`, `unseen`, `pgvector`).

### A–N (seed-lab)

| ID | Bar |
|---|---|
| A Redis `SET NX EX` | `redis-cache` #1 |
| B stampede paraphrase | `redis-cache` #1 |
| C k8s fragmentation | `k8s-incident` only |
| D Node A | 2 CPUs / 512Mi |
| E serverless Postgres | dense prefers `db-pool`; **rerank saves** `postgres` + PgBouncer |
| F Redlock | `negative_not_found`, no citations |
| G Redis caused k8s | reject premise |
| H Mongolia / I photosynthesis | refuse, empty context |
| J typos | `k8s-incident` |
| K timeouts | ambiguous; **no pgvector** after isolation |
| L Node B | 0.5 CPU / 4Gi; **no HNSW C** after isolation |
| M Redis + pool | those two (plus extra seed `http-caching`) |
| N injection / bypass-corpus | `insufficient`, empty context, refuse |

## Eval (RAGAS-style, last committed report)

Gold set: 10 IntelliRAG samples + 2 adversarial probes. Judge = Gemini 3.7 Flash, not lexical overlap. Report: [`docs/eval-report.json`](docs/eval-report.json).

| Metric | Published lexical baseline | This run | Gate |
|---|---|---|---|
| retrieval MRR | 1.00 | **1.00** | 0.50 |
| retrieval recall | 1.00 | **1.00** | 0.80 |
| retrieval precision | 0.28 | 0.25 | 0.25 |
| context precision | 0.47 | **1.00** | 0.30 |
| context recall | 1.00 | **1.00** | 0.60 |
| faithfulness | 0.60 | **1.00** | 0.70 |
| citation precision | 0.60 | **0.80** | 0.50 |
| hallucination | 0.40 | **0.00** | ≤ 0.30 |
| answer relevancy | 0.28 | **0.87** | 0.50 |
| answer correctness | — | **0.85** | — |
| e2e latency p95 | — | **5.57 s** | — |
| adversarial pass | 1.00 | **1.00** | 0.70 |

Verdict: **pass**. Baseline was `nomic-embed-text` + `llama3.2` with `judge_model=lexical`, `use_ragas=false`. This run uses real embeddings + Flash. Precision sits at 0.25 because the live corpus also has distractor runbooks; the gold document is always rank 1 (MRR 1.0). Generation dominates p95 (~1.8–5.6 s e2e); dense / BM25 / rerank are sub-millisecond to low-hundreds of ms for embed.

`POST /api/eval` re-runs this suite. `skipCache` is required so graph cache cannot hide retrieval bugs.

## Keys (never in the browser)

Server env only — **not** `VITE_`, not git, not `localStorage`:

- `OPENROUTER_API_KEY` (or `GEMINI_API_KEY`)
- `DATABASE_URL` — **required on Vercel** for durable embeddings (Neon). Without it, dense retrieval is disabled.
- `GITHUB_TOKEN` — optional, raises GitHub API rate limits for repo ingestion

## Local

```bash
cd web
npm install
npm run dev
```

Local embeddings persist in file-backed PGLite at `.data/pglite` so a restart keeps vectors. Production must set `DATABASE_URL`.
