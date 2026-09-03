# Live web console

The dark-theme browser lab lives in this repository under [`web/`](web/). The split `intellirag-web` GitHub repo is gone — this folder is the source of truth.

- Folder: [`web/`](web/)
- Live: https://intellirag-web.vercel.app/
- Python platform in `rag-platform/` is unchanged. No secrets in git.

Vercel **Root Directory must be `web/`**. A root `vercel.json` also builds `web/` if the project is connected at the repo root.

Without `OPENROUTER_API_KEY` / `GEMINI_API_KEY`, the live site still answers: `XAI_API_KEY` (Grok 4.5) if present, otherwise extractive citations from packed chunks. Dense retrieval still needs `DATABASE_URL` (Neon).

```bash
cd web && npm install && npm run dev   # 127.0.0.1:8080
```

Acceptance harness (from `web/` with the server running): `node scripts/acceptance-hybrid.mjs`.
