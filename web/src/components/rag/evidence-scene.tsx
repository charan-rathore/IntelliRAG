import { useCallback, useEffect, useRef } from "react";
import { EASE_IO, EASE_OUT, flightPath, highlighterPath, span } from "@/lib/motion/curves";
import { useTimeline } from "@/lib/motion/scene";

/**
 * The welcome's one orchestrated moment: source → answer → proof, played
 * once when it scrolls into view (3.6 s), then resting on its final frame.
 *
 *  1. A scan line passes down the README (ease-in-out).
 *  2. The highlighter marks the two passages retrieval used, most relevant
 *     first. Each stroke is a closed Catmull-Rom spline with jittered edges
 *     (lib/motion/curves.ts → highlighterPath), revealed left to right.
 *  3. A thread (cubic Bézier) draws from each highlight to the citation it
 *     supports, and the answer's words arrive as their thread lands.
 *
 * Text is the real p-queue README and a faithful answer to the demo
 * question. The scene is decorative (aria-hidden); the same content follows
 * as plain text for assistive tech.
 */

type Line = { text: string; kind: "h" | "p" | "code"; cite?: 1 | 2 };
const SOURCE: Line[] = [
  { kind: "h", text: "#### .pause()" },
  { kind: "p", text: "Put queue execution on hold.", cite: 2 },
  { kind: "h", text: "#### .onPendingZero()" },
  { kind: "p", text: "Returns a promise that settles when all currently running tasks have completed." },
  { kind: "p", text: "Useful when you want to drain in-flight tasks before mutating shared state.", cite: 1 },
  { kind: "code", text: "queue.pause(); await queue.onPendingZero();" },
  { kind: "h", text: "#### .onIdle()" },
  { kind: "p", text: "Settles when the queue is empty and all promises have completed." },
];

/** The answer, split so each clause can arrive with the citation it rests on. */
const ANSWER: { text: string; cite?: 1 | 2; at: number }[] = [
  { text: "Pause the queue so nothing new starts", at: 0.5 },
  { text: "", cite: 2, at: 0.62 },
  { text: ", then wait for the tasks already running to finish before you change shared configuration", at: 0.64 },
  { text: "", cite: 1, at: 0.8 },
  { text: ". Queued jobs stay queued until you call ", at: 0.82 },
  { text: "queue.start()", at: 0.86 },
  { text: ".", at: 0.88 },
];

// Highlights land most relevant first: [1] then [2].
const CITED = SOURCE.map((l, i) => ({ i, cite: l.cite })).filter((x) => x.cite).sort((a, b) => a.cite! - b.cite!);

const QUESTION = "How do I change shared configuration while jobs are still queued?";

