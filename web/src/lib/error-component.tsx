import type { ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";

function isDeployFsError(message: string) {
  return /pglite|ENOENT|_libs/i.test(message);
}

export function AppErrorComponent({ error }: ErrorComponentProps) {
  const message = error instanceof Error && error.message
    ? error.message
    : "An unexpected error occurred. Try reloading the page.";
  const deployFs = isDeployFsError(message);
  return (
    <main
      className={
        "flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center " +
        "bg-bg text-fg"
      }
    >
      <span className="text-bad" aria-hidden="true">
        <TriangleAlert className="size-10" strokeWidth={2} />
      </span>
      <h1 className="text-lg font-semibold">
        {deployFs ? "Lab is switching to ephemeral mode" : "Something went wrong"}
      </h1>
      <p className="max-w-md text-sm break-words text-muted">
        {deployFs
          ? "This host cannot open the local database file. Reload to continue with keyword search on the seed corpus."
          : message}
      </p>
      {deployFs ? (
        <p className="max-w-md text-xs break-words text-subtle">{message}</p>
      ) : null}
      {deployFs ? (
        <button
          type="button"
          className="mt-2 rounded-md bg-action px-4 py-2 text-sm text-primary-fg hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-primary"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      ) : null}
    </main>
  );
}
