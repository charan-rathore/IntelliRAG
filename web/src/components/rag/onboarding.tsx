import { ArrowRight } from "lucide-react";
import { EvidenceScene } from "./evidence-scene";
import { HowItChecks } from "./how-it-checks";
import { FeatureExplorer } from "./feature-explorer";
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
  layout = "list",
}: {
  suggestions: Array<Pick<SuggestedQuestion, "question" | "askCount" | "source">>;
  onAsk: (q: string) => void;
  title?: string;
  hint?: string;
  layout?: "list" | "grid";
}) {
  if (!suggestions.length) return null;
  if (layout === "grid") {
    return (
      <div>
        <h2 className="ir-h2 text-fg">{title}</h2>
        {hint ? <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted">{hint}</p> : null}
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {suggestions.slice(0, 6).map((item) => (
            <button key={item.question} type="button" onClick={() => onAsk(item.question)} className="ir-qcard group">
              <span className="text-[15px] font-medium leading-snug text-fg">{item.question}</span>
              <span className="mt-auto flex items-center justify-between gap-3 pt-5 text-[13px] text-subtle">
                <span>{item.askCount > 0 ? `Asked ${item.askCount} times` : item.source === "predicted" ? "Predicted from the source" : "Popular"}</span>
                <span className="ir-qcard-go">Ask</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }
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
  onEvidence,
  onLab,
}: {
  view: ConsoleView;
  onEvidence?: () => void;
  onLab?: () => void;
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
    <section className="ir-welcome mx-auto flex max-w-6xl flex-col gap-14 pb-10 pt-2 sm:gap-20 sm:pt-6">
      <div className="grid items-center gap-8 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] xl:gap-12">
        <div>
          <h1 className="ir-h1 text-fg">Ask a source. See exactly where the answer came from.</h1>
          <p className="mt-5 max-w-[34rem] text-[17px] leading-[1.6] text-muted">
            {customSources
              ? "Point IntelliRAG at a GitHub README or paste a doc. Every sentence of the answer cites a passage you can open, and when the source doesn’t say, it tells you."
              : "Ask the pinned p-queue README anything. Every sentence of the answer cites a passage you can open, and when the README doesn’t say, it tells you."}
          </p>
          <div className="ir-hero-ctas mt-7 flex flex-wrap items-center gap-2.5">
            <Button size="lg" disabled={importing} onClick={onRepositoryDemo}>
              Ask the sample question
            </Button>
            <Button size="lg" variant="ghost" onClick={onSources}>
              {customSources ? "Bring your own source" : "See the sources"}
            </Button>
          </div>
          {importError ? (
            <p role="alert" className="mt-3 text-sm text-bad">
              {importError}
            </p>
          ) : null}
          <ul className="ir-facts mt-8">
            <li>Every sentence cited</li>
            <li>Refuses when the source is silent</li>
            <li>{hasKey ? "Generated answers with your key" : "Cited extracts without a model key"}</li>
          </ul>
        </div>
        <EvidenceScene />
      </div>

      <div>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="ir-h2 text-fg">What’s inside</h2>
            <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted">Each feature plays what it does. Pick one to open it for real.</p>
          </div>
          <Button variant="ghost" onClick={onTour}>Take the 1-minute tour</Button>
        </div>
        <FeatureExplorer
          onAsk={onRepositoryDemo}
          onEvidence={onEvidence ?? onRepositoryDemo}
          onSources={onSources}
          onLab={onLab ?? onRepositoryDemo}
          onTour={onTour}
        />
      </div>

      <SuggestedQuestions
        suggestions={chips}
        onAsk={onAsk}
        title="Questions people ask this source"
        hint="Predicted from the document and from what visitors ask most. Or type your own below."
        layout="grid"
      />

      <HowItChecks />

      <p className="text-sm text-subtle">
        Want the engineering detail?{" "}
        <a href="/architecture.html" className="font-medium text-fg underline decoration-border underline-offset-4 hover:decoration-fg">
          Read how the pipeline is built
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
