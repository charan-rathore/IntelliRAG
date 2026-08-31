# IntelliRAG web console

Dark-theme live lab for the IntelliRAG platform. Hybrid retrieval (dense + BM25 + RRF) with `gemini-embedding-2` for index and query, Gemini 3.7 Flash for cited answers, Graphify cache, and a guided tour that spotlights the real control.

This directory is the console. The Python platform stays in `rag-platform/` and is unchanged.

Live: https://intellirag-web.vercel.app/

## Run

```bash
cd web
npm install
npm run dev
```

Server env only (never `VITE_`, never git):

- `OPENROUTER_API_KEY`
- `GEMINI_API_KEY` (optional, preferred for native embeddings)
- `DATABASE_URL` (Neon in production; omit locally)

## Sync from the live tree

Until Vercel is pointed at this repo's `web/` root, the deployable source of truth for https://intellirag-web.vercel.app/ is still `charan-rathore/intellirag-web`. Refresh this folder with:

```bash
./scripts/sync-web-console.sh
```
