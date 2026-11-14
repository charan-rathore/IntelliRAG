import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const tokens = Object.fromEntries([...css.matchAll(/--color-([\w-]+):\s*(#[\da-f]{6});/gi)].map((m) => [m[1], m[2]]));
function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map((v) => parseInt(v, 16) / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
test('warm-dark text tokens meet normal-text contrast on every opaque surface', () => {
  for (const fg of ['fg', 'muted', 'subtle', 'primary', 'good', 'warn', 'bad']) {
    for (const bg of ['bg', 'surface', 'raised']) {
      assert.ok(contrast(tokens[fg], tokens[bg]) >= 4.5, `${fg} on ${bg}: ${contrast(tokens[fg], tokens[bg]).toFixed(2)}`);
    }
  }
});
test('primary button label has contrast on normal and hover fills', () => {
  for (const bg of ['action', 'action-hover']) {
    assert.ok(contrast(tokens['primary-fg'], tokens[bg]) >= 4.5, `button on ${bg}`);
  }
});
test('theme-color matches the app background token', () => {
  // Browser chrome follows the app background (paper redesign #111: bg is
  // --color-bg, currently light). Pin the relationship, not the value, so a
  // deliberate palette change updates one token.
  assert.ok(readFileSync(new URL('../src/routes/__root.tsx', import.meta.url), 'utf8').includes(tokens.bg));
});
test('favicon keeps its dark brand tile', () => {
  // The paper redesign (#111) deliberately kept a dark tile with yellow
  // strokes for the favicon - it is a standalone brand mark and must NOT
  // track the light app background. Pin the shipped tile color.
  const svg = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8');
  assert.ok(svg.includes('#1c1c19'), 'favicon lost its dark brand tile');
});
