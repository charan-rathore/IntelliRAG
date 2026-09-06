# IntelliRAG Live

**This folder is the web lab. The GitHub source of truth is [charan-rathore/IntelliRAG](https://github.com/charan-rathore/IntelliRAG), not the old `intellirag-web` mirror.**

Browser RAG console over a small ops corpus. Retrieval is **hybrid when embeddings exist** (`gemini-embedding-2` cosine + BM25 + RRF + calibrated IDF/title rerank) and **keyword (BM25 + the same rerank) on Vercel without `DATABASE_URL`**. Answers are cited — Gemini 3.7 Flash when a key is present, otherwise extractive snippets from packed chunks.

**Live (keep):** [https://intellirag-web.vercel.app](https://intellirag-web.vercel.app)

**Do not use:** `https://intellirag-live-own-track.vercel.app/` — that URL is Vercel SSO on the `own-track` team, not a public app.

You do **not** need an API key to try it. Demo cards fire real queries. The header chip is **Ready** (or **Extractive** if no generation key) — not “Key needed”, and not “17 stale” when missing vectors are expected on serverless.

There is **no learned cross-encoder** and **MMR is not in the retrieval path**. Context packing uses a calibrated score floor (0.24) plus a relative drop versus rank-1 — that is not “similarity must be ≥ 0.55”.

See [WEB.md](../WEB.md) and [ROADMAP.md](../ROADMAP.md) (Graphify knowledge graph + eval loop).

## Local

```bash
npm install
npm run dev
```

## Keys (never in the browser)

Server env only — **not** `VITE_`, not git, not `localStorage`:

- `OPENROUTER_API_KEY` (or `GEMINI_API_KEY`) — optional; Flash answers + dense embeddings
- `XAI_API_KEY` — optional; Grok 4.5 answers when Gemini/OpenRouter are unset
- `DATABASE_URL` — **required on Vercel** for durable embeddings (Neon)
- `GITHUB_TOKEN` — optional, GitHub ingest rate limits
