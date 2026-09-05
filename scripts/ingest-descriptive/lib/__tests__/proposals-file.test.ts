import { test } from 'node:test';
import assert from 'node:assert/strict';

import { emptyProposalsFile, mergeEntry, serializeProposalsFile, type ProposalsFile } from '../proposals-file.ts';
import type { RecordFinding } from '../classify.ts';

const finding = (over: Partial<RecordFinding> = {}): RecordFinding => ({
  id: 'demo',
  sourceUrl: 'https://x.example/a',
  finalUrl: 'https://x.example/a',
  urlHealth: 'ok',
  detail: 'ok',
  proposals: [],
  reviews: [{ kind: 'status-signal', message: 'check status', excerpt: 'not accepting applications' }],
  ...over,
});

test('an unchanged finding carries firstSeen and fetchedAt forward (fixed point)', () => {
  const first = mergeEntry(finding(), undefined, '2026-09-05T10:00:00.000Z', '2026-09-05');
  const second = mergeEntry(finding(), first, '2026-11-01T10:00:00.000Z', '2026-11-01');
  assert.deepEqual(second, first);
});

test('a substantive change bumps fetchedAt but keeps firstSeen', () => {
  const first = mergeEntry(finding(), undefined, '2026-09-05T10:00:00.000Z', '2026-09-05');
  const changed = mergeEntry(
    finding({ reviews: [{ kind: 'status-signal', message: 'different', excerpt: 'now closed' }] }),
    first,
    '2026-11-01T10:00:00.000Z',
    '2026-11-01',
  );
  assert.equal(changed.firstSeen, '2026-09-05');
  assert.equal(changed.fetchedAt, '2026-11-01T10:00:00.000Z');
});

test('serialization is stable: sorted ids, fixed key order, trailing newline', () => {
  const file: ProposalsFile = {
    ...emptyProposalsFile(),
    records: {
      zeta: mergeEntry(finding({ id: 'zeta' }), undefined, '2026-09-05T00:00:00.000Z', '2026-09-05'),
      alpha: mergeEntry(finding({ id: 'alpha' }), undefined, '2026-09-05T00:00:00.000Z', '2026-09-05'),
    },
  };
  const out = serializeProposalsFile(file);
  assert.ok(out.endsWith('}\n'));
  assert.ok(out.indexOf('"alpha"') < out.indexOf('"zeta"'));
  // Re-serializing the parsed form is a no-op.
  assert.equal(serializeProposalsFile({ ...emptyProposalsFile(), records: JSON.parse(out).records }), out);
});

test('an empty queue serializes deterministically', () => {
  assert.equal(serializeProposalsFile(emptyProposalsFile()), serializeProposalsFile(emptyProposalsFile()));
});
