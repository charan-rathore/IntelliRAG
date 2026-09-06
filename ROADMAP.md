# IntelliRAG roadmap — research, evals, Graphify

Single product surface: the Vite lab in `web/`, live at https://intellirag-web.vercel.app/. Python platform stays in `rag-platform/` for ingestion, workers, and offline eval.

## Why Graphify (not a second RAG stack)

[Graphify](https://graphify.com) (`graphifyy` on PyPI, CLI `graphify`) turns a folder into:

- `graph.html` — clickable vis.js graph a non-engineer can filter and search
- `GRAPH_REPORT.md` — communities, hub nodes, suggested questions
- `graph.json` — paths with `file:line` and edge labels `EXTRACTED` / `INFERRED` / `AMBIGUOUS`

Code is parsed on-device with tree-sitter. Docs/PDFs get a semantic pass. That is the visualization layer we want: no Neo4j, no extra account, output a non-technical person can open in a browser.

IntelliRAG already does hybrid retrieval + evidence gating + RAGAS-style eval. Graphify does **structure**. Together:

1. Hybrid RAG answers *"what does the runbook say?"* with citations.
2. The graph answers *"how is Redis connected to the k8s incident?"* as a path a human can see.
3. Evals decide whether the answer or the path was grounded.

## Phase 13 — Graph lab in `web/`

- [ ] `pipx install graphifyy` in CI / local scripts (`scripts/graphify-corpus.sh`)
- [ ] Build `graphify-out/` from the seed ops corpus + any GitHub ingest
- [ ] Serve `graph.html` from the lab (iframe or first-party vis of `graph.json`)
- [ ] Node tooltip copy in plain language: *what this is*, *what it connects to*, *why this edge exists*
- [ ] Query path overlay: when a RAG answer cites chunks, highlight those nodes and the shortest EXTRACTED path between them
- [ ] Keep ranking constants in `web/src/lib/rag/ranking.ts` frozen; graph is a new channel, not a retune of BM25/RRF

Non-negotiable UX: a teammate who does not know embeddings should understand the picture in under a minute.

## Phase 14 — RAG + GraphRAG evals

Keep the existing bars (A–N, unseen U1–U10, `POST /api/eval`, RAGAS-style judge). Add graph-aware checks:

| Check | Pass if |
|---|---|
| Path grounded | Answer path uses EXTRACTED edges, or labels INFERRED explicitly |
| Multi-hop | Questions that need 2+ docs pack both, or refuse |
| Isolation | Graph built from corpus A does not leak nodes from corpus B |
| Refusal | Off-corpus still returns *Not in the indexed corpus.* |
| Faithfulness | Judge still gates generation; graph does not override evidence gate |

Papers and surveys to track (read, do not copy APIs blindly):

- Microsoft GraphRAG (index + local/global; now maintenance-mode — take the *idea*, not the pipeline cost)
- GraphRAG surveys / Awesome-GraphRAG (knowledge-based vs index-based graphs)
- RAGAS + newer RAG eval work: faithfulness, citation precision, answer correctness, adversarial probes
- Hybrid retrieval literature already in the lab: dense + BM25 + RRF, calibrated pack floor

Expand golden set toward 50–100 production-sampled cases before any strict CI merge gate.

## Phase 15 — platform glue

- [ ] Optional: `graphify query` / MCP over `graph.json` next to `/api/query`
- [ ] Docker Compose for `rag-platform` + web lab
- [ ] Failure-feed promotion from traces into the golden set
- [ ] Dense hybrid on Vercel only with `DATABASE_URL` (Neon); never reopen PGLite on serverless

## Out of scope

- A second GitHub repo for the web app
- A second public Vercel project with team SSO on
- Retuning frozen ranking to chase U5 on keyword-only production
