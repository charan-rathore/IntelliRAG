import { useCallback, useEffect, useState } from "react";
import { Moon } from "lucide-react";
import { getCorpusMemory, runSleep } from "@/lib/rag/functions";
import { cn } from "@/lib/utils";

type Memory = Awaited<ReturnType<typeof getCorpusMemory>>;
type SleepRun = Awaited<ReturnType<typeof runSleep>>;

const STRATEGY: Record<string, { name: string; what: string }> = {
  lexicon: { name: "People's words", what: "the source's terms swapped for the words people used for them" },
  identifiers: { name: "Inside identifiers", what: "words hidden in names like onSizeLessThan" },
  context: { name: "Section context", what: "the heading, file and symbol a passage sits under" },
  model: { name: "Model-written", what: "questions a model wrote for the passage" },
};
const REASON: Record<string, string> = {
  "already-found": "already found",
  "no-gain": "didn't help",
  forgetting: "would cost a real question",
  "dead-end-returned": "brought back a dead end",
  duplicate: "duplicate",
};

function Bar({ value, max, tone = "primary", delay = 0 }: { value: number; max: number; tone?: "primary" | "muted"; delay?: number }) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const t = window.setTimeout(() => setW(max ? (100 * value) / max : 0), 60 + delay);
    return () => window.clearTimeout(t);
  }, [value, max, delay]);
  return (
    <span className="relative block h-1.5 w-full overflow-hidden rounded-full bg-raised">
      <span
        className={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-[var(--ease-smooth-out)]", tone === "primary" ? "bg-primary" : "bg-ink-line")}
        style={{ width: `${w}%` }}
      />
    </span>
  );
}

/**
 * What a corpus has learned, and a way to let it sleep: replay what people
 * rated, consolidate their vocabulary, dream new ways to find passages, keep
 * only what costs nothing, and say why for everything else.
 */
