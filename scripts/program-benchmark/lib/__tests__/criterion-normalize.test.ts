import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeCriterion,
  comparisonKey,
  sameCanonicalForm,
  countManualReview,
  toNegationNormalForm,
} from '../criterion-normalize.ts';
import { c } from './fixtures.ts';

const key = (x: Parameters<typeof comparisonKey>[0]) => comparisonKey(normalizeCriterion(x));

test('allOf operand order does not matter', () => {
  const a = c.allOf(c.is('state', 'WI'), c.is('county', 'dane'));
  const b = c.allOf(c.is('county', 'dane'), c.is('state', 'WI'));
  assert.equal(key(a), key(b));
});

test('nested same-kind combinators are flattened', () => {
  const a = c.allOf(c.is('state', 'WI'), c.allOf(c.isTrue('hasChildUnder5'), c.income('fpl', 200)));
  const b = c.allOf(c.is('state', 'WI'), c.isTrue('hasChildUnder5'), c.income('fpl', 200));
  assert.equal(key(a), key(b));
});

test('singleton combinators unwrap', () => {
  assert.equal(key(c.allOf(c.income('fpl', 100))), key(c.income('fpl', 100)));
  assert.equal(key(c.anyOf(c.income('fpl', 100))), key(c.income('fpl', 100)));
});

test('duplicate operands collapse', () => {
  const a = c.allOf(c.is('state', 'WI'), c.is('state', 'WI'), c.isTrue('hasChildUnder5'));
  const b = c.allOf(c.is('state', 'WI'), c.isTrue('hasChildUnder5'));
  assert.equal(key(a), key(b));
});

test('always is identity in allOf and absorbing in anyOf', () => {
  assert.equal(key(c.allOf(c.income('fpl', 100), c.always())), key(c.income('fpl', 100)));
  assert.equal(key(c.anyOf(c.income('fpl', 100), c.always())), key(c.always()));
});

test('De Morgan: not over a combinator distributes to the leaves', () => {
  const a = c.not(c.allOf(c.is('state', 'WI'), c.isTrue('hasChildUnder5')));
  const b = c.anyOf(c.not(c.is('state', 'WI')), c.not(c.isTrue('hasChildUnder5')));
  assert.equal(key(a), key(b));
});

test('double negation cancels', () => {
  assert.equal(key(c.not(c.not(c.income('fpl', 100)))), key(c.income('fpl', 100)));
});

test('not folds into a compare operator dual', () => {
  assert.equal(
    key(c.not(c.is('state', 'WI'))),
    key({ kind: 'compare', fact: 'state' as never, op: 'neq', value: 'WI' }),
  );
});

test('not(atMost) becomes gt (its exact dual), not gte', () => {
  const folded = normalizeCriterion(c.not(c.atMost('householdSize', 4)));
  assert.deepEqual(folded, { kind: 'compare', fact: 'householdSize', op: 'gt', value: 4 });
});

test('boolean compare(neq,false) canonicalises to compare(eq,true)', () => {
  const a: Parameters<typeof normalizeCriterion>[0] = { kind: 'compare', fact: 'facingLossOfHousing' as never, op: 'neq', value: false };
  assert.equal(key(a), key(c.isTrue('facingLossOfHousing')));
});

test('set values are order- and duplicate-independent', () => {
  const a = c.hasAnyOf('currentBenefits', ['ssi', 'w2-tanf', 'ssi']);
  const b = c.hasAnyOf('currentBenefits', ['w2-tanf', 'ssi']);
  assert.equal(key(a), key(b));
});

test('manualReview note text is not part of the comparison key', () => {
  assert.equal(key(c.manualReview('reason one')), key(c.manualReview('a totally different reason')));
});

test('countManualReview counts nested leaves', () => {
  const tree = c.allOf(c.is('state', 'WI'), c.anyOf(c.income('fpl', 200), c.manualReview('x')), c.manualReview('y'));
  assert.equal(countManualReview(tree), 2);
});

test('toNegationNormalForm leaves no not above a combinator', () => {
  const nnf = toNegationNormalForm(c.not(c.anyOf(c.is('state', 'WI'), c.allOf(c.isTrue('hasChildUnder5')))));
  const s = JSON.stringify(nnf);
  const hasNotOverCombinator =
    s.includes('"kind":"not","of":{"kind":"allOf"') || s.includes('"kind":"not","of":{"kind":"anyOf"');
  assert.equal(hasNotOverCombinator, false);
});

test('sameCanonicalForm is the public equality helper', () => {
  assert.equal(
    sameCanonicalForm(
      c.allOf(c.is('state', 'WI'), c.income('fpl', 200)),
      c.allOf(c.income('fpl', 200), c.is('state', 'WI')),
    ),
    true,
  );
  assert.equal(sameCanonicalForm(c.income('fpl', 200), c.income('fpl', 100)), false);
});
