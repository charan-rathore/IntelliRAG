# Self-Improvement Memory for the retrieval harness

After Yu et al., *Self-Improvement Memory Enables Continual Recursive Self-Improvement* (arXiv 2611.18856, November 2026).

**The harness.** Retrieval itself is fixed. The harness is the policy around it (`scripts/sim-optimize.ts`):
- how much experience counts: `boost`, `boostFloor`, `demoteBy`, `demoteSimilarity`;
- how context is packed: `relativeFloor`, `soloMargin`, rank or coverage packing, `maxPassages`, `chunkTokens`.

**The loop.** An optimizer edits the harness for N = 6 rounds, with k = 5 candidates per round:
- It scores candidates on an evolve split: two of the three wordings, the originals and the unanswerable questions.
- It keeps one only if it beats the current harness without answering more unanswerable questions.
- It is judged on a held-out wording it never sees.

**The memory, [`memory.json`](memory.json).** The paper's structure:
- one entry per recurring problem (root cause);
- each attempt records its edit, its rationale, the cases it predicted to fix, the cases it actually fixed and broke, the score change, and its provenance (setting and round).

Root causes are found automatically for every failing case:
- `not-retrieved`;
- `ranked-not-packed`;
- `refused`;
- `learned-noise` (learning broke an answer that worked without it);
- `false-answer`.

**Reading the memory.** The paper's proposer is an LLM. This one is deterministic, so CI reproduces it exactly. It reads every entry:
- It skips an edit already tried in this setting that didn't help.
- It keeps going in a direction that helped here.
- It revises, at half a step, one that helped only elsewhere.

The memory persists across runs (continual), so a second run starts from what the first one learned.

## Results ([`results.json`](results.json))

**Run 1** starts from the earlier defaults (`soloMargin` 1.35, `boostFloor` 0.25) on the clean corpus. It kept two edits:

| Round | Edit | Root cause it addressed | Evolve |
|---|---|---|---:|
| 1 | `soloMargin` 1.35 → 1.5 | ranked-not-packed: a strong rank-1 passage was packed alone when the answer needed two | 67.7% |
| 4 | `boostFloor` 0.25 → 0.2 | not-retrieved: rewordings share few words with the confirmed question | 69.4% |

- **Held-out wording on the clean corpus:** 52.9% → **58.8%**.
- **Carried to the distractor corpus:** held-out 58.8% (cold start) → **61.8%** (harness transfer).
- **An evaluation it never touched.** The conversation eval scores multi-turn follow-ups, and the optimizer never saw it. With `soloMargin` 1.5 it went from 71.8% to **76.9%** complete evidence, with follow-ups 77.3% → **86.4%**. Repo-support is unchanged on both corpora.

**Both edits are now the defaults** (`CONTEXT_SOLO_MARGIN`, `DEFAULT_EXPERIENCE_POLICY`).

**Run 2 and the target continuation** started from the new defaults. With the memory, run 2 skipped the edits run 1 had already seen fail (`maxPassages` 4, `relativeFloor` 0.56) and tried new ones (`relativeFloor` 0.68, `chunkTokens` 384). Nothing improved, so nothing was kept.

On the distractor target, the four CRSI conditions (cold start, harness transfer, problem-only memory, full SIM) accepted no edits in six rounds. So this data **doesn't separate full SIM from problem-only memory**: the paper's continuation gain doesn't show up here. That's an honest null with 34 evolve cases per fold and a deterministic proposer. The memory is in place, for an LLM proposer or a larger evaluation.

```sh
npx tsx scripts/sim-optimize.ts --failures     # what fails now, by root cause
npx tsx scripts/sim-optimize.ts --write        # one more run, appending to the memory
```
