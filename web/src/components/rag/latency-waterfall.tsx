import { bottleneckOf } from "@/lib/rag/trace";
import type { LayerLatencies } from "@/lib/rag/types";
import { cn } from "@/lib/utils";

const ORDER = ["embed", "dense", "keyword", "rerank", "assemble", "generate"] as const;
const LABELS: Record<string, string> = {
  embed: "Embed query",
  dense: "Dense search",
  keyword: "BM25",
  rerank: "Rerank",
  assemble: "Pack context",
  generate: "Gemini Flash",
  guide: "Guide",
};

function formatMs(ms?: number) {
  if (ms == null || Number.isNaN(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function LatencyWaterfall({ latencies }: { latencies: LayerLatencies }) {
  const entries = ORDER.map((k) => [k, latencies[k]] as const).filter(
    (pair): pair is readonly [(typeof ORDER)[number], number] =>
      typeof pair[1] === "number" && pair[1] > 0,
  );
  const extra = Object.entries(latencies).filter(
    ([k, v]) => !ORDER.includes(k as (typeof ORDER)[number]) && typeof v === "number" && v > 0,
  );
  const rows = [...entries, ...extra];
  const total = rows.reduce((n, [, v]) => n + v, 0) || 1;
  const retrieve = (latencies.dense ?? 0) + (latencies.keyword ?? 0) + (latencies.rerank ?? 0) + (latencies.assemble ?? 0);
  const bottle = bottleneckOf(latencies);

  return (
    <div className="rounded-md border border-border bg-raised p-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">Latency</p>
        <p className="font-mono text-xs tabular-nums text-fg">{formatMs(total)}</p>
      </div>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-border">
        {rows.map(([k, v]) => (
          <span
            key={k}
            title={`${LABELS[k] ?? k} ${formatMs(v)}`}
            className={cn(
              "h-full",
              k === "generate" ? "bg-primary" : k === "embed" ? "bg-muted" : "bg-good/70",
            )}
            style={{ width: `${Math.max(1.5, (v / total) * 100)}%` }}
          />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5">
        {rows.map(([k, v]) => (
          <li key={k} className="flex items-center justify-between gap-3 font-mono text-xs tabular-nums">
            <span className={cn("text-muted", bottle === k && "text-fg")}>
              {LABELS[k] ?? k}
              {bottle === k ? " · bottleneck" : ""}
            </span>
            <span className="text-fg">{formatMs(v)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-subtle">
        Retrieval {formatMs(retrieve)} ({((retrieve / total) * 100).toFixed(0)}%) · generation{" "}
        {formatMs(latencies.generate)} ({(((latencies.generate ?? 0) / total) * 100).toFixed(0)}%)
      </p>
    </div>
  );
}
