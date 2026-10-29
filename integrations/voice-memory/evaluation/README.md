# Scattered-context evaluation

Twelve synthetic, clearly fictional cases. These are challenge fixtures, not customer interviews or proof of model performance. Models have NOT run on them yet.

For each model, score independently: (1) required distinctions recovered; (2) no forbidden invention; (3) exact quote support for each factual statement; (4) correct current/conditional/unknown status; (5) draft has a specific useful question or action and excludes irrelevant material; (6) inferred implication clearly separated from source facts. Fail a case on invented approval, wrong authority, dropped prerequisite, cross-client disclosure or unsupported commitment. Read drafts manually; schema/quotes alone are not a semantic judge. Keep latency/token/cost receipts separately. Compare to current extractive and rule-grouping baselines, which are expected to miss some criteria.

Do not tune prompts on all cases then claim held-out improvement. Initial split: development cases1-6, evaluation cases7-12. Save raw outputs and score before changing prompts. More varied held-out documents are needed before any production reliability claim.
