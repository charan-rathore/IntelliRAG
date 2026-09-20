import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { COACH_COPY, DEMO_RUNS } from "@/lib/rag/onboarding";
import type { SuggestedQuestion } from "@/lib/rag/predict-questions";
import type { ConsoleView, CoverageKind } from "@/lib/rag/types";

export function FirstRunCoach({
  kind,
  onDismiss,
}: {
  kind: CoverageKind;
  onDismiss: () => void;
}) {
  const copy = COACH_COPY[kind];
  return (
    <aside className="rounded-lg border border-border bg-raised px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-fg">{copy.title}</p>
          <p className="mt-2 text-xs leading-relaxed text-muted">{copy.body}</p>
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
      <div className="mt-3 flex flex-col gap-2">
        {suggestions.slice(0, 6).map((item) => (
          <button
            key={item.question}
            type="button"
            onClick={() => onAsk(item.question)}
            className="group flex min-h-11 items-start justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-raised"
          >
            <span className="text-sm leading-snug text-fg">{item.question}</span>
            <span className="flex shrink-0 items-center gap-2 pt-0.5">
              {item.askCount > 0 ? (
                <span className="text-[10px] uppercase tracking-[0.14em] text-subtle">
                  asked {item.askCount}×
                </span>
              ) : item.source === "predicted" ? (
                <span className="text-[10px] uppercase tracking-[0.14em] text-subtle">predicted</span>
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
  const chips = suggestions.length
    ? suggestions
    : DEMO_RUNS.slice(0, 3).map((d) => ({
        question: d.question,
        askCount: 0,
        source: "predicted" as const,
      }));

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6 py-4">
      <div>
        <p className="font-display text-4xl leading-[1.05] tracking-[-0.04em] text-fg sm:text-5xl">
          IntelliRAG
        </p>
        <h1 className="mt-4 max-w-xl text-xl font-medium leading-snug text-fg sm:text-2xl">
          Ask what your documents mean for your situation.
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
          Bring a GitHub README or paste a doc. We suggest likely questions from that source, and
          remember the ones people actually ask.
        </p>
      </div>

      <div className="rounded-lg border border-primary/35 bg-surface px-4 py-4">
        <p className="text-xs uppercase tracking-[0.16em] text-muted">Ready to try</p>
        <p className="mt-2 text-base font-medium text-fg">
          Change shared configuration while jobs are still queued
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Uses the pinned <span className="text-fg">sindresorhus/p-queue</span> README. One click
          asks a real support question against that source.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button disabled={importing} onClick={onRepositoryDemo}>
            Ask this question
            <ArrowRight className="size-4" />
          </Button>
          <Button variant="ghost" onClick={onSources}>
            Use your own source
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted">
          {hasKey
            ? "Answers cite the loaded document. Follow-ups stay in that corpus."
            : "No model key yet: you still get cited extracts. Add a key in Settings for generated answers."}
        </p>
        {importError ? (
          <p role="alert" className="mt-2 text-sm text-bad">
            {importError}
          </p>
        ) : null}
      </div>

      <SuggestedQuestions
        suggestions={chips}
        onAsk={onAsk}
        title="Questions you can ask next"
        hint="Predicted from the loaded document, plus the most asked community questions for this source. Or type your own below."
      />

      <p className="text-xs text-subtle">
        Sources and Evidence stay behind the header buttons when you need them.{" "}
        <button type="button" onClick={onTour} className="text-muted underline hover:text-fg">
          Show me the controls
        </button>
      </p>
    </section>
  );
}

/** Kept for product-tour targets that still reference the old preview. */
export function RunPreview({ onTour }: { onTour: () => void }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">What a run looks like</p>
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
