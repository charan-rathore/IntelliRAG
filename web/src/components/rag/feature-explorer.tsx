import { useEffect, useRef, useState, type ReactNode } from "react";
import { EASE_IO, EASE_OUT, catmullRomPath, span } from "@/lib/motion/curves";
import { Button } from "@/components/ui/button";

/**
 * "What's inside": a tab rail of the product's features, each with a small
 * live product window that plays what the feature does. Tabs advance on
 * their own (6 s each, with a progress line, paused while you hover or
 * focus the explorer), and every tab ends in a real button that opens that
 * feature in the console. Clicking a tab stops the auto-advance.
 *
 * Every scene is a pure function of p in [0, 1], so any frame is a
 * complete picture; reduced motion shows the final frame and never
 * advances on its own. The windows are aria-hidden: each tab's description
 * and its button carry the same information.
 */

const DURATION = 6000;

export interface ExplorerActions {
  onAsk: () => void;
  onEvidence: () => void;
  onSources: () => void;
  onLab: () => void;
  onTour: () => void;
}

type Feature = {
  id: string;
  title: string;
  body: string;
  cta: string;
  act: keyof ExplorerActions;
  window: string;
  Scene: (props: { p: number }) => ReactNode;
};

const FEATURES: Feature[] = [
  {
    id: "ask",
    title: "Ask in plain words",
    body: "Each sentence of the answer carries a citation you can open.",
    cta: "Ask the sample question",
    act: "onAsk",
    window: "Ask",
    Scene: AskScene,
  },
  {
    id: "evidence",
    title: "See the evidence",
    body: "Every passage retrieval considered, its score, and whether it cleared the gate.",
    cta: "Ask, then open Evidence",
    act: "onEvidence",
    window: "Evidence",
    Scene: EvidenceListScene,
  },
  {
    id: "sources",
    title: "Bring a source",
    body: "Point at a GitHub README or paste a doc. It is split into passages you can inspect.",
    cta: "See the sources",
    act: "onSources",
    window: "Sources",
    Scene: SourcesScene,
  },
  {
    id: "lab",
    title: "Open the Lab",
    body: "The knowledge graph behind the answer and where every millisecond went.",
    cta: "Open the Lab",
    act: "onLab",
    window: "Lab",
    Scene: LabScene,
  },
];

