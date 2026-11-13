/**
 * Motion math, after Freya Holmér's "The Beauty of Bézier Curves",
 * "The Continuity of Splines" and "Lerp smoothing is broken".
 * (Same module as memoRABLE's src/motion/curves.ts.)
 *
 * - `damp`: frame-rate independent smoothing, b + (a − b)·e^(−λ·dt),
 *   with λ = ln 2 / half-life. Never `lerp(a, b, k)` per frame.
 * - `bezier` / `flight`: cubic Bézier by De Casteljau, plus its tangent so an
 *   object can bank along the curve.
 * - `catmullRomPath`: a spline that passes through every point, written as
 *   SVG cubic Béziers (handles = 1/6 of the neighbouring chord, so joins are C¹).
 * - `cssCubicBezier`: the CSS easing curve as a function (Newton's method),
 *   so JS-driven motion matches the CSS transitions exactly.
 */
export interface Vec2 { x: number; y: number }

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const span = (p: number, a: number, b: number) => clamp01(a === b ? (p >= b ? 1 : 0) : (p - a) / (b - a));

export const decayFromHalfLife = (halfLife: number) => Math.LN2 / Math.max(1e-6, halfLife);
export const damp = (a: number, b: number, decay: number, dt: number) => b + (a - b) * Math.exp(-decay * dt);

export function bezier(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

export function bezierTangent(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const u = 1 - t;
  return {
    x: 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
    y: 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y),
  };
}

/** Travel from a to b leaving along `out` and arriving from `inn` (relative handles). */
export function flight(a: Vec2, b: Vec2, out: Vec2, inn: Vec2, t: number) {
  const p1 = { x: a.x + out.x, y: a.y + out.y };
  const p2 = { x: b.x + inn.x, y: b.y + inn.y };
  const p = bezier(a, p1, p2, b, t);
  const d = bezierTangent(a, p1, p2, b, t);
  return { x: p.x, y: p.y, angle: Math.atan2(d.y, d.x) };
}

/** An SVG path for the same flight, for drawing it as a thread. */
export function flightPath(a: Vec2, b: Vec2, out: Vec2, inn: Vec2): string {
  const f = (n: number) => n.toFixed(1);
  return `M${f(a.x)} ${f(a.y)}C${f(a.x + out.x)} ${f(a.y + out.y)} ${f(b.x + inn.x)} ${f(b.y + inn.y)} ${f(b.x)} ${f(b.y)}`;
}

export function catmullRomPath(points: Vec2[], closed = false): string {
  const P = points, n = P.length;
  if (n < 2) return "";
  const at = (i: number) => (closed ? P[(i + n) % n]! : P[Math.max(0, Math.min(n - 1, i))]!);
  const f = (v: number) => v.toFixed(1);
  let d = `M${f(P[0]!.x)} ${f(P[0]!.y)}`;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    d += `C${f(p1.x + (p2.x - p0.x) / 6)} ${f(p1.y + (p2.y - p0.y) / 6)} ${f(p2.x - (p3.x - p1.x) / 6)} ${f(p2.y - (p3.y - p1.y) / 6)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return closed ? d + "Z" : d;
}

export function cssCubicBezier(x1: number, y1: number, x2: number, y2: number): (p: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (p: number) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let t = p;
    for (let i = 0; i < 8; i++) {
      const err = sx(t) - p;
      if (Math.abs(err) < 1e-6) return sy(t);
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0, hi = 1;
    t = p;
    for (let i = 0; i < 30; i++) { const v = sx(t); if (Math.abs(v - p) < 1e-6) break; if (v < p) lo = t; else hi = t; t = (lo + hi) / 2; }
    return sy(t);
  };
}

/** Emil Kowalski's curves: strong ease-out for arrivals, ease-in-out for on-screen moves. */
export const EASE_OUT = cssCubicBezier(0.23, 1, 0.32, 1);
export const EASE_IO = cssCubicBezier(0.77, 0, 0.175, 1);

/** Seeded PRNG (mulberry32): hand-drawn shapes look the same on every load. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A highlighter stroke over a w×h box: top and bottom edges are Catmull-Rom
 * splines through slightly jittered points, ends slightly rounded, so it reads
 * as a marker pass rather than a CSS rectangle.
 */
export function highlighterPath(w: number, h: number, seed: number): string {
  const r = rng(seed);
  const n = Math.max(3, Math.round(w / 60));
  const top: Vec2[] = [], bottom: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * w;
    top.push({ x, y: 1 + (r() - 0.5) * 2.2 });
    bottom.push({ x: w - x, y: h - 1 + (r() - 0.5) * 2.2 });
  }
  const pts = [{ x: -3, y: h * 0.5 }, ...top, { x: w + 3, y: h * 0.5 + (r() - 0.5) * 2 }, ...bottom];
  return catmullRomPath(pts, true);
}
