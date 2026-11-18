# Conversations: does a follow-up find its evidence?

Real use isn't one question. It is a question followed by "what if it's already running?" and "why not just call clear instead?". On their own, those follow-ups name almost nothing to search for. This evaluation measures whether the evidence for each turn reaches the reader once the turns before it are taken into account.

- **Data.** [`dataset.json`](dataset.json) has 14 conversations and 42 turns over the same frozen p-queue README as [`../repo-support`](../repo-support). The turns are labelled:
  - `open`: the first question.
  - `follow-up`: leans on earlier turns.
  - `switch`: changes topic and must not be dragged back.
  - `refuse`: the source can't answer it, however much history comes before.

  Every evidence quote is checked verbatim against the fixture.
- **Arms.** All three share retrieval, the support gate and the 1,400-token packing budget. Each carries its own earlier results forward, as a live session would.
  - `turn-only`: today's single-turn pipeline.
  - `concat-history`: every earlier question pasted in front.
  - `session-intent`: [`session-intent.ts`](../../web/src/lib/rag/session-intent.ts).
- **Scoring.** For answerable turns, whether every gold quote is in the packed text. For `refuse` turns, whether the turn was refused. No model runs.

Run it from `web`:

```sh
npx tsx scripts/conversation-eval.ts               # clean corpus
npx tsx scripts/conversation-eval.ts --distractors # plus the ten seed runbooks as noise
```

## Results

| Arm | Complete evidence | Follow-ups | Refused (of 3) | Complete, with distractors | Refused, with distractors |
|---|---:|---:|---:|---:|---:|
| turn-only | 64.1% | 63.6% | 1 | 64.1% | 1 |
| concat-history | **76.9%** | **86.4%** | 1 | **76.9%** | 1 |
| session-intent | **76.9%** | **86.4%** | **2** | **76.9%** | **2** |

Session intent finds the evidence for 22.8 more points of follow-ups than the single-turn pipeline. It ties pasting the whole history on evidence, and refuses one more unanswerable follow-up, because context may help find a passage but never makes an unsupported question look answered.

These numbers include `soloMargin` 1.5, an edit the self-improvement loop ([`../sim`](../sim)) found on a different evaluation. Before it, follow-ups were 77.3% (session intent) and 59.1% (turn-only).

**What lost.** The first design carried a handful of weighted terms (historical query expansion with idf weights and decay). It scored 64–69%: whole earlier questions keep the phrases BM25 and the phrase signal match on, and carried terms like "every" and "second" were noise. Weighting question terms by whether that turn's own evidence contained them made the term list a good *description* of the session, which is what the console now shows. It did not make it a better search. Both designs are in the git history of this file and `session-intent.ts`.

**Limits.**
- The sample is small: 22 follow-ups and 3 refusals, so one turn moves a rate by 4.5 to 33 points.
- The annotations are first-party.
- Topic switches score 33% in every arm, because the switch questions are hard for the base retriever.
- Feedback (thumbs up or dead end on an answer) is covered by unit tests, not by this evaluation.

CI runs both corpora with `--check`. It fails if session intent ever finds less evidence, or refuses fewer turns, than the single-turn pipeline.

Runs: [`runs/clean`](runs/clean/results.json), [`runs/distractors`](runs/distractors/results.json).
