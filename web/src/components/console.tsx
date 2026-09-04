import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowUp,
  Copy,
  KeyRound,
  Layers,
  LoaderCircle,
  Plus,
  ShieldAlert,
  X,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { AnswerFeedback } from "@/components/rag/answer-feedback";
import { CoverageChip } from "@/components/rag/coverage-chip";
import { KnowledgeGraph } from "@/components/rag/knowledge-graph";
import { LatencyWaterfall } from "@/components/rag/latency-waterfall";
import { FirstRunCoach, RunPreview, WelcomeOnboarding } from "@/components/rag/onboarding";
import { ProductTour } from "@/components/rag/product-tour";
import { PackedSources, SourceInspector } from "@/components/rag/source-inspector";
import { ViewToggle } from "@/components/rag/view-toggle";
import { formatAnswerHtml } from "@/lib/rag/answer";
import {
  embedNextBatch,
  getLabSnapshot,
  ingestPastedDocument,
  ingestRemoteUrl,
  removeDocument,
  submitGraphFeedback,
} from "@/lib/rag/functions";
import { EXAMPLE_QUESTIONS } from "@/lib/rag/corpus";
import { ALL_CORPORA, SEED_CORPUS_ID, corpusLabel } from "@/lib/rag/corpus-scope";
import type { GraphOutcome } from "@/lib/rag/graphify/schema";
import { loadTourSeen } from "@/lib/rag/tour";
import {
  forgetLegacyClientKeys,
  loadCoachDismissed,
  loadRetrievalMode,
  loadTopK,
  loadViewMode,
  persistCoachDismissed,
  RETRIEVAL_MODE_STORAGE,
  TOP_K_STORAGE,
  VIEW_MODE_STORAGE,
} from "@/lib/rag/client-key";
import type {
  AuditFinding,
  Citation,
  ConsoleView,
  CoverageKind,
  DenseDiagnostics,
  DocumentHealth,
  EvidenceGate,
  EvidenceKind,
  LayerLatencies,
  RetrievalCandidate,
  RetrievedChunk,
  RetrievalMode,
  StaleReason,
  StorageStatus,
} from "@/lib/rag/types";
import { cn } from "@/lib/utils";

type Snapshot = Awaited<ReturnType<typeof getLabSnapshot>>;

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  citations?: Citation[];
  chunks?: RetrievedChunk[];
  candidates?: RetrievalCandidate[];
  latencies?: LayerLatencies;
  stage?: string;
  error?: string;
  pendingEmbeddings?: number;
  coverage?: CoverageKind;
  contextTokens?: number;
  cacheHit?: boolean;
  graphSlugs?: string[];
  dense?: DenseDiagnostics;
  evidence?: EvidenceKind;
  storage?: StorageStatus;
  scoreSemantics?: string;
  actualMode?: RetrievalMode;
  corpusId?: string | null;
  corpusScope?: "corpus" | "all";
  evidenceGate?: EvidenceGate;
  feedback?: GraphOutcome | null;
  asked?: string;
};

const STALE_LABEL: Record<StaleReason, string> = {
  missing_embeddings: "Missing vectors",
  model_mismatch: "Model mismatch",
  never_indexed: "Never indexed",
  age: "Aging",
  ephemeral_storage: "Ephemeral (no DATABASE_URL)",
};

const EXPECTED_WITHOUT_DENSE: StaleReason[] = [
  "ephemeral_storage",
  "missing_embeddings",
  "never_indexed",
];

function visibleStaleReasons(reasons: StaleReason[], denseAvailable: boolean): StaleReason[] {
  if (denseAvailable) return reasons;
  return reasons.filter((r) => !EXPECTED_WITHOUT_DENSE.includes(r));
}

