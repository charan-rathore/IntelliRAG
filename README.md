# IntelliRAG

An experimental RAG systems lab built from first principles.

I wanted to know where retrieval-augmented generation actually breaks - not how to wrap another API. This repo implements the full pipeline so each layer can be measured: ingestion, chunking, embedding, indexing, hybrid retrieval, reranking, context assembly, citation-aware generation, evaluation, and observability.

**Status:** Phases 1-12 complete. Query API and CI quality gates operational. Benchmarks on a small deterministic corpus are labeled honestly (mock embeddings/LLM in CI; real Ollama optional).

**Repository:** [github.com/charan-rathore/IntelliRAG](https://github.com/charan-rathore/IntelliRAG)

## Live web console

The dark-theme browser lab lives in [`web/`](web/) on this repo (same functionality as the standalone lab; Python in `rag-platform/` is untouched).

- Guided tour cuts a hole around the **actual** control it is describing
- Hybrid retrieve + Graphify cache + answer feedback
- Live: [intellirag-web.vercel.app](https://intellirag-web.vercel.app/)

```bash
cd web
npm install
npm run dev   # 0.0.0.0:8080
```

Server env only: `OPENROUTER_API_KEY`, optional `GEMINI_API_KEY`, optional `DATABASE_URL`.
Refresh `web/` from the live tree with `./scripts/sync-web-console.sh`.

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

The rest of this README (pipeline, eval numbers, local Python setup) is unchanged from main.
