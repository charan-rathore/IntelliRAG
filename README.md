# IntelliRAG

An experimental RAG systems lab built from first principles.

I wanted to know where retrieval-augmented generation actually breaks - not how to wrap another API. This repo implements the full pipeline so each layer can be measured: ingestion, chunking, embedding, indexing, hybrid retrieval, reranking, context assembly, citation-aware generation, evaluation, and observability.

**Status:** Phases 1-12 complete. Query API and CI quality gates operational. Benchmarks on a small deterministic corpus are labeled honestly (mock embeddings/LLM in CI; real Ollama optional).

**Repository:** [github.com/charan-rathore/IntelliRAG](https://github.com/charan-rathore/IntelliRAG)

See [WEB.md](WEB.md) for the dark-theme live console (`web/`).

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
