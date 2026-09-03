import { createFileRoute } from "@tanstack/react-router";
import { Console } from "@/components/console";
import { getLabSnapshot } from "@/lib/rag/functions";

export const Route = createFileRoute("/")({
  loader: () => getLabSnapshot(),
  component: Home,
});

function Home() {
  const snapshot = Route.useLoaderData();
  return <Console initial={snapshot} />;
}
