# Live web console

The dark-theme browser lab lives in this repository under [`web/`](web/). There is no separate `intellirag-web` GitHub repo.

- Folder: [`web/`](web/)
- Live (existing Vercel project): https://intellirag-web.vercel.app/
- Source of truth: `web/` at IntelliRAG `main` (imported from `intellirag-web@1769d99`)
- Python platform in `rag-platform/` is unchanged. No secrets in git. OpenRouter key is server-only.

```bash
cd web && npm install && npm run dev   # 127.0.0.1:8080
```

Point the Vercel project root at `web/` so production builds from this repo.

Acceptance harness (from `web/` with the server running): `node scripts/acceptance-hybrid.mjs`.
