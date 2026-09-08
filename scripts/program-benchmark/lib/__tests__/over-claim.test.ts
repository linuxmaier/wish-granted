import { test } from 'node:test';
import assert from 'node:assert/strict';

import { overClaimWrongness } from '../over-claim.ts';
import { dangerousWrongness } from '../dangerous.ts';
import { criterionEquivalence } from '../criterion-equivalence.ts';
import { c } from './fixtures.ts';

/**
 * The over-claim direction: the candidate tells someone they qualify when the
 * verified record rules them out or cannot say.
 *
 * This dimension did not exist for the whole of the extraction programme, which
 * meant a candidate could score clean for a rule that sends people on wasted
 * trips. These tests pin the PAIR -- for every fixture, over-claim and
 * under-claim are asserted together, so neither direction can be quietly
 * re-broken and neither can silently absorb the other.
 */

const WI = c.is('state', 'WI');

test('no findings when the two rules are the same', () => {
  const rule = c.allOf(WI, c.income('fpl', 130));
  assert.deepEqual(overClaimWrongness(rule, rule), []);
  assert.deepEqual(dangerousWrongness(rule, rule), []);
});

test('a loosened income ceiling is an over-claim, and NOT an under-claim', () => {
  // The lifeline-survivor-extended shape: the real general rule is 135% FPL and
  // the extractor lifted 200% out of a survivor-only branch. Someone at 170% is
  // told they qualify when they do not.
  const verified = c.allOf(WI, c.income('fpl', 135));
  const candidate = c.allOf(WI, c.income('fpl', 200));

  const over = overClaimWrongness(verified, candidate);
  assert.ok(over.length > 0, 'expected an over-claim finding');
  assert.equal(over[0]?.source, 'model-check');
  assert.ok((over[0]?.witnesses ?? []).length > 0);
  assert.equal(over[0]?.witnesses?.[0]?.candidate, 'eligible');

  assert.deepEqual(dangerousWrongness(verified, candidate), [], 'must not double-count as under-claim');
});

test('a tightened income ceiling is an under-claim, and NOT an over-claim', () => {
  const verified = c.allOf(WI, c.income('fpl', 200));
  const candidate = c.allOf(WI, c.income('fpl', 135));

  assert.deepEqual(overClaimWrongness(verified, candidate), []);
  assert.ok(dangerousWrongness(verified, candidate).length > 0);
});

test('dropping an abstention is an over-claim: "someone must check" became "you qualify"', () => {
  // madison-housing-choice-voucher shape: the waiting list is the real
  // constraint and no engine can decide it.
  const verified = c.allOf(WI, c.income('dane-ami', 50), c.manualReview('The waiting list is closed.'));
  const candidate = c.allOf(WI, c.income('dane-ami', 50));

  const over = overClaimWrongness(verified, candidate);
  assert.ok(over.some((f) => f.source === 'abstention-dropped'));
});

test('an abstention the candidate kept is not flagged', () => {
  const verified = c.allOf(WI, c.manualReview('Subject to funding.'));
  const candidate = c.allOf(WI, c.manualReview('Funding is not guaranteed.'));
  assert.ok(!overClaimWrongness(verified, candidate).some((f) => f.source === 'abstention-dropped'));
});

test('an invented eligible branch is an over-claim', () => {
  const verified = c.allOf(WI, c.income('fpl', 130));
  const candidate = c.anyOf(c.allOf(WI, c.income('fpl', 130)), c.allOf(WI, c.isTrue('recentIncomeDrop')));

  const over = overClaimWrongness(verified, candidate);
  assert.ok(over.length > 0);
  assert.equal(over[0]?.witnesses?.[0]?.candidate, 'eligible');
});

test('"verified needs review, candidate says eligible" is an over-claim', () => {
  const verified = c.allOf(WI, c.manualReview('Caseworker discretion.'));
  const candidate = WI;

  const over = overClaimWrongness(verified, candidate);
  assert.ok(over.length > 0);
  // Both detectors fire here and both are right: the model check sees the
  // promise, the abstention detector sees where it came from.
  assert.ok(over.map((f) => f.source).includes('abstention-dropped'));
  const witnessed = over.find((f) => f.source === 'model-check');
  assert.equal(witnessed?.witnesses?.[0]?.verified, 'needs-review');
});

test('a rule that diverges both ways reports both directions', () => {
  // The candidate swaps one gate for another: it admits people the verified
  // rule excludes AND excludes people it admits.
  const verified = c.allOf(WI, c.isTrue('paysHeatingCost'));
  const candidate = c.allOf(WI, c.isTrue('facingLossOfHousing'));

  assert.ok(overClaimWrongness(verified, candidate).length > 0);
  assert.ok(dangerousWrongness(verified, candidate).length > 0);
});

test('criterionEquivalence populates the two witness arrays independently', () => {
  const eq = criterionEquivalence(c.allOf(WI, c.income('fpl', 135)), c.allOf(WI, c.income('fpl', 200)));

  assert.equal(eq.verdict, 'divergent');
  assert.ok(eq.overClaimWitnesses.length > 0);
  assert.deepEqual(eq.dangerousWitnesses, []);
  assert.ok(eq.detail.includes('OVER-CLAIM'));
});

test('criterionEquivalence leaves both witness arrays empty for equivalent rules', () => {
  const rule = c.allOf(WI, c.income('fpl', 130));
  const eq = criterionEquivalence(rule, rule);
  assert.deepEqual(eq.overClaimWitnesses, []);
  assert.deepEqual(eq.dangerousWitnesses, []);
});
