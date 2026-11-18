# Learning: does IntelliRAG get better at a corpus as people use it?

Every rated answer is filed back against the passages it was built from (experience memory, [`experience.ts`](../../web/src/lib/rag/experience.ts)). A later question worded differently can then find the passage through the wordings people confirmed for it. This is document expansion from real queries (doc2query with the query log as the generator) and the "file good answers back" step of Karpathy's LLM-wiki pattern, applied per passage so citations still point at the untouched source.

- **Data.** [`paraphrases.json`](paraphrases.json) holds three rewordings of each of the 14 answerable repo-support questions: a terse search query, a casual question, and one that avoids the README's vocabulary. It also has 6 rewordings of unanswerable questions. Gold evidence comes from [`../repo-support`](../repo-support).
- **Protocol.** For each fold, people ask the original questions and the other two wordings, then rate every answer:
  - **Useful** when it contains the gold evidence, a **dead end** otherwise.
  - In the "source picks" arms, after a miss the person also marks the passage that answers it if it is among the eight candidates in the Evidence panel. This is the new "This passage answers my question" button.

  The held-out wording is then scored. It was never asked. All three folds are averaged.
- **Scoring.** Complete evidence in the packed context (1,400-token budget), as in the other evals. No model runs.

```sh
npx tsx scripts/learning-eval.ts                # clean corpus
npx tsx scripts/learning-eval.ts --distractors  # plus the ten seed runbooks
```

| Arm | Held-out wordings (clean) | Originals (clean) | Held-out (distractors) | Originals (distractors) | Refused |
|---|---:|---:|---:|---:|---:|
| no experience | 50.0% | 71.4% | 52.4% | 85.7% | 3/6 |
| ratings on the originals | 54.8% | 78.6% | 54.8% | 78.6% | 3/6 |
| ratings on originals and other wordings | 54.8% | 76.2% | 54.8% | 85.7% | 3/6 |
| **plus source picks** | **54.8%** | **81.0%** | **54.8%** | **85.7%** | 3/6 |
| plus source picks, 20% of ratings wrong | 54.8% | 81.0% | 54.8% | 85.7% | 3/6 |

What learning buys:
- Questions people already asked come back better: +9.6 points on the clean corpus.
- New wordings improve by 2.4 to 4.8 points.
- Wrong ratings (20%) cost nothing measurable.
- Nothing that should be refused is answered.

The gains are modest and the sample is small: one question is 2.4 points.

**What didn't work, and why the design is what it is**
- **Expansions counted as passage text.** Adding confirmed wordings to a passage's text, as plain doc2query does, made passages that turned up beside many answers into hubs that matched everything. On the distractor corpus it cut the originals from 85.7% to 52.4%. Now only wordings that resemble the current question count. They find and lift a passage, and never stand in for what its text says.
- **Reliability over all of a passage's ratings.** This let incidental passages outrank the one that answers. Reliability now counts only ratings on similar questions, with a Beta(1,1) prior.
- **Support without the source.** A confirmation can count as support only when it is close (similarity × reliability ≥ 0.45). Even then, the guards that read the source still refuse: absent names and the turn's own terms.

CI runs both corpora with `--check`. It fails unless learning improves held-out wordings without costing originals or refusals.
