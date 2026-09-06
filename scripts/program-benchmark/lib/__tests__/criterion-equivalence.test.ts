import { test } from 'node:test';
import assert from 'node:assert/strict';

import { criterionEquivalence } from '../criterion-equivalence.ts';
import { c } from './fixtures.ts';

test('equivalent by canonical form: reordered allOf', () => {
  const r = criterionEquivalence(
    c.allOf(c.is('state', 'WI'), c.income('fpl', 200)),
    c.allOf(c.income('fpl', 200), c.is('state', 'WI')),
  );
  assert.equal(r.verdict, 'equivalent');
  assert.equal(r.method, 'canonical-form');
});

test('equivalent by model check: distribution the canonicaliser does not do', () => {
  // allOf(A, anyOf(B, C))  ==  anyOf(allOf(A,B), allOf(A,C))
  const A = c.is('state', 'WI');
  const B = c.isTrue('hasChildUnder5');
  const D = c.isTrue('isPregnantOrPostpartum');
  const r = criterionEquivalence(
    c.allOf(A, c.anyOf(B, D)),
    c.anyOf(c.allOf(A, B), c.allOf(A, D)),
  );
  assert.equal(r.verdict, 'equivalent');
  assert.equal(r.method, 'model-check');
});

test('equivalent by model check: absorption', () => {
  const A = c.is('state', 'WI');
  const B = c.isTrue('hasChildUnder5');
  const r = criterionEquivalence(A, c.anyOf(A, c.allOf(A, B)));
  assert.equal(r.verdict, 'equivalent');
});

test('income thresholds are linked: <=100% implies <=200%', () => {
  // verified: income <= 200%.  candidate: anyOf(income<=100, income<=200) -- same set.
  const r = criterionEquivalence(
    c.income('fpl', 200),
    c.anyOf(c.income('fpl', 100), c.income('fpl', 200)),
  );
  assert.equal(r.verdict, 'equivalent');
});

test('divergent and DANGEROUS: candidate drops a categorical-eligibility branch', () => {
  // verified: income<=200%  OR  on SSI/W-2.   candidate: income<=200% only.
  const verified = c.anyOf(c.income('fpl', 200), c.hasAnyOf('currentBenefits', ['ssi', 'w2-tanf']));
  const candidate = c.income('fpl', 200);
  const r = criterionEquivalence(verified, candidate);
  assert.equal(r.verdict, 'divergent');
  assert.ok(r.dangerousWitnesses.length > 0, 'expected a dangerous witness');
  assert.equal(r.dangerousWitnesses[0]!.candidate, 'ruled-out');
});

test('divergent and DANGEROUS: candidate tightens an income ceiling', () => {
  const r = criterionEquivalence(c.income('fpl', 200), c.income('fpl', 130));
  assert.equal(r.verdict, 'divergent');
  assert.ok(r.dangerousWitnesses.some((w) => /fpl/.test(w.profile)));
});

test('divergent but NOT dangerous: candidate is over-inclusive (drops a required conjunct)', () => {
  const verified = c.allOf(c.is('state', 'WI'), c.income('fpl', 200));
  const candidate = c.income('fpl', 200); // no residency gate -> broader
  const r = criterionEquivalence(verified, candidate);
  assert.equal(r.verdict, 'divergent');
  assert.equal(r.dangerousWitnesses.length, 0);
});

test('verified manualReview vs candidate concrete rule: divergent, and dangerous (needs-review -> ruled-out)', () => {
  // verified: allOf(residency, manualReview).  Under Kleene this is never F->
  // it is T-gated-by-U == U at best.  candidate: allOf(residency, income<=80)
  // which CAN be F.  So there is a needs-review -> ruled-out witness.
  const verified = c.allOf(c.is('county', 'dane'), c.manualReview('income limits not published'));
  const candidate = c.allOf(c.is('county', 'dane'), c.income('dane-ami', 80));
  const r = criterionEquivalence(verified, candidate);
  assert.equal(r.verdict, 'divergent');
  assert.ok(r.dangerousWitnesses.some((w) => w.verified === 'needs-review'));
});

test('undecided: two different numeric bounds on the same fact (no interval solver)', () => {
  const verified = c.allOf(c.atLeast('householdSize', 2), c.atMost('householdSize', 8));
  const candidate = c.atMost('householdSize', 8);
  const r = criterionEquivalence(verified, candidate);
  assert.equal(r.verdict, 'undecided');
  assert.equal(r.dangerousWitnesses.length, 0);
});
