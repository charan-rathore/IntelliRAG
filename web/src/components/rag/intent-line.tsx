import type { TurnPlan } from "@/lib/rag/session-intent";

/**
 * Under a follow-up: how the conversation changed what was searched. It says
 * the decision in a sentence and shows the terms the session is about, so a
 * wrong reading is visible (and fixable with "New topic") instead of silent.
 */
export function IntentLine({ plan }: { plan: TurnPlan }) {
  if (plan.mode === "fresh") return null;
  return (
    <p className="ir-rise mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs leading-relaxed text-muted" data-intent={plan.mode}>
      <span className="font-mono text-[11px] uppercase tracking-wide text-subtle">
        {plan.mode === "switch" ? "new topic" : plan.mode === "related" ? "same topic" : "follow-up"}
      </span>
      <span>{plan.why}</span>
      {plan.carried.length > 0 && (
        <span className="flex flex-wrap gap-1" aria-label="What this conversation is about">
          {plan.carried.slice(0, 5).map((c) => (
            <span
              key={c.term}
              title={c.from === "feedback" ? "From an answer you marked useful" : c.from === "answer" ? "From what the last answer was about" : `Asked ${c.age === 1 ? "in the previous question" : `${c.age} questions ago`}`}
              className="rounded-sm border border-border px-1.5 py-px font-mono text-[11px] text-fg"
              style={{ opacity: 0.55 + 0.45 * Math.min(1, c.weight / (plan.carried[0]?.weight || 1)) }}
            >
              {c.term}
            </span>
          ))}
        </span>
      )}
    </p>
  );
}
