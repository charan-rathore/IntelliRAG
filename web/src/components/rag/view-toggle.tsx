import { VIEW_MODE_STORAGE } from "@/lib/rag/client-key";
import type { ConsoleView } from "@/lib/rag/types";
import { cn } from "@/lib/utils";

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
  return (
    <div
      role="tablist"
      aria-label="Console view"
      className="flex rounded-md border border-border bg-raised p-1"
    >
      {(
        [
          ["reading", "Reading"],
          ["lab", "Lab"],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          onClick={() => set(id)}
          className={cn(
            "h-8 min-w-14 rounded-sm px-2 text-xs font-medium transition-colors duration-150 sm:h-9 sm:min-w-20 sm:px-3 sm:text-sm",
            value === id ? "bg-surface text-fg" : "text-muted hover:text-fg",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
