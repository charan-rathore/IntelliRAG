import { useRef } from "react";
import { EASE_IO, EASE_OUT, flight, lerp, span } from "@/lib/motion/curves";
import { useScrollScene } from "@/lib/motion/scene";

/**
 * "How an answer earns its citations", told as a scroll-pinned chapter.
 * The stage is sticky inside the conversation panel; the scene is a pure
 * function of how far you have scrolled through it, so scrolling back plays
 * it backwards and no scroll position shows an empty frame.
 *
 *   0.00–0.30  every README section gets a score (dense + keyword, fused)
 *   0.30–0.55  sections re-rank on Bézier arcs; the gate drops in under the
 *              last section whose score is close to the best
 *   0.55–0.75  sections above the gate are highlighted and cited
 *   0.75–1.00  an off-source question: every score collapses under the gate,
 *              so the answer is a refusal, not a guess
 *
 * Bars show relative relevance for this example; they are not benchmark
 * numbers. The visual is aria-hidden; the steps carry the same content.
 */

type Chunk = { label: string; dense: number; kw: number; weather: number };
const CHUNKS: Chunk[] = [
  { label: ".add(fn, options?)", dense: 0.2, kw: 0.12, weather: 0.05 },
  { label: ".pause()", dense: 0.45, kw: 0.36, weather: 0.03 },
  { label: ".start()", dense: 0.32, kw: 0.2, weather: 0.04 },
  { label: ".onEmpty()", dense: 0.22, kw: 0.12, weather: 0.02 },
  { label: ".onIdle()", dense: 0.28, kw: 0.18, weather: 0.03 },
  { label: ".onPendingZero()", dense: 0.5, kw: 0.42, weather: 0.04 },
  { label: ".clear()", dense: 0.24, kw: 0.14, weather: 0.02 },
  { label: "timeout", dense: 0.08, kw: 0.04, weather: 0.09 },
];
const total = (c: Chunk) => c.dense + c.kw;
const RANK = CHUNKS.map((c, i) => ({ i, s: total(c) })).sort((a, b) => b.s - a.s).map((x) => x.i);
const USED = 2; // sections above the gate for the real question

const STEPS = [
  { h: "Every passage gets a score.", p: "Meaning (dense vectors) and exact words (BM25) are scored separately, then fused by rank." },
  { h: "A gate decides what may be cited.", p: "A calibrated floor, plus a cut where scores fall away from the best match. Passages under it stay open for inspection, never for citation." },
  { h: "Each sentence points at its passage.", p: "Generated answers cite [1], [2] for the passages above the gate. Without a model key you get those passages as extracts." },
  { h: "Or it refuses.", p: "Ask something the source doesn’t cover and nothing clears the gate. You get “Not in the indexed corpus”, not a confident guess." },
];

