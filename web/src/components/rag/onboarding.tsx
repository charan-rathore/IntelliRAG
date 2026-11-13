import { ArrowRight } from "lucide-react";
import { EvidenceScene } from "./evidence-scene";
import { HowItChecks } from "./how-it-checks";
import { Button } from "@/components/ui/button";
import { COACH_COPY, DEMO_RUNS } from "@/lib/rag/onboarding";
import type { SuggestedQuestion } from "@/lib/rag/predict-questions";
import type { ConsoleView, DisplayCoverageKind } from "@/lib/rag/types";

export function FirstRunCoach({
  kind,
  onDismiss,
}: {
  kind: DisplayCoverageKind;
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
      <p className="text-sm font-medium text-muted">{title}</p>
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
                <span className="text-xs text-subtle">
                  asked {item.askCount}×
                </span>
              ) : item.source === "predicted" ? (
                <span className="text-xs text-subtle">predicted</span>
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
  customSources = true,
}: {
  view: ConsoleView;
  customSources?: boolean;
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
    <section className="mx-auto flex max-w-5xl flex-col gap-10 py-6 sm:py-10">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:items-end">
        <div>
          <h1 className="font-display text-[44px] font-semibold leading-[0.98] tracking-[-0.035em] text-fg sm:text-[64px]">
            Ask a source. See where the answer came from.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
            {customSources
              ? "Bring a GitHub README or paste a doc. Every answer is built from passages you can open, and when the source doesn’t say, IntelliRAG says so."
              : "This public demo searches one pinned source. Without a model key it shows cited extracts, not an invented answer, and you can open every passage yourself."}
          </p>
        </div>

        <div className="ir-feature-card rounded-lg border border-border px-5 py-5">
          <p className="text-sm text-muted">Try a real support question on the pinned p-queue README</p>
          <p className="mt-2 font-display text-xl font-semibold leading-snug tracking-[-0.01em] text-fg">
            Change shared configuration while jobs are still queued
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button disabled={importing} onClick={onRepositoryDemo}>
              Ask this question
            </Button>
            <Button variant="ghost" onClick={onSources}>
              {customSources ? "Use your own source" : "See the sources"}
            </Button>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-subtle">
            {!customSources
              ? "A read-only public demo on a pinned source. Without a configured model you get cited extracts."
              : hasKey
                ? "Generated answers cite the selected corpus. Open each source before relying on a conclusion."
                : "No model key yet: you still get cited extracts. Add a key in Settings for generated answers."}
          </p>
          {importError ? (
            <p role="alert" className="mt-2 text-sm text-bad">
              {importError}
            </p>
          ) : null}
        </div>
      </div>

      <EvidenceScene />

      <SuggestedQuestions
        suggestions={chips}
        onAsk={onAsk}
        title="Other questions to try"
        hint="Predicted from the loaded document, plus the questions people ask most about this source. Or type your own below."
      />

      <HowItChecks />

      <p className="text-sm text-subtle">
        Sources and Evidence open from the header when you need them.{" "}
        <button type="button" onClick={onTour} className="text-muted underline underline-offset-4 hover:text-fg">
          Show me the controls
        </button>
        {" or read "}
        <a href="/architecture.html" className="text-muted underline underline-offset-4 hover:text-fg">
          how the pipeline is built
        </a>
        .
      </p>
    </section>
  );
}

/** Kept for product-tour targets that still reference the old preview. */
export function RunPreview({ onTour }: { onTour: () => void }) {
  return (
    <div>
      <p className="text-sm font-medium text-muted">What a run looks like</p>
      <ol className="mt-3 list-decimal space-y-3 pl-4 text-xs leading-relaxed text-muted">
        <li>You bring a document and ask a question.</li>
        <li>Retrieval packs supporting passages from that source.</li>
        <li>The answer cites those passages, or refuses when evidence is missing.</li>
      </ol>
      <Button className="mt-4 w-full" size="sm" onClick={onTour}>
        Watch the guided tour
      </Button>
    </div>
  );
}
