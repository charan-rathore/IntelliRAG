import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import snapshot from '../../data/pqueue-demo.json';
import { REPO_DEMO_DOCUMENT } from './repo-demo.server.ts';
import { REPO_DEMO_CORPUS } from './repo-demo.ts';
import { SEED_CORPUS_ID } from './corpus-scope.ts';

it('ships the exact licensed benchmark source in a separate versioned demo corpus', () => {
  const gold = JSON.parse(readFileSync(new URL('../../../../eval/repo-support/dataset.json', import.meta.url), 'utf8'));
  assert.equal(createHash('sha256').update(snapshot.body).digest('hex'), gold.source.sha256);
  assert.equal(REPO_DEMO_DOCUMENT.corpusId, REPO_DEMO_CORPUS);
  assert.notEqual(REPO_DEMO_CORPUS, SEED_CORPUS_ID);
  assert.ok(REPO_DEMO_DOCUMENT.sourceUri!.includes(gold.source.revision));
});
