import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Search, CornerDownLeft } from "lucide-react";
import { searchSources, suggestSearch } from "@/lib/rag/functions";
import { cn } from "@/lib/utils";

type Result = Awaited<ReturnType<typeof searchSources>>;

const OPERATORS: Array<[string, string]> = [
  ["path:src/queue", "only files under a path"],
  ["lang:ts", "one language"],
  ["sym:resume", "a function or class name"],
  ["kind:prose", "docs only (kind:code for code)"],
  ['"exact words"', "must appear as typed"],
  ["-word", "leave out passages with it"],
];

function Highlighted({ text, marks }: { text: string; marks: Array<[number, number]> }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  marks.forEach(([s, e], i) => {
    if (s > at) parts.push(text.slice(at, s));
    parts.push(<mark key={i} className="rounded-[2px] bg-primary/20 px-px text-fg">{text.slice(s, e)}</mark>);
    at = e;
  });
  parts.push(text.slice(at));
  return <>{parts}</>;
}

/**
 * Search the indexed sources the way you'd search code on GitHub: instant,
 * ranked passages with the matching lines highlighted. Open with ⌘K / Ctrl+K.
 */
export function SearchPalette({ open, onClose, corpus }: { open: boolean; onClose: () => void; corpus: string | null }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Result | null>(null);
  const [hints, setHints] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!open) return;
    setActive(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const text = q.trim();
    const id = ++seq.current;
    const last = q.split(/\s+/).at(-1) ?? "";
    const timer = window.setTimeout(async () => {
      try {
        if (last.length >= 2 && !last.includes(":")) {
          void suggestSearch({ data: { prefix: last, corpus } }).then((s) => { if (seq.current === id) setHints(s.filter((h) => h !== last).slice(0, 5)); }).catch(() => {});
        } else setHints([]);
        if (!text) { setRes(null); setError(null); return; }
        setBusy(true);
        const r = await searchSources({ data: { q: text, corpus, limit: 20 } });
        if (seq.current !== id) return;
        setRes(r); setError(null); setActive(0);
      } catch {
        if (seq.current === id) setError("Search didn't respond. Try again.");
      } finally {
        if (seq.current === id) setBusy(false);
      }
    }, 120);
    return () => window.clearTimeout(timer);
  }, [q, corpus, open]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const results = res?.results ?? [];
  const completeWith = (word: string) => setQ((cur) => cur.replace(/\S*$/, `${word} `));

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Tab" && hints[0] && !e.shiftKey) { e.preventDefault(); completeWith(hints[0]); }
    else if (e.key === "Enter") {
      const r = results[active];
      if (r) { e.preventDefault(); listRef.current?.querySelector<HTMLAnchorElement>(`[data-i="${active}"] a`)?.click(); }
    }
  };

  const summary = useMemo(() => {
    if (!res) return null;
    return `${res.results.length} of ${res.searched.toLocaleString()} passages · ${res.tookMs} ms`;
  }, [res]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-bg/70 px-3 pt-[12vh] backdrop-blur-[2px]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Search sources" className="flex max-h-[72vh] w-full max-w-2xl flex-col overflow-hidden rounded-md border border-border bg-surface shadow-[0_24px_60px_-20px_rgba(0,0,0,0.45)]">
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="size-4 shrink-0 text-muted" aria-hidden />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search code and docs: parseConfig lang:ts -test"
            aria-label="Search sources"
            aria-controls="search-results"
            aria-activedescendant={results[active] ? `sr-${active}` : undefined}
            spellCheck={false}
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-subtle"
          />
          {busy && <span className="size-1.5 animate-pulse rounded-full bg-primary" aria-label="Searching" />}
          <kbd className="hidden rounded-sm border border-border px-1.5 py-0.5 font-mono text-[11px] text-subtle sm:block">esc</kbd>
        </div>

        {hints.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2 text-xs text-muted">
            <span className="text-subtle">Complete</span>
            {hints.map((h, i) => (
              <button key={h} type="button" onClick={() => { completeWith(h); inputRef.current?.focus(); }} className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-fg hover:bg-raised">
                {h}{i === 0 && <span className="ml-1 text-subtle">tab</span>}
              </button>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error && <p className="px-4 py-6 text-sm text-warn">{error}</p>}
          {res?.didYouMean && (
            <p className="px-4 pt-3 text-sm text-muted">
              Did you mean{" "}
              <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => setQ(res.didYouMean!)}>{res.didYouMean}</button>?
            </p>
          )}
          {!q.trim() && (
            <div className="px-4 py-4">
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-subtle">Narrow it down</p>
              <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                {OPERATORS.map(([op, what]) => (
                  <div key={op} className="flex items-baseline gap-2">
                    <dt><button type="button" className="font-mono text-[13px] text-fg hover:text-primary" onClick={() => { setQ((c) => `${c}${c && !c.endsWith(" ") ? " " : ""}${op} `); inputRef.current?.focus(); }}>{op}</button></dt>
                    <dd className="text-muted">{what}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {res && results.length === 0 && !error && (
            <p className="px-4 py-6 text-sm text-muted">Nothing in these sources matches. Fewer words or a different filter may help.</p>
          )}
          <ul id="search-results" ref={listRef} role="listbox" className="py-1">
            {results.map((r, i) => (
              <li key={r.chunkId} id={`sr-${i}`} data-i={i} role="option" aria-selected={i === active} onMouseMove={() => setActive(i)}
                className={cn("border-l-2 px-4 py-2.5", i === active ? "border-primary bg-raised" : "border-transparent")}>
                <Link to="/sources/$slug" params={{ slug: r.slug }} onClick={onClose} className="block">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate text-sm font-medium text-fg">{r.symbol ?? r.heading ?? r.title}</span>
                    <span className="truncate font-mono text-xs text-subtle">{r.path ?? r.title}</span>
                    {r.language && <span className="ml-auto shrink-0 font-mono text-[11px] text-subtle">{r.language}</span>}
                  </div>
                  <pre className="mt-1.5 overflow-hidden whitespace-pre-wrap break-words font-mono text-[12.5px] leading-[1.55] text-muted [max-height:6.5em]">
                    <Highlighted text={r.snippet.text} marks={r.snippet.marks} />
                  </pre>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2 text-[11px] text-subtle">
          <span className="tabular-nums">{summary ?? "Ranks identifiers, names and docstrings; learns from passages you confirm."}</span>
          <span className="hidden items-center gap-1 sm:flex"><CornerDownLeft className="size-3" aria-hidden /> open · ↑↓ move</span>
        </div>
      </div>
    </div>
  );
}
