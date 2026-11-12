import { cn } from "@/lib/utils";
import { STAGE_STEPS as STEPS, stageIndex, type StageInput } from "@/lib/rag/stage-progress";

/**
 * What the system is doing, in the order it does it: three plain steps on
 * one hairline track. The fill only moves forward; the live step breathes.
 */
export function StageStepper(props: StageInput) {
  const at = stageIndex(props);
  const cached = props.stage === "graph-cache";
  return (
    <div className="mb-4" role="status" aria-live="polite" aria-label={cached ? "Reusing a reviewed answer" : STEPS[at]}>
      <div className="relative h-px w-full bg-border" aria-hidden>
        <span
          className="absolute inset-y-0 left-0 bg-primary transition-[width] duration-[520ms] ease-[var(--ease-smooth-out)]"
          style={{ width: `${((at + 0.5) / STEPS.length) * 100}%` }}
        />
      </div>
      <ol className="mt-2.5 grid grid-cols-3 gap-2 text-xs" aria-hidden>
        {STEPS.map((label, i) => (
          <li
            key={label}
            className={cn(
              "flex items-center gap-2 transition-colors duration-300",
              i < at ? "text-muted" : i === at ? "text-fg" : "text-subtle/60",
            )}
          >
            <span
              className={cn(
                "inline-block size-1.5 shrink-0 rounded-full transition-colors duration-300",
                i < at ? "bg-muted" : i === at ? "ir-breathe bg-primary" : "bg-border",
              )}
            />
            <span className="truncate">{i === 0 && cached ? "Reusing a reviewed answer" : label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
