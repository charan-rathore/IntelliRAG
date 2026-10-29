/** Bounded development-only execution policy. No credentials or network chosen.
 * Caller verifies account, permission and remote lifetime key cap separately.
 * Recorded usage is settlement evidence, never an exact pre-charge guarantee.
 */
import { runEvaluation } from "./runner.mjs";
export async function runDevelopment({
  cases,
  provider,
  save,
  approvedUSD,
  signal,
}) {
  if (!Number.isFinite(approvedUSD) || approvedUSD <= 0 || approvedUSD > 0.25)
    throw Error("Explicit positive approval no greater than $0.25 required.");
  if (typeof provider !== "function" || typeof save !== "function")
    throw Error("Explicit provider and private durable sink required.");
  let spentUSD = 0;
  let calls = 0;
  let responseSeen = false;
  const guardedSave = async (record) => {
    await save(record);
    if (record.status === "request-recorded") {
      if (spentUSD >= approvedUSD || calls >= 6)
        throw Error("Development budget or request limit exhausted.");
      calls++;
      responseSeen = false;
    }
    if (record.status === "response-recorded") {
      if (responseSeen) throw Error("Duplicate response accounting receipt.");
      const cost = record.audit?.receipt?.usage?.cost;
      if (!Number.isFinite(cost) || cost < 0)
        throw Error(
          "Missing or invalid returned usage cost; stop for reconciliation.",
        );
      responseSeen = true;
      spentUSD += cost;
      if (!Number.isFinite(spentUSD) || spentUSD > approvedUSD)
        throw Error("Reported cost exceeds approval; stop and reconcile.");
    }
    if (record.status === "failed")
      throw Error("Development case failed; no further requests.");
    if (record.status === "needs-human-review" && !responseSeen)
      throw Error("No usage receipt; stop for reconciliation.");
  };
  const receipts = await runEvaluation({
    cases,
    provider,
    save: guardedSave,
    split: "development",
    maxRequests: 6,
    signal,
  });
  return {
    receipts,
    reportedCostUSD: spentUSD,
    requestCount: calls,
    qualityScore: null,
  };
}
