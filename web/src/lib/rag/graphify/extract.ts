import type { SeedDocument } from "../corpus";
import type { GraphJson, GraphLink, GraphNode } from "./schema";

const STOP = new Set([
  "the", "and", "for", "with", "from", "that", "this", "are", "was", "were",
  "have", "has", "not", "you", "your", "into", "when", "then", "than", "its",
  "use", "used", "using", "can", "should", "must", "will", "each", "also",
  "only", "over", "after", "before", "about", "into", "onto", "such",
]);

function slugPart(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !STOP.has(t));
}

function headings(body: string): Array<{ text: string; line: number; depth: number }> {
  const out: Array<{ text: string; line: number; depth: number }> = [];
  const lines = body.split("\n");
  lines.forEach((line, i) => {
    const m = /^(#{2,3})\s+(.+)$/.exec(line.trim());
    if (!m) return;
    out.push({ text: m[2].trim(), line: i + 1, depth: m[1].length });
  });
  return out;
}

/**
 * Graphify markdown extraction: file node, heading nodes (EXTRACTED contains),
 * shared terms (INFERRED uses) across documents. Same confidence tags as
 * graphify extractors/markdown.py + build().
 */
export function extractCorpus(docs: Array<Pick<SeedDocument, "slug" | "title" | "body">>): GraphJson {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const seen = new Set<string>();

  const addNode = (n: GraphNode) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    nodes.push(n);
  };

  const termDocs = new Map<string, Set<string>>();

  docs.forEach((doc, community) => {
    const fileId = `doc:${doc.slug}`;
    addNode({
      id: fileId,
      label: doc.title,
      source_file: `${doc.slug}.md`,
      source_location: "L1",
      file_type: "markdown",
      kind: "document",
      community,
      slug: doc.slug,
    });

    for (const h of headings(doc.body)) {
      const hid = `heading:${doc.slug}:${slugPart(h.text)}`;
      addNode({
        id: hid,
        label: h.text,
        source_file: `${doc.slug}.md`,
        source_location: `L${h.line}`,
        file_type: "markdown",
        kind: "heading",
        community,
        slug: doc.slug,
      });
      links.push({
        source: fileId,
        target: hid,
        relation: "contains",
        confidence: "EXTRACTED",
      });
    }

    const bag = new Set(tokens(`${doc.title} ${doc.body}`));
    for (const t of bag) {
      if (!termDocs.has(t)) termDocs.set(t, new Set());
      termDocs.get(t)!.add(doc.slug);
    }
  });

  let termCommunity = docs.length;
  for (const [term, slugs] of termDocs) {
    if (slugs.size < 2) continue;
    const tid = `term:${term}`;
    addNode({
      id: tid,
      label: term,
      source_file: "shared",
      source_location: "",
      file_type: "term",
      kind: "term",
      community: termCommunity++,
    });
    for (const slug of slugs) {
      links.push({
        source: `doc:${slug}`,
        target: tid,
        relation: "uses",
        confidence: "INFERRED",
      });
    }
  }

  return {
    directed: false,
    multigraph: false,
    graph: { built_at: new Date().toISOString(), generator: "intellirag-graphify" },
    nodes,
    links,
  };
}

export function questionHash(question: string): string {
  const n = question.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
  let h = 2166136261;
  for (let i = 0; i < n.length; i++) {
    h ^= n.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `q${(h >>> 0).toString(16)}:${n.slice(0, 80)}`;
}

export function queryTokens(question: string): string[] {
  return tokens(question);
}