export function HowItChecks() {
  const rows = useRef<(HTMLDivElement | null)[]>([]);
  const bars = useRef<(HTMLSpanElement | null)[][]>([]);
  const tags = useRef<(HTMLElement | null)[]>([]);
  const gate = useRef<HTMLDivElement>(null);
  const q = useRef<HTMLParagraphElement>(null);
  const verdict = useRef<HTMLParagraphElement>(null);
  const steps = useRef<(HTMLLIElement | null)[]>([]);
  const visual = useRef<HTMLDivElement>(null);

  const ref = useScrollScene<HTMLElement>((p) => {
    const at = p < 0.3 ? 0 : p < 0.55 ? 1 : p < 0.75 ? 2 : 3;
    steps.current.forEach((el, i) => el?.classList.toggle("is-on", i === at));

    const rowH = (visual.current?.clientWidth ?? 600) < 460 ? 34 : 40;
    const top = 104; // below the window bar and the question
    const refuse = EASE_IO(span(p, 0.76, 0.9));
    if (q.current) {
      q.current.textContent = p < 0.8 ? "How do I change shared configuration while jobs are still queued?" : "What’s the weather in Tokyo?";
      q.current.style.opacity = (p > 0.76 && p < 0.8 ? 0.2 : 1).toString();
    }
    const reorder = EASE_IO(span(p, 0.32, 0.52));
    CHUNKS.forEach((c, i) => {
      const row = rows.current[i];
      if (!row) return;
      const rank = RANK.indexOf(i);
      // Scores fill in document order, each in its own short window.
      const fill = EASE_OUT(span(p, 0.03 + i * 0.022, 0.16 + i * 0.022));
      const dense = lerp(c.dense, c.weather * 0.6, refuse) * fill;
      const kw = lerp(c.kw, c.weather * 0.4, refuse) * fill;
      const [bd, bk] = bars.current[i] ?? [];
      if (bd) bd.style.transform = `scaleX(${dense.toFixed(4)})`;
      if (bk) { bk.style.transform = `scaleX(${kw.toFixed(4)})`; bk.style.left = `${(dense * 100).toFixed(2)}%`; }
      // Re-rank on arcs: rows moving up swing right, rows moving down swing left.
      const from = { x: 0, y: top + i * rowH };
      const to = { x: 0, y: top + rank * rowH + (rank >= USED ? 18 : 0) };
      const dir = rank < i ? 1 : -1;
      const f = flight(from, to, { x: 18 * dir, y: 0 }, { x: 18 * dir, y: 0 }, reorder);
      row.style.transform = `translate3d(${f.x.toFixed(1)}px, ${f.y.toFixed(1)}px, 0)`;
      const used = rank < USED && refuse < 0.5;
      const cite = EASE_OUT(span(p, 0.56 + rank * 0.05, 0.66 + rank * 0.05));
      row.dataset.state = p < 0.5 ? "scored" : used ? (cite > 0.5 ? "cited" : "used") : "inspect";
      const tag = tags.current[i];
      if (tag) {
        tag.textContent = used ? `Cited [${rank + 1}]` : "Inspect only";
        tag.style.opacity = (p < 0.5 ? 0 : used ? cite : EASE_OUT(span(p, 0.5, 0.56))).toFixed(3);
      }
    });
    if (gate.current) {
      const g = EASE_OUT(span(p, 0.44, 0.56));
      gate.current.style.transform = `translate3d(0, ${(top + USED * rowH + 4).toFixed(1)}px, 0) scaleX(${g.toFixed(3)})`;
      gate.current.style.opacity = g.toFixed(3);
    }
    if (verdict.current) {
      const v = EASE_OUT(span(p, 0.88, 0.97));
      verdict.current.style.opacity = v.toFixed(3);
      verdict.current.style.transform = `translateY(${((1 - v) * 6).toFixed(1)}px)`;
    }
  });

  return (
    <section ref={ref} className="ir-chapter" aria-labelledby="ir-chapter-h">
      <div className="ir-chapter-stage">
        <div className="ir-chapter-copy">
          <h2 id="ir-chapter-h" className="ir-h1 text-fg" style={{ fontSize: "clamp(32px, 3.6vw, 48px)" }}>
            How an answer earns its citations.
          </h2>
          <ol className="ir-steps">
            {STEPS.map((s, i) => (
              <li key={s.h} ref={(el) => { steps.current[i] = el; }} className={i === 0 ? "is-on" : ""}>
                <h3>{s.h}</h3>
                <p>{s.p}</p>
              </li>
            ))}
          </ol>
        </div>
        <div ref={visual} className="ir-win ir-chapter-visual" aria-hidden="true">
          <p className="ir-win-bar"><span>Retrieval, p-queue README</span></p>
          <p ref={q} className="ir-scene-q ir-chapter-q" />
          {CHUNKS.map((c, i) => (
            <div key={c.label} ref={(el) => { rows.current[i] = el; }} className="ir-rank-row" data-state="scored">
              <span className="ir-rank-label">{c.label}</span>
              <span className="ir-rank-track">
                <span ref={(el) => { (bars.current[i] ??= [])[0] = el; }} className="ir-rank-dense" />
                <span ref={(el) => { (bars.current[i] ??= [])[1] = el; }} className="ir-rank-kw" />
              </span>
              <em ref={(el) => { tags.current[i] = el; }} className="ir-rank-tag" />
            </div>
          ))}
          <div ref={gate} className="ir-gate"><span>Gate</span></div>
          <p ref={verdict} className="ir-verdict">Not in the indexed corpus. Nothing cleared the gate, so nothing is cited.</p>
        </div>
      </div>
    </section>
  );
}
