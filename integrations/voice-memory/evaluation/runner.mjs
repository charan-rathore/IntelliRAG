/** Evaluation orchestration only. Explicit provider injection; no credential
 * lookup or paid endpoint selected. Saves output in caller-provided sink.
 * A local request count is not a dollar cap or authorization.
 */
import { importBundle } from "../dist/engine.mjs";
import { synthesize } from "../synthesis.mjs";
export async function runEvaluation({
  cases,
  provider,
  save,
  split = "evaluation",
  maxRequests = 6,
  signal,
}) {
  if (typeof provider !== "function" || typeof save !== "function")
    throw Error("Explicit provider and private output sink required.");
  if (!["development", "evaluation"].includes(split))
    throw Error("Named split required.");
  const selected =
    split === "development" ? cases.slice(0, 6) : cases.slice(6, 12);
  if (selected.length > maxRequests)
    throw Error("Case count exceeds explicit request bound.");
  const receipts = [];
  for (const item of selected) {
    if (signal?.aborted) throw signal.reason || Error("Aborted");
    const started = performance.now();
    let record;
    try {
      const bundle = importBundle(item.documents);
      const result = await synthesize(item.question, bundle, provider, {
        signal,
      });
      record = {
        id: item.id,
        split,
        status: "needs-human-review",
        result,
        elapsedMs: Math.round(performance.now() - started),
        modelQualityScore: null,
      };
    } catch (err) {
      record = {
        id: item.id,
        split,
        status: "failed",
        error: err instanceof Error ? err.message : "Evaluation failed",
        elapsedMs: Math.round(performance.now() - started),
        modelQualityScore: null,
      };
    }
    await save(record);
    receipts.push({ id: record.id, status: record.status });
  }
  return receipts;
}
