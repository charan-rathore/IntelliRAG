import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { DeploymentPosture } from "@/lib/rag/deployment-mode";
import { cn } from "@/lib/utils";

const REASON_COPY: Record<DeploymentPosture["reasons"][number], string> = {
  ephemeral_storage: "This host has no durable database, so anything stored here can disappear on the next cold start.",
  database_unreachable: "The database did not answer the last health check.",
  forced_by_operator: "The operator has pinned this host to demo mode.",
};

/**
 * One quiet line, not a warning siren: a slow-breathing dot says "live",
 * the copy says what is true, and the detail opens on request.
 */
export function DemoBanner({ posture }: { posture: DeploymentPosture }) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  if (posture.mode !== "demo") return null;
  return (
    <div className="ir-drop border-b border-border bg-surface" role="status">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5 md:px-6">
        <span className="ir-breathe relative inline-flex size-2 shrink-0 rounded-full bg-primary" aria-hidden />
        <p className="min-w-0 flex-1 text-sm text-fg">
          <span className="font-medium">Interactive demo</span>
          <span className="text-muted">
            {posture.temporaryImports
              ? " · you can import sources, but they are temporary and disappear when the server restarts."
              : " · sources are managed by the operator."}
          </span>
        </p>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailId}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-sm px-2 text-xs text-muted transition-colors hover:text-fg"
        >
          Why
          <ChevronDown
            className={cn("size-3.5 transition-transform duration-300 ease-[var(--ease-smooth-out)]", open && "rotate-180")}
          />
        </button>
      </div>
      <div id={detailId} className="ir-reveal" data-open={open}>
        <div className="min-h-0 overflow-hidden">
          <div className="mx-auto max-w-6xl px-4 pb-3 md:px-6">
            <ul className="space-y-1 pl-5 text-xs leading-relaxed text-muted">
              {posture.reasons.map((r) => (
                <li key={r}>{REASON_COPY[r]}</li>
              ))}
              <li>
                Pasted sources and URL imports work here but live in memory, so they are lost when the
                server restarts. A model key you add stays in your browser cookie and is sent with requests that call your provider; the server does not store it. Every answer cites its source, or
                says plainly when the source does not establish it.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
