import { ArrowRight, Check, Play } from "lucide-react";
import { CoverageChip } from "@/components/rag/coverage-chip";
import { SourceInspector } from "@/components/rag/source-inspector";
import { Button } from "@/components/ui/button";
import {
  COACH_COPY,
  DEMO_RUNS,
  PIPELINE_STEPS,
  RUN_STORY,
  SAMPLE_CANDIDATES,
  SAMPLE_TRACE_QUESTION,
  TRUST_MARKS,
  type DemoRun,
} from "@/lib/rag/onboarding";
import { EXAMPLE_QUESTIONS } from "@/lib/rag/corpus";
import type { ConsoleView, CoverageKind } from "@/lib/rag/types";
import { cn } from "@/lib/utils";

const SECONDARY_QUESTIONS = EXAMPLE_QUESTIONS.filter(
  (q) => !DEMO_RUNS.some((d) => d.question === q),
);

export function PipelinePreview() {
  return (
    <ol data-tour="tour-pipeline" className="grid gap-2 md:grid-cols-5">
      {PIPELINE_STEPS.map((step, i) => (
        <li
          key={step.id}
          className="ir-rise flex items-start gap-3 rounded-md border border-border bg-raised px-3 py-2 md:py-3 md:flex-col"
          style={{ animationDelay: `${i * 60}ms` }}
        >
          <p className="font-mono text-xs tabular-nums text-subtle">
            {String(i + 1).padStart(2, "0")}
          </p>
          <div className="min-w-0">
            <p className="text-sm font-medium text-fg">{step.label}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">{step.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function TrustStrip() {
  return (
    <ul className="flex flex-wrap gap-2">
      {TRUST_MARKS.map((mark) => (
        <li
          key={mark.id}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-raised px-3 py-2 text-xs text-muted"
        >
          <Check className="size-3.5 text-good" aria-hidden />
          {mark.label}
        </li>
      ))}
    </ul>
  );
}

function DemoCard({
  demo,
  onAsk,
}: {
  demo: DemoRun;
  onAsk: (q: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onAsk(demo.question)}
      className={cn(
        "flex min-h-28 flex-col rounded-lg border bg-surface p-4 text-left transition-colors duration-150 hover:bg-raised",
        demo.primary ? "border-primary/40" : "border-border",
      )}
    >
      <span className="flex flex-wrap items-center gap-2">
        <CoverageChip kind={demo.kind} />
        <span className="text-xs uppercase tracking-[0.16em] text-subtle">{demo.audience}</span>
      </span>
      <span className="mt-3 text-sm font-medium leading-snug text-fg">{demo.question}</span>
      <span className="mt-2 text-xs leading-relaxed text-muted">{demo.promise}</span>
      <span className="mt-3 inline-flex items-center gap-1 text-xs text-primary">
        {demo.primary ? "Run this demo" : "Ask this"}
        <ArrowRight className="size-3.5" />
      </span>
    </button>
  );
}

export function DemoCatalog({
  hasKey,
  onAsk,
}: {
  hasKey: boolean;
  onAsk: (q: string) => void;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">Three ways to see it work</p>
      <p className="mt-1 text-xs leading-relaxed text-subtle">
        Each card fires a real query. Grounded packs runbooks. Refused proves the lab will not hallucinate a forecast.
      </p>
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        {DEMO_RUNS.map((demo) => (
          <DemoCard key={demo.id} demo={demo} onAsk={onAsk} />
        ))}
      </div>
      {!hasKey && (
        <p className="mt-3 text-xs leading-relaxed text-subtle">
          Demos hit the live index without an LLM key — answers are extractive citations from packed chunks. Add OpenRouter in Settings for Gemini 3.7 Flash.
        </p>
      )}
    </div>
  );
}

export function SampleTrace() {
  const packed = SAMPLE_CANDIDATES.filter((c) => c.usedInContext);
  return (
    <div data-tour="tour-sample" className="rounded-lg border border-border bg-surface px-4 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">Sample trace</p>
        <p className="text-xs text-subtle">Not a live run — scores are typical for this question</p>
      </div>
      <p className="mt-2 text-sm text-fg">{SAMPLE_TRACE_QUESTION}</p>
      <SourceInspector candidates={SAMPLE_CANDIDATES} packed={packed} contextTokens={240} />
    </div>
  );
}

export function RunPreview({ onTour }: { onTour: () => void }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">What a run looks like</p>
      <ol className="mt-3 space-y-3">
        {RUN_STORY.map((line, i) => (
          <li key={line} className="flex gap-3">
            <span className="font-mono text-xs tabular-nums text-subtle">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="text-xs leading-relaxed text-muted">{line}</span>
          </li>
        ))}
      </ol>
      <Button className="mt-4 w-full" size="sm" onClick={onTour}>
        <Play className="size-3.5" />
        Watch the guided tour
      </Button>
    </div>
  );
}

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

export function WelcomeOnboarding({
  view,
  hasKey,
  onAsk,
  onNeedKey,
  onTour,
}: {
  view: ConsoleView;
  hasKey: boolean;
  onAsk: (q: string) => void;
  onNeedKey: () => void;
  onTour: () => void;
}) {
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8 pt-4 pb-8">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Knowledge console</p>
        <h1 className="mt-3 font-display text-4xl tracking-[-0.03em] text-fg md:text-5xl">IntelliRAG</h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-muted">
          Ask a runbook. Watch hybrid retrieval pick three chunks. Get a cited answer — or an honest refusal.
        </p>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-subtle">
          Built for an SRE who needs the command, and a RAG engineer who needs to see why a chunk survived.
        </p>
        <div className="mt-5 flex flex-col items-start gap-2 sm:flex-row sm:items-center">
          <Button onClick={onTour} className="min-h-11">
            <Play className="size-4" />
            Watch the guided tour
          </Button>
          <p className="hidden text-xs leading-relaxed text-subtle sm:block sm:px-3">
            Spotlights every control. Pause, skip, or let it play.
          </p>
        </div>
        {view === "reading" && (
          <p className="mt-3 text-xs text-subtle">
            Reading hides the trace. Switch to Lab in the header to see dense / BM25 / hybrid scores.
          </p>
        )}
      </div>

      <DemoCatalog hasKey={hasKey} onAsk={hasKey ? onAsk : () => onNeedKey()} />

      <div>
        <p className="mb-3 text-xs font-medium uppercase tracking-[0.16em] text-muted">How a question is answered</p>
        <PipelinePreview />
      </div>

      <SampleTrace />

      <TrustStrip />

      {SECONDARY_QUESTIONS.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">More from the corpus</p>
          <div className="mt-3 grid gap-2">
            {SECONDARY_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => (hasKey ? onAsk(q) : onNeedKey())}
                className="min-h-11 rounded-md border border-border bg-surface px-4 py-3 text-left text-sm text-fg transition-colors hover:bg-raised"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
