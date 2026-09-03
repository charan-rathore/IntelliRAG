import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { GraphOutcome } from "@/lib/rag/graphify/schema";
import { cn } from "@/lib/utils";

const OPTIONS: Array<{ id: GraphOutcome; label: string; hint: string }> = [
  { id: "useful", label: "Useful", hint: "Cited sources answered it. Promote those nodes." },
  { id: "dead_end", label: "Dead end", hint: "Wrong or empty path. Do not cache this." },
  { id: "corrected", label: "Correct", hint: "The answer was wrong. Add the fix." },
];

export function AnswerFeedback({
  question,
  selected,
  onSubmit,
}: {
  question: string;
  selected?: GraphOutcome | null;
  onSubmit: (outcome: GraphOutcome, correction?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [correction, setCorrection] = useState("");
  return (
    <div data-tour="tour-feedback" className="mt-4 rounded-md border border-border bg-raised p-3">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">Teach the graph</p>
      <p className="mt-1 text-xs leading-relaxed text-subtle">
        Graphify save-result. Useful nodes become preferred sources on the next ask.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            title={o.hint}
            onClick={() => {
              if (o.id === "corrected") setOpen(true);
              else onSubmit(o.id);
            }}
            className={cn(
              "h-11 rounded-sm border px-3 text-sm",
              selected === o.id
                ? "border-primary bg-surface text-fg"
                : "border-border bg-bg text-muted hover:text-fg",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {open && (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit("corrected", correction.trim() || undefined);
            setOpen(false);
          }}
        >
          <label className="text-xs text-muted" htmlFor={`fix-${question.slice(0, 12)}`}>
            What should the answer have been?
          </label>
          <textarea
            id={`fix-${question.slice(0, 12)}`}
            value={correction}
            onChange={(e) => setCorrection(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg outline-none"
          />
          <Button type="submit" size="sm" disabled={!correction.trim()}>
            Save correction
          </Button>
        </form>
      )}
    </div>
  );
}
