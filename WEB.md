# Live web console

**Canonical source:** this monorepo. The browser lab lives in [`web/`](web/).

**Keep this live URL:** [https://intellirag-web.vercel.app/](https://intellirag-web.vercel.app/)

Do **not** use [https://intellirag-live-own-track.vercel.app/](https://intellirag-live-own-track.vercel.app/). That hostname is a Vercel Authentication / SSO gate on the `own-track` team. It is not a broken build of the app — visitors who are not logged into the team get sent to `vercel.com/login`. The working host is a public production deployment (no SSO).

## One repo, one live host

| Thing | Status |
|---|---|
| `charan-rathore/IntelliRAG` (`web/` + `rag-platform/`) | **Keep.** Source of truth. |
| Live host `https://intellirag-web.vercel.app/` | **Keep.** Public. |
| `charan-rathore/intellirag-web` | **Redundant mirror** of `web/`. Do not develop there. Delete the GitHub repo from Settings → Danger zone (API tokens here cannot delete repositories). |
| `https://intellirag-live-own-track.vercel.app/` | **Drop.** SSO-protected leftover. In Vercel → that project → Settings → Delete project (or turn off Deployment Protection if you still need the hostname). |

Vercel **Root Directory must be `web/`** when this monorepo is connected. Env vars stay on the Vercel project, never in git: `OPENROUTER_API_KEY` / `GEMINI_API_KEY` / `XAI_API_KEY`, optional `DATABASE_URL` (Neon) for dense hybrid, optional `GITHUB_TOKEN`.

You do **not** need an API key to try the public lab. Demo cards fire real queries. Without `DATABASE_URL` the lab is a **keyword index** (Ready / Extractive). Dense hybrid needs Neon.

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

Next: Graphify-backed knowledge-graph view + RAG eval loop — see [ROADMAP.md](ROADMAP.md).
