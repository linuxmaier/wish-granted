import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  emptyProposalsFile,
  mergeEntry,
  resolveAcknowledgement,
  serializeProposalsFile,
  type ProposalEntry,
  type ProposalsFile,
} from '../proposals-file.ts';
import type { RecordFinding } from '../classify.ts';

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

const ACK = { reviewedOn: '2026-09-05', reason: 'verified false positive', sourceHash: 'sha256:aaa' } as const;
const withAck = (over: Partial<ProposalEntry> = {}): ProposalEntry => ({
  ...mergeEntry(finding(), undefined, '2026-09-05T00:00:00.000Z', '2026-09-05'),
  acknowledgement: { ...ACK },
  ...over,
});

test('resolveAcknowledgement: kept while the page hash still matches', () => {
  assert.deepEqual(resolveAcknowledgement({ sourceHash: 'sha256:aaa' }, withAck()), ACK);
});

test('resolveAcknowledgement: dropped when the page text moved', () => {
  assert.equal(resolveAcknowledgement({ sourceHash: 'sha256:bbb' }, withAck()), undefined);
});

test('resolveAcknowledgement: kept when the page could not be read this run', () => {
  assert.deepEqual(resolveAcknowledgement({ sourceHash: null }, withAck()), ACK);
});

test('resolveAcknowledgement: none when there was no prior acknowledgement', () => {
  const noAck = mergeEntry(finding(), undefined, '2026-09-05T00:00:00.000Z', '2026-09-05');
  assert.equal(resolveAcknowledgement({ sourceHash: 'sha256:aaa' }, noAck), undefined);
});

test('mergeEntry carries a valid acknowledgement forward as a fixed point', () => {
  const prev = withAck();
  const merged = mergeEntry(finding({ sourceHash: 'sha256:aaa' }), prev, '2026-12-01T00:00:00.000Z', '2026-12-01');
  assert.deepEqual(merged, prev); // byte-for-byte: fetchedAt not bumped, ack intact
});

test('mergeEntry drops the acknowledgement when the page hash changes, and bumps fetchedAt', () => {
  const prev = withAck();
  const merged = mergeEntry(finding({ sourceHash: 'sha256:CHANGED' }), prev, '2026-12-01T00:00:00.000Z', '2026-12-01');
  assert.equal(merged.acknowledgement, undefined);
  assert.equal(merged.fetchedAt, '2026-12-01T00:00:00.000Z');
  assert.equal(merged.firstSeen, prev.firstSeen);
});

test('the committed proposals.json is already in canonical serialized form', () => {
  // Guards a hand-edit (e.g. adding an acknowledgement) that would otherwise make
  // the next scheduled run rewrite the file and open a spurious PR.
  const path = join(import.meta.dirname, '..', '..', 'proposals.json');
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  const parsed = { ...emptyProposalsFile(), records: (JSON.parse(raw) as ProposalsFile).records };
  assert.equal(raw.replace(/\r\n/g, '\n'), serializeProposalsFile(parsed));
});

test('serialization round-trips an acknowledgement with a fixed key order', () => {
  const file: ProposalsFile = { ...emptyProposalsFile(), records: { demo: withAck() } };
  const out = serializeProposalsFile(file);
  assert.match(out, /"acknowledgement": \{/);
  const ackSlice = out.slice(out.indexOf('"acknowledgement"'));
  assert.ok(ackSlice.indexOf('"reviewedOn"') < ackSlice.indexOf('"reason"'));
  assert.ok(ackSlice.indexOf('"reason"') < ackSlice.indexOf('"sourceHash"'));
  assert.equal(serializeProposalsFile({ ...emptyProposalsFile(), records: JSON.parse(out).records }), out);
});
