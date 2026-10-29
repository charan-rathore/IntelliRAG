/** Evaluation orchestration only. Explicit provider injection; no credential
 * lookup or paid endpoint selected. Saves output in caller-provided sink.
 * A local request count is not a dollar cap or authorization.
 */
import { readFileSync } from "node:fs";
const splits = JSON.parse(
  readFileSync(new URL("./splits.json", import.meta.url), "utf8"),
);
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
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 12)
    throw Error("maxRequests requires a positive integer in range 1..12.");
  const byId = new Map(cases.map((item) => [item.id, item]));
  if (byId.size !== cases.length) throw Error("Duplicate case IDs.");
  const selected = splits[split].map((id) => {
    if (!byId.has(id)) throw Error(`Missing stable case ID: ${id}`);
    return byId.get(id);
  });
  if (selected.length > maxRequests)
    throw Error("Case count exceeds explicit request bound.");
  const receipts = [];
  for (const item of selected) {
    if (signal?.aborted) throw signal.reason || Error("Aborted");
    const started = performance.now();
    let record;
    let audit;
    try {
      const bundle = importBundle(item.documents);
      const auditedProvider = async (request) => {
        const config = provider.auditConfig;
        if (
          !config ||
          typeof config.model !== "string" ||
          typeof config.endpoint !== "string"
        )
          throw Error(
            "Auditable provider config required before evaluation network call.",
          );
        audit = {
          config: Object.fromEntries(
            [
              "model",
              "endpoint",
              "maxInputCharacters",
              "maxOutputTokens",
              "maxResponseBytes",
              "timeoutMs",
              "temperature",
              "responseFormat",
              "allowFallbacks",
              "dataCollection",
              "redirect",
            ]
              .filter((key) => Object.hasOwn(config, key))
              .map((key) => [key, config[key]]),
          ),
          request: {
            instructions: request.instructions,
            question: request.question,
            sources: request.sources,
          },
          receipt: null,
        };
        await save({
          id: item.id,
          split,
          status: "request-recorded",
          audit,
          modelQualityScore: null,
        });
        return provider({
          ...request,
          onRequest: async (wireRequest) => {
            audit.wireRequest = wireRequest;
            await save({
              id: item.id,
              split,
              status: "wire-request-recorded",
              audit,
              modelQualityScore: null,
            });
          },
          onReceipt: async (receipt) => {
            audit.receipt = receipt;
            await save({
              id: item.id,
              split,
              status: "response-recorded",
              audit,
              modelQualityScore: null,
            });
          },
        });
      };
      const result = await synthesize(item.question, bundle, auditedProvider, {
        signal,
      });
      record = {
        id: item.id,
        split,
        status: "needs-human-review",
        result,
        audit,
        elapsedMs: Math.round(performance.now() - started),
        modelQualityScore: null,
      };
    } catch (err) {
      record = {
        id: item.id,
        split,
        status: "failed",
        audit,
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
