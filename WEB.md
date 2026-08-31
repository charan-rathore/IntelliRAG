# Live web console

The dark-theme browser lab is part of this repository.

- Folder: [`web/`](web/)
- Live: https://intellirag-web.vercel.app/
- Tour: each step punches a hole around the real control (wordmark, Reading/Lab, Settings, corpus rail, pipeline tiles, source trace, knowledge graph, composer, feedback).
- Python platform in `rag-platform/` is unchanged. No secrets in git. OpenRouter key is server-only.

```bash
./scripts/sync-web-console.sh   # copy latest console into web/
cd web && npm install && npm run dev   # 0.0.0.0:8080
```

Merge this branch to put `web/` on main. Point the Vercel project root at `web/` when you want production to build from this repo instead of `charan-rathore/intellirag-web`.
