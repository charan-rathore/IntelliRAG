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
test('theme-color and favicon use the warm-dark background', () => {
  for (const path of ['../src/routes/__root.tsx', '../public/favicon.svg']) {
    assert.ok(readFileSync(new URL(path, import.meta.url), 'utf8').includes(tokens.bg));
  }
});
