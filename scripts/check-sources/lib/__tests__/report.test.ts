import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hasActionableFindings, renderReport } from '../report.ts';
import type { CheckResult } from '../check.ts';

function result(over: Partial<CheckResult> & Pick<CheckResult, 'id' | 'status'>): CheckResult {
  return {
    url: `https://example.gov/${over.id}`,
    detail: '',
    entry: {
      url: `https://example.gov/${over.id}`,
      normalizedSha256: null,
      normalizedChars: null,
      status: 'ok',
      firstSeen: '2026-01-01',
      lastChanged: '2026-01-01',
    },
    ...over,
  };
}

const base = {
  stale: [],
  staleDays: 180,
  generatedAt: '2026-09-05T00:00:00.000Z',
  wrote: false,
  branchBlocked: null,
};

test('hasActionableFindings is true for changed / gone / unreachable only', () => {
  assert.equal(hasActionableFindings([result({ id: 'a', status: 'unchanged' })]), false);
  assert.equal(hasActionableFindings([result({ id: 'a', status: 'new' })]), false);
  assert.equal(hasActionableFindings([result({ id: 'a', status: 'changed' })]), true);
  assert.equal(hasActionableFindings([result({ id: 'a', status: 'gone' })]), true);
  assert.equal(hasActionableFindings([result({ id: 'a', status: 'unreachable' })]), true);
});

test('an all-unchanged run renders no Changed/Gone/Unreachable sections', () => {
  const md = renderReport({
    ...base,
    results: [result({ id: 'a', status: 'unchanged' }), result({ id: 'b', status: 'unchanged' })],
  });
  assert.doesNotMatch(md, /## Changed/);
  assert.doesNotMatch(md, /## Gone/);
  assert.doesNotMatch(md, /## Unreachable/);
  assert.match(md, /2 unchanged/);
});

test('changed and gone are rendered as separate, differently-worded sections', () => {
  const md = renderReport({
    ...base,
    results: [
      result({ id: 'edited', status: 'changed', detail: '100 -> 140 chars' }),
      result({ id: 'removed', status: 'gone', detail: "HTTP 404 -- page removed, not edited" }),
    ],
  });
  assert.match(md, /## Changed \(1\)/);
  assert.match(md, /## Gone \(1\)/);
  assert.match(md, /\*\*edited\*\*/);
  assert.match(md, /\*\*removed\*\*/);
  // The two carry different remediation guidance.
  assert.match(md, /re-verification loop/);
  assert.match(md, /Moved vs\. never correct/);
});

test('stalePrograms output is always shown, with the window in the heading', () => {
  const md = renderReport({
    ...base,
    staleDays: 90,
    stale: [{ id: 'old-record', lastVerified: '2025-01-01' }],
    results: [result({ id: 'a', status: 'unchanged' })],
  });
  assert.match(md, /stalePrograms\(90\)/);
  assert.match(md, /\*\*old-record\*\* -- last verified 2025-01-01/);
});

test('branchBlocked renders a refusal notice', () => {
  const md = renderReport({
    ...base,
    branchBlocked: 'main',
    results: [result({ id: 'a', status: 'changed' })],
  });
  assert.match(md, /Refusing to write source-hashes\.json on `main`/);
});
