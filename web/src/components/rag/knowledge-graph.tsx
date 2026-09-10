import { useMemo, useState } from "react";
import type { GraphLink, GraphNode, LearningSidecar } from "@/lib/rag/graphify/schema";
import { cn } from "@/lib/utils";

type Props = {
  nodes: GraphNode[];
  links: GraphLink[];
  learning?: LearningSidecar | null;
  nodeCount?: number;
  edgeCount?: number;
  cacheCount?: number;
  preferred?: number;
};

function layout(nodes: GraphNode[], width: number, height: number) {
  const groups = new Map<number, GraphNode[]>();
  for (const n of nodes) {
    const g = groups.get(n.community) ?? [];
    g.push(n);
    groups.set(n.community, g);
  }
  const keys = [...groups.keys()];
  const cx = width / 2;
  const cy = height / 2;
  const R = Math.min(width, height) * 0.32;
  const pos = new Map<string, { x: number; y: number }>();
  keys.forEach((k, i) => {
    const angle = (i / Math.max(keys.length, 1)) * Math.PI * 2;
    const gx = cx + Math.cos(angle) * R;
    const gy = cy + Math.sin(angle) * R;
    const members = groups.get(k) ?? [];
    members.forEach((n, j) => {
      const a = (j / Math.max(members.length, 1)) * Math.PI * 2;
      const r = 18 + Math.min(22, members.length);
      pos.set(n.id, {
        x: Math.round((gx + Math.cos(a) * r) * 10) / 10,
        y: Math.round((gy + Math.sin(a) * r) * 10) / 10,
      });
    });
  });
  return pos;
}

export function KnowledgeGraph(props: Props) {
  const [hover, setHover] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const docs = useMemo(() => {
    const query = search.trim().toLowerCase();
    const documents = props.nodes.filter(n => n.kind === "document" && (!query || n.label.toLowerCase().includes(query)));
    const seeds = documents.slice(0, query ? 4 : 8);
    const ids = new Set(seeds.map(n => n.id));
    const neighbors = new Set<string>();
    for (const edge of props.links) {
      if (ids.has(edge.source)) neighbors.add(edge.target);
      if (ids.has(edge.target)) neighbors.add(edge.source);
    }
    const terms = props.nodes.filter(n => n.kind === "term" && neighbors.has(n.id)).slice(0, 20);
    return [...seeds, ...terms].slice(0, 28);
  }, [props.nodes, props.links, search]);
  const ids = useMemo(() => new Set(docs.map((n) => n.id)), [docs]);
  const links = useMemo(
    () => props.links.filter((e) => ids.has(e.source) && ids.has(e.target)),
    [props.links, ids],
  );
  const pos = useMemo(() => layout(docs, 268, 200), [docs]);
  const verdict = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of props.learning?.nodes ?? []) m.set(n.id, n.verdict);
    return m;
  }, [props.learning]);
  const active = docs.find((n) => n.id === hover);

  return (
    <div data-tour="tour-graph" className="rounded-md border border-border bg-raised p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">Knowledge graph</p>
        <p className="font-mono text-xs tabular-nums text-subtle">
          {props.nodeCount ?? props.nodes.length}n · {props.edgeCount ?? props.links.length}e
        </p>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-subtle">
        Graphify-compatible lexical graph. Lines link documents to shared terms; they do not prove a semantic relationship.
      </p>
      <label className="mt-2 block text-xs text-muted">Find a document
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search graph documents…" className="mt-1 w-full rounded border border-border bg-bg p-2 text-fg" />
      </label>
      <p className="mt-1 text-xs text-subtle">Showing {docs.length} nodes from {props.nodeCount ?? props.nodes.length}. Search to inspect other sources.</p>
      <svg viewBox="0 0 268 200" className="mt-3 h-48 w-full" role="group" aria-label="Corpus knowledge graph">
        {links.map((e, i) => {
          const a = pos.get(e.source);
          const b = pos.get(e.target);
          if (!a || !b) return null;
          return (
            <line
              key={`${e.source}-${e.target}-${i}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className={e.confidence === "EXTRACTED" ? "stroke-muted" : "stroke-border"}
              strokeWidth={e.confidence === "EXTRACTED" ? 1.2 : 0.8}
            />
          );
        })}
        {docs.map((n) => {
          const p = pos.get(n.id);
          if (!p) return null;
          const v = verdict.get(n.id);
          return (
            <circle
              key={n.id}
              cx={p.x}
              cy={p.y}
              r={n.kind === "document" ? 5 : 3}
              className={cn(
                v === "preferred"
                  ? "fill-good"
                  : v === "contested" || v === "dead_end"
                    ? "fill-warn"
                    : n.kind === "document"
                      ? "fill-primary"
                      : "fill-muted",
              )}
              tabIndex={0}
              role="button"
              aria-label={`${n.label}, ${n.kind}`}
              onFocus={() => setHover(n.id)}
              onBlur={() => setHover(null)}
              onClick={() => setHover(n.id)}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setHover(n.id); } }}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}
      </svg>
      <p className="mt-1 min-h-5 text-xs text-muted">
        {active ? `${active.label} · ${active.kind}` : "Tap or focus a node. Documents are larger."}
      </p>
      <p className="mt-2 font-mono text-xs tabular-nums text-subtle">
        cache {props.cacheCount ?? 0} · preferred {props.preferred ?? 0}
      </p>
    </div>
  );
}