export function MemoryPanel({ corpusId }: { corpusId: string }) {
  const [mem, setMem] = useState<Memory | null>(null);
  const [run, setRun] = useState<SleepRun | null>(null);
  const [sleeping, setSleeping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setMem(await getCorpusMemory({ data: { corpusId } })); setError(null); }
    catch { setError("Couldn't read this source's memory."); }
  }, [corpusId]);
  useEffect(() => { void load(); }, [load]);

  const sleepNow = async () => {
    setSleeping(true);
    setError(null);
    try { setRun(await runSleep({ data: { corpusId } })); await load(); }
    catch { setError("The sleep cycle didn't finish. Nothing was changed."); }
    finally { setSleeping(false); }
  };

  const last = mem?.sleeps.at(-1) ?? null;
  const strategies = last ? Object.entries(last.strategies).filter(([, s]) => s && (s.proposed || s.paused)) : [];
  const caseLast = mem?.cases.journal.at(-1) ?? null;

  return (
    <div className="space-y-6 text-sm">
      <section className="ir-rise">
        <p className="text-xs font-medium uppercase tracking-[0.08em] text-subtle">Awake</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {[
            ["Confirmed", mem?.wake.confirmed ?? 0, "answers people marked useful or picked"],
            ["Dead ends", mem?.wake.deadEnds ?? 0, "answers marked wrong"],
            ["Dreams kept", mem?.wake.dreams ?? 0, "practice questions that passed every check"],
          ].map(([label, n, hint], i) => (
            <div key={String(label)} className="ir-rise rounded-md border border-border bg-bg p-3" style={{ animationDelay: `${i * 60}ms` }} title={String(hint)}>
              <p className="font-display text-2xl tabular-nums leading-none tracking-[-0.03em]">{n}</p>
              <p className="mt-1 text-xs text-muted">{label}</p>
            </div>
          ))}
        </div>
        {mem && (
          <p className="mt-2 text-xs text-subtle">
            {mem.sinceSleep} of {mem.sleepEvery} ratings until it sleeps on its own.
          </p>
        )}
      </section>

      <section className="ir-rise" style={{ animationDelay: "120ms" }}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-subtle">Asleep</p>
          <button
            type="button"
            onClick={() => void sleepNow()}
            disabled={sleeping}
            className="inline-flex min-h-9 items-center gap-2 rounded-sm bg-action px-3 text-sm font-medium text-primary-fg transition-colors hover:bg-action-hover disabled:opacity-70"
          >
            <Moon className={cn("size-4", sleeping && "ir-breathe")} aria-hidden />
            {sleeping ? "Sleeping…" : "Sleep now"}
          </button>
        </div>
        {sleeping && <span className="ir-sweep mt-3 block h-px w-full bg-primary/60" aria-hidden />}
        {!last && !sleeping && (
          <p className="mt-2 text-muted">
            No sleep yet. A sleep replays what people rated, tries new ways to find passages nobody has asked about, and keeps
            only what doesn't cost a question that already works.
          </p>
        )}
        {last && (
          <div className="mt-3 space-y-4">
            <div>
              <div className="flex items-baseline justify-between">
                <span className="text-muted">Confirmed questions still found</span>
                <span className="font-mono text-xs tabular-nums">{last.replay.after}/{last.replay.total}</span>
              </div>
              <div className="mt-1.5"><Bar value={last.replay.after} max={Math.max(1, last.replay.total)} /></div>
              <p className="mt-1 text-xs text-subtle">
                {last.replay.rolledBack
                  ? "A late check found a loss, so this sleep kept nothing."
                  : last.replay.after >= last.replay.before
                    ? "Nothing was forgotten."
                    : `${last.replay.before - last.replay.after} lost.`}
                {last.lexicon ? ` Learned ${last.lexicon} words people use for the source's words.` : ""}
              </p>
            </div>
            {strategies.length > 0 && (
              <ul className="space-y-3">
                {strategies.map(([key, s], i) => (
                  <li key={key} className="ir-rise" style={{ animationDelay: `${i * 70}ms` }}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium text-fg" title={STRATEGY[key]?.what}>{STRATEGY[key]?.name ?? key}</span>
                      <span className="font-mono text-xs tabular-nums text-subtle">{s!.paused ? "paused" : `${s!.accepted} of ${s!.proposed} kept`}</span>
                    </div>
                    <div className="mt-1.5"><Bar value={s!.accepted} max={Math.max(1, s!.proposed)} delay={i * 70} /></div>
                    <p className="mt-1 text-xs text-subtle">
                      {s!.paused ? s!.rationale : Object.entries(s!.rejected).filter(([, n]) => n).map(([r, n]) => `${n} ${REASON[r] ?? r}`).join(" · ") || s!.rationale}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {last.kept.length > 0 && (
              <div>
                <p className="text-xs text-subtle">Kept, for passages nobody had asked about</p>
                <ul className="mt-1.5 space-y-1">
                  {last.kept.slice(0, 5).map((k, i) => (
                    <li key={`${k.chunkId}-${i}`} className="ir-rise flex gap-2 font-mono text-xs" style={{ animationDelay: `${i * 50}ms` }}>
                      <span className="text-primary">“{k.question}”</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {run && <p className="mt-2 text-xs text-subtle">Slept in {run.tookMs} ms.</p>}
      </section>

      <section className="ir-rise" style={{ animationDelay: "200ms" }}>
        <p className="text-xs font-medium uppercase tracking-[0.08em] text-subtle">Resolved questions</p>
        <p className="mt-2 text-muted">
          {mem?.cases.count ?? 0} on file.{" "}
          {caseLast
            ? caseLast.accepted
              ? `The last sleep started using them: ${caseLast.rationale}.`
              : `Not used yet: ${caseLast.rationale}.`
            : "They're used once replaying them shows they help on this source."}
        </p>
      </section>

      {mem && mem.wake.recent.length > 0 && (
        <section className="ir-rise" style={{ animationDelay: "260ms" }}>
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-subtle">Latest ratings</p>
          <ul className="mt-2 space-y-1.5">
            {mem.wake.recent.map((r, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", r.vote > 0 ? "bg-primary" : "bg-bad")} aria-label={r.vote > 0 ? "useful" : "dead end"} />
                <span className="text-fg">{r.q}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {error && <p className="text-warn">{error}</p>}
    </div>
  );
}
