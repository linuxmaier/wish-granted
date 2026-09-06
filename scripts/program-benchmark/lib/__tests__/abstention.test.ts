import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scoreAbstention } from '../abstention.ts';
import { c } from './fixtures.ts';

test('not-applicable: neither rule abstains', () => {
  const s = scoreAbstention(c.income('fpl', 200), c.income('fpl', 200));
  assert.equal(s.verdict, 'not-applicable');
});

test('correct: candidate reproduces the manualReview leaf inside allOf', () => {
  const verified = c.allOf(c.is('state', 'WI'), c.income('fpl', 200), c.manualReview('work activity required'));
  const candidate = c.allOf(c.is('state', 'WI'), c.income('fpl', 200), c.manualReview('must be working or in school'));
  const s = scoreAbstention(verified, candidate);
  assert.equal(s.verdict, 'correct');
  assert.equal(s.verifiedManualReviewCount, 1);
  assert.equal(s.candidateManualReviewCount, 1);
});

test('missing: verified abstains, candidate states a hard rule', () => {
  const verified = c.allOf(c.is('county', 'dane'), c.manualReview('income not published'));
  const candidate = c.allOf(c.is('county', 'dane'), c.income('dane-ami', 80));
  assert.equal(scoreAbstention(verified, candidate).verdict, 'missing');
});

test('partial: verified has two manualReview leaves, candidate has one', () => {
  const verified = c.allOf(c.manualReview('a'), c.manualReview('b'), c.is('state', 'WI'));
  const candidate = c.allOf(c.manualReview('a'), c.is('state', 'WI'));
  assert.equal(scoreAbstention(verified, candidate).verdict, 'partial');
});

test('spurious: candidate abstains where the verified rule is decidable', () => {
  const s = scoreAbstention(c.income('fpl', 200), c.manualReview('not sure'));
  assert.equal(s.verdict, 'spurious');
});

test('whole-rule vs leaf abstention is reported', () => {
  const s = scoreAbstention(c.manualReview('closed waitlist'), c.manualReview('cannot tell'));
  assert.equal(s.verdict, 'correct');
  assert.equal(s.verifiedWholeRule, true);
  assert.equal(s.candidateWholeRule, true);
});
