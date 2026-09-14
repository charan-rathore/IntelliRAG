import { useEffect, useMemo, useState } from "react";
import type { GraphLink, GraphNode, LearningSidecar } from "@/lib/rag/graphify/schema";
import { applyGraphEdits, scopeGraph, edgeKey, loadGraphEdits, GRAPH_EDITS_STORAGE, EMPTY_EDITS, type GraphEdits } from "@/lib/rag/graphify/edits";
import { explainConnection } from "@/lib/rag/graphify/story";
import { cn } from "@/lib/utils";

type Props = { nodes: GraphNode[]; links: GraphLink[]; learning?: LearningSidecar | null; nodeCount?: number; edgeCount?: number; cacheCount?: number; preferred?: number; durable?: boolean };
const control = "min-h-11 rounded border border-border bg-bg px-3 text-xs text-fg";
const colors: Record<GraphNode["kind"], string> = { document: "#b3a4ff", heading: "#64d8c0", term: "#e8bc75", query: "#79b9f5", symbol: "#f496b3" };

export function KnowledgeGraph(props: Props) {
  const [trail, setTrail] = useState<string[]>([]);
  const [neighborPage, setNeighborPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState("all");
  const [expanded, setExpanded] = useState(false);
  const [edits, setEdits] = useState<GraphEdits>(EMPTY_EDITS);
  const [label, setLabel] = useState("");
  const [target, setTarget] = useState("");
  const [relation, setRelation] = useState("related to");
  const [limit, setLimit] = useState(12);
  const [notice, setNotice] = useState("");
  useEffect(() => { setEdits(loadGraphEdits()); }, []);
  const base = useMemo(() => scopeGraph({ directed: false, multigraph: false, graph: { generator: "intellirag-graphify" }, nodes: props.nodes, links: props.links }, scope), [props.nodes, props.links, scope]);
  const graph = useMemo(() => {
    const next = applyGraphEdits(base, edits);
    const priority = (e: GraphLink) => e.confidence === "USER_EDITED" ? 0 : e.confidence === "EXTRACTED" ? 1 : 2;
    return { ...next, links: [...next.links].sort((a, b) => priority(a) - priority(b)) };
  }, [base, edits]);
  const byId = useMemo(() => new Map(graph.nodes.map(n => [n.id, n])), [graph.nodes]);
  const active = selected ? byId.get(selected) : undefined;
  const connections = useMemo(() => active ? graph.links.filter(e => e.source === active.id || e.target === active.id) : [], [graph.links, active]);
  const matches = useMemo(() => graph.nodes.filter(n => search.trim() ? n.label.toLowerCase().includes(search.trim().toLowerCase()) : n.kind === "document"), [graph.nodes, search]);
  const visible = useMemo(() => {
    if (!active) return matches.slice(0, 6);
    const ids = connections.slice(neighborPage * 6, neighborPage * 6 + 6).map(e => e.source === active.id ? e.target : e.source);
    return [active, ...[...new Set(ids)].map(id => byId.get(id)).filter((n): n is GraphNode => Boolean(n))];
  }, [active, matches, connections, neighborPage, byId]);
  const learning = props.learning?.nodes.find(n => n.id === active?.id);
  const prior = byId.get(trail.at(-2) || '');
  const arrival = active && prior ? graph.links.find(e => (e.source === prior.id && e.target === active.id) || (e.target === prior.id && e.source === active.id)) : undefined;
  const learned = props.learning?.nodes.filter(n => byId.has(n.id)) || [];
  const positions = useMemo(() => {
    const out = new Map<string, { x: number; y: number }>();
    visible.forEach((n, i) => {
      if (active && i === 0) { out.set(n.id, { x: 400, y: 245 }); return; }
      const count = visible.length - (active ? 1 : 0);
      const angle = (i - (active ? 1 : 0)) / Math.max(1, count) * Math.PI * 2 - Math.PI / 2;
      out.set(n.id, { x: Math.round((400 + Math.cos(angle) * 290) * 10) / 10, y: Math.round((245 + Math.sin(angle) * 195) * 10) / 10 });
    });
    return out;
  }, [visible, active]);
  function choose(n: GraphNode) {
    const revisited = trail.indexOf(n.id);
    const connected = active && connections.some(e => e.source === n.id || e.target === n.id);
    setTrail(revisited >= 0 ? trail.slice(0, revisited + 1) : connected ? [...trail, n.id] : [n.id]);
    setSelected(n.id); setLabel(n.label); setTarget(""); setLimit(6); setNeighborPage(0);
  }
  function clear() { setSelected(null); setTrail([]); setNeighborPage(0); }
  function save(next: GraphEdits) {
    if (next.edges.length > 200 || next.labels.length > 100) { setNotice("Edit limit reached. Reset or restore an edit before adding another."); return; }
    try { localStorage.setItem(GRAPH_EDITS_STORAGE, JSON.stringify(next)); setEdits(next); setNotice("Saved in this browser. Your next question will use these connections."); }
    catch { setNotice("Could not save edits: browser storage is unavailable."); }
  }
  function changeEdge(e: GraphLink, disabled: boolean) {
    save({ ...edits, edges: [...edits.edges.filter(x => edgeKey(x) !== edgeKey(e)), { source: e.source, target: e.target, relation: e.relation, disabled }] });
  }
  function download() {
    const blob = new Blob([JSON.stringify({ schema: 1, graph, edits, scope }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "intellirag-graph.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const scopes = [...new Set(props.nodes.filter(n => n.kind === "document").map(n => n.corpusId ?? "seed-lab"))];
  const disabled = edits.edges.filter(e => e.disabled && (e.source === selected || e.target === selected));
  return <section data-tour="tour-graph" aria-label="Knowledge graph explorer" className={cn("rounded-xl border border-border bg-raised p-3", expanded && "fixed inset-2 z-50 overflow-auto p-4 shadow-2xl sm:inset-6 sm:p-6")}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><p className="text-xs uppercase tracking-[0.16em] text-primary">Knowledge graph</p><p className="mt-1 text-xs text-muted">{graph.nodes.length} nodes · {graph.links.length} connections</p></div>
      <button className={control} onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? "Close explorer" : "Expand graph ↗"}</button>
    </div>
    <p className="mt-3 text-xs leading-relaxed text-muted">Start with a source. Follow one clue at a time: the original text, the connections it creates, and the answers that cited it. Your edits guide search; the source stays the evidence.</p>
    <div className={cn("mt-3 grid gap-3", expanded && "sm:grid-cols-2")}>
      <label className="text-xs text-muted">Find a source or term<input value={search} onChange={e => { setSearch(e.target.value); clear(); }} placeholder="Search Redis, SQL, or a source…" className={cn(control, "mt-1 w-full")} /></label>
      <label className="text-xs text-muted">Graph corpus<select value={scope} onChange={e => { setScope(e.target.value); clear(); }} className={cn(control, "mt-1 w-full")}><option value="all">All indexed sources</option>{scopes.map(c => <option key={c} value={c}>{c === "seed-lab" ? "Built-in runbooks" : c}</option>)}</select></label>
    </div>
    <nav aria-label="Evidence trail" className="mt-3 flex flex-wrap items-center gap-1 text-xs"><button className={control} onClick={clear}>All sources</button>{trail.map(id => { const n = byId.get(id); return n && <span key={id} className="inline-flex max-w-full items-center gap-1"><span aria-hidden="true">→</span><button className={cn(control, "max-w-56 truncate", id === selected && "border-primary text-primary")} aria-current={id === selected ? "step" : undefined} onClick={() => choose(n)}>{n.label}</button></span>; })}</nav>
    <div className={cn("mt-3 grid gap-4", expanded && "lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]")}>
      <div className={cn("min-w-0", expanded && "lg:sticky lg:top-0 lg:self-start")}>
        <div className="relative overflow-hidden rounded-xl border border-border bg-bg" style={{ backgroundImage: "radial-gradient(ellipse at 50% 50%,#8170cc18,transparent 70%),radial-gradient(#94a3b81a 1px,transparent 1px)", backgroundSize: "auto,20px 20px" }}>
          <svg viewBox="0 0 800 490" className="w-full" role="group" aria-label="Corpus knowledge graph">
            <circle cx="400" cy="245" r="160" fill="none" stroke="#94a3b81a" strokeDasharray="4 8" />
            {(active ? connections : []).map((e, i) => { const a = positions.get(e.source), b = positions.get(e.target); if (!a || !b) return null; return <g key={i}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={e.confidence === "USER_EDITED" ? "#e8bc75" : "#a798df"} strokeWidth={e.confidence === "EXTRACTED" ? 3 : e.confidence === "USER_EDITED" ? 2 : 1} opacity={active ? .65 : .25} strokeDasharray={e.confidence === "EXTRACTED" ? undefined : "5 5"} /><title>{`${e.relation} · ${e.confidence.toLowerCase()}`}</title>{active && visible.length < 10 && <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2} fill="#bdb4d8" fontSize="11" textAnchor="middle">{e.relation}</text>}</g>; })}
            {visible.map(n => { const p = positions.get(n.id)!; return <g key={n.id} transform={`translate(${p.x} ${p.y})`} role="button" tabIndex={0} aria-label={`${n.label}, ${n.kind}`} aria-pressed={selected === n.id} onClick={() => choose(n)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(n); } }} className="cursor-pointer outline-none focus:stroke-white">
              <title>{`${n.label} · ${n.source_file} ${n.source_location}`}</title><circle r="24" fill={colors[n.kind]} opacity=".1" /><circle r={n.kind === "document" ? 10 : 6} fill={colors[n.kind]} stroke={selected === n.id ? "white" : colors[n.kind]} strokeWidth="2" /><text y="35" textAnchor="middle" fill={colors[n.kind]} fontSize="12">{n.label.length > 25 ? n.label.slice(0, 23) + "…" : n.label}</text>
            </g>; })}
          </svg>
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted">{Object.entries(colors).map(([kind, color]) => <span key={kind}><span style={{ color }}>●</span> {kind}</span>)}</div>
        <p className="mt-2 text-xs text-subtle">Showing {visible.length} of {graph.nodes.length} nodes. {active ? "Selected node and its neighborhood." : "Choose a source to focus its neighborhood."} Thick solid: observed in the source or answer trace. Thin dashed: inferred. Gold dashed: your edit.</p>
        {active && connections.length > 6 && <button className={cn(control, "mt-2")} onClick={() => setNeighborPage((neighborPage + 1) % Math.ceil(connections.length / 6))}>Next clues · {neighborPage + 1}/{Math.ceil(connections.length / 6)}</button>}
        <div className="mt-3 flex max-h-48 flex-wrap gap-2 overflow-auto" aria-label="Matching graph nodes">
          {matches.slice(0, limit).map(n => <button key={n.id} className={cn(control, "max-w-full break-words py-2 text-left", selected === n.id && "border-primary text-primary")} onClick={() => choose(n)}>{n.label}</button>)}
          {!matches.length && <p className="text-xs text-muted">No matching nodes in this corpus.</p>}
          {matches.length > limit && <button className={control} onClick={() => setLimit(limit + 24)}>Show more matches ({matches.length - limit})</button>}
        </div>
        <div className="mt-3 flex flex-wrap gap-2"><button className={control} onClick={download}>Export graph + edits</button><button className={control} disabled={!edits.edges.length && !edits.labels.length} onClick={() => save({ labels: [], edges: [] })}>Reset my edits</button></div>
        <p className="mt-2 text-xs text-muted">{edits.labels.length + edits.edges.length} browser edits · {props.cacheCount ?? 0} cached answers. Export to keep a portable copy.</p>
      </div>
      <div className="min-w-0">
        {active ? <div className="rounded-xl border border-border bg-bg p-3 text-xs">
          <p className="uppercase tracking-widest text-primary">{active.kind} / inspect & tune</p><h3 className="mt-2 break-words text-lg text-fg">{active.label}</h3>
          <p className="mt-2 break-words text-muted">Source: {active.source_file || "Shared term"}{active.source_location ? ` · ${active.source_location}` : ""}</p>
          <div className="mt-2 flex flex-wrap gap-3">{active.slug && <a className="inline-flex min-h-11 items-center text-primary underline" href={`/sources/${encodeURIComponent(active.slug)}`}>Open source evidence →</a>}{active.sourceUri && /^https:\/\//.test(active.sourceUri) && <a className="inline-flex min-h-11 items-center text-primary underline" href={active.sourceUri} target="_blank" rel="noreferrer">Original on GitHub ↗</a>}</div>
          <div data-graph-story className="mt-3 space-y-3 border-y border-border py-4">
            <p className="text-sm font-medium text-fg">How this clue fits</p>
            <p className="leading-relaxed text-muted">{arrival && prior ? explainConnection(arrival, prior, active) : active.kind === "document" ? "This is an indexed source. Its headings and declarations preserve entry points into the original; saved answer connections show where it was cited." : active.kind === "query" ? "This question was saved after an answer. Its source connections record cited documents, so you can retrace the answer." : active.kind === "term" ? "This word appears across sources. It is a lexical clue, not a fact or a causal explanation. Follow a document to inspect the wording." : "This node was extracted from the source at the recorded line. Open the surrounding passage before drawing a conclusion."}</p>
            {active.excerpt && <div><p className="mb-2 text-subtle">Original text · {active.source_location}</p><blockquote className="whitespace-pre-wrap break-words border-l-2 border-primary pl-3 font-mono text-xs leading-relaxed text-fg">{active.excerpt}</blockquote></div>}
            <p className="leading-relaxed text-muted">{learning ? `Feedback: ${learning.verdict.replace('_', ' ')} · ${learning.useful} useful, ${learning.dead_end} dead ends, ${learning.corrected} corrections from distinct questions. ${learning.verdict === 'preferred' ? 'This source can receive a graph ranking boost.' : learning.verdict === 'contested' || learning.verdict === 'dead_end' ? 'Its graph ranking boost is withheld; the original source remains inspectable.' : 'More independent support is needed before preference.'}` : "No rated answer history for this node yet. A connection alone is not a quality endorsement."}</p>
          </div>
          <form onSubmit={e => { e.preventDefault(); if (label.trim()) save({ ...edits, labels: [...edits.labels.filter(x => x.id !== active.id), { id: active.id, label: label.trim() }] }); }} className="mt-2 flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 text-muted">Display label<input className={cn(control, "mt-1 w-full")} value={label} onChange={e => setLabel(e.target.value)} maxLength={160} required /></label><button className={control}>Save label</button>
          </form>
          <p className="mt-4 font-medium">{connections.length} connections · {Math.min(limit, connections.length)} listed</p>
          <ul className="mt-2 max-h-64 space-y-2 overflow-auto">{connections.slice(0, limit).map(e => { const n = byId.get(e.source === active.id ? e.target : e.source); return <li key={edgeKey(e)} className="rounded border border-border p-2"><button className="min-h-11 w-full break-words text-left text-primary" onClick={() => n && choose(n)}>{n?.label}</button><p className="text-muted">{e.relation} · {e.confidence.toLowerCase()}</p>{n && <p className="mt-2 leading-relaxed text-subtle">{explainConnection(e, active, n)}</p>}<button className="min-h-11 text-muted underline" onClick={() => changeEdge(e, true)}>Disable connection</button></li>; })}</ul>
          {connections.length > limit && <button className={cn(control, "mt-2")} onClick={() => setLimit(limit + 24)}>Show more connections</button>}
          {disabled.map(e => <div key={edgeKey(e)} className="mt-2 break-words text-muted">Disabled: {byId.get(e.source === active.id ? e.target : e.source)?.label ?? "Missing node"}<button className="ml-2 min-h-11 text-primary underline" onClick={() => save({ ...edits, edges: edits.edges.filter(x => edgeKey(x) !== edgeKey(e)) })}>Restore connection</button></div>)}
          <form className="mt-4 space-y-2 border-t border-border pt-3" onSubmit={e => { e.preventDefault(); if (target && relation.trim()) changeEdge({ source: active.id, target, relation: relation.trim(), confidence: "USER_EDITED" }, false); }}>
            <p className="font-medium text-fg">Add or relabel a connection</p><label className="block text-muted">Connect to<select required value={target} onChange={e => setTarget(e.target.value)} className={cn(control, "mt-1 w-full")}><option value="">Choose a node…</option>{graph.nodes.filter(n => n.id !== active.id).map(n => <option key={n.id} value={n.id}>{n.label} · {n.kind}</option>)}</select></label>
            <label className="block text-muted">Connection label<input required maxLength={80} value={relation} onChange={e => setRelation(e.target.value)} className={cn(control, "mt-1 w-full")} /></label><button className={control}>Save connection</button>
            <p className="text-subtle">Manual connections are marked user_edited. They can guide retrieval but cannot establish a fact.</p>
          </form><button className="mt-2 min-h-11 text-muted underline" onClick={clear}>Clear selection</button>
        </div> : <div className="rounded-xl border border-dashed border-border p-5 text-sm leading-relaxed text-muted">Select a node above to read its source location, follow every connection, and adjust labels or relationships.</div>}
      </div>
    </div>
    <details data-graph-evolution className="mt-4 rounded-lg border border-border bg-bg p-3 text-xs">
      <summary className="min-h-11 cursor-pointer content-center text-primary">How the graph grows · {graph.nodes.filter(n => n.kind === 'query').length} saved questions · {learned.filter(n => n.verdict === 'preferred').length} preferred sources</summary>
      <ol className="mt-2 list-decimal space-y-2 pl-5 leading-relaxed text-muted"><li>Import a source: headings, declarations and shared words form new connections.</li><li>Ask a question: the graph is consulted before retrieval. Saved answers connect to the documents they actually cite.</li><li>Rate the answer: distinct useful questions can promote a source. Corrections and dead ends remove its graph boost; repeated votes on one question do not count as independent support.</li><li>Re-import changed text: old cached answers and feedback are cleared so stale evidence cannot keep its old standing.</li></ol>
      <p className="mt-3 text-muted">Feedback weight halves every {props.learning?.halfLifeDays ?? 30} days. {props.learning?.minCorroboration ?? 2} distinct useful questions are needed for preference. Learning guides ranking; it never rewrites source facts.</p>
      <p className="mt-3 text-warn">{props.durable ? "This deployment reports persistent storage for its graph history." : "This public lab uses temporary storage. Imports, saved answers and learning may reset after a server restart. Export to keep a copy."} Manual edits stay in this browser.</p>
    </details>
    <p role="status" className="mt-2 text-xs text-primary">{notice}</p>
  </section>;
}
