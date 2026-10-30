import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chunkDocument } from './chunking.ts';

const prose = [
  '# Operations', '', '## Approvals', '',
  ...Array.from({ length: 18 }, (_, i) => `Task ${i}: supervisor approval is required before restart.`),
  '', '## Limits', '', '| Task | Limit |', '| --- | --- |',
  ...Array.from({ length: 18 }, (_, i) => `| Task ${i} | ${i + 1} retries |`),
].join('\n');
const code = [
  'import os', '', 'def restart_service():', '    return "approval required"', '',
  'def retry_limit():', '    return 4',
].join('\n');

describe('document line ending equivalence', () => {
  it('preserves prose text, headings and table context across LF, CRLF and CR', () => {
    const opts = { chunkSize: 30, overlap: 3 };
    const expected = chunkDocument(prose, opts);
    assert.ok(expected.length > 3);
    assert.deepEqual(chunkDocument(prose.replace(/\n/g, '\r\n'), opts), expected);
    assert.deepEqual(chunkDocument(prose.replace(/\n/g, '\r'), opts), expected);
  });

  it('preserves code symbol boundaries across LF, CRLF and CR', () => {
    const opts = { kind: 'code' as const, language: 'python', chunkSize: 20, overlap: 0 };
    const expected = chunkDocument(code, opts);
    assert.deepEqual(expected.map(chunk => chunk.symbol), ['restart_service', 'retry_limit']);
    assert.deepEqual(chunkDocument(code.replace(/\n/g, '\r\n'), opts), expected);
    assert.deepEqual(chunkDocument(code.replace(/\n/g, '\r'), opts), expected);
  });

  it('normalizes mixed line endings without turning CRLF into duplicate newlines', () => {
    const source = '# Policy\r\n\r\nApproval required.\rLimit: 4.\nNo automatic retries.';
    const expected = '# Policy\n\nApproval required.\nLimit: 4.\nNo automatic retries.';
    assert.deepEqual(chunkDocument(source), chunkDocument(expected));
  });
});
