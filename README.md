# IntelliRAG

**Retrieval that decides what it can prove before a model speaks.**

Ask a question about a pinned source. IntelliRAG finds the passages, checks whether they actually support an answer, packs them into a fixed token budget, and tells you which parts of your question the context never mentions. If the evidence isn't there, it refuses instead of improvising.

[**Try the live console**](https://intellirag-live-own-track.vercel.app/) · [Interactive architecture](https://intellirag-live-own-track.vercel.app/architecture.html) · [Browser walkthrough](https://intellirag-live-own-track.vercel.app/walkthrough) · [Measured evaluation](eval/repo-support/README.md) · [Code graph](docs/codegraph/README.md)

![How a question becomes a cited answer or a refusal: 1 ask, 2 query, 3 rank, 4 check support (refuse if nothing is supported), 5 pack within 1,400 tokens, 6 measure coverage, 7 answer, 8 answer with trace; A ingest a pinned GitHub source, B optional model, C a frozen eval replays the same functions](docs/images/architecture.png)

Follow the numbers. **1–2**: you ask. **3–7**: the evidence is decided *before* any model runs. **8**: you get the answer, its citations, and the question terms nothing in the context covers. **A–C** happen offline: ingest at a pinned commit, an optional model, and a frozen evaluation that calls the same functions the server does.

## The problem

Retrieval-augmented systems rarely fail by answering from nothing. They fail by answering *with* sources attached. In a 2026 penalty-aware audit, 98% and 100% of two commercial RAG products' wrong answers came with cited sources or grounding chunks ([arXiv:2608.26385](https://arxiv.org/abs/2608.26385)). Practitioners describe the same failure: the retriever returns something topically close, and the model fills the gap convincingly.

Most of these errors happen when the retrieved context is *relevant but insufficient* ([Sufficient Context, ICLR 2025](https://arxiv.org/abs/2411.06037)). So IntelliRAG treats "is this enough to answer?" as a first-class, inspectable decision, not something left to the prompt.

## What it does differently

| Stage | Decision | Where |
|---|---|---|
| Retrieve | BM25, plus dense vectors only when compatible stored embeddings exist, fused with RRF | [`retrieve-core.ts`](web/src/lib/rag/retrieve-core.ts) |
| Rerank | A calibrated mix of idf recall, phrase and title overlap. It is not a cross-encoder and not a confidence score. | [`ranking.ts`](web/src/lib/rag/ranking.ts) |
| Gate | A passage needs a support floor and distinctive overlap; a decisive rank-1 margin keeps only that source. If nothing passes, the answer is a refusal with no citations. | [`ranking.ts`](web/src/lib/rag/ranking.ts), [`evidence.ts`](web/src/lib/rag/evidence.ts) |
| Pack | 1,400-token budget. Passages are verbatim slices of the stored chunk, code fences are never split, and a chunk that doesn't fit is trimmed to its most relevant contiguous paragraphs. | [`ranking.ts`](web/src/lib/rag/ranking.ts), [`coverage-pack.ts`](web/src/lib/rag/coverage-pack.ts) |
| Measure | Lists the question terms (function words and quantities removed) that appear in no packed passage, shown under every answer | [`coverage-pack.ts`](web/src/lib/rag/coverage-pack.ts), [`context-coverage.tsx`](web/src/components/rag/context-coverage.tsx) |
| Answer | With a server or visitor key: temperature 0 and a cite-or-refuse prompt. Without one: cited extracts, labelled as extracts. | [`query.server.ts`](web/src/lib/rag/query.server.ts) |
| Cache | Keyed by question, corpus and a policy hash covering retrieval mode, evidence policy, model and graph edits. Corrections invalidate it. | [`graphify/persist.server.ts`](web/src/lib/rag/graphify/persist.server.ts), [`query.server.ts`](web/src/lib/rag/query.server.ts) |

The coverage line reads like this on a question the source can't settle:

> **5/9 question terms in context** · not found: `server` `processes` `durable`

That is the honest summary of "does this README establish a shared, durable rate limit across three servers?": it doesn't.

## Measured, including what lost

One pinned README ([sindresorhus/p-queue](https://github.com/sindresorhus/p-queue) at `180ab9e`), 15 answerable questions with exact evidence anchors, 5 that must be refused, and the same 1,400-token budget for every arm. No model runs in these numbers; they measure whether the required evidence reached the reader.

| Arm | Clean corpus | + distractor documents | Refused 5/5 |
|---|---:|---:|:---:|
| Plain BM25 | 73.3% | 63.3% | — |
| IntelliRAG, rank-order packing (**default**) | 73.3% | **83.3%** | ✓ |
| IntelliRAG, coverage-aware packing (opt-in) | **76.7%** | 73.3% | ✓ |

The default ties BM25 on the clean corpus and beats it by 20 points once noise documents are mixed in. The coverage packer wins one extra question on the clean corpus, but the gain's bootstrap interval is [−10, +20] points, and it loses 10 points under distractors. So it stays opt-in. Every run, including the losing ones, is in [`eval/repo-support/runs/`](eval/repo-support/runs/), and the [evaluation write-up](eval/repo-support/README.md) covers method, history and limits.

## Tested on real GitHub issues

![170 real GitHub issues, before and after](eval/github-issues/chart.svg)

Paste a bug report and IntelliRAG ranks the repository's files. I tested it on 170 real issues from django, scikit-learn, sphinx and pytest (SWE-bench Lite), using the reporter's own text. The file the fix changed now comes first 45.3% of the time, up from 35.3%, and is in the top 5 65.9% of the time, up from 60.6%. No model is involved. The gain comes from reading the code an issue names (traceback paths, `module.Class`, function calls) and linking it to the files that define it. Settings were tuned on different issues (sympy). Method, per-repository numbers and a negative result: [eval/github-issues](eval/github-issues/README.md).

## It sleeps

The design follows Google's "Language Models Need Sleep" (Behrouz, Hashemi, Mirrokni) and Self-Improvement Memory (Yu et al., arXiv 2611.18856). IntelliRAG has no weights to train, so the sleep acts on its memory:

| Phase | What happens | Guard |
|---|---|---|
| Awake | Every rated answer and every picked source is filed against the passages it came from. | The source text is never edited. |
| Replay | During sleep, the questions people confirmed are asked again. | This is the metric. |
| Consolidate | It learns which words people use for which words the sources use. | Kept in separate memory; the source's term statistics never change. |
| Dream | It writes practice questions for passages nobody has asked about: words hidden in identifiers, section context, people's vocabulary, or a model's questions when one is configured. | Each dream is tried on a copy of memory. It is kept only if its passage is now found, no confirmed question is lost, and no dead end comes back. A final full replay rolls back the whole sleep if anything slipped through. |
| Journal | Each strategy's kept-of-tried count and the reason for every rejection are recorded. | The next sleep budgets toward what worked and pauses a strategy that failed twice running. |

It sleeps by itself after every 8 ratings, or when you press **Sleep now** in the Memory panel. The panel shows what was kept and why everything else wasn't.

**Measured honestly.** On the 14-question rewording test, one sleep neither helped nor hurt (54.8% before and after on held-out wordings). On the GitHub issues, sleep's guard cut the damage of a memory that didn't transfer from −6.5 to −1.8 points, but didn't turn it into a gain. The gains so far come from ratings and picks (held-out rewordings 50.0% → 54.8%, original questions 71.4% → 81.0%) and from the code links above. With a model configured, the model-written dream strategy is where the paper expects the bigger effect. That hasn't been measured here yet.

**Answers never stop mid-sentence.** If the model runs out of output budget, it continues from where it stopped. If it still can't finish, the answer is cut back to its last whole sentence or list item, with a one-line note.

## It gets better the more it's used

Three loops improve IntelliRAG as people use it. Each is measured on held-out data, and each can only add evidence: none of them can make an unsupported question look answered.

| Loop | What it learns | Measured |
|---|---|---|
| **Conversation** ([`session-intent.ts`](web/src/lib/rag/session-intent.ts)) | A follow-up is searched with the earlier questions on its topic | Follow-ups with complete evidence: 63.6% → **86.4%**, refusals 1/3 → 2/3 ([eval](eval/conversations/README.md)) |
| **Experience** ([`experience.ts`](web/src/lib/rag/experience.ts)) | A rated answer, or a passage picked as the one that answers a question, is filed against that passage. Later questions worded like it find it. | Originals asked again: 71.4% → **81.0%**; new wordings +2.4 to +4.8 points; 20% wrong ratings cost nothing ([eval](eval/learning/README.md)) |
| **Self-improvement memory** ([`sim-optimize.ts`](web/scripts/sim-optimize.ts), after [arXiv 2611.18856](https://arxiv.org/abs/2611.18856)) | The retrieval policy is edited round by round. Each attempt is recorded with its root cause, rationale, predicted fixes and observed result. | Held-out wording 52.9% → **58.8%**. Its accepted packing edit also lifted the follow-up eval it never saw by 9 points ([write-up, including the null result](eval/sim/README.md)) |

Experience is the "file good answers back" step of [Karpathy's LLM-wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f), done per passage: the source is never edited, and links go stale when the passage they learned about changes. Agents get the same memory through the MCP server's `feedback` tool. It is kept per repository, so a repo keeps learning across sessions.

## Search like GitHub code search

Press ⌘K (Ctrl+K) to search every indexed source instantly. It splits identifiers
(`parseJSONResponse` matches "parse json response"), weights function names and
docstrings, and takes operators: `path:src/queue`, `lang:ts`, `sym:resume`,
`kind:prose`, `"exact words"`, `-word`. Results show the matching lines
highlighted, with "did you mean" for typos and completions from your sources.
The same engine answers `GET /api/search?q=…&corpus=…`.

On CoSQA (313 real web queries, 6,267 Python functions) it scores 46.4 nDCG@10
against 42.9 for plain BM25, with no model. Details and an honest comparison with
dense retrievers: [eval/code-search](eval/code-search/README.md).

## Research behind the design

| Paper | What we took | Status here |
|---|---|---|
| [Sufficient Context](https://arxiv.org/abs/2411.06037) (Joren et al., ICLR 2025) | Errors concentrate where context is relevant but insufficient, so expose sufficiency before trusting fluency | Lexical proxy shipped on every answer; an LLM autorater is not used |
| [AdaGReS](https://arxiv.org/abs/2512.25052) (2025) | Redundancy-penalised greedy selection under a token budget with an adaptive penalty | Implemented in `coverage-pack.ts`; opt-in after measurement |
| [Lin & Bilmes](https://aclanthology.org/P11-1052/) (ACL 2011) | Cost-benefit greedy plus a best-single-unit check for knapsack-constrained submodular selection | Implemented; the guarantee holds only without the redundancy term |
| [Recall Is Not Enough](https://arxiv.org/abs/2607.00725) (2026) | Score what the packed context contains, not the candidate list | The eval scores the text actually packed, after trimming |
| [Lost in the Middle](https://arxiv.org/abs/2307.03172) (TACL 2024) | Position matters; keep the strongest evidence first | The top supported chunk is the whole-chunk anchor |

## Use it from your coding agent

IntelliRAG also runs as an MCP server with no dependencies, so Claude Code, Codex, Hermes or any MCP client can answer from a repository's docs with citations, or refuse:

~~~sh
claude mcp add intellirag -- npx -y github:charan-rathore/IntelliRAG                    # Claude Code
codex mcp add intellirag -- npx -y github:charan-rathore/IntelliRAG                     # Codex
hermes mcp add intellirag --command npx --args -y github:charan-rathore/IntelliRAG     # Hermes Agent
~~~

```
> index_folder                        (the repo you're in, or index_github owner/repo at a pinned commit)
> ask  "How do I cancel a queued task with an AbortSignal?"   session: fix-1234
  3 supported passages from sindresorhus/p-queue@180ab9e …
> ask  "What if it is already running?"                        session: fix-1234
  Reading: Read as a follow-up: searched together with the previous question (about abortsignal, cancel).
  [readme.md#14] readme.md › options › signal
  If the operation is already running, the signal will need to be handled by the operation itself.
> ask  "What production database password does it specify?"   session: fix-1234
  REFUSED. Nothing in this corpus passed the support gate for this question.
```

It exposes seven tools: `index_folder`, `index_github`, `ask`, `search`, `feedback`, `new_topic` and `sources`. They call the same retrieval, support gate, packing and conversation reading as the console (`web/src/lib/rag`), bundled into [`mcp/dist`](mcp/dist/intellirag-mcp.mjs) and checked over stdio in CI. The agent skill is [`skills/intellirag/SKILL.md`](skills/intellirag/SKILL.md), written to Hermes Agent's authoring standard. The Hermes catalog entry is [`integrations/hermes/manifest.yaml`](integrations/hermes/manifest.yaml).

## Run it

~~~sh
git clone https://github.com/charan-rathore/IntelliRAG.git
cd IntelliRAG/web
npm ci
npm run dev            # http://localhost:8080, pinned source works without a key
~~~

~~~sh
npm run typecheck && npm run build
npx tsx --test src/lib/rag/*.test.ts                 # retrieval, gate, packing, persistence
npx tsx scripts/repo-support-eval.ts                 # the measured table above, no network
npx tsx scripts/repo-support-eval.ts --distractors   # the noise stress test
~~~

[WEB.md](WEB.md) covers the Vercel setup, security posture and release gate. Durable imports, persistent semantic search and provider generation need private configuration; they aren't a frontend toggle.

## Repository map

```mermaid
flowchart LR
  subgraph web["web/ · the served app"]
    UI["src/components<br/>console, inspector, coverage"] --> Q["lib/rag/query.server.ts<br/>stream: sources → tokens → done"]
    Q --> R["retrieve-core.ts<br/>BM25 · dense · RRF"]
    R --> K["ranking.ts<br/>rerank · gate · pack"]
    K --> C["coverage-pack.ts<br/>budgeted selection · coverage"]
    R --> E["evidence.ts<br/>classify support"]
    Q --> S["store.server.ts<br/>Postgres / PGlite · cache"]
    I["ingest.server.ts<br/>chunking · GitHub · SSRF guard"] --> S
  end
  EV["web/scripts/repo-support-eval.ts"] -.same functions.-> R
  PY["rag-platform/<br/>Python reference + benchmarks"]
```

[`docs/codegraph/`](docs/codegraph/README.md) is a generated dependency graph of the whole repository (files, imports, hubs and import cycles), rebuilt with `node scripts/codegraph.mjs`. Start there to find the blast radius of a change. The Python [`rag-platform/`](rag-platform/) is a separate benchmark and reference implementation; it is not the serving runtime.

## Limits

- The evaluation is one README with project-authored annotations. Both splits have been inspected, so the results are exploratory, not a blind holdout.
- The public host has no durable vector index or server model key. It shows keyword retrieval and cited extracts honestly; it doesn't demonstrate production semantic RAG.
- The coverage check is lexical. A paraphrase can answer a "missing" term, and a matched term can still be used in an unrelated sense.
- The graph view shows lexical document links, not verified entity extraction.

The target is verified task completion per unit of compute. A change ships when it beats the frozen baseline at the same budget and its failures are published.

## License

MIT
