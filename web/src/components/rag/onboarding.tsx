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
import type { ConsoleView, CoverageKind } from "@/lib/rag/types";
import { cn } from "@/lib/utils";

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
        Each card fires a real query. Grounded packs runbooks. The off-corpus example checks whether unsupported questions are refused.
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
        <p className="text-xs text-subtle">Illustrative scores · no retrieval or model ran here</p>
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

export function WelcomeOnboarding({ onAsk, onSources, onTour }: {
  view: ConsoleView; hasKey: boolean; onAsk: (q: string) => void; onSources: () => void; onTour: () => void;
}) {
  return <section className="mx-auto flex max-w-3xl flex-col gap-8 py-8 sm:py-14">
    <div><p className="font-mono text-xs uppercase tracking-[0.18em] text-muted">FROM SOURCE TO ANSWER</p>
      <h1 className="mt-4 max-w-xl font-display text-4xl leading-tight tracking-[-0.03em] text-fg sm:text-6xl">Your docs.<br />Answers you can check.</h1>
      <p className="mt-5 max-w-xl text-base leading-relaxed text-muted">Import a GitHub repo, issue, or document. Ask a question. Follow the citation—or see where the evidence runs out.</p>
      <div className="mt-6 flex flex-wrap gap-3"><Button onClick={onSources}>Bring a source <ArrowRight className="size-4" /></Button><Button variant="ghost" onClick={onTour}>Show me the controls</Button></div>
    </div>
    <div><p className="mb-3 text-xs uppercase tracking-[0.16em] text-muted">Or try a real question</p><div className="grid gap-3 sm:grid-cols-3">{DEMO_RUNS.map(demo => <button key={demo.id} onClick={() => onAsk(demo.question)} className="min-h-28 rounded-lg border border-border bg-surface p-4 text-left text-sm leading-relaxed transition-colors hover:border-primary"><span className="block text-xs text-muted">{demo.kind === 'refused' ? 'Test the boundary' : 'Find the evidence'}</span><span className="mt-2 block">{demo.question}</span><ArrowRight className="mt-3 size-4 text-primary" /></button>)}</div></div>
    <p className="text-sm leading-relaxed text-muted">Sources manages your documents. Evidence opens the graph and retrieval details when you need them.</p>
  </section>;
}
