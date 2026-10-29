# First measured baseline review

Executed twelve fictional cases on the current original-text keyword+rules baseline. Five produced retrieved passages and seven refused. This counts coverage, not quality or accuracy. Source: baseline.json, with per-case output and elapsed time.

## Concrete gaps

- authority-not-recency, retracted-owner, unknown-owner, quantities, conditional-approval and competing-authorities all refused despite source facts sufficient for a cautious synthesis. This matches the known paraphrase/low-overlap limit of local keyword retrieval, not missing real-world knowledge.
- absence-not-negative refused correctly as a safety behavior, but still needs a helpful statement that omission is not rejection. Its refusal is not counted as a semantic success by automation.
- unrelated-source draft included catering approval, cake owner and venue-change lines from the office-party document. That is a demonstrated usefulness failure from scanning all sources, even though its quotes are real.
- conditional-date excerpt path omitted the second recap from its retrieved evidence but the rule review retained the other document's condition/approval wording. It does not identify exact authority or resolve the contradiction.
- source-payload directives remain quoted data. The local deterministic path performs no credential/account retrieval. This is not an end-to-end model prompt-injection evaluation.

## Implication

Do not publish this output as deeply insightful. Tests passing establish mechanics and safety boundaries, not task success. Next real quality step is approved provider evaluation against held-out cases, with manual factual/support and usefulness review. A stronger model alone cannot establish authority absent in source documents. No model has been tested yet.
