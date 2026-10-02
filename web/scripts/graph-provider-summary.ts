import { readFileSync, writeFileSync } from "node:fs";
const root = "docs/graph-first/";
const r = JSON.parse(readFileSync(root + "provider-retrieval.json", "utf8"));
const a = JSON.parse(readFileSync(root + "provider-answers.json", "utf8"));
const c = JSON.parse(readFileSync(root + "provider-cost-ledger.json", "utf8"));
const groups = Object.fromEntries(
  ["graph", "full"].map((arm) => [
    arm,
    {
      unsupported_refusals: a.results.filter(
        (x: any) =>
          x.arm === arm &&
          x.id.startsWith("unsupported") &&
          x.answer.startsWith("Not in the indexed corpus."),
      ).length,
      unsupported_n: 3,
      supported_n: 6,
    },
  ]),
);
const summary = {
  scope: r.scope,
  cases: r.cases.length,
  graph_hits: r.cases.filter((x: any) => x.graph.trace.route === "graph").length,
  repeated_hits: r.cases.filter(
    (x: any) => x.id.endsWith("repeat") && x.graph.trace.route === "graph",
  ).length,
  repeated_n: 1,
  related_hits: r.cases.filter(
    (x: any) => x.id.endsWith("related") && x.graph.trace.route === "graph",
  ).length,
  related_n: 2,
  citation_text_equal: r.cases.every((x: any) => x.citation_text_equal),
  groups,
  spend: c.spend_or_reserved,
  calls: c.calls.length,
  errors: c.calls.filter((x: any) => x.status >= 400).length,
  embedding_dimensions: r.learned_nodes[0].dimension,
  real_provider_multihop_paths: r.cases
    .flatMap((x: any) => x.graph.trace.paths)
    .filter((p: any) => p.path.length > 1).length,
};
writeFileSync(root + "provider-summary.json", JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