function formatMs(ms?: number) {
  if (ms == null || Number.isNaN(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function parseSseChunk(buffer: string, onEvent: (event: string, data: unknown) => void) {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const part of parts) {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of part.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) continue;
    try {
      onEvent(event, JSON.parse(dataLines.join("")));
    } catch {
      // ignore
    }
  }
  return rest;
}

export function Console({ initial }: { initial: Snapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [geminiDraft, setGeminiDraft] = useState("");
  const [openrouterDraft, setOpenrouterDraft] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [corpusOpen, setCorpusOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [mode, setMode] = useState<RetrievalMode>("hybrid");
  const [topK, setTopK] = useState(5);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [ingestUrl, setIngestUrl] = useState("");
  const [ingestBody, setIngestBody] = useState("");
  const [ingestTitle, setIngestTitle] = useState("Pasted document");
  const [ingestBusy, setIngestBusy] = useState(false);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [evalBusy, setEvalBusy] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [evalReport, setEvalReport] = useState<Snapshot["lastEval"]>(initial.lastEval);
  const [view, setView] = useState<ConsoleView>("lab");
  const [corpus, setCorpus] = useState(SEED_CORPUS_ID);
  const [coachOpen, setCoachOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const indexLoop = useRef(false);

  const hasKey = snapshot.hasServerKey;
  const denseAvailable = snapshot.storage?.denseAvailable !== false;
  const staleCount = snapshot.documents.filter(
    (d) => visibleStaleReasons(d.staleReasons, denseAvailable).length > 0,
  ).length;
  const asked = messages.filter((m) => m.role === "user").map((m) => m.text);
  const followUps = EXAMPLE_QUESTIONS.filter((q) => !asked.includes(q)).slice(0, 3);

  const refresh = useCallback(async () => {
    const next = await getLabSnapshot();
    setSnapshot(next);
    if (next.lastEval) setEvalReport(next.lastEval);
    return next;
  }, []);

  const runEval = useCallback(async () => {
    setEvalBusy(true);
    setEvalError(null);
    try {
      const res = await fetch("/api/eval", { method: "POST" });
      const report = (await res.json()) as Snapshot["lastEval"] & { message?: string; verdict?: string };
      if (!res.ok) {
        throw new Error(report?.message || "Eval failed");
      }
      setEvalReport(report);
      await refresh();
    } catch (err) {
      setEvalError(err instanceof Error ? err.message : "Eval failed");
    } finally {
      setEvalBusy(false);
    }
  }, [refresh]);

  const runIndexLoop = useCallback(async () => {
      if (indexLoop.current) return;
      indexLoop.current = true;
      setIndexing(true);
      try {
        let remaining = 1;
        while (remaining > 0) {
          const result = await embedNextBatch({ data: {} });
          remaining = result.remaining;
          await refresh();
          if (result.embedded === 0) break;
        }
      } catch {
        await refresh();
      } finally {
        indexLoop.current = false;
        setIndexing(false);
      }
    }, [refresh]);

  useEffect(() => {
    forgetLegacyClientKeys();
    setMode(loadRetrievalMode());
    setTopK(loadTopK());
    setView(loadViewMode());
    setCoachOpen(!loadCoachDismissed());
    if (!loadTourSeen()) {
      window.setTimeout(() => setTourOpen(true), 500);
    }
    if (initial.hasServerKey && initial.storage?.denseAvailable !== false) {
      void runIndexLoop();
    }
  }, [initial.hasServerKey, initial.storage?.denseAvailable, runIndexLoop]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
      e.preventDefault();
      taRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const saveKeys = async () => {
    setKeyBusy(true);
    setKeyError(null);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gemini: geminiDraft.trim() || undefined,
          openrouter: openrouterDraft.trim() || undefined,
        }),
      });
      const status = (await res.json()) as Snapshot;
      if (!res.ok) throw new Error("Could not save keys");
      setGeminiDraft("");
      setOpenrouterDraft("");
      const next = await refresh();
      setSettingsOpen(false);
      if (status.hasServerKey || next.hasServerKey) {
        if (next.storage?.denseAvailable !== false) await runIndexLoop();
        void runEval();
      }
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : "Could not save keys");
    } finally {
      setKeyBusy(false);
    }
  };

  const clearKeys = async (which: "gemini" | "openrouter") => {
    setKeyBusy(true);
    setKeyError(null);
    try {
      await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          which === "gemini" ? { clearGemini: true } : { clearOpenRouter: true },
        ),
      });
      await refresh();
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : "Could not clear key");
    } finally {
      setKeyBusy(false);
    }
  };

  const dismissCoach = () => {
    persistCoachDismissed();
    setCoachOpen(false);
  };

  const ask = async (preset?: string) => {
    const q = (preset ?? question).trim();
    if (!q || busy) return;
    setQuestion("");
    setBusy(true);
    const userMsg: Message = { id: crypto.randomUUID(), role: "user", text: q };
    const asstId = crypto.randomUUID();
    const asst: Message = {
      id: asstId,
      role: "assistant",
      text: "",
      stage: "retrieving",
      asked: q,
    };
    setMessages((m) => [...m, userMsg, asst]);
    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          retrievalMode: mode,
          topK,
          corpus,
        }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`Query failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      const patch = (fn: (msg: Message) => Message) => {
        setMessages((all) => all.map((m) => (m.id === asstId ? fn(m) : m)));
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        buf = parseSseChunk(buf, (_event, raw) => {
          const data = raw as Record<string, unknown>;
          if (data.type === "stage") {
            patch((m) => ({ ...m, stage: String(data.name) }));
          } else if (data.type === "sources") {
            patch((m) => ({
              ...m,
              chunks: data.chunks as RetrievedChunk[],
              candidates: data.candidates as RetrievalCandidate[],
              pendingEmbeddings: data.pendingEmbeddings as number,
              contextTokens: data.contextTokens as number,
              dense: data.dense as DenseDiagnostics | undefined,
              evidence: data.evidence as EvidenceKind | undefined,
              storage: data.storage as StorageStatus | undefined,
              scoreSemantics: data.scoreSemantics as string | undefined,
              actualMode: data.actualMode as RetrievalMode | undefined,
              corpusId: data.corpusId as string | null | undefined,
              corpusScope: data.corpusScope as "corpus" | "all" | undefined,
              evidenceGate: data.evidenceGate as EvidenceGate | undefined,
              stage: "generating",
            }));
          } else if (data.type === "token") {
            patch((m) => ({
              ...m,
              text: m.text + String(data.text),
              stage: "generating",
            }));
          } else if (data.type === "done") {
            patch((m) => ({
              ...m,
              text: String(data.answer ?? m.text),
              citations: data.citations as Citation[],
              latencies: data.latencies as LayerLatencies,
              candidates: (data.candidates as RetrievalCandidate[]) ?? m.candidates,
              coverage: data.coverage as CoverageKind,
              contextTokens: data.contextTokens as number,
              cacheHit: Boolean(data.cacheHit),
              graphSlugs: data.graphSlugs as string[] | undefined,
              dense: (data.dense as DenseDiagnostics | undefined) ?? m.dense,
              evidence: (data.evidence as EvidenceKind | undefined) ?? m.evidence,
              storage: (data.storage as StorageStatus | undefined) ?? m.storage,
              scoreSemantics: (data.scoreSemantics as string | undefined) ?? m.scoreSemantics,
              actualMode: (data.actualMode as RetrievalMode | undefined) ?? m.actualMode,
              corpusId: (data.corpusId as string | null | undefined) ?? m.corpusId,
              evidenceGate: (data.evidenceGate as EvidenceGate | undefined) ?? m.evidenceGate,
              stage: undefined,
            }));
          } else if (data.type === "error") {
            patch((m) => ({
              ...m,
              error: String(data.message),
              stage: undefined,
            }));
          }
        });
      }
      void refresh();
    } catch (err) {
      setMessages((all) =>
        all.map((m) =>
          m.id === asstId
            ? { ...m, error: err instanceof Error ? err.message : "Query failed", stage: undefined }
            : m,
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const runDemo = (q: string) => {
    setView("lab");
    window.localStorage.setItem(VIEW_MODE_STORAGE, "lab");
    void ask(q);
  };

  const ingestRemote = async () => {
    if (!ingestUrl.trim()) return;
    setIngestBusy(true);
    setIngestError(null);
    try {
      const result = await ingestRemoteUrl({ data: { url: ingestUrl.trim() } });
      if (result && "corpusId" in result && typeof result.corpusId === "string") {
        setCorpus(result.corpusId);
      }
      setIngestUrl("");
      const next = await refresh();
      if (hasKey && next.pendingEmbeddings > 0) await runIndexLoop();
    } catch (err) {
      setIngestError(err instanceof Error ? err.message : "Ingest failed");
    } finally {
      setIngestBusy(false);
    }
  };

  const ingestPaste = async () => {
    setIngestBusy(true);
    setIngestError(null);
    try {
      const result = await ingestPastedDocument({
        data: { title: ingestTitle.trim() || "Pasted document", body: ingestBody },
      });
      if (result && "corpusId" in result && typeof result.corpusId === "string") {
        setCorpus(result.corpusId);
      }
      setIngestBody("");
      const next = await refresh();
      if (hasKey && next.pendingEmbeddings > 0) await runIndexLoop();
    } catch (err) {
      setIngestError(err instanceof Error ? err.message : "Ingest failed");
    } finally {
      setIngestBusy(false);
    }
  };

  const sendFeedback = async (id: string, q: string, outcome: GraphOutcome, correction?: string) => {
    try {
      const graph = await submitGraphFeedback({ data: { question: q, outcome, correction } });
      setMessages((all) => all.map((m) => (m.id === id ? { ...m, feedback: outcome } : m)));
      setSnapshot((s) => ({ ...s, graph }));
    } catch {
      // keep the UI usable if the sidecar write fails
    }
  };

  const healthLabel = useMemo(() => {
    if (indexing) return "Indexing…";
    if (!denseAvailable) return hasKey ? "Ready" : "Extractive";
    if (snapshot.generationVia === "xai") return "Ready";
    if (!hasKey) return "Extractive";
    if (staleCount) return `${staleCount} stale`;
    return "Ready";
  }, [denseAvailable, hasKey, indexing, snapshot.generationVia, staleCount]);

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-border bg-bg/95 px-3 py-3 backdrop-blur-sm sm:gap-3 md:px-6">
        <div className="flex min-w-0 items-center gap-3" data-tour="tour-brand">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-sm border border-border bg-raised">
            <Layers className="size-4 text-primary" />
          </span>
          <div className="min-w-0">
            <p className="font-display text-lg leading-tight tracking-[-0.03em]">IntelliRAG</p>
            <p className="hidden text-xs text-muted sm:block">
              {denseAvailable ? "hybrid retrieval · cited answers" : "keyword retrieval · cited answers"}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <span
            className={cn(
              "hidden rounded-full border px-3 py-1 text-xs font-medium tabular-nums sm:inline-flex",
              indexing ? "border-warn/40 text-warn" : "border-border text-muted",
            )}
          >
            {healthLabel}
          </span>
          <span data-tour="tour-view">
            <ViewToggle value={view} onChange={setView} />
          </span>
          <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => setCorpusOpen(true)}>
            Corpus
          </Button>
          <span data-tour="tour-settings">
            <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)}>
              <KeyRound className="size-4" />
              <span className="hidden sm:inline">Settings</span>
            </Button>
          </span>
          <Button variant="ghost" size="sm" className="hidden sm:inline-flex" onClick={() => setTourOpen(true)}>
            Tour
          </Button>
        </div>
      </header>

      {!hasKey && (
        <div className="border-b border-border bg-raised px-4 py-3 md:px-6">
          <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-fg">
              The lab is live without an LLM key — demos return cited extracts from packed runbooks. Add OpenRouter or Gemini in Settings only if you want Gemini 3.7 Flash.
            </p>
            <Button size="sm" onClick={() => setSettingsOpen(true)}>
              Add API key
            </Button>
          </div>
        </div>
      )}

      <div className="mx-auto grid w-full max-w-[1400px] flex-1 grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_300px]">
        <aside className="hidden border-r border-border lg:block" data-tour="tour-corpus">
          <CorpusPanel
            snapshot={snapshot}
            corpus={corpus}
            onCorpus={setCorpus}
            ingestUrl={ingestUrl}
            ingestBody={ingestBody}
            ingestTitle={ingestTitle}
            ingestBusy={ingestBusy}
            ingestError={ingestError}
            indexing={indexing}
            pending={snapshot.pendingEmbeddings}
            onUrl={setIngestUrl}
            onBody={setIngestBody}
            onTitle={setIngestTitle}
            onIngestUrl={ingestRemote}
            onIngestPaste={ingestPaste}
            onRemove={async (id) => {
              await removeDocument({ data: { id } });
              await refresh();
            }}
          />
        </aside>

        <main className="flex min-h-0 flex-col">
          <div ref={threadRef} className="flex-1 overflow-y-auto px-4 py-6 md:px-8">
            {messages.length === 0 ? (
              <WelcomeOnboarding
                view={view}
                hasKey={hasKey}
                onAsk={runDemo}
                onTour={() => setTourOpen(true)}
              />
            ) : (
              <div className="mx-auto flex max-w-3xl flex-col gap-6">
                {messages.map((m, i) => (
                  <Turn
                    key={m.id}
                    message={m}
                    view={view}
                    onFeedback={(outcome, correction) => {
                      if (m.asked) void sendFeedback(m.id, m.asked, outcome, correction);
                    }}
                    coach={
                      coachOpen &&
                      !busy &&
                      m.role === "assistant" &&
                      m.coverage &&
                      i === messages.findIndex((x) => x.role === "assistant" && x.coverage) ? (
                        <FirstRunCoach kind={m.coverage} onDismiss={dismissCoach} />
                      ) : null
                    }
                  />
                ))}
                {!busy && followUps.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {followUps.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => runDemo(q)}
                        className="rounded-full border border-border bg-raised px-3 py-2 text-left text-xs text-muted transition-colors hover:bg-surface hover:text-fg"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </main>

        <aside className="hidden border-l border-border lg:block">
          <AuditPanel
            snapshot={snapshot}
            last={messages.filter((m) => m.role === "assistant").at(-1)}
            evalReport={evalReport}
            evalBusy={evalBusy}
            evalError={evalError}
            onRunEval={() => void runEval()}
            canEval={hasKey}
            view={view}
            onTour={() => setTourOpen(true)}
          />
        </aside>
      </div>

      <footer className="sticky bottom-0 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur-sm md:px-6">
        <form
          className="mx-auto flex max-w-3xl items-end gap-2 rounded-lg border border-border bg-surface p-2"
          data-tour="tour-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void ask();
          }}
        >
          <textarea
            ref={taRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask();
              }
            }}
            rows={1}
            maxLength={4000}
            placeholder="Ask about your documents…  / to focus"
            className="max-h-36 min-h-11 flex-1 resize-none bg-transparent px-3 py-2 text-base text-fg outline-none placeholder:text-subtle"
          />
          <Button type="submit" size="icon" disabled={busy || !question.trim()} aria-label="Ask">
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
          </Button>
        </form>
        <p className="mx-auto mt-2 max-w-3xl text-center text-xs text-subtle">
          Enter to send · Shift+Enter for a new line · / focuses the composer
        </p>
        <div className="mx-auto mt-2 flex max-w-3xl justify-center gap-2 lg:hidden">
          <Button variant="ghost" size="sm" onClick={() => setCorpusOpen(true)}>
            Corpus
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setAuditOpen(true)}>
            Trace
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setTourOpen(true)}>
            Tour
          </Button>
        </div>
      </footer>

      {settingsOpen && (
        <Modal title="Settings" onClose={() => setSettingsOpen(false)}>
          <div className="rounded-md border border-border bg-raised px-3 py-3">
            <p className="text-sm font-medium text-fg">Two models, two jobs</p>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              Retrieval compares vectors. Every document chunk and every question must be
              embedded with <span className="font-mono text-fg">{snapshot.embeddingModel}</span> —
              same model, same 768 dimensions, same prefixes. Gemini 3.7 Flash never enters that
              vector space; it only writes the answer. Dense retrieval needs durable Postgres
              (`DATABASE_URL` / Neon in production). Scores in Lab are raw cosine / BM25 / RRF /
              calibrated mix — not confidence and not a cross-encoder.
            </p>
            {snapshot.storage?.warning && (
              <p className="mt-2 text-xs leading-relaxed text-warn">{snapshot.storage.warning}</p>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-border px-3 py-1 text-muted">
              Embed {snapshot.embeddingVia === "google" ? "Google AI" : snapshot.embeddingVia === "openrouter" ? "OpenRouter → Gemini" : "unset"}
            </span>
            <span className="rounded-full border border-border px-3 py-1 text-muted">
              Answer {snapshot.generationVia === "openrouter" ? "OpenRouter → 3.7 Flash" : snapshot.generationVia === "google" ? "Google AI → 3.7 Flash" : snapshot.generationVia === "xai" ? "Grok 4.5" : "extractive (no LLM key)"}
            </span>
          </div>
          {snapshot.xaiFromEnv && (
            <p className="mt-3 text-xs leading-relaxed text-good">
              Grok 4.5 is configured on the server for cited answers when no Gemini/OpenRouter key is set. Embeddings still need Gemini or OpenRouter for dense retrieval.
            </p>
          )}

          <label className="mt-5 block text-sm text-muted">OpenRouter key</label>
          {snapshot.openRouterFromEnv ? (
            <p className="mt-2 text-sm text-good">Configured on the server. Not shown here, not in the browser.</p>
          ) : (
            <>
              <input
                type="password"
                value={openrouterDraft}
                onChange={(e) => setOpenrouterDraft(e.target.value)}
                placeholder="sk-or-v1-…"
                autoComplete="off"
                className="mt-2 h-11 w-full rounded-md border border-border bg-raised px-3 text-fg outline-none focus:ring-2 focus:ring-primary/40"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-xs leading-relaxed text-muted">
                  {snapshot.hasOpenRouterKey
                    ? "Held on the server for this device. Routes to google/gemini-3.7-flash and google/gemini-embedding-2."
                    : "Sent once to the server, never stored in page JavaScript. Use this for budget-capped Gemini calls."}
                </p>
                {snapshot.hasOpenRouterKey && !snapshot.openRouterFromEnv && (
                  <Button variant="ghost" size="sm" disabled={keyBusy} onClick={() => void clearKeys("openrouter")}>
                    Clear
                  </Button>
                )}
              </div>
            </>
          )}

          <label className="mt-5 block text-sm text-muted">Gemini API key (optional)</label>
          {snapshot.geminiFromEnv ? (
            <p className="mt-2 text-sm text-good">Configured on the server. Preferred for embeddings.</p>
          ) : (
            <>
              <input
                type="password"
                value={geminiDraft}
                onChange={(e) => setGeminiDraft(e.target.value)}
                placeholder="AIza…"
                autoComplete="off"
                className="mt-2 h-11 w-full rounded-md border border-border bg-raised px-3 text-fg outline-none focus:ring-2 focus:ring-primary/40"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-xs leading-relaxed text-muted">
                  {snapshot.hasGeminiKey
                    ? "Held in server memory. Wins for embeddings so index and query stay in Google’s native vector space."
                    : "If set, embeddings go through Google’s API. OpenRouter still answers with 3.7 Flash."}
                </p>
                {snapshot.hasGeminiKey && !snapshot.geminiFromEnv && (
                  <Button variant="ghost" size="sm" disabled={keyBusy} onClick={() => void clearKeys("gemini")}>
                    Clear
                  </Button>
                )}
              </div>
            </>
          )}

          {keyError && <p className="mt-3 text-xs text-bad">{keyError}</p>}

          <label className="mt-5 block text-sm text-muted">Retrieval</label>
          <select
            value={mode}
            onChange={(e) => {
              const next = e.target.value as RetrievalMode;
              setMode(next);
              window.localStorage.setItem(RETRIEVAL_MODE_STORAGE, next);
            }}
            className="mt-2 h-11 w-full rounded-md border border-border bg-raised px-3 text-fg"
          >
            <option value="hybrid">Hybrid (dense + BM25)</option>
            <option value="dense">Dense only</option>
            <option value="keyword">Keyword only</option>
          </select>
          <label className="mt-5 block text-sm text-muted">Sources to retrieve</label>
          <input
            type="number"
            min={3}
            max={12}
            value={topK}
            onChange={(e) => {
              const n = Number(e.target.value);
              setTopK(n);
              window.localStorage.setItem(TOP_K_STORAGE, String(n));
            }}
            className="mt-2 h-11 w-full rounded-md border border-border bg-raised px-3 text-fg"
          />
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setSettingsOpen(false)}>
              Close
            </Button>
            <Button
              disabled={keyBusy || (!geminiDraft.trim() && !openrouterDraft.trim())}
              onClick={() => void saveKeys()}
            >
              {keyBusy ? "Saving…" : "Save to server"}
            </Button>
          </div>
        </Modal>
      )}

      {corpusOpen && (
        <Modal title="Corpus" onClose={() => setCorpusOpen(false)}>
          <CorpusPanel
            snapshot={snapshot}
            corpus={corpus}
            onCorpus={setCorpus}
            ingestUrl={ingestUrl}
            ingestBody={ingestBody}
            ingestTitle={ingestTitle}
            ingestBusy={ingestBusy}
            ingestError={ingestError}
            indexing={indexing}
            pending={snapshot.pendingEmbeddings}
            onUrl={setIngestUrl}
            onBody={setIngestBody}
            onTitle={setIngestTitle}
            onIngestUrl={ingestRemote}
            onIngestPaste={ingestPaste}
            onRemove={async (id) => {
              await removeDocument({ data: { id } });
              await refresh();
            }}
          />
        </Modal>
      )}

      {auditOpen && (
        <Modal title="Trace" onClose={() => setAuditOpen(false)}>
          <AuditPanel
            snapshot={snapshot}
            last={messages.filter((m) => m.role === "assistant").at(-1)}
            evalReport={evalReport}
            evalBusy={evalBusy}
            evalError={evalError}
            onRunEval={() => void runEval()}
            canEval={hasKey}
            view={view}
            onTour={() => setTourOpen(true)}
          />
        </Modal>
      )}
      <ProductTour open={tourOpen} onClose={() => setTourOpen(false)} />
    </div>
  );
}

function Turn({
  message,
  view,
  coach,
  onFeedback,
}: {
  message: Message;
  view: ConsoleView;
  coach?: ReactNode;
  onFeedback?: (outcome: GraphOutcome, correction?: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  if (message.role === "user") {
    return (
      <div className="ml-8 rounded-lg bg-raised px-4 py-3 text-base leading-relaxed text-fg">
        {message.text}
      </div>
    );
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };
  return (
    <article className="rounded-lg border border-border bg-surface px-4 py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {message.coverage ? <CoverageChip kind={message.coverage} /> : <span />}
        <span className="flex items-center gap-2">
          {message.cacheHit && (
            <span className="rounded-full border border-good/30 px-2 py-0.5 text-xs text-good">Graph cache</span>
          )}
          {message.text && (
            <button
              type="button"
              onClick={() => void copy()}
              className="inline-flex h-9 items-center gap-1.5 rounded-sm px-2 text-xs text-muted hover:text-fg"
            >
              <Copy className="size-3.5" />
              {copied ? "Copied" : "Copy"}
            </button>
          )}
        </span>
      </div>
      {message.stage && (
        <p className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted">
          <LoaderCircle className="size-3.5 animate-spin" />
          {message.stage}
        </p>
      )}
      {message.error && (
        <p className="text-sm text-bad">{message.error}</p>
      )}
      {message.text && (
        <div
          className="text-base leading-relaxed text-fg [&_a.cite-chip]:mx-0.5 [&_a.cite-chip]:rounded-sm [&_a.cite-chip]:bg-raised [&_a.cite-chip]:px-1.5 [&_a.cite-chip]:py-0.5 [&_a.cite-chip]:text-xs [&_a.cite-chip]:text-primary [&_code]:rounded-xs [&_code]:bg-raised [&_code]:px-1"
          dangerouslySetInnerHTML={{ __html: formatAnswerHtml(message.text, message.citations ?? []) }}
        />
      )}
      {coach ? <div className="mt-4">{coach}</div> : null}
      {view === "lab" && message.latencies && (
        <div className="mt-4">
          <LatencyWaterfall latencies={message.latencies} />
        </div>
      )}
      {view === "lab" && message.candidates && message.candidates.length > 0 ? (
        <SourceInspector
          candidates={message.candidates}
          packed={message.chunks ?? []}
          contextTokens={message.contextTokens ?? 0}
          dense={message.dense}
          evidence={message.evidence}
          scoreSemantics={message.scoreSemantics}
          actualMode={message.actualMode}
          corpusId={message.corpusId}
          evidenceGate={message.evidenceGate}
        />
      ) : (
        message.chunks && message.chunks.length > 0 && <PackedSources chunks={message.chunks} />
      )}
      {message.text && onFeedback && !message.stage && !message.error && (
        <AnswerFeedback
          question={message.asked ?? ""}
          selected={message.feedback}
          onSubmit={onFeedback}
        />
      )}
    </article>
  );
}

function CorpusPanel(props: {
  snapshot: Snapshot;
  corpus: string;
  onCorpus: (id: string) => void;
  ingestUrl: string;
  ingestBody: string;
  ingestTitle: string;
  ingestBusy: boolean;
  ingestError: string | null;
  indexing: boolean;
  pending: number;
  onUrl: (v: string) => void;
  onBody: (v: string) => void;
  onTitle: (v: string) => void;
  onIngestUrl: () => void;
  onIngestPaste: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">Corpus</p>
        <p className="mt-1 text-xs text-subtle">
          {props.indexing
            ? `Embedding ${props.pending} remaining chunks`
            : `${props.snapshot.documents.length} documents${
                props.snapshot.storage?.denseAvailable === false ? " · keyword index" : ""
              }`}
        </p>
        <label className="mt-3 block text-xs text-muted">
          Active corpus
          <select
            value={props.corpus}
            onChange={(e) => props.onCorpus(e.target.value)}
            className="mt-1 h-10 w-full rounded-md border border-border bg-raised px-2 text-sm text-fg outline-none"
          >
            <option value={SEED_CORPUS_ID}>{corpusLabel(SEED_CORPUS_ID)}</option>
            {(props.snapshot.corpora ?? [])
              .filter((c) => c.id !== SEED_CORPUS_ID)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} ({c.documentCount})
                </option>
              ))}
            <option value={ALL_CORPORA}>All corpora (advanced)</option>
          </select>
        </label>
        <p className="mt-2 text-xs leading-relaxed text-subtle">
          Lab questions search the seed corpus unless you switch to an imported repo. All-corpora is never the default.
        </p>
        {props.snapshot.storage?.warning && (
          <p className="mt-2 text-xs leading-relaxed text-subtle">{props.snapshot.storage.warning}</p>
        )}
      </div>
      <ul className="space-y-2">
        {props.snapshot.documents
          .filter((doc) => props.corpus === ALL_CORPORA || doc.corpusId === props.corpus)
          .map((doc) => (
          <DocRow
            key={doc.id}
            doc={doc}
            denseAvailable={props.snapshot.storage?.denseAvailable !== false}
            onRemove={props.onRemove}
          />
        ))}
      </ul>
      <div className="rounded-lg border border-border bg-surface p-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Plus className="size-4" /> Ingest
        </p>
        <input
          value={props.ingestUrl}
          onChange={(e) => props.onUrl(e.target.value)}
          placeholder="GitHub repo, blob, or markdown URL"
          className="mt-3 h-11 w-full rounded-md border border-border bg-raised px-3 text-sm text-fg outline-none"
        />
        <Button
          className="mt-2 w-full"
          variant="ghost"
          size="sm"
          disabled={props.ingestBusy || !props.ingestUrl.trim()}
          onClick={props.onIngestUrl}
        >
          Fetch & index
        </Button>
        <input
          value={props.ingestTitle}
          onChange={(e) => props.onTitle(e.target.value)}
          placeholder="Title"
          className="mt-4 h-11 w-full rounded-md border border-border bg-raised px-3 text-sm text-fg outline-none"
        />
        <textarea
          value={props.ingestBody}
          onChange={(e) => props.onBody(e.target.value)}
          placeholder="Paste markdown…"
          rows={5}
          className="mt-2 w-full rounded-md border border-border bg-raised px-3 py-2 text-sm text-fg outline-none"
        />
        <Button
          className="mt-2 w-full"
          variant="subtle"
          size="sm"
          disabled={props.ingestBusy || props.ingestBody.trim().length < 40}
          onClick={props.onIngestPaste}
        >
          Chunk & store
        </Button>
        {props.ingestError && <p className="mt-2 text-xs text-bad">{props.ingestError}</p>}
      </div>
    </div>
  );
}

function DocRow({
  doc,
  denseAvailable,
  onRemove,
}: {
  doc: DocumentHealth;
  denseAvailable: boolean;
  onRemove: (id: string) => void;
}) {
  const stale = visibleStaleReasons(doc.staleReasons, denseAvailable);
  return (
    <li className="rounded-md border border-border bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <Link
          to="/sources/$slug"
          params={{ slug: doc.slug }}
          className="text-sm font-medium leading-snug text-fg hover:underline"
        >
          {doc.title}
        </Link>
        {doc.sourceType !== "seed" && (
          <button
            type="button"
            aria-label={`Remove ${doc.title}`}
            className="text-subtle hover:text-fg"
            onClick={() => onRemove(doc.id)}
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      <p className="mt-1 font-mono text-xs tabular-nums text-subtle">
        {denseAvailable
          ? `v${doc.version} · ${doc.embeddedCount}/${doc.chunkCount} embedded`
          : `v${doc.version} · ${doc.chunkCount} chunks · keyword`}
        {doc.corpusId ? ` · ${doc.corpusId}` : ""}
      </p>
      {stale.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {stale.map((r) => (
            <span key={r} className="rounded-full bg-raised px-2 py-0.5 text-xs text-warn">
              {STALE_LABEL[r]}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

function AuditPanel({
  snapshot,
  last,
  evalReport,
  evalBusy,
  evalError,
  onRunEval,
  canEval,
  view,
  onTour,
}: {
  snapshot: Snapshot;
  last?: Message;
  evalReport: Snapshot["lastEval"];
  evalBusy: boolean;
  evalError: string | null;
  onRunEval: () => void;
  canEval: boolean;
  view: ConsoleView;
  onTour: () => void;
}) {
  const metricKeys = [
    "retrieval_mrr",
    "retrieval_recall",
    "retrieval_precision",
    "context_precision",
    "context_recall",
    "faithfulness",
    "citation_precision",
    "hallucination_rate",
    "answer_relevancy",
    "adversarial_pass_rate",
  ] as const;
  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-4">
      {!last && <RunPreview onTour={onTour} />}
      {snapshot.graph && (
        <KnowledgeGraph
          nodes={snapshot.graph.nodes}
          links={snapshot.graph.links}
          learning={snapshot.graph.learning}
          nodeCount={snapshot.graph.nodeCount}
          edgeCount={snapshot.graph.edgeCount}
          cacheCount={snapshot.graph.cacheCount}
          preferred={snapshot.graph.preferred}
        />
      )}
      <div data-tour="tour-feedback" className="rounded-md border border-border bg-raised p-3">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">Teach the graph</p>
        <p className="mt-1 text-xs leading-relaxed text-subtle">
          After every answer, mark Useful, Dead end, or Correct. Graphify reflect promotes preferred sources.
        </p>
      </div>
      {view === "lab" && last?.latencies && <LatencyWaterfall latencies={last.latencies} />}
      {view === "reading" && last?.latencies && (
        <p className="font-mono text-xs tabular-nums text-subtle">
          {Object.entries(last.latencies)
            .map(([k, v]) => `${k} ${formatMs(v)}`)
            .join(" · ")}
        </p>
      )}
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">RAGAS eval</p>
        <p className="mt-1 text-xs leading-relaxed text-subtle">
          10 gold questions + 2 adversarial probes. Judges with Gemini 3.7 Flash against the original IntelliRAG baseline.
        </p>
        <Button
          className="mt-3 w-full"
          size="sm"
          disabled={evalBusy || !canEval}
          onClick={onRunEval}
        >
          {evalBusy ? "Running eval…" : "Run RAGAS eval"}
        </Button>
        {evalError && <p className="mt-2 text-xs text-bad">{evalError}</p>}
        {evalReport && (
          <div className="mt-3 rounded-md border border-border bg-surface p-3">
            <p
              className={cn(
                "text-sm font-medium",
                evalReport.verdict === "pass" ? "text-good" : "text-warn",
              )}
            >
              {evalReport.verdict === "pass" ? "Quality gate passed" : "Quality gate failed"}
            </p>
            <ul className="mt-2 space-y-1 font-mono text-xs tabular-nums text-fg">
              {metricKeys.map((key) => {
                const value = evalReport.metrics[key];
                const baseline =
                  evalReport.claimedBaseline[key as keyof typeof evalReport.claimedBaseline];
                return (
                  <li key={key} className="flex justify-between gap-2">
                    <span className="text-muted">{key.replaceAll("_", " ")}</span>
                    <span>
                      {typeof value === "number" ? value.toFixed(3) : "—"}
                      {typeof baseline === "number" ? (
                        <span className="text-subtle"> / {baseline.toFixed(3)}</span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
            {evalReport.failures.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-warn">
                {evalReport.failures.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      <div>
        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-muted">
          <ShieldAlert className="size-3.5" />
          Staleness audit
        </p>
        <ul className="mt-3 space-y-3">
          {snapshot.audit.map((f: AuditFinding) => (
            <li key={f.id} className="rounded-md border border-border bg-surface p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-warn">{f.severity}</p>
              <p className="mt-1 text-sm font-medium text-fg">{f.title}</p>
              <p className="mt-2 text-xs leading-relaxed text-muted">{f.original}</p>
              <p className="mt-2 text-xs leading-relaxed text-good">{f.liveFix}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-bg/70 p-0 sm:items-center sm:p-6">
      <button type="button" className="absolute inset-0" aria-label="Close" onClick={onClose} />
      <div className="relative z-10 max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-xl border border-border bg-surface p-5 sm:rounded-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl tracking-[-0.02em]">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close dialog">
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
