import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hasActionableFindings, isBookkeepingOnly, renderReport } from '../report.ts';
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

/** An `unreachable` result at a given consecutive-failure count. */
function unreachableAt(id: string, consecutiveFailures: number): CheckResult {
  return result({
    id,
    status: 'unreachable',
    consecutiveFailures,
    entry: {
      url: `https://example.gov/${id}`,
      normalizedSha256: 'sha256:old',
      normalizedChars: 10,
      status: 'unreachable',
      firstSeen: '2026-01-01',
      lastChanged: '2026-01-01',
      consecutiveFailures,
    },
  });
}

const base = {
  stale: [],
  staleDays: 180,
  generatedAt: '2026-09-05T00:00:00.000Z',
  wrote: false,
  branchBlocked: null,
};

test('hasActionableFindings: changed / gone always; unreachable only once escalated', () => {
  assert.equal(hasActionableFindings([result({ id: 'a', status: 'unchanged' })]), false);
  assert.equal(hasActionableFindings([result({ id: 'a', status: 'new' })]), false);
  assert.equal(hasActionableFindings([result({ id: 'a', status: 'changed' })]), true);
  assert.equal(hasActionableFindings([result({ id: 'a', status: 'gone' })]), true);
  // A first-time unreachable is recorded but not actionable.
  assert.equal(hasActionableFindings([unreachableAt('a', 1)]), false);
  // A second consecutive failure escalates.
  assert.equal(hasActionableFindings([unreachableAt('a', 2)]), true);
});

test('isBookkeepingOnly is true when the only change is a first-time unreachable counter', () => {
  assert.equal(isBookkeepingOnly([unreachableAt('a', 1), result({ id: 'b', status: 'unchanged' })]), true);
  assert.equal(isBookkeepingOnly([unreachableAt('a', 2)]), false); // escalated -> a real PR
  assert.equal(isBookkeepingOnly([result({ id: 'a', status: 'changed' })]), false);
  assert.equal(isBookkeepingOnly([result({ id: 'a', status: 'unchanged' })]), false);
  // A new baseline alongside a transient failure is NOT bookkeeping-only -> PR path.
  assert.equal(isBookkeepingOnly([unreachableAt('a', 1), result({ id: 'b', status: 'new' })]), false);
});

test('a first-time unreachable renders as a no-action note, not an Unreachable section', () => {
  const md = renderReport({ ...base, wrote: true, results: [unreachableAt('flaky', 1)] });
  assert.doesNotMatch(md, /## Unreachable/);
  assert.match(md, /unreachable for the first time/);
  assert.match(md, /\bflaky\b/);
  assert.match(md, /bookkeeping/);
});

test('an escalated unreachable renders the Unreachable section and is actionable', () => {
  const md = renderReport({ ...base, wrote: true, results: [unreachableAt('down', 2)] });
  assert.match(md, /## Unreachable \(1\)/);
  assert.match(md, /\*\*down\*\*/);
  assert.match(md, /runs running/);
});

test('renderReport names records that fell back to the weak <body> region', () => {
  const md = renderReport({
    ...base,
    results: [
      result({
        id: 'no-landmark',
        status: 'unchanged',
        contentRegion: 'body',
        entry: {
          url: 'https://example.gov/no-landmark',
          normalizedSha256: 'sha256:x',
          normalizedChars: 900,
          status: 'ok',
          firstSeen: '2026-01-01',
          lastChanged: '2026-01-01',
        },
      }),
      result({ id: 'has-main', status: 'unchanged', contentRegion: 'main' }),
    ],
  });
  assert.match(md, /## Weak content-region fallback \(1\)/);
  assert.match(md, /\*\*no-landmark\*\* -- fell back to `<body>`/);
  assert.doesNotMatch(md, /has-main/);
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
