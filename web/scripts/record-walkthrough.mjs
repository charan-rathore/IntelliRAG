/** Real public UI capture. Presentation captions are overlays; responses are never mocked. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const browser = process.env.AGENT_BROWSER || '/Users/charanrathore/.npm/_npx/6de2aa2fded2970c/node_modules/agent-browser/bin/agent-browser-darwin-arm64';
const session = process.env.BROWSER_SESSION || 'demo-live';
const out = process.env.WALKTHROUGH_OUTPUT || '/private/tmp/intellirag-demo';
const url = process.env.WALKTHROUGH_URL || 'https://intellirag-live-own-track.vercel.app/';
const sourceUrl = 'https://github.com/brianc/node-postgres/issues/3745';
const corpusId = 'url:github.com/brianc/node-postgres/issues/3745';
const question = 'How does a WeakMap give the SQL proposal a stable statement name with no hashing?';
const rawPath = `${out}/take-${Date.now()}.webm`;
mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function run(...args) {
  const raw = execFileSync(browser, ['--session', session, '--json', ...args], { encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  const response = JSON.parse(raw); assert.equal(response.success, true, response.error);
  return response.data?.result ?? response.data;
}
const evaluate = (fn, arg) => run('eval', `(${fn.toString()})(${JSON.stringify(arg) ?? ''})`);
async function until(fn, arg, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = evaluate(fn, arg); if (value) return value; await sleep(300); }
  throw Error(`UI condition timed out: ${fn.toString()}`);
}
async function tap(selector) {
  evaluate(selector => document.querySelector(selector)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), selector);
  await sleep(550);
  evaluate(selector => { const el = document.querySelector(selector); if (!el) throw Error(`Missing ${selector}`); const r = el.getBoundingClientRect(); const cursor = document.getElementById('demo-cursor'); if (cursor) cursor.style.transform = `translate(${r.x + r.width / 2}px,${r.y + r.height / 2}px)`; }, selector);
  await sleep(200);
  // DOM events exercise the real application handlers; no API results are injected.
  evaluate(selector => { const el = document.querySelector(selector); if (el instanceof HTMLElement) el.click(); else el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }, selector);
}
async function button(label, scope = 'body') {
  evaluate(({ label, scope }) => {
    document.querySelector('[data-demo-target]')?.removeAttribute('data-demo-target');
    const el = [...document.querySelector(scope).querySelectorAll('button,[role=tab]')].find(el => el.textContent.trim() === label);
    if (!el) throw Error(`Button missing: ${label}`); el.setAttribute('data-demo-target', 'true');
  }, { label, scope });
  await tap('[data-demo-target]');
}
async function type(selector, text) {
  await tap(selector);
  for (let length = 5; length < text.length; length += 5) { run('fill', selector, text.slice(0, length)); await sleep(60); }
  run('fill', selector, text); await sleep(400);
}
const chapters = [];
let started = 0, recording = false;
async function caption(step, title, body, mode = 'corner') {
  console.log(`${step}: ${title}`);
  chapters.push({ at: (Date.now() - started) / 1000, step, title, body });
  evaluate(({ step, title, body, mode }) => {
    const el = document.getElementById('demo-caption');
    el.className = mode; el.querySelector('small').textContent = step;
    el.querySelector('h2').textContent = title; el.querySelector('p').textContent = body;
  }, { step, title, body, mode });
  await sleep(450);
}
async function ask(text) {
  const before = evaluate(() => window.__demoResponses.length);
  await type('[data-tour="tour-composer"] textarea', text);
  evaluate(() => document.querySelector('[data-tour="tour-composer"] textarea').form.requestSubmit());
  const raw = await until(before => window.__demoResponses.length > before && window.__demoResponses.at(-1), before);
  const events = raw.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
  const done = events.find(e => e.type === 'done'); assert.ok(done, JSON.stringify(events));
  await sleep(600);
  evaluate(() => {
    document.getElementById('demo-caption').className = 'bottom';
    const article = [...document.querySelectorAll('article')].at(-1);
    if (article) { article.style.scrollMarginTop = '120px'; article.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
  await sleep(700);
  return { done, graph: events.find(e => e.type === 'graph') };
}

try {
  run('set', 'viewport', '1440', '1000'); run('open', url);
  evaluate(() => { localStorage.setItem('intellirag.view', 'reading'); localStorage.setItem('intellirag.retrievalMode', 'keyword'); localStorage.setItem('intellirag.coachDismissed', '1'); });
  run('record', 'start', rawPath, url); recording = true;
  await until(() => !!document.querySelector('[data-tour="tour-composer"] textarea'));
  await button('Reading');
  evaluate(() => {
    window.__demoResponses = [];
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await original(...args);
      if (String(args[0]).includes('/api/query')) response.clone().text().then(text => window.__demoResponses.push(text));
      return response;
    };
    const style = document.createElement('style');
    style.textContent = `#demo-caption{position:fixed;z-index:100000;top:145px;left:24px;width:320px;box-sizing:border-box;border:1px solid #303238;border-left:3px solid #c9d0d8;border-radius:8px;padding:20px;background:#0b0c0ef5;color:#ecece8;box-shadow:0 15px 65px #0007;pointer-events:none;font-family:var(--font-sans)}#demo-caption small{font-family:var(--font-mono);font-size:10px;letter-spacing:.1em;color:#c9d0d8}#demo-caption h2{font-family:var(--font-display);font-size:29px;line-height:1.15;letter-spacing:-.035em;font-weight:500;margin:12px 0}#demo-caption p{font-size:17px;line-height:1.5;color:#aeb0b5;margin:0;white-space:pre-line}#demo-caption.bottom{top:auto;bottom:24px;left:24px;width:640px;padding:16px 22px}#demo-caption.bottom h2{font-size:27px;margin:6px 0}#demo-caption.bottom p{font-size:16px}#demo-caption.full{inset:0;width:100%;display:flex;flex-direction:column;justify-content:center;border:0;border-radius:0;padding:100px;background:#0b0c0e}#demo-caption.full:after{content:'SOURCE → QUESTION → EVIDENCE';position:absolute;bottom:85px;left:100px;font:13px var(--font-mono);letter-spacing:.15em;color:#8b8d92;border-top:1px solid #303238;padding-top:25px;width:calc(100% - 200px)}#demo-caption.full small{font-size:14px}#demo-caption.full h2{font-size:82px;max-width:1080px;line-height:1.04;margin:26px 0}#demo-caption.full p{font-size:26px;max-width:1070px;line-height:1.55}#demo-cursor{position:fixed;z-index:100001;top:0;left:0;width:24px;height:24px;border:2px solid #c9d0d8;border-radius:50%;margin:-12px;pointer-events:none;opacity:.8}#demo-caption.full~#demo-cursor{opacity:0}`;
    document.head.append(style);
    const caption = document.createElement('div'); caption.id = 'demo-caption'; caption.innerHTML = '<small></small><h2></h2><p></p>'; document.body.append(caption);
    const cursor = document.createElement('div'); cursor.id = 'demo-cursor'; document.body.append(cursor);
  });
  await until(() => document.fonts.status === 'loaded');
  started = Date.now();
  await caption('A SMALL EXPERIMENT / INTELLIRAG', 'One issue. Two questions.', 'Can we tell evidence from guesswork?\nImport a GitHub issue. Ask what it says, then something it cannot know.\nThis makes an answer easier to check before you trust it.', 'full');
  await sleep(5000);

  await caption('01 / GIVE IT A SOURCE', 'Start with one real issue.', 'We’re importing a proposal for a SQL template function.\nThe question will search this issue, not every document in the lab.');
  await button('Sources');
  await type('input[placeholder="GitHub repo, blob, or markdown URL"]', sourceUrl);
  await button('Fetch & index');
  await until(id => document.querySelector('[data-tour="tour-corpus"] select')?.value === id, corpusId);
  evaluate(() => document.querySelector('[data-tour="tour-corpus"] select').scrollIntoView({ behavior: 'smooth', block: 'center' }));
  await sleep(3000);
  const corpus = evaluate(() => document.querySelector('[data-tour="tour-corpus"]').innerText);
  assert.match(corpus, /sql tagged template/i); assert.match(corpus, /chunks/);
  run('screenshot', `${out}/01-import.png`);
  await tap('button[aria-label="Close dialog"]');

  await caption('02 / ASK WHAT THE SOURCE SUPPORTS', 'Find the reason in the source.', 'The proposal describes a way to reuse SQL statements.\nAsk how it works, then check the cited passage.');
  const supported = await ask(question);
  assert.ok(supported.done.citations?.length > 0); assert.match(supported.done.answer, /WeakMap/);
  assert.ok(supported.done.candidates.every(c => c.corpusId === corpusId));
  await sleep(3200); run('screenshot', `${out}/02-supported.png`);
  evaluate(() => [...document.querySelectorAll('article')].at(-1).querySelector('a.cite-chip')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  await sleep(2500); run('screenshot', `${out}/02-citation.png`);

  await caption('03 / FOLLOW THE CONNECTIONS', 'See where the knowledge lives.', 'Open the source node. Its location and labeled connections\nshow how the document is represented in the graph.', 'bottom');
  await button('Evidence'); await button('Expand graph ↗');
  run('select', '[data-tour="tour-graph"] select', corpusId);
  await sleep(600);
  await tap('[data-tour="tour-graph"] g[aria-label$=", document"]');
  await sleep(4000);
  const graph = evaluate(() => document.querySelector('[data-tour="tour-graph"]').innerText);
  assert.match(graph, /Source:/); assert.match(graph, /Open source evidence/); assert.match(graph, /extracted|inferred/);
  run('screenshot', `${out}/03-graph.png`);
  await button('Close explorer'); await tap('button[aria-label="Close dialog"]');

  await caption('04 / ASK WHAT THE SOURCE CANNOT KNOW', 'Now test the boundary.', 'What’s the weather in Tokyo?\nA SQL proposal has no evidence for that answer.');
  const refused = await ask("What's the weather in Tokyo?");
  assert.equal(refused.done.coverage, 'refused'); assert.equal(refused.done.citations.length, 0);
  await sleep(5000); run('screenshot', `${out}/04-refused.png`);

  await caption('05 / REUSE A CHECKED RESULT', 'Ask the first question again.', 'An exact question and matching settings can reuse the graph cache.\nThe evidence stays attached; retrieval and generation can be skipped.');
  const repeated = await ask(question);
  assert.equal(repeated.done.cacheHit, true); assert.equal(repeated.done.answer, supported.done.answer);
  await sleep(5000); run('screenshot', `${out}/05-cache.png`);

  await caption('THE RESULT / TRY THE SAME EXPERIMENT', 'A source. A citation. A boundary.', 'One supported answer. One honest refusal. One reusable result.\nTry your own GitHub issue in the live lab.\nShown in keyword / cited-extract mode. Imports here are temporary.', 'full');
  await sleep(5000);
  const contentDuration = (Date.now() - started) / 1000;
  const errors = run('errors')?.errors || [];
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/capture.json`, JSON.stringify({ url, rawPath, sourceUrl, corpusId, contentDuration, chapters, checks: { scopedImport: true, supported: true, graphProvenance: true, refused: true, cacheReuse: true }, supported, refused, repeated, graph, errors }, null, 2));
  run('record', 'stop'); recording = false;
  console.log(JSON.stringify({ raw: rawPath, contentDuration, report: `${out}/capture.json` }));
} catch (error) {
  try { run('screenshot', `${out}/failure.png`); writeFileSync(`${out}/failure.json`, JSON.stringify({ error: error.message, text: evaluate(() => document.body.innerText), responses: evaluate(() => window.__demoResponses) }, null, 2)); } catch {}
  throw error;
} finally {
  if (recording) run('record', 'stop');
}
