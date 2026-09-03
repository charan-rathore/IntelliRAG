import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import type { DenseDiagnostics, EvidenceGate, EvidenceKind, RetrievalCandidate, RetrievedChunk, RetrievalMode, RetrievalStageScores } from "@/lib/rag/types";
import { CONTEXT_TOKEN_BUDGET } from "@/lib/rag/types";
import { cn } from "@/lib/utils";

const STAGE: Array<{ key: keyof RetrievalStageScores; label: string; unit: string }> = [
  { key: "dense", label: "Cosine", unit: "raw" },
  { key: "keyword", label: "BM25", unit: "raw" },
  { key: "hybrid", label: "RRF", unit: "raw" },
  { key: "rerank", label: "Calibrated", unit: "0–1 mix" },
];

function ScoreBar({ value, kind }: { value: number | null; kind: keyof RetrievalStageScores }) {
  const bounded = kind === "dense" || kind === "rerank";
  const pct =
    value == null ? 0
    : bounded ? Math.round(Math.min(1, Math.max(0, value)) * 100)
    : Math.round(Math.min(1, Math.max(0, value / (Math.abs(value) + 1))) * 100);
  return (
    <span className="flex items-center gap-2">
      {bounded && (
        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-border">
          <span
            className={cn("block h-full rounded-full", value == null ? "bg-border" : "bg-primary")}
            style={{ width: `${pct}%` }}
          />
        </span>
      )}
      <span className="min-w-[2.5rem] font-mono text-xs tabular-nums text-muted">
        {value == null ? "—" : value >= 10 ? value.toFixed(1) : value.toFixed(3)}
      </span>
    </span>
  );
}

function CandidateRow({
  candidate,
  index,
  contextIndex,
}: {
  candidate: RetrievalCandidate;
  index: number;
  contextIndex?: number;
}) {
  const [open, setOpen] = useState(index === 0);
  return (
    <li className="rounded-md border border-border bg-raised" id={contextIndex ? `cite-${contextIndex}` : undefined}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left"
      >
        <span className="mt-0.5 font-mono text-xs tabular-nums text-subtle">{index + 1}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <Link
              to="/sources/$slug"
              params={{ slug: candidate.slug }}
              onClick={(e) => e.stopPropagation()}
              className="text-sm font-medium text-fg hover:underline"
            >
              {candidate.title}
            </Link>
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-xs",
                candidate.usedInContext
                  ? "border-good/30 text-good"
                  : "border-border text-subtle",
              )}
            >
              {candidate.usedInContext ? "Used" : "Inspect only"}
            </span>
            {candidate.corpusId && (
              <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-subtle">
                {candidate.corpusId}
              </span>
            )}
            {candidate.cited && (
              <span className="rounded-full border border-primary/30 px-2 py-0.5 text-xs text-primary">
                Cited
              </span>
            )}
          </span>
          <span className="mt-2 hidden flex-wrap gap-x-4 gap-y-1 md:flex">
            {STAGE.map((s) => (
              <span key={s.key} className="flex items-center gap-1.5 text-xs text-muted">
                {s.label}
                <ScoreBar value={candidate.scores[s.key]} kind={s.key} />
              </span>
            ))}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "mt-1 size-4 shrink-0 text-subtle transition-transform duration-150",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="border-t border-border px-3 py-3">
          <div className="mb-3 grid grid-cols-2 gap-2 sm:hidden">
            {STAGE.map((s) => (
              <p key={s.key} className="flex items-center justify-between text-xs text-muted">
                {s.label}
                <ScoreBar value={candidate.scores[s.key]} kind={s.key} />
              </p>
            ))}
          </div>
          {candidate.overlapTerms.length > 0 && (
            <p className="mb-2 text-xs text-muted">
              Lexical overlap{" "}
              {candidate.overlapTerms.map((t) => (
                <span
                  key={t}
                  className="mr-1 inline-flex rounded-sm bg-surface px-1.5 py-0.5 font-mono text-fg"
                >
                  {t}
                </span>
              ))}
            </p>
          )}
          {candidate.dropReason && (
            <p className="mb-2 text-xs leading-relaxed text-warn">{candidate.dropReason}</p>
          )}
          {candidate.ranks && (
            <p className="mb-2 font-mono text-[10px] tabular-nums text-subtle">
              ranks dense={candidate.ranks.dense ?? "—"} bm25={candidate.ranks.keyword ?? "—"} rrf=
              {candidate.ranks.fused ?? "—"} rerank={candidate.ranks.rerank}
              {candidate.ranks.dense != null &&
              candidate.ranks.dense === 1 &&
              candidate.ranks.rerank !== 1
                ? " · dense #1 displaced by rerank"
                : ""}
            </p>
          )}
          <p className="line-clamp-4 text-xs leading-relaxed text-muted">{candidate.text}</p>
        </div>
      )}
    </li>
  );
}

export function PackedSources({ chunks }: { chunks: RetrievedChunk[] }) {
  if (!chunks.length) return null;
  return (
    <div className="mt-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-muted">Sources</p>
      <ul className="space-y-2">
        {chunks.map((c, i) => (
          <li key={c.chunkId}>
            <Link
              id={`cite-${i + 1}`}
              to="/sources/$slug"
              params={{ slug: c.slug }}
              className="block rounded-md border border-border bg-raised px-3 py-2"
            >
              <p className="text-sm font-medium text-fg">
                [{i + 1}] {c.title}
              </p>
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">{c.text}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SourceInspector({
  candidates,
  packed,
  contextTokens,
  dense,
  evidence,
  scoreSemantics,
  actualMode,
  corpusId,
  evidenceGate,
}: {
  candidates: RetrievalCandidate[];
  packed: RetrievedChunk[];
  contextTokens: number;
  dense?: DenseDiagnostics;
  evidence?: EvidenceKind;
  scoreSemantics?: string;
  actualMode?: RetrievalMode;
  corpusId?: string | null;
  evidenceGate?: EvidenceGate;
}) {
  const used = candidates.filter((c) => c.usedInContext).length;
  const contextIndex = new Map(packed.map((c, i) => [c.chunkId, i + 1]));
  if (!candidates.length) return null;

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">Why these sources</p>
        <p className="font-mono text-xs tabular-nums text-subtle">
          {used}/{candidates.length} in context · {contextTokens}/{CONTEXT_TOKEN_BUDGET} tok
        </p>
      </div>
      {(dense || evidence || actualMode) && (
        <p className="mb-2 text-xs leading-relaxed text-muted">
          {actualMode ? `Mode ${actualMode}. ` : ""}
          {corpusId != null ? `Corpus ${corpusId || "all"}. ` : ""}
          {evidence ? `Evidence ${evidence.replaceAll("_", " ")}. ` : ""}
          {evidenceGate?.denseRerankDisagree
            ? `Dense #1 ${evidenceGate.denseRank1Slug} vs rerank #1 ${evidenceGate.rerankRank1Slug}. `
            : ""}
          {dense
            ? dense.skippedReason
              ? dense.skippedReason
              : `Query embed ${dense.queryEmbeddingProduced ? "yes" : "no"} · compatible vectors ${dense.compatibleStoredVectors} · dense hits ${dense.denseCandidatesProduced}.`
            : ""}
        </p>
      )}
      {scoreSemantics && <p className="mb-2 text-xs leading-relaxed text-subtle">{scoreSemantics}</p>}
      <ul className="space-y-2">
        {candidates.map((c, i) => (
          <CandidateRow
            key={c.chunkId}
            candidate={c}
            index={i}
            contextIndex={contextIndex.get(c.chunkId)}
          />
        ))}
      </ul>
    </div>
  );
}
