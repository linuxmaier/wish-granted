import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  incomeAtOrBelow,
  allOf,
  anyOf,
  isTrue,
  atLeast,
  atMost,
  livesIn,
} from '../../../../src/domain/criteria.ts';
import type { Criterion } from '../../../../src/domain/criteria.ts';
import { manualReview, always } from '../../../../src/domain/criteria.ts';
import { crossMethodAgreement } from '../agreement.ts';
import type { MethodOutcome } from '../methods.ts';

const ex = (c: Criterion): MethodOutcome => ({ decision: 'extract', criterion: c });
const abstain = (reason: string): MethodOutcome => ({ decision: 'abstain', reason });

test('not comparable when either method abstains', () => {
  const r = crossMethodAgreement(abstain('no rule'), ex(incomeAtOrBelow('fpl', 100)));
  assert.equal(r.verdict, 'not-comparable');
  assert.equal(r.comparable, false);
});

test('equivalent when both methods emit the same rule (canonical form)', () => {
  const r = crossMethodAgreement(
    ex(allOf(livesIn.wisconsin, incomeAtOrBelow('fpl', 200))),
    ex(allOf(incomeAtOrBelow('fpl', 200), livesIn.wisconsin)),
  );
  assert.equal(r.verdict, 'equivalent');
  assert.equal(r.comparable, true);
});

test('divergent-dangerous: agentic rule is strictly narrower (income ceiling lower)', () => {
  const r = crossMethodAgreement(ex(incomeAtOrBelow('wi-smi', 100)), ex(incomeAtOrBelow('wi-smi', 60)));
  assert.equal(r.verdict, 'divergent-dangerous');
  assert.equal(r.agenticNarrower, true);
  assert.equal(r.deterministicNarrower, false);
});

test('divergent-dangerous is symmetric: caught when the deterministic rule is the narrower one', () => {
  const r = crossMethodAgreement(ex(incomeAtOrBelow('wi-smi', 60)), ex(incomeAtOrBelow('wi-smi', 100)));
  assert.equal(r.verdict, 'divergent-dangerous');
  assert.equal(r.deterministicNarrower, true);
  assert.equal(r.agenticNarrower, false);
});

test('divergent-dangerous: a dropped categorical branch is a ruled-out profile', () => {
  // deterministic keeps an OR branch the agentic rule drops.
  const withBranch = anyOf(incomeAtOrBelow('fpl', 100), isTrue('isPregnantOrPostpartum'));
  const withoutBranch = incomeAtOrBelow('fpl', 100);
  const r = crossMethodAgreement(ex(withBranch), ex(withoutBranch));
  assert.equal(r.verdict, 'divergent-dangerous');
  assert.equal(r.agenticNarrower, true);
});

test('undecided when a leaf cannot be modelled (two numeric bounds on one fact)', () => {
  const r = crossMethodAgreement(
    ex(allOf(livesIn.wisconsin, atLeast('householdSize', 2))),
    ex(allOf(livesIn.wisconsin, atMost('householdSize', 5))),
  );
  assert.equal(r.verdict, 'undecided');
  assert.equal(r.agenticNarrower, false);
  assert.equal(r.deterministicNarrower, false);
});

test('any strict narrowing counts as dangerous-direction (checked both ways, per #84 "either way")', () => {
  // A rule that merely ADDS a required leaf is narrower -> dangerous direction.
  const r = crossMethodAgreement(
    ex(incomeAtOrBelow('fpl', 100)),
    ex(allOf(incomeAtOrBelow('fpl', 100), isTrue('isPregnantOrPostpartum'))),
  );
  assert.equal(r.verdict, 'divergent-dangerous');
  assert.equal(r.agenticNarrower, true);
});

test('divergent-safe: the two rules disagree only around an unknown (never T-vs-F)', () => {
  // `always` (T everywhere) vs `manualReview` (U everywhere): every state is
  // T-vs-U, so there is no dangerous witness in either direction.
  const r = crossMethodAgreement(ex(always()), ex(manualReview('a reviewer must decide')));
  assert.equal(r.verdict, 'divergent-safe');
});
