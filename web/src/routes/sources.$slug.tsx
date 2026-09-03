import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { getSourceDocument } from "@/lib/rag/functions";

export const Route = createFileRoute("/sources/$slug")({
  loader: ({ params }) => getSourceDocument({ data: { slug: params.slug } }),
  component: SourcePage,
});

function SourcePage() {
  const doc = Route.useLoaderData();
  if (!doc) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <p className="text-muted">Document not found.</p>
        <Link to="/" className="mt-4 inline-block text-sm text-primary underline">
          Back to console
        </Link>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" />
        Console
      </Link>
      <p className="mt-6 text-xs uppercase tracking-[0.16em] text-muted">
        {doc.sourceType} · v{doc.version}
      </p>
      <h1 className="mt-2 font-display text-3xl tracking-[-0.03em] text-fg">{doc.title}</h1>
      {doc.sourceUri && (
        <p className="mt-2 break-all text-xs text-subtle">{doc.sourceUri}</p>
      )}
      <article className="mt-8 whitespace-pre-wrap text-[15px] leading-relaxed text-fg">
        {doc.body}
      </article>
    </main>
  );
}
