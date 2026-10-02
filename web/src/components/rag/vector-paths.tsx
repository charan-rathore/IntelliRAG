import type { VectorTrace } from "@/lib/rag/graph-first";

/** A shortest-path forest from the actual retrieval trace, not an invented graph animation. */
export function VectorPaths({ trace }: { trace: VectorTrace }) {
  const paths = trace.paths.slice(0, 12);
  const ids = [...new Set(paths.flatMap((p) => p.path))];
  if (!ids.length)
    return (
      <p className="text-muted">No strong vector seeds. The query used full-index fallback.</p>
    );
  const depth = new Map(
    ids.map((id) => [
      id,
      Math.min(...paths.filter((p) => p.path.includes(id)).map((p) => p.path.indexOf(id))),
    ]),
  );
  const levels = [...new Set(depth.values())].sort((a, b) => a - b);
  const height = Math.max(
    180,
    Math.max(...levels.map((d) => ids.filter((id) => depth.get(id) === d).length)) * 72 + 40,
  );
  const positions = new Map(
    ids.map((id) => {
      const level = depth.get(id)!;
      const peers = ids.filter((x) => depth.get(x) === level);
      return [id, { x: 90 + level * 190, y: 45 + peers.indexOf(id) * 72 }];
    }),
  );
  const width = Math.max(420, levels.length * 190 + 120);
  const seen = new Set<string>();
  const edges = paths
    .flatMap((p) => p.path.slice(1).map((to, i) => ({ from: p.path[i], to })))
    .filter((e) => {
      const key = JSON.stringify([e.from, e.to]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const label = (id: string) =>
    trace.nodes?.find((n) => n.id === id)?.label ?? id.split(":").at(-1) ?? id;
  return (
    <div
      className="overflow-x-auto rounded border border-border bg-bg p-2"
      aria-label="Actual Dijkstra shortest-path forest"
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="min-w-[420px] w-full"
        role="img"
        aria-label="Weighted paths used to select source chunks"
      >
        {edges.map((e) => {
          const a = positions.get(e.from)!,
            b = positions.get(e.to)!;
          const edge = trace.edges?.find(
            (x) =>
              (x.source === e.from && x.target === e.to) ||
              (x.target === e.from && x.source === e.to),
          );
          return (
            <g key={e.from + e.to}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#93b5ef" strokeWidth="2" />
              <text
                x={(a.x + b.x) / 2}
                y={(a.y + b.y) / 2 - 8}
                fill="#b9c8db"
                fontSize="11"
                textAnchor="middle"
              >
                {edge?.cost.toFixed(3) ?? "path"}
              </text>
            </g>
          );
        })}
        {ids.map((id) => {
          const p = positions.get(id)!;
          const path = paths.find((x) => x.id === id);
          return (
            <g key={id} transform={`translate(${p.x} ${p.y})`}>
              <circle r="8" fill={trace.roots.includes(id) ? "#d7ab7f" : "#93b5ef"} />
              <title>{label(id)}</title>
              <text y="23" fill="#d8dde6" fontSize="11" textAnchor="middle">
                {label(id).slice(0, 24)}
              </text>
              <text y="39" fill="#a2adbd" fontSize="10" textAnchor="middle">
                {path ? `total ${path.cost.toFixed(3)}` : "connector"}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="text-xs text-muted">
        Gold: matched roots. Blue: connected chunk nodes. Labels are actual cosine-distance edge
        costs. Only paths used for this query are shown.
      </p>
    </div>
  );
}
