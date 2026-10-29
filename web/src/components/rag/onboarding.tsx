import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { COACH_COPY } from "@/lib/rag/onboarding";
import type { SuggestedQuestion } from "@/lib/rag/predict-questions";
import type { ConsoleView, CoverageKind } from "@/lib/rag/types";

export function FirstRunCoach({ kind, onDismiss }: { kind: CoverageKind; onDismiss: () => void }) {
  const copy = COACH_COPY[kind];
  return (
    <aside className="rounded-lg border border-border bg-raised px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-fg">{copy.title}</p>
          <details className="mt-2 text-xs leading-relaxed text-muted">
            <summary className="cursor-pointer text-primary">How to check this answer</summary>
            <p className="mt-2">{copy.body}</p>
          </details>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex h-11 shrink-0 items-center rounded-sm px-3 text-xs text-muted hover:text-fg"
        >
          Got it
        </button>
      </div>
    </aside>
  );
}

export function SuggestedQuestions({
  suggestions,
  onAsk,
  title = "Suggested questions",
  hint,
}: {
  suggestions: Array<Pick<SuggestedQuestion, "question" | "askCount" | "source">>;
  onAsk: (q: string) => void;
  title?: string;
  hint?: string;
}) {
  if (!suggestions.length) return null;
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">{title}</p>
      {hint ? <p className="mt-1 text-xs leading-relaxed text-subtle">{hint}</p> : null}
      <div className="mt-3 flex flex-col divide-y divide-border border-y border-border">
        {suggestions.slice(0, 6).map((item) => (
          <button
            key={item.question}
            type="button"
            onClick={() => onAsk(item.question)}
            className="group flex min-h-11 items-start justify-between gap-3 px-1 py-3 text-left transition-colors hover:bg-raised focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span className="text-sm leading-snug text-fg">{item.question}</span>
            <span className="flex shrink-0 items-center gap-2 pt-0.5">
              {item.askCount > 0 ? (
                <span className="text-[10px] uppercase tracking-[0.14em] text-subtle">
                  asked {item.askCount}×
                </span>
              ) : item.source === "predicted" ? (
                <span className="text-[10px] uppercase tracking-[0.14em] text-subtle">
                  predicted
                </span>
              ) : null}
              <ArrowRight className="size-3.5 text-primary opacity-70 transition-opacity group-hover:opacity-100" />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function WelcomeOnboarding({
  onAsk,
  onSources,
  onTour,
  hasKey,
  onRepositoryDemo,
  importing,
  importError,
  suggestions,
}: {
  view: ConsoleView;
  hasKey: boolean;
  onAsk: (q: string) => void;
  onSources: () => void;
  onTour: () => void;
  onRepositoryDemo: () => void;
  importing: boolean;
  importError: string | null;
  suggestions: Array<Pick<SuggestedQuestion, "question" | "askCount" | "source">>;
}) {
  const chips = suggestions.slice(0, 3);

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-8 py-6 sm:py-10">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">
          Your document workspace
        </p>
        <h1 className="mt-3 max-w-xl font-display text-3xl font-medium leading-tight tracking-[-0.035em] text-fg sm:text-4xl">
          Find the answer.
          <br className="hidden sm:block" /> Keep the evidence.
        </h1>
        <p className="mt-4 max-w-lg text-base leading-relaxed text-muted">
          Bring a document, ask a question, and inspect the passages behind each answer.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-[1.25fr_1fr]">
        <div className="rounded-lg border border-primary/40 bg-surface p-5">
          <p className="text-sm font-medium text-fg">Start with your own source</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Paste a document or import a GitHub README or Markdown URL. Your questions stay in its
            selected source collection.
          </p>
          <Button className="mt-5" onClick={onSources}>
            Add a source <ArrowRight className="size-4" />
          </Button>
        </div>
        <div className="rounded-lg border border-border p-5">
          <p className="text-sm font-medium text-fg">Just looking? Try an example.</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Ask about queued jobs using the pinned p-queue README. No setup needed.
          </p>
          <Button className="mt-5" variant="ghost" disabled={importing} onClick={onRepositoryDemo}>
            Try the example
          </Button>
        </div>
      </div>
      {importError ? (
        <p role="alert" className="text-sm text-bad">
          {importError}
        </p>
      ) : null}
      <ol
        aria-label="How answers work"
        className="grid gap-4 border-y border-border py-5 text-sm text-muted sm:grid-cols-3"
      >
        <li>
          <span className="mr-2 font-mono text-xs text-primary">01</span>Add a source
        </li>
        <li>
          <span className="mr-2 font-mono text-xs text-primary">02</span>Ask in its context
        </li>
        <li>
          <span className="mr-2 font-mono text-xs text-primary">03</span>Check the cited passages
        </li>
      </ol>
      {chips.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-muted">
            Questions for the selected sources
          </summary>
          <div className="mt-4">
            <SuggestedQuestions suggestions={chips} onAsk={onAsk} title="Suggested questions" />
          </div>
        </details>
      )}
      <p className="text-xs leading-relaxed text-subtle">
        {hasKey
          ? "Generated answers can be wrong. Verify important details against the original source."
          : "Currently using cited extracts, not generated synthesis. Model access is optional in Settings."}{" "}
        <button type="button" onClick={onTour} className="text-muted underline hover:text-fg">
          Show the controls
        </button>
      </p>
    </section>
  );
}

/** Kept for product-tour targets that still reference the old preview. */
export function RunPreview({ onTour }: { onTour: () => void }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">
        What a run looks like
      </p>
      <ol className="mt-3 space-y-3 text-xs leading-relaxed text-muted">
        <li>1. You bring a document and ask a question.</li>
        <li>2. Retrieval packs supporting passages from that source.</li>
        <li>3. The answer cites those passages, or refuses when evidence is missing.</li>
      </ol>
      <Button className="mt-4 w-full" size="sm" onClick={onTour}>
        Watch the guided tour
      </Button>
    </div>
  );
}
