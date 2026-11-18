---
name: intellirag
description: Answer from a repo's docs with citations or refuse.
version: 0.1.0
author: Charan Rathore (charan-rathore), Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [RAG, Retrieval, Citations, GitHub, Documentation, MCP]
    category: research
    related_skills: [github-code-review, arxiv]
---

# IntelliRAG Skill

Answers questions about a codebase or its documentation from the passages that actually support the answer. When nothing does, it refuses, so the agent never states something the source doesn't say. Follow-up questions in one session are read together with the earlier questions on their topic. This skill does not generate prose: the agent writes the answer from the passages it is given.

## When to Use

- Questions about how a library, service or repository behaves ("does `onIdle` wait for running tasks?").
- Before citing documentation in a PR description, review comment or issue reply.
- Comparing what a dependency's README promises with how the code uses it.
- Do not use it for general knowledge, or for files that are faster to read whole with `read_file`.

## Prerequisites

The `intellirag` MCP server, with Node 20 or newer. It has no API keys and no other dependencies.

```yaml
# ~/.hermes/config.yaml
mcp_servers:
  intellirag:
    command: npx
    args: ["-y", "github:charan-rathore/IntelliRAG"]
    env:
      GITHUB_TOKEN: ${GITHUB_TOKEN}   # optional: raises GitHub's rate limit for index_github
```

Claude Code: `claude mcp add intellirag -- npx -y github:charan-rathore/IntelliRAG`.
Codex: add `[mcp_servers.intellirag]` with `command = "npx"` and `args = ["-y", "github:charan-rathore/IntelliRAG"]` to `~/.codex/config.toml`.

## How to Run

1. Index once per task: `index_folder` for the repository you are in (`path` defaults to the working directory), or `index_github` with `repo: owner/name` for a dependency. A repo is pinned to the commit its ref points at now.
2. Ask with one `session` id per task: `ask(question, session)`. Reuse the id for follow-ups.
3. Write the answer only from the returned passages, citing `file › heading`.
4. If the result says **REFUSED**, tell the user the source doesn't establish it. Don't answer from memory.
5. Optionally call `feedback(session, ref, helpful)` on a passage, so later follow-ups lean toward the right part of the docs.

## Quick Reference

| Tool | Use |
|---|---|
| `index_folder` | Index docs and source in a local folder (`include: docs` for Markdown only) |
| `index_github` | Index a GitHub repo at a pinned commit (docs by default, `include: all` for source) |
| `ask` | Supported passages, or a refusal; reads follow-ups with the session |
| `search` | Ranked candidates before the support gate, for exploring only |
| `feedback` | Mark a passage helpful or not for this session |
| `new_topic` | Clear a session so the next question is searched on its own |
| `sources` | List indexed corpora and their pinned origins |

## Procedure

1. `sources` to see what is already indexed. Index only if the corpus you need is missing.
2. Ask the user's question as they phrased it. Don't add keywords yourself: the session reading does that and shows what it added under `Reading:`.
3. Read `Not mentioned in any passage:` and leave those parts of the question unanswered, or say they aren't covered.
4. For a different subject in the same task, call `new_topic` or use a new session id.

## Pitfalls

- `search` results are candidates, not evidence. Only cite what `ask` returns.
- Passing a new session id on every call turns follow-ups back into fresh questions.
- A refusal is a result, not an error. Don't retry with paraphrases to get around it.
- Large monorepos: index a subfolder (`path: packages/core`) rather than the whole tree.

## Verification

`ask` with a question the corpus can't answer ("What production database password does this repository specify?") must return `REFUSED` with no passages. A follow-up such as "what if it is already running?" after a question about cancelling with an AbortSignal should show `Reading: Read as a follow-up` and cite the passage about running operations.
