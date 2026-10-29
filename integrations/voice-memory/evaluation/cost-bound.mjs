/** Planning arithmetic only. Not a tokenizer, billing guarantee or grant. */
export function plannedCost({
  cases,
  inputTokensPerCase,
  outputTokensPerCase,
  inputUSDPerMillion,
  outputUSDPerMillion,
}) {
  for (const n of [
    cases,
    inputTokensPerCase,
    outputTokensPerCase,
    inputUSDPerMillion,
    outputUSDPerMillion,
  ])
    if (!Number.isFinite(n) || n < 0)
      throw Error("Nonnegative finite bounds required.");
  const result =
    (cases *
      (inputTokensPerCase * inputUSDPerMillion +
        outputTokensPerCase * outputUSDPerMillion)) /
    1e6;
  if (!Number.isFinite(result)) throw Error("Cost arithmetic overflow.");
  return result;
}
