import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderReport } from '../report.ts';
import type { RecordFinding } from '../classify.ts';
import type { Acknowledgement } from '../proposals-file.ts';

const finding = (over: Partial<RecordFinding> = {}): RecordFinding => ({
  id: 'demo',
  sourceUrl: 'https://x.example/a',
  finalUrl: 'https://x.example/a',
  urlHealth: 'ok',
  detail: 'ok',
  proposals: [],
  reviews: [{ kind: 'status-signal', message: 'check status', excerpt: 'not accepting applications' }],
  sourceHash: 'sha256:aaa',
  ...over,
});

const base = {
  generatedAt: '2026-09-05T00:00:00.000Z',
  checkedCount: 1,
  wrote: false,
  dryRun: true,
  branchBlocked: null,
};

const ACK: Acknowledgement = { reviewedOn: '2026-09-05', reason: 'verified false positive', sourceHash: 'sha256:aaa' };

test('an un-acknowledged status-signal lands in "Needs human review"', () => {
  const md = renderReport({ ...base, findings: [finding()], acknowledged: new Map() });
  assert.match(md, /## Needs human review -- descriptive \(1\)/);
  assert.match(md, /## Reviewed -- no change needed \(0\)/);
});

test('an acknowledged finding moves out of review and into "Reviewed -- no change needed"', () => {
  const md = renderReport({
    ...base,
    findings: [finding()],
    acknowledged: new Map([['demo', ACK]]),
  });
  assert.match(md, /## Needs human review -- descriptive \(0\)/);
  assert.match(md, /## Reviewed -- no change needed \(1\)/);
  assert.match(md, /\*\*demo\*\* \(status-signal\) -- reviewed 2026-09-05: verified false positive/);
  assert.match(md, /keyed to the page hash/);
});
