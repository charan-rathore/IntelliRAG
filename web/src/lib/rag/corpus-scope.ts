/** Corpus / workspace identifiers. Retrieval is scoped; "all" is never default. */

export const SEED_CORPUS_ID = "seed-lab";
export const ALL_CORPORA = "all";

export type CorpusScope =
  | { kind: "corpus"; corpusId: string }
  | { kind: "all" };

export type CorpusSummary = {
  id: string;
  documentCount: number;
  label: string;
};

export function parseCorpusScope(raw?: string | null): CorpusScope {
  const value = (raw ?? "").trim();
  if (!value) return { kind: "corpus", corpusId: SEED_CORPUS_ID };
  if (value === ALL_CORPORA || value === "*") return { kind: "all" };
  return { kind: "corpus", corpusId: value };
}

export function scopeCorpusId(scope: CorpusScope): string | null {
  return scope.kind === "all" ? null : scope.corpusId;
}

export function githubCorpusId(originRepo: string, originRef?: string | null): string {
  const sha = (originRef ?? "").includes("@") ? originRef!.slice(originRef!.lastIndexOf("@") + 1) : originRef;
  const suffix = sha?.trim() ? `@${sha.trim()}` : "";
  return `github:${originRepo}${suffix}`;
}

export function urlCorpusId(sourceUri: string): string {
  try {
    const u = new URL(sourceUri);
    return `url:${u.host}${u.pathname}`.replace(/\/+$/, "").slice(0, 180);
  } catch {
    return `url:${sourceUri.slice(0, 160)}`;
  }
}

export function importedCorpusId(slugHint: string): string {
  const slug = slugHint
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `imported:${slug || "markdown"}`;
}

export function corpusIdForInput(input: {
  sourceType: string;
  originRepo?: string | null;
  originRef?: string | null;
  sourceUri?: string | null;
  slugHint?: string | null;
  corpusId?: string | null;
}): string {
  if (input.corpusId?.trim()) return input.corpusId.trim();
  if (input.sourceType === "seed") return SEED_CORPUS_ID;
  if (input.originRepo) return githubCorpusId(input.originRepo, input.originRef);
  if (input.sourceType === "url" && input.sourceUri) return urlCorpusId(input.sourceUri);
  if (input.sourceUri?.startsWith("seed://")) return SEED_CORPUS_ID;
  return importedCorpusId(input.slugHint || "document");
}

export function corpusLabel(id: string): string {
  if (id === SEED_CORPUS_ID) return "Seed lab";
  if (id === ALL_CORPORA) return "All corpora";
  if (id.startsWith("github:")) return id.slice("github:".length);
  if (id.startsWith("url:")) return id.slice("url:".length);
  if (id.startsWith("imported:")) return `Imported · ${id.slice("imported:".length)}`;
  return id;
}
