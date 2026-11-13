import assert from "node:assert/strict";
import { test } from "node:test";
import { EASE_OUT, catmullRomPath, damp, decayFromHalfLife, flight, highlighterPath, span } from "./curves";

test("damp is frame-rate independent", () => {
  const decay = decayFromHalfLife(0.1);
  const run = (fps: number) => { let a = 0; for (let i = 0; i < fps; i++) a = damp(a, 1, decay, 1 / fps); return a; };
  assert.ok(Math.abs(run(24) - run(144)) < 1e-12);
});

test("span clamps and maps a window", () => {
  assert.equal(span(0, 0.2, 0.4), 0);
  assert.equal(span(1, 0.2, 0.4), 1);
  assert.ok(Math.abs(span(0.3, 0.2, 0.4) - 0.5) < 1e-12);
});

test("a flight starts and ends on its endpoints", () => {
  const a = { x: 0, y: 0 }, b = { x: 100, y: 50 };
  const s = flight(a, b, { x: 0, y: -40 }, { x: -30, y: 0 }, 0);
  const e = flight(a, b, { x: 0, y: -40 }, { x: -30, y: 0 }, 1);
  assert.deepEqual([s.x, s.y], [0, 0]);
  assert.ok(Math.abs(e.x - 100) < 1e-9 && Math.abs(e.y - 50) < 1e-9);
});

test("Catmull-Rom passes through every point", () => {
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 40 }, { x: -5, y: 80 }];
  const d = catmullRomPath(pts);
  for (const p of pts) assert.ok(d.includes(`${p.x.toFixed(1)} ${p.y.toFixed(1)}`));
});

test("highlighter strokes are deterministic and closed", () => {
  assert.equal(highlighterPath(200, 20, 3), highlighterPath(200, 20, 3));
  assert.ok(highlighterPath(200, 20, 3).endsWith("Z"));
});

test("ease-out matches CSS at its endpoints and front-loads motion", () => {
  assert.equal(EASE_OUT(0), 0);
  assert.equal(EASE_OUT(1), 1);
  assert.ok(EASE_OUT(0.25) > 0.6);
});
