import type { ContextCoverage } from "@/lib/rag/types";
import { cn } from "@/lib/utils";

/**
 * "What the context never mentions": the question terms absent from every
 * packed passage. A lexical check (a paraphrase can still answer a term), so
 * the copy says "not found in context", never "not in the source".
 *
 * Inspired by the sufficient-context analysis of Joren et al. (ICLR 2025):
 * most RAG errors happen with context attached, so the reader should see what
 * the context is missing before trusting a fluent answer.
 */
export function ContextCoverageLine({ coverage, className }: { coverage?: ContextCoverage | null; className?: string }) {
  if (!coverage || coverage.covered.length + coverage.missing.length === 0) return null;
  const total = coverage.covered.length + coverage.missing.length;
  const pct = Math.round(coverage.ratio * 100);
  const tone = coverage.missing.length === 0 ? "good" : pct >= 60 ? "muted" : "warn";
  return (
    <div
      className={cn("mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs leading-relaxed", className)}
      aria-label={`Context covers ${coverage.covered.length} of ${total} question terms`}
    >
      <span
        className={cn(
          "inline-flex h-6 items-center gap-1.5 rounded-full border px-2 font-medium tabular-nums",
          tone === "good" && "border-good/30 text-good",
          tone === "muted" && "border-border text-muted",
          tone === "warn" && "border-warn/40 text-warn",
        )}
        title="Share of the question's distinctive terms (idf-weighted) that appear somewhere in the packed context. Lexical: a paraphrase may still answer a missing term."
      >
        <svg width="28" height="6" viewBox="0 0 28 6" aria-hidden className="overflow-visible">
          <rect x="0" y="0" width="28" height="6" rx="3" className="fill-current opacity-20" />
          <rect x="0" y="0" width={Math.max(3, (28 * pct) / 100)} height="6" rx="3" className="fill-current" />
        </svg>
        {coverage.covered.length}/{total} question terms in context
      </span>
      {coverage.missing.length > 0 && (
        <>
          <span className="text-subtle">not found:</span>
          {coverage.missing.slice(0, 6).map((t) => (
            <span key={t} className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[11px] text-muted">
              {t}
            </span>
          ))}
          {coverage.missing.length > 6 && <span className="text-subtle">+{coverage.missing.length - 6} more</span>}
        </>
      )}
    </div>
  );
}
