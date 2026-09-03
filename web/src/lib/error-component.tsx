import type { ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";

function isDeployFsError(message: string) {
  return /pglite|ENOENT|_libs/i.test(message);
}

export function AppErrorComponent({ error }: ErrorComponentProps) {
  const message = error.message || "An unexpected error occurred. Try reloading the page.";
  const deployFs = isDeployFsError(message);
  return (
    <main
      className={
        "flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center " +
        "bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50"
      }
    >
      <span className="text-red-500" aria-hidden="true">
        <TriangleAlert className="size-10" strokeWidth={2} />
      </span>
      <h1 className="text-lg font-semibold">
        {deployFs ? "Lab is switching to ephemeral mode" : "Something went wrong"}
      </h1>
      <p className="max-w-md text-sm break-words text-zinc-500 dark:text-zinc-400">
        {deployFs
          ? "This host cannot open the local database file. Reload to continue with keyword search on the seed corpus."
          : message}
      </p>
      {deployFs ? (
        <p className="max-w-md text-xs break-words text-zinc-400 dark:text-zinc-500">{message}</p>
      ) : null}
      {deployFs ? (
        <button
          type="button"
          className="mt-2 rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      ) : null}
    </main>
  );
}
