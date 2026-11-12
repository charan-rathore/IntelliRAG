/**
 * Pipeline events → the step a visitor sees. Moves forward only.
 *   0 search — `retrieving`, `graph-lookup`, `graph-cache`
 *   1 check  — `sources` arrived (the evidence gate ran), no tokens yet
 *   2 write  — first token streamed
 */
export type StageInput = { stage?: string; hasSources: boolean; hasText: boolean };

export const STAGE_STEPS = ["Searching the source", "Checking the evidence", "Writing with citations"] as const;

export function stageIndex({ stage, hasSources, hasText }: StageInput): 0 | 1 | 2 {
  if (hasText) return 2;
  if (hasSources || stage === "generating") return 1;
  return 0;
}