export function EvidenceScene() {
  const scene = useRef<HTMLDivElement>(null);
  const scan = useRef<HTMLDivElement>(null);
  const lines = useRef<(HTMLDivElement | null)[]>([]);
  const marks = useRef<(SVGSVGElement | null)[]>([]);
  const threads = useRef<(SVGPathElement | null)[]>([]);
  const chips = useRef<(HTMLElement | null)[]>([]);
  const refs = useRef<(HTMLLIElement | null)[]>([]);
  const words = useRef<(HTMLSpanElement | null)[]>([]);
  const caption = useRef<HTMLParagraphElement>(null);
  const geo = useRef<{ len: number[] }>({ len: [] });

  const layout = useCallback(() => {
    const root = scene.current;
    if (!root) return;
    const box = root.getBoundingClientRect();
    const stacked = box.width < 720;
    CITED.forEach(({ i, cite }, k) => {
      const line = lines.current[i];
      const svg = marks.current[k];
      const path = threads.current[k];
      const target = refs.current[cite! - 1];
      if (!line || !svg || !path || !target) return;
      const text = line.querySelector("span")!;
      const r = text.getBoundingClientRect();
      const w = r.width + 8, h = r.height + 2;
      svg.setAttribute("width", String(w));
      svg.setAttribute("height", String(h));
      svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
      svg.style.left = `${r.left - box.left - 4}px`;
      svg.style.top = `${r.top - box.top - 1}px`;
      svg.querySelector("path")!.setAttribute("d", highlighterPath(w, h, 3 + k * 11));
      const c = target.getBoundingClientRect();
      // Threads end on the answer's source list, never across its prose:
      // desktop, an S-curve through the gutter into the row's left edge;
      // stacked, a curve down the left margin into the row.
      const to = { x: c.left - box.left - 8, y: c.top - box.top + c.height / 2 };
      if (stacked) {
        const from = { x: r.left - box.left - 6, y: r.top - box.top + r.height / 2 };
        const reach = 10 + k * 6;
        path.setAttribute("d", flightPath(from, to, { x: -reach, y: (to.y - from.y) * 0.3 }, { x: -reach - 4, y: -(to.y - from.y) * 0.3 }));
      } else {
        // A straight leader along the line's own row to the column edge, so
        // the curve only ever bends in the empty gutter.
        const from = { x: r.right - box.left + 8, y: r.top - box.top + r.height / 2 };
        const col = line.parentElement!.getBoundingClientRect();
        const g = { x: Math.max(from.x, col.right - box.left + 10), y: from.y };
        const dx = to.x - g.x;
        path.setAttribute("d", `M${from.x.toFixed(1)} ${from.y.toFixed(1)}L${g.x.toFixed(1)} ${g.y.toFixed(1)}` + flightPath(g, to, { x: dx * 0.6, y: 0 }, { x: -dx * 0.6, y: 0 }).replace(/^M[^C]*/, ""));
      }
      geo.current.len[k] = path.getTotalLength?.() ?? 400;
    });
  }, []);

  const render = useCallback((p: number) => {
    if (!geo.current.len.length) layout();
    const root = scene.current;
    if (!root) return;
    const h = root.querySelector<HTMLElement>(".ir-src-lines")?.offsetHeight ?? 200;
    // 1. Scan line.
    const s = EASE_IO(span(p, 0.04, 0.32));
    if (scan.current) {
      scan.current.style.transform = `translateY(${(s * h).toFixed(1)}px)`;
      scan.current.style.opacity = (p > 0.02 && p < 0.34 ? 1 : 0).toString();
    }
    lines.current.forEach((el) => {
      if (!el) return;
      const y = el.offsetTop / h;
      const passed = s >= y;
      el.dataset.read = passed || p >= 0.34 ? "1" : "0";
    });
    // 2. Highlights, most relevant first.
    CITED.forEach((_, k) => {
      const svg = marks.current[k];
      const a = 0.3 + k * 0.1;
      const t = EASE_OUT(span(p, a, a + 0.16));
      if (svg) svg.style.clipPath = `inset(0 ${((1 - t) * 100).toFixed(2)}% 0 0)`;
      const line = lines.current[CITED[k]!.i];
      if (line) line.dataset.marked = t > 0.55 ? "1" : "0";
      // 3. Threads draw toward their citation.
      const path = threads.current[k];
      const L = geo.current.len[k] ?? 400;
      const d = EASE_IO(span(p, 0.42 + k * 0.14, 0.6 + k * 0.16));
      if (path) {
        path.style.strokeDasharray = `${L}`;
        path.style.strokeDashoffset = `${(L * (1 - d)).toFixed(1)}`;
        path.style.opacity = d > 0 ? "1" : "0";
      }
    });
    ANSWER.forEach((w, i) => {
      const el = w.cite ? chips.current[w.cite - 1] : words.current[i];
      if (!el) return;
      const t = EASE_OUT(span(p, w.at, w.at + 0.08));
      el.style.opacity = t.toFixed(3);
      el.style.transform = w.cite ? `scale(${(0.9 + 0.1 * t).toFixed(3)})` : `translateY(${((1 - t) * 4).toFixed(1)}px)`;
    });
    refs.current.forEach((el, k) => {
      if (!el) return;
      const t = EASE_OUT(span(p, 0.56 + k * 0.14, 0.66 + k * 0.14));
      el.style.opacity = t.toFixed(3);
      el.style.transform = `translateX(${((1 - t) * -6).toFixed(1)}px)`;
    });
    if (caption.current) caption.current.style.opacity = EASE_OUT(span(p, 0.9, 1)).toFixed(3);
  }, [layout]);

  const { ref, replay } = useTimeline<HTMLElement>(3600, render);

  useEffect(() => {
    const onResize = () => { layout(); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [layout]);

  return (
    <figure ref={ref} className="ir-scene" aria-labelledby="ir-scene-cap">
      <div ref={scene} className="ir-scene-stage" aria-hidden="true">
        <p className="ir-scene-q">{QUESTION}</p>
        <div className="ir-scene-cols">
          <div className="ir-src ir-win">
            <p className="ir-win-bar"><i /><i /><i /><span>sindresorhus/p-queue, README.md</span></p>
            <div className="ir-src-lines">
              <div ref={scan} className="ir-scan" />
              {SOURCE.map((l, i) => (
                <div key={i} ref={(el) => { lines.current[i] = el; }} className={`ir-src-line is-${l.kind}`} data-read="0">
                  <span>{l.text}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="ir-ans ir-win">
            <p className="ir-win-bar"><i /><i /><i /><span>Answer</span></p>
            <p className="ir-ans-text">
              {ANSWER.map((w, i) =>
                w.cite ? (
                  <b key={i} ref={(el) => { chips.current[w.cite! - 1] = el; }} className="ir-cite">{w.cite}</b>
                ) : (
                  <span key={i} ref={(el) => { words.current[i] = el; }} className={w.text.includes("()") ? "ir-code" : undefined}>{w.text}</span>
                ),
              )}
            </p>
            <ol className="ir-refs">
              <li ref={(el) => { refs.current[0] = el; }}><b className="ir-cite">1</b><span>.onPendingZero(), README</span></li>
              <li ref={(el) => { refs.current[1] = el; }}><b className="ir-cite">2</b><span>.pause(), README</span></li>
            </ol>
          </div>
        </div>
        {CITED.map((_, k) => (
          <svg key={`m${k}`} ref={(el) => { marks.current[k] = el; }} className="ir-mark"><path /></svg>
        ))}
        <svg className="ir-threads">
          {CITED.map((_, k) => <path key={k} ref={(el) => { threads.current[k] = el; }} />)}
        </svg>
      </div>
      <figcaption id="ir-scene-cap" className="ir-scene-foot">
        <p ref={caption}>
          Two README passages were used, and every sentence of the answer points at one of them.
        </p>
        <button type="button" className="ir-replay" onClick={replay}>Play again</button>
      </figcaption>
      <p className="sr-only">
        Example: asked “{QUESTION}”, IntelliRAG answers that you should pause the queue, then await
        onPendingZero before changing shared configuration, citing the README’s .pause() and .onPendingZero() sections.
      </p>
    </figure>
  );
}
