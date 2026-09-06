import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dangerousWrongness } from '../dangerous.ts';
import { c } from './fixtures.ts';

test('no findings when the candidate is equivalent', () => {
  const rule = c.allOf(c.is('state', 'WI'), c.income('fpl', 200));
  assert.deepEqual(dangerousWrongness(rule, c.allOf(c.income('fpl', 200), c.is('state', 'WI'))), []);
});

test('no findings when the candidate is merely over-inclusive', () => {
  const verified = c.allOf(c.is('state', 'WI'), c.income('fpl', 200));
  const findings = dangerousWrongness(verified, c.income('fpl', 200));
  assert.equal(findings.length, 0);
});

test('model-check finding: dropped categorical-eligibility branch', () => {
  const verified = c.anyOf(c.income('fpl', 200), c.hasAnyOf('currentBenefits', ['ssi', 'w2-tanf']));
  const findings = dangerousWrongness(verified, c.income('fpl', 200));
  assert.ok(findings.some((f) => f.source === 'model-check'));
  assert.ok(findings.some((f) => (f.witnesses ?? []).length > 0));
});

test('model-check finding: tightened income ceiling', () => {
  const findings = dangerousWrongness(c.income('fpl', 200), c.income('fpl', 130));
  assert.ok(findings.some((f) => f.source === 'model-check'));
});

test('abstention-replaced finding: verified manualReview swapped for a concrete threshold', () => {
  const verified = c.allOf(c.is('county', 'dane'), c.isTrue('facingLossOfHousing'), c.manualReview('income not published'));
  const candidate = c.allOf(c.is('county', 'dane'), c.isTrue('facingLossOfHousing'), c.income('dane-ami', 80));
  const findings = dangerousWrongness(verified, candidate);
  assert.ok(findings.some((f) => f.source === 'abstention-replaced'));
});

test('threshold-tightened fallback fires only when the model check is undecided', () => {
  // Two numeric bounds on householdSize make the model check bail; the income
  // ceiling comparison still runs structurally.
  const verified = c.allOf(c.atLeast('householdSize', 2), c.atMost('householdSize', 8), c.income('fpl', 200));
  const candidate = c.allOf(c.atMost('householdSize', 8), c.income('fpl', 150));
  const findings = dangerousWrongness(verified, candidate);
  assert.ok(findings.some((f) => f.source === 'threshold-tightened'));
});

test('a candidate that also abstains is never dangerous', () => {
  const verified = c.allOf(c.is('state', 'WI'), c.income('fpl', 200));
  const findings = dangerousWrongness(verified, c.manualReview('cannot tell'));
  assert.equal(findings.length, 0);
});
