import { VIEW_MODE_STORAGE } from "@/lib/rag/client-key";
import type { ConsoleView } from "@/lib/rag/types";
import { cn } from "@/lib/utils";

const OPTIONS = [
  ["reading", "Reading"],
  ["lab", "Lab"],
] as const;

/**
 * Product mode vs Lab mode. One raised pill slides under the active label,
 * so the eye follows a single object instead of two colour swaps.
 */
export function ViewToggle({
  value,
  onChange,
}: {
  value: ConsoleView;
  onChange: (next: ConsoleView) => void;
}) {
  const set = (next: ConsoleView) => {
    onChange(next);
    window.localStorage.setItem(VIEW_MODE_STORAGE, next);
  };
  const index = OPTIONS.findIndex(([id]) => id === value);
  return (
    <div
      role="tablist"
      aria-label="Console view"
      className="relative grid grid-cols-2 rounded-md border border-border bg-raised p-1"
    >
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-sm bg-surface shadow-[0_1px_0_0_color-mix(in_oklab,var(--color-fg)_6%,transparent)] transition-transform duration-[280ms] ease-[var(--ease-spring)]"
        style={{ transform: `translateX(${index * 100}%)` }}
      />
      {OPTIONS.map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          onClick={() => set(id)}
          className={cn(
            "relative z-10 h-8 min-w-14 rounded-sm px-2 text-xs font-medium transition-colors duration-150 sm:h-9 sm:min-w-20 sm:px-3 sm:text-sm",
            value === id ? "text-fg" : "text-muted hover:text-fg",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
