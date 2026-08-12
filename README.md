# IntelliRAG

An experimental RAG systems lab built from first principles.

I wanted to know where retrieval-augmented generation actually breaks - not how to wrap another API. This repo implements the full pipeline so each layer can be measured: ingestion, chunking, embedding, indexing, hybrid retrieval, reranking, context assembly, citation-aware generation, evaluation, and observability.

**Status:** Phases 1-12 complete. Query API and CI quality gates operational. Benchmarks on a small deterministic corpus are labeled honestly (mock embeddings/LLM in CI; real Ollama optional).

**Repository:** [github.com/charan-rathore/IntelliRAG](https://github.com/charan-rathore/IntelliRAG)

---

## Table of Contents

1. [What is This Project?](#what-is-this-project)
2. [Pipeline Architecture](#pipeline-architecture)
3. [What's Built (Phases 1-11)](#whats-built-phases-111)
4. [Evaluation Results](#evaluation-results)
5. [Tech Stack](#tech-stack)
6. [Project Structure](#project-structure)
7. [Getting Started](#getting-started)
8. [Query Console (UI)](#query-console-ui)
9. [Running Benchmarks & Evaluation](#running-benchmarks--evaluation)
10. [Observability Dashboard](#observability-dashboard)
11. [CI/CD Quality Gates](#cicd-quality-gates)
12. [Configuration](#configuration)
13. [Roadmap](#roadmap)

---

## What is This Project?

RAG systems answer questions by finding relevant document chunks, then generating answers grounded in that context. Most tutorials stop at `vectorstore.similarity_search() + llm.invoke()`. This lab builds every layer so you can see which one failed:

```
Ingest → Chunk → Embed → Index → Retrieve → Rerank → Assemble Context → Generate → Evaluate → Observe
```

**Design principles:** correctness over speed, local-first (Ollama, ChromaDB, no paid APIs), benchmark-driven defaults, structured logging, and CI quality gates.

### Who Is This For?

- Engineers learning production AI systems beyond API wrappers
- Teams building internal knowledge platforms
- Anyone who wants to understand *why* retrieval fails and *how* to measure it

---

## Evaluation philosophy

The detailed benchmarks below use a **2-document test corpus** with **mock embeddings** and **mock LLM** for deterministic CI. That is intentional. Precision can look low; some quality gates fail under strict thresholds. Relative patterns (hybrid vs dense, rerank lift) are what the lab is for.

Re-run with `--use-ollama` for real model scores. Expand the golden set before treating any number as production truth.

*(Full architecture, phase tables, eval numbers, setup, and ops docs follow unchanged in spirit from the prior README - see sections below.)*

---

## Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATA SOURCES                                    │
│         GitHub Issues  │  Markdown Docs  │  Runbooks  │  etc.               │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  INGESTION (Phase 1-2)          FastAPI + Celery Workers                    │
│  Webhook → Validate → Dedupe → Raw Store → Postgres (lifecycle tracking)    │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PROCESSING PIPELINE (Phases 3-5)                                           │
│  Chunk (5 strategies) → Embed (Ollama nomic-embed-text) → Index (ChromaDB) │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  QUERY PIPELINE (Phases 6-9)                                                │
│                                                                              │
│  Retrieve → Rerank → Context Assembly → Generate (Ollama + citations)       │
│  (hybrid)   (cross-enc)  (dedup/MMR/budget)   (G-Cite prompts)              │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  EVALUATION + OBSERVABILITY (Phases 10-11)                                  │
│  Quality gates │ Adversarial probes │ Metrics │ Tracing │ Dashboard         │
└─────────────────────────────────────────────────────────────────────────────┘
```

For phase-by-phase status, benchmarks, tech stack, project structure, getting started, query console, CI gates, configuration, and roadmap, see the remaining sections in the repository history and `docs/architecture/` plus `docs/engineering-journal.md`.

### Quick start

```bash
git clone https://github.com/charan-rathore/IntelliRAG.git
cd IntelliRAG/rag-platform
python -m venv .venv && source .venv/bin/activate
pip install -e ".[eval]"
```

See the full README history and `docs/` for complete setup (Postgres, Redis, Ollama), benchmark commands, and quality gate thresholds.

## License

MIT
