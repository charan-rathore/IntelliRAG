import type { GraphOutcome, GraphState, LearningNode, LearningSidecar, MemoryDoc } from "./schema";
import { GRAPHIFY_HALF_LIFE_DAYS, GRAPHIFY_MIN_CORROBORATION } from "./schema";

const SIGN: Record<GraphOutcome, number> = {
  useful: 1,
  dead_end: -1,
  corrected: -0.7,
};

/**
 * graphify reflect(): time-decayed signed scores, min corroboration 2 for preferred.
 * Learning is a sidecar — never stamped into graph.json.
 */
export function reflect(state: GraphState, now = Date.now()): LearningSidecar {
  const byNode = new Map<string, MemoryDoc[]>();
  for (const doc of state.memory) {
    if (!doc.outcome) continue;
    for (const id of doc.source_nodes) {
      if (!byNode.has(id)) byNode.set(id, []);
      byNode.get(id)!.push(doc);
    }
  }
  const half = GRAPHIFY_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000;
  const nodes: LearningNode[] = [];
  for (const [id, docs] of byNode) {
    let score = 0;
    let useful = 0;
    let dead = 0;
    let corrected = 0;
    for (const d of docs) {
      const age = Math.max(0, now - new Date(d.date).getTime());
      const decay = Math.pow(0.5, age / half);
      const outcome = d.outcome as GraphOutcome;
      score += SIGN[outcome] * decay;
      if (outcome === "useful") useful += 1;
      if (outcome === "dead_end") dead += 1;
      if (outcome === "corrected") corrected += 1;
    }
    const rounded = Number(score.toFixed(9));
    let verdict: LearningNode["verdict"] = "tentative";
    if (dead > 0 && useful === 0) verdict = "dead_end";
    else if (useful > 0 && dead > 0) verdict = "contested";
    else if (useful >= GRAPHIFY_MIN_CORROBORATION && rounded > 0) verdict = "preferred";
    else if (useful > 0) verdict = "tentative";
    const label = state.graph.nodes.find((n) => n.id === id)?.label ?? id;
    nodes.push({ id, label, verdict, score: rounded, useful, dead_end: dead, corrected });
  }
  nodes.sort((a, b) => b.score - a.score);
  return {
    schema: 1,
    generatedAt: new Date(now).toISOString(),
    halfLifeDays: GRAPHIFY_HALF_LIFE_DAYS,
    minCorroboration: GRAPHIFY_MIN_CORROBORATION,
    nodes,
  };
}
