import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classify, isActionable, type RecordInput } from '../classify.ts';
import type { FetchOutcome } from '../fetch.ts';

const idNormalize = (s: string) => s;

const REC: RecordInput = {
  id: 'demo',
  sourceUrl: 'https://agency.example.gov/program',
  currentPhone: '1-800-555-1234',
  currentStatus: 'open',
};

const ok = (text: string, finalUrl = REC.sourceUrl): FetchOutcome => ({ kind: 'ok', finalUrl, text });

test('404 -> gone, distinct from changed, proposes nothing, flags for review', () => {
  const f = classify(REC, { kind: 'gone', finalUrl: REC.sourceUrl, httpStatus: 404 }, { normalize: idNormalize });
  assert.equal(f.urlHealth, 'gone');
  assert.equal(f.proposals.length, 0);
  assert.equal(f.reviews[0]!.kind, 'gone');
  assert.match(f.detail, /removed, not edited/);
});

test('redirect to a different host -> moved, proposes the new source URL', () => {
  const f = classify(REC, ok('the program page, plenty of text here to clear the threshold '.repeat(10), 'https://fna.usda.gov/program'), { normalize: idNormalize });
  assert.equal(f.urlHealth, 'moved');
  const p = f.proposals.find((x) => x.field === 'source.url')!;
  assert.equal(p.classification, 'moved');
  assert.equal(p.proposed, 'https://fna.usda.gov/program');
  assert.equal(p.current, REC.sourceUrl);
});

test('redirect on the same host -> redirected (not moved), still a source.url proposal', () => {
  const f = classify(REC, ok('body text '.repeat(60), 'https://agency.example.gov/program/index.html'), { normalize: idNormalize });
  assert.equal(f.urlHealth, 'redirected');
  assert.equal(f.proposals[0]!.classification, 'changed');
});

test('unreachable and blocked are their own outcomes, never "changed"', () => {
  const u = classify(REC, { kind: 'unreachable', finalUrl: REC.sourceUrl, reason: 'ETIMEDOUT' }, { normalize: idNormalize });
  assert.equal(u.urlHealth, 'unreachable');
  const b = classify(REC, { kind: 'blocked', finalUrl: REC.sourceUrl, reason: 'robots.txt' }, { normalize: idNormalize });
  assert.equal(b.urlHealth, 'blocked');
  assert.equal(b.proposals.length, 0);
});

test('stored phone still on the page -> no proposal, no review', () => {
  const f = classify(REC, ok('Questions? Call 1-800-555-1234 during business hours. ' + 'x'.repeat(400)), { normalize: idNormalize });
  assert.equal(f.urlHealth, 'ok');
  assert.ok(!isActionable(f));
});

test('stored phone gone from the page -> review flag with the numbers now present', () => {
  const f = classify(REC, ok('Reach the office at 608-266-4651 or 608-266-4675. ' + 'y'.repeat(400)), { normalize: idNormalize });
  const r = f.reviews.find((x) => x.kind === 'phone-missing-from-page')!;
  assert.match(r.message, /608-266-4651/);
  assert.equal(f.proposals.length, 0);
});

test('record with no phone + exactly one on the page -> low-confidence proposal with provenance', () => {
  const rec = { ...REC, currentPhone: null };
  const f = classify(rec, ok('Apply by calling (608) 266-3509 for the nutrition program office. ' + 'z'.repeat(400)), { normalize: idNormalize });
  const p = f.proposals.find((x) => x.field === 'howToApply.phone')!;
  assert.equal(p.current, null);
  assert.equal(p.proposed, '(608) 266-3509');
  assert.equal(p.confidence, 'low');
  assert.match(p.provenance.excerpt, /nutrition program office/);
});

test('record with no phone + several on the page -> review flag, not a guess', () => {
  const rec = { ...REC, currentPhone: null };
  const f = classify(rec, ok('Offices: 608-266-1046, 608-266-0044, 608-267-9125. ' + 'q'.repeat(400)), { normalize: idNormalize });
  assert.ok(f.reviews.some((x) => x.kind === 'phone-candidates'));
  assert.equal(f.proposals.filter((p) => p.field === 'howToApply.phone').length, 0);
});

test('a page that normalizes to nothing -> source-text-review flag, no false phone-missing', () => {
  const f = classify(REC, ok('<div></div>'), { normalize: () => '' });
  assert.ok(f.reviews.some((x) => x.kind === 'source-text-review'));
  assert.ok(!f.reviews.some((x) => x.kind === 'phone-missing-from-page'));
});

test('status signal on the page while the record says open -> review flag', () => {
  const f = classify(REC, ok('This program is not currently accepting new applications. ' + 'w'.repeat(400)), { normalize: idNormalize });
  const r = f.reviews.find((x) => x.kind === 'status-signal')!;
  assert.match(r.message, /status is "open"/);
});

test('status signal that agrees with the recorded status is quiet', () => {
  const closed = { ...REC, currentStatus: 'closed' };
  const f = classify(closed, ok('The program has ended. ' + 'w'.repeat(400)), { normalize: idNormalize });
  assert.ok(!f.reviews.some((x) => x.kind === 'status-signal'));
});

test('dedupe: proposed source.url equal to current is not emitted', () => {
  // finalUrl === sourceUrl means no redirect -> no source.url proposal at all.
  const f = classify(REC, ok('plenty of body text '.repeat(40)), { normalize: idNormalize });
  assert.equal(f.proposals.filter((p) => p.field === 'source.url').length, 0);
});
