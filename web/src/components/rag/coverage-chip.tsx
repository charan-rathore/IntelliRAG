import type { DisplayCoverageKind } from "@/lib/rag/types";
import { cn } from "@/lib/utils";

const COPY: Record<DisplayCoverageKind, { label: string; hint: string; tone: string }> = {
  grounded: {
    label: "Grounded",
    hint: "Answered from indexed runbooks with citations",
    tone: "text-good border-good/30",
  },
  excerpts: {
    label: "Source excerpts",
    hint: "Quoted indexed passages. Answer completeness has not been established.",
    tone: "text-muted border-border",
  },
  general: {
    label: "General Flash",
    hint: "Unused in grounded mode. insufficient evidence is refused instead",
    tone: "text-warn border-warn/30",
  },
  refused: {
    label: "Refused",
    hint: "Not in the indexed corpus. no fake citations",
    tone: "text-bad border-bad/30",
  },
  guide: {
    label: "Guide",
    hint: "Console help, not a retrieved answer",
    tone: "text-muted border-border",
  },
};

export function CoverageChip({ kind }: { kind: DisplayCoverageKind }) {
  const copy = COPY[kind];
  return (
    <span
      title={copy.hint}
      className={cn(
        "inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-medium",
        copy.tone,
      )}
    >
      {copy.label}
    </span>
  );
}
