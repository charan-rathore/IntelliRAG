# Delivery workflow

The user requests continuous GitHub progress: commit and push each small, successfully verified feature or fix before starting the next increment. Run checks appropriate to the change, keep commits focused, and verify production after deployment. Do not include secrets, temporary debug probes, or unrelated work.

For nontrivial tasks, follow [the Codex + REA evidence-driven workflow](docs/engineering/codex-rea-workflow.md). REA is optional and should only inspect authorized opaque software when direct source/tests are insufficient. Reproduce before fixing, show evidence and test results, and preserve failed/untested states accurately. Never treat documentation-only work as proof that release gates passed. Require explicit approval before infrastructure spending, secrets changes, destructive commands, production deployment or merging.
