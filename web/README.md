# IntelliRAG browser lab

[Live application](https://intellirag-live-own-track.vercel.app/) · [Deployment and provider setup](../WEB.md) · [Measured audit](../audit/REPORT.md)

This directory is deployed from **charan-rathore/IntelliRAG**, the sole canonical GitHub repository. The older `intellirag-web` repository has been retired.

The console exposes ingestion, chunking, indexing, retrieval traces, citations, evaluation and a lexical knowledge graph. With a persistent Postgres database and indexed `gemini-embedding-2` vectors, retrieval combines dense cosine search and BM25 using RRF. Without that setup on Vercel, it uses temporary keyword search and cited extractive answers. Capability claims must match the actual trace and `/api/health` status.

```bash
npm ci
npm run dev
npm run typecheck
npm run test:hardening
npm run test:persistence
npx --yes tsx --test src/lib/rag/*.test.ts
npm run build
```

See [WEB.md](../WEB.md) for private environment configuration, migrations, frozen production acceptance, cold-start verification and the distinction between pipeline checks and real answer-quality evaluation. No provider credentials belong in this repository.
