# Live web console

The dark-theme browser lab lives in [`web/`](web/) and is mirrored at [`charan-rathore/intellirag-web`](https://github.com/charan-rathore/intellirag-web).

- Folder: [`web/`](web/)
- Live: https://intellirag-web.vercel.app/
- Python platform in `rag-platform/` is unchanged. No secrets in git.

You do **not** need an API key to try it. Demo cards fire real queries. On Vercel without `DATABASE_URL` the lab is a **keyword index** (Ready / Extractive) — not “Key needed” and not “17 stale”. Dense hybrid needs Neon.

Vercel **Root Directory must be `web/`** if this monorepo is connected. The split `intellirag-web` repo is Root Directory `.`.

Without `OPENROUTER_API_KEY` / `GEMINI_API_KEY`, answers still work: `XAI_API_KEY` (Grok 4.5) if present, otherwise extractive citations from packed chunks.

Serverless hosts never open PGLite. Missing wasm at `/var/task/_libs/pglite.data` used to blank the page; production without Neon now uses the in-memory seed corpus instead.

Measured on the live host (keyword, no `DATABASE_URL`): A–N retrieval/refusal **14/14**, unseen paraphrases **9/10** (U5 miss; ranking is frozen). Unit tests in `web/`: **41/41**. Local hybrid with embeddings: A–N **14/14**, unseen **10/10**.

```bash
cd web && npm install && npm run dev
```

Acceptance (from `web/`):

```bash
node scripts/acceptance-hybrid.mjs an            # local hybrid
ACCEPTANCE_BASE=https://intellirag-web.vercel.app node scripts/acceptance-hybrid.mjs an-live
```
