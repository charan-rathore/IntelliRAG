# IntelliRAG Live

Browser RAG console over a small ops corpus. Retrieval is **hybrid when embeddings exist** (`gemini-embedding-2` cosine + BM25 + RRF + calibrated IDF/title rerank) and **keyword (BM25 + the same rerank) on Vercel without `DATABASE_URL`**. Answers are cited — Gemini 3.7 Flash when a key is present, otherwise extractive snippets from packed chunks.

**Live:** [https://intellirag-web.vercel.app](https://intellirag-web.vercel.app)

You do **not** need an API key to try it. Demo cards fire real queries. The header chip is **Ready** (or **Extractive** if no generation key) — not “Key needed”, and not “17 stale” when missing vectors are expected on serverless.

There is **no learned cross-encoder** and **MMR is not in the retrieval path**. Context packing uses a calibrated score floor (0.24) plus a relative drop versus rank-1 — that is not “similarity must be ≥ 0.55”.

GitHub **repository** URLs enumerate the git tree (text/code files, with size and vendor filters). A blob URL still indexes that one file.

- Source: [`charan-rathore/intellirag-web`](https://github.com/charan-rathore/intellirag-web) (this app) and [`charan-rathore/IntelliRAG`](https://github.com/charan-rathore/IntelliRAG) `web/`
- Python platform: sibling [`rag-platform/`](https://github.com/charan-rathore/IntelliRAG/tree/main/rag-platform)

## What the live lab does

Open [intellirag-web.vercel.app](https://intellirag-web.vercel.app).

- **Ask** a runbook question, or click a demo card (Redis stampede, k8s incident, weather refuse). Demos do not bounce you to Settings.
- **Watch** retrieval in Lab: Used vs Inspect only. Dense cosine runs only when stored vectors exist.
- **Read** a cited answer, or an honest **Not in the indexed corpus.**
- **Settings** is optional: OpenRouter or Gemini for Flash answers and dense embeddings. Keys stay on the server (httpOnly cookie), never in page JavaScript.

Without a generation key, answers are **extractive citations** from packed chunks. The public live host currently has an OpenRouter key, so Flash writes the answer. With `XAI_API_KEY` on the server and no Gemini/OpenRouter, Grok 4.5 writes it.

On Vercel without `DATABASE_URL`, PGLite is never opened (that used to crash with `ENOENT /var/task/_libs/pglite.data`). Keyword search over the seed corpus still runs. The UI treats that as a live keyword index, not a failed hybrid one.

## Models

| Job | Model | Why |
|---|---|---|
| Index + query vectors | `gemini-embedding-2` (768-d, Google prefixes) | Same vector space or retrieval is noise |
| Answers | `gemini-3.7-flash` via OpenRouter, else Grok 4.5, else extractive | Generation is a different job than embedding |

## Retrieval and grounding

- **Hybrid only when both channels fire.** Dense cosine needs durable storage and compatible stored vectors. Without `DATABASE_URL` on Vercel, dense is disabled (fail-closed) and corpus health will not claim stored vectors.
- **Corpus isolation.** Default scope is `seed-lab`. GitHub ingest lands in `github:{owner}/{repo}@{shortSha}`. `/api/query` accepts `corpus` (`all` is explicit advanced mode). The lab UI has a corpus selector.
- **Evidence gate** (after packing, not a ranking retune): `positive | negative_not_found | insufficient | ambiguous`. Insufficient / out-of-corpus / “answer from memory” → deterministic “Not in the indexed corpus.” with no citations.
- **Packing.** Absolute calibrated floor **0.24** and **62% of rank-1**; solo-pack if rank-1 ≥ 1.35× rank-2.

Ranking constants in `src/lib/rag/ranking.ts` are frozen against unseen-paraphrase results. Do not retune them to chase that set.

## Tests

### Unit (always run)

```bash
npx tsx --test src/lib/rag/*.test.ts
npm run typecheck
```

| Suite | Result |
|---|---|
| RAG unit (`intents`, `evidence`, `ranking`, `corpus-scope`, `github`, `persistence`, `self-query`) | **41/41 pass** |
| Auth schema stays under `migrations/auth/` (not globbed) | **pass** (7/7 migration-plan) |

`npm test` also runs platform chrome tests (PWA injector / write-atomic). The RAG lab does not depend on those for retrieval correctness.

### Live host (keyword — no `DATABASE_URL`)

Measured against [https://intellirag-web.vercel.app](https://intellirag-web.vercel.app). Mode is `keyword` because dense is fail-closed without durable vectors. The strict harness’s `actualMode === hybrid` gate is therefore skipped; retrieval, packing, evidence, and refusal bars still apply.

```bash
ACCEPTANCE_BASE=https://intellirag-web.vercel.app node scripts/acceptance-hybrid.mjs an-live
ACCEPTANCE_BASE=https://intellirag-web.vercel.app node scripts/acceptance-hybrid.mjs unseen-live
```

| Check | Result |
|---|---|
| Seed A–N retrieval / refuse / evidence bars | **14/14** (keyword) |
| 10 frozen unseen paraphrases (U1–U10) | **9/10** — U5 (`git-ops`) misses; do not retune ranking |
| Header / demos | Demos query without a key; chip is Ready/Extractive, not “Key needed” / “N stale” |

### Hybrid acceptance (local, needs embeddings)

Last measured on file-backed PGLite with OpenRouter embeddings. This is **not** a Neon / Vercel preview proof. Dense is off on Vercel without `DATABASE_URL`.

```bash
npm run dev
node scripts/acceptance-hybrid.mjs          # embed + A–N + unseen + pgvector
node scripts/acceptance-hybrid.mjs an       # A–N only (requires hybrid)
node scripts/acceptance-hybrid.mjs unseen
```

| Check | Result |
|---|---|
| Seed A–N (`corpus=seed-lab`) | **14/14** (local hybrid + embeddings) |
| 10 frozen unseen paraphrases (U1–U10) | **10/10** local hybrid — do not retune ranking from these |
| pgvector tree ingest | 46 files → corpus `github:pgvector/pgvector@e48241b`; 5 questions packed **10 distinct non-README** files |
| After ingest, seed-scope K / L / N | **PASS** — no `pgvector-*` leak; N refuses |
| Local cold start (PGLite) | **PASS** |
| Neon / Vercel preview cold start | **not proven** without `DATABASE_URL` |

Still true after isolation: rerank can still beat a correct dense hit (case E; HNSW insert). L/M can still pack extra **seed** docs — ranking, not isolation.

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

Verdict: **pass**. `POST /api/eval` re-runs this suite. `skipCache` is required so graph cache cannot hide retrieval bugs.

## Keys (never in the browser)

Server env only — **not** `VITE_`, not git, not `localStorage`:

- `OPENROUTER_API_KEY` (or `GEMINI_API_KEY`) — optional; Flash answers + dense embeddings
- `XAI_API_KEY` — optional; Grok 4.5 answers when Gemini/OpenRouter are unset
- `DATABASE_URL` — **required on Vercel** for durable embeddings (Neon). Without it, dense retrieval is disabled; keyword search still works.
- `GITHUB_TOKEN` — optional, raises GitHub API rate limits for repo ingestion

## Local

```bash
npm install
npm run dev
```

Local embeddings persist in file-backed PGLite at `.data/pglite` so a restart keeps vectors. Production must set `DATABASE_URL` for dense retrieval.
