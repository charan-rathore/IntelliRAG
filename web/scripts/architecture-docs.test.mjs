import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const doc = resolve(root, 'docs/architecture/interactive.html');
const html = readFileSync(doc, 'utf8');
const svg = readFileSync(resolve(dirname(doc), 'web-pipeline.svg'), 'utf8');

test('architecture has ten keyboard-native stage disclosures', () => {
  assert.equal((html.match(/<details /g) || []).length, 10);
  assert.equal((html.match(/<summary>/g) || []).length, 10);
  assert.match(html, /name="viewport"/);
  assert.match(html, /@media\(max-width:700px\)/);
});

test('every architecture source and asset link resolves in the repository', () => {
  for (const [, target] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    assert.ok(!/^(?:https?:|\/\/)/.test(target), `unexpected external dependency: ${target}`);
    assert.ok(existsSync(resolve(dirname(doc), target)), `missing local target: ${target}`);
  }
});

test('architecture needs no scripts, remote fonts or model calls', () => {
  assert.doesNotMatch(html, /<script\b|<iframe\b|@import|url\(/i);
  assert.doesNotMatch(svg, /<script\b|<foreignObject\b/i);
  assert.doesNotMatch(html + svg + readFileSync(resolve(root, 'README.md'), 'utf8'), /jev|typesafe/i);
});

test('optional second-opinion gate and separate evaluation remain explicit', () => {
  assert.match(html, /The second-opinion gate never upgrades a refusal/);
  assert.match(html, /Timeout, malformed output or low confidence/);
  assert.match(html, /Not an inline answer-approval step/);
  assert.match(html, /not answer accuracy/);
  assert.match(html, /Ambiguous evidence can still generate/);
  assert.match(html, /repo-support-eval.ts/);
  assert.match(html, /dataset.json/);
  assert.match(html, /calls retrieveFromRows directly/);
  assert.doesNotMatch(readFileSync(resolve(root, 'README.md'), 'utf8'), /Download the HTML and SVG together/);
  assert.match(html, /Python platform is a separate implementation/);
});

test('static diagram exposes accessible labels and the cache bypass', () => {
  assert.match(svg, /role="img" aria-labelledby="title desc"/);
  assert.match(svg, /<title id="title">/);
  assert.match(svg, /<desc id="desc">/);
  assert.match(svg, /cache hit bypasses stages 05-07/);
  assert.match(svg, /Separate evaluation runner/);
});
