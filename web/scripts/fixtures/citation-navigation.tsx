import React from "react";
import { createRoot } from "react-dom/client";
import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { Turn } from "../../src/components/console";
import { PASSAGES_DIVIDER } from "../../src/lib/rag/extractive";
import type { RetrievedChunk, RetrievalCandidate } from "../../src/lib/rag/types";

const params = new URLSearchParams(window.location.search);
const mode = params.get("mode") ?? "reading";
const special = params.get("scope") === "special";
function chunk(turn: string, n: number): RetrievedChunk {
  return {
    chunkId: `${turn}-${n}`,
    documentId: `${turn}-${n}`,
    slug: `${turn}-${n}`,
    title: `${turn === "first" ? "Orion repair manual" : "Vega deployment guide"} ${n}`,
    text:
      turn === "first"
        ? `Orion source ${n}: disconnect power before replacing the fuse.`
        : `Vega source ${n}: keep two replicas during deployment.`,
    heading: null,
    score: 0.8,
    rank: n,
    retriever: "keyword",
    tokenCount: 12,
    indexedAt: null,
    embeddingModel: null,
    filepath: null,
    language: null,
    symbol: null,
    chunkKind: "prose",
    corpusId: turn,
  };
}
function App() {
  return (
    <main>
      <h1>Two answers, different evidence</h1>
      <p>
        Actual Turn, source components and router. Synthetic documents. No model or retrieval
        requests.
      </p>
      {["first", "second"].map((turn) => {
        const packed = [chunk(turn, 1), chunk(turn, 2)];
        const candidates: RetrievalCandidate[] = [packed[1]!, packed[0]!, chunk(turn, 3)].map(
          (c, i) => ({
            ...c,
            usedInContext: i < 2,
            cited: i < 2,
            overlapTerms: [],
            scores: { dense: null, keyword: 1, hybrid: null, rerank: 0.8 },
            ranks: { dense: null, keyword: i + 1, fused: null, rerank: i + 1 },
          }),
        );
        const citations = packed.map((c, i) => ({
          sourceIndex: i + 1,
          title: c.title,
          chunkId: c.chunkId,
          documentId: c.documentId,
          textSnippet: c.text,
        }));
        const prose = "Check the matching evidence [Source 1] and [Source 2].";
        const text =
          mode === "excerpt"
            ? "Relevant source excerpts"
            : mode === "passages"
              ? `${prose}${PASSAGES_DIVIDER}[Source 1]\n${packed[0]!.text}\n[Source 2]\n${packed[1]!.text}`
              : prose;
        return (
          <section key={turn} data-turn={turn}>
            <h2>{turn === "first" ? "Answer 1: Orion" : "Answer 2: Vega"}</h2>
            <Turn
              message={{
                id: special ? `turn %/测试-${turn}` : `turn-${turn}`,
                role: "assistant",
                text,
                citations,
                chunks: packed,
                candidates,
                contextTokens: 24,
                ...(mode === "excerpt" ? { answerKind: "source_excerpts" as const } : {}),
              }}
              view={mode === "lab" ? "lab" : "reading"}
              onPicked={() => {}}
            />
          </section>
        );
      })}
    </main>
  );
}
const root = createRootRoute({ component: App });
const index = createRoute({ getParentRoute: () => root, path: "/" });
const router = createRouter({ routeTree: root.addChildren([index]) });
createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