const reducedMotion = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function FeatureExplorer(actions: ExplorerActions) {
  const [active, setActive] = useState(0);
  const [p, setP] = useState(0);
  const [auto, setAuto] = useState(true);
  const hold = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const visible = useRef(false);

  useEffect(() => {
    if (reducedMotion()) { setP(1); return; }
    let raf = 0;
    let last = 0;
    let t = 0;
    const io = typeof IntersectionObserver === "function"
      ? new IntersectionObserver(([e]) => { visible.current = !!e?.isIntersecting; }, { threshold: 0.2 })
      : null;
    if (root.current) io?.observe(root.current); else visible.current = true;
    if (!io) visible.current = true;
    const frame = (now: number) => {
      const dt = last ? Math.min(64, now - last) : 16;
      last = now;
      // The scene always plays while on screen; hovering only holds the
      // switch to the next tab, so you can watch the end of the one you're on.
      if (visible.current && t < DURATION) {
        t = Math.min(DURATION, t + dt);
        setP(t / DURATION);
      } else if (t >= DURATION && auto && !hold.current && visible.current) {
        t = 0;
        setActive((a) => (a + 1) % FEATURES.length);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); io?.disconnect(); };
  }, [active, auto]);

  const feature = FEATURES[active]!;
  const Scene = feature.Scene;
  // Scenes finish their story by 85% of the slot, then rest on the full frame.
  const sp = Math.min(1, p / 0.85);

  return (
    <div
      ref={root}
      className="ir-explorer"
      onPointerEnter={() => { hold.current = true; }}
      onPointerLeave={() => { hold.current = false; }}
      onFocus={() => { hold.current = true; }}
      onBlur={() => { hold.current = false; }}
    >
      <div className="ir-explorer-rail" role="tablist" aria-label="Features">
        {FEATURES.map((f, i) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            id={`ir-tab-${f.id}`}
            aria-selected={i === active}
            aria-controls="ir-explorer-panel"
            className="ir-tab"
            onClick={() => { setAuto(false); setActive(i); }}
          >
            <span className="ir-tab-title">{f.title}</span>
            <span className="ir-tab-body">{f.body}</span>
            <span className="ir-tab-progress" aria-hidden="true">
              <i style={{ transform: `scaleX(${i === active ? (auto ? p : 1) : 0})` }} />
            </span>
          </button>
        ))}
      </div>
      <div id="ir-explorer-panel" role="tabpanel" aria-labelledby={`ir-tab-${feature.id}`} className="ir-explorer-panel">
        <div className="ir-win ir-explorer-win" aria-hidden="true" key={feature.id}>
          <p className="ir-win-bar"><span>{feature.window}</span></p>
          <div className="ir-explorer-scene"><Scene p={sp} /></div>
        </div>
        <div className="ir-explorer-actions">
          <p>{feature.window === "Ask" ? "Runs on the pinned p-queue README." : feature.window === "Sources" ? "Lists the indexed sources and what is in them." : "Runs the sample question, then opens it."}</p>
          <Button size="lg" onClick={actions[feature.act]}>{feature.cta}</Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

const o = (v: number) => ({ opacity: v, transform: `translateY(${((1 - v) * 6).toFixed(1)}px)` });

function AskScene({ p }: { p: number }) {
  const q = "How do I pause the queue and wait for running jobs?";
  const typed = q.slice(0, Math.round(q.length * EASE_IO(span(p, 0, 0.22))));
  const parts: { t: string; cite?: number; at: number }[] = [
    { t: "Call ", at: 0.3 }, { t: "queue.pause()", at: 0.33 }, { t: " so no new task starts", at: 0.37 }, { t: "", cite: 2, at: 0.45 },
    { t: ", then ", at: 0.5 }, { t: "await queue.onPendingZero()", at: 0.54 }, { t: " until the running ones settle", at: 0.58 }, { t: "", cite: 1, at: 0.66 }, { t: ".", at: 0.68 },
  ];
  return (
    <div className="sc-ask">
      <div className="sc-ask-q"><span>{typed}</span>{p < 0.24 ? <i className="sc-caret" /> : null}</div>
      <p className="sc-ask-a">
        {parts.map((x, i) => {
          const v = EASE_OUT(span(p, x.at, x.at + 0.06));
          return x.cite
            ? <b key={i} className="ir-cite" style={{ opacity: v, transform: `scale(${0.85 + 0.15 * v})` }}>{x.cite}</b>
            : <span key={i} className={x.t.includes("queue.") ? "ir-code" : undefined} style={{ opacity: v }}>{x.t}</span>;
        })}
      </p>
      <div className="sc-ask-cards">
        {[{ n: 1, h: ".onPendingZero()", s: "Drain in-flight tasks before mutating shared state." }, { n: 2, h: ".pause()", s: "Put queue execution on hold." }].map((c, i) => (
          <div key={c.n} className="sc-card" style={o(EASE_OUT(span(p, 0.72 + i * 0.08, 0.86 + i * 0.08)))}>
            <b className="ir-cite" style={{ opacity: 1 }}>{c.n}</b>
            <div><span className="sc-mono">{c.h}</span><span className="sc-dim">{c.s}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EvidenceListScene({ p }: { p: number }) {
  const rows = [
    { h: ".onPendingZero()", v: 0.92, used: 1 },
    { h: ".pause()", v: 0.81, used: 2 },
    { h: ".start()", v: 0.52 },
    { h: ".onIdle()", v: 0.46 },
    { h: ".clear()", v: 0.37 },
    { h: ".add(fn, options?)", v: 0.31 },
  ];
  const gate = EASE_OUT(span(p, 0.42, 0.55));
  const open = EASE_IO(span(p, 0.58, 0.78));
  return (
    <div className="sc-ev">
      {rows.map((r, i) => {
        const fill = EASE_OUT(span(p, 0.03 + i * 0.05, 0.25 + i * 0.05)) * r.v;
        const used = !!r.used && gate > 0.5;
        return (
          <div key={r.h}>
            {i === 2 ? <div className="sc-gate" style={{ opacity: gate, transform: `scaleX(${gate})` }}><span>Gate</span></div> : null}
            <div className={`sc-ev-row${used ? " is-used" : ""}${!r.used && gate > 0.5 ? " is-out" : ""}`}>
              <span className="sc-mono">{r.h}</span>
              <span className="sc-bar"><i style={{ transform: `scaleX(${fill.toFixed(3)})` }} /></span>
              <em>{used ? `Cited [${r.used}]` : gate > 0.5 ? "Inspect only" : ""}</em>
            </div>
            {i === 0 ? (
              <div className="sc-ev-open" style={{ height: `${(open * 52).toFixed(1)}px`, opacity: open }}>
                <p>Useful when you want to <mark style={{ backgroundSize: `${(EASE_OUT(span(p, 0.74, 0.9)) * 100).toFixed(1)}% 100%` }}>drain in-flight tasks before mutating shared state</mark>.</p>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function SourcesScene({ p }: { p: number }) {
  const url = "github.com/sindresorhus/p-queue";
  const typed = url.slice(0, Math.round(url.length * EASE_IO(span(p, 0, 0.2))));
  const sections = ["Install", "Usage", "API: new PQueue(options)", ".add(fn, options?)", ".pause() and .start()", ".onEmpty(), .onIdle(), .onPendingZero()", "Events", "FAQ"];
  const read = span(p, 0.26, 0.78);
  const ready = EASE_OUT(span(p, 0.8, 0.92));
  return (
    <div className="sc-src">
      <div className="sc-ask-q"><span className="sc-mono">{typed}</span>{p < 0.22 ? <i className="sc-caret" /> : null}</div>
      <div className="sc-progress"><i style={{ transform: `scaleX(${read.toFixed(3)})` }} /></div>
      <ul>
        {sections.map((s, i) => {
          const v = EASE_OUT(span(read, i / sections.length, (i + 1) / sections.length));
          return (
            <li key={s} style={o(v)}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 7.5 6 10l5-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              <span>{s}</span>
            </li>
          );
        })}
      </ul>
      <p className="sc-ready" style={o(ready)}>README.md is ready to ask</p>
    </div>
  );
}

const NODES = [
  { x: 48, y: 70, k: "doc", l: "README" }, { x: 150, y: 34, k: "h", l: ".pause()" }, { x: 168, y: 112, k: "h", l: ".onPendingZero()" },
  { x: 270, y: 60, k: "t", l: "shared state" }, { x: 286, y: 138, k: "t", l: "running tasks" }, { x: 96, y: 150, k: "h", l: ".onIdle()" },
];
const EDGES: [number, number][] = [[0, 1], [0, 2], [0, 5], [2, 3], [2, 4], [1, 3]];
const STAGES = [
  { l: "Retrieve", a: 0, w: 0.22 }, { l: "Rerank", a: 0.22, w: 0.12 }, { l: "Pack", a: 0.34, w: 0.08 }, { l: "Generate", a: 0.42, w: 0.58 },
];

function LabScene({ p }: { p: number }) {
  return (
    <div className="sc-lab">
      <svg viewBox="0 0 340 180" className="sc-graph">
        {EDGES.map(([a, b], i) => {
          const A = NODES[a]!, B = NODES[b]!;
          const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 - 18 };
          const d = catmullRomPath([A, mid, B]);
          const t = EASE_IO(span(p, 0.12 + i * 0.05, 0.34 + i * 0.05));
          return <path key={i} d={d} pathLength={1} strokeDasharray="1" strokeDashoffset={1 - t} />;
        })}
        {NODES.map((n, i) => {
          const v = EASE_OUT(span(p, i * 0.04, 0.12 + i * 0.04));
          return (
            <g key={n.l} transform={`translate(${n.x} ${n.y}) scale(${0.6 + 0.4 * v})`} opacity={v}>
              <circle r={n.k === "doc" ? 9 : 6} className={`n-${n.k}`} />
              <text y={n.k === "doc" ? 22 : 18} textAnchor="middle">{n.l}</text>
            </g>
          );
        })}
      </svg>
      <div className="sc-wf">
        {STAGES.map((s, i) => {
          const t = EASE_OUT(span(p, 0.5 + i * 0.08, 0.66 + i * 0.08));
          return (
            <div key={s.l} className="sc-wf-row">
              <span>{s.l}</span>
              <span className="sc-wf-track"><i style={{ left: `${s.a * 100}%`, width: `${s.w * 100}%`, transform: `scaleX(${t.toFixed(3)})` }} /></span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
