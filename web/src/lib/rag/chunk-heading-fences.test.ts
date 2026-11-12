import { it } from 'node:test';
import assert from 'node:assert/strict';
import { chunkDocument } from './chunking.ts';

for (const marker of ['```', '~~~', '````']) {
  it(`does not assign prose heading metadata from ${marker} fenced examples`, () => {
    const body = [
      '# Deployment guide', '', '## Approval', '',
      'Supervisor approval is required before restarting services.', '',
      marker + 'markdown', '# Example fake policy', '## No approval required',
      ...Array.from({ length: 12 }, () => 'Sample documentation inside code, not an actual policy section.'),
      marker, '', ...Array.from({ length: 12 }, () => 'Real approval policy continues here. Supervisor approval is still required.'),
      '', '## Recovery', '', 'Manual recovery is required after failed restart.',
    ].join('\n');
    const chunks = chunkDocument(body, { chunkSize: 40, overlap: 0 });
    const continuation = chunks.filter(chunk => chunk.text.includes('Real approval policy continues'));
    assert.ok(continuation.length);
    assert.ok(continuation.every(chunk => chunk.heading === 'Deployment guide > Approval'), JSON.stringify(continuation.map(c => c.heading)));
    assert.ok(chunks.every(chunk => !chunk.heading?.includes('fake policy') && !chunk.heading?.includes('No approval required')));
    assert.equal(chunks.at(-1)?.heading, 'Deployment guide > Recovery');
    assert.ok(chunks.some(chunk => chunk.text.includes('# Example fake policy')), 'source code content must remain intact');
  });
}
