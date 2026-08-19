import { describe, expect, it } from 'vitest';
import {
  allOf,
  anyOf,
  always,
  atLeast,
  hasAnyOf,
  incomeAtOrBelow,
  is,
  isTrue,
  manualReview,
  not,
  oneOf,
} from '@/domain/criteria';
import type { Answers } from '@/domain/facts';
import { evaluate, decidingReasons } from '@/engine/evaluate';
import { incomeLimit } from '@/engine/thresholds';

const verdict = (criterion: Parameters<typeof evaluate>[0], answers: Answers) =>
  evaluate(criterion, answers).verdict;

describe('leaf criteria', () => {
  it('is unknown when the fact has not been answered', () => {
    expect(verdict(is('state', 'WI'), {})).toBe('unknown');
  });

  it('reports the fact it is waiting on', () => {
    expect(evaluate(is('state', 'WI'), {}).missingFacts).toEqual(['state']);
  });

  it('passes and fails on an answered fact', () => {
    expect(verdict(is('state', 'WI'), { state: 'WI' })).toBe('pass');
    expect(verdict(is('state', 'WI'), { state: 'other' })).toBe('fail');
  });

  it('treats false as answered, not as missing', () => {
    // A regression guard: an `if (!value)` check here would wrongly treat a
    // "no" answer as unanswered and leave the program stuck in "might qualify".
    expect(verdict(isTrue('paysHeatingCost'), { paysHeatingCost: false })).toBe('fail');
  });

  it('compares numbers by ordering', () => {
    expect(verdict(atLeast('householdSize', 3), { householdSize: 4 })).toBe('pass');
    expect(verdict(atLeast('householdSize', 3), { householdSize: 2 })).toBe('fail');
  });

  it('handles set membership and multi-select facts', () => {
    expect(verdict(oneOf('housingStatus', ['renting', 'own-home']), { housingStatus: 'renting' })).toBe('pass');
    expect(verdict(oneOf('housingStatus', ['renting']), { housingStatus: 'own-home' })).toBe('fail');

    const enrolled: Answers = { currentBenefits: ['snap-foodshare', 'wic'] };
    expect(verdict(hasAnyOf('currentBenefits', ['ssi', 'wic']), enrolled)).toBe('pass');
    expect(verdict(hasAnyOf('currentBenefits', ['ssi']), enrolled)).toBe('fail');
  });
});

describe('three-valued combinators', () => {
  const yes = always();
  const no = not(always());
  const dunno = is('state', 'WI'); // unanswered below

  it('allOf fails as soon as one child fails, even with unknowns present', () => {
    // This asymmetry is what lets the app rule programs out early rather than
    // waiting for a complete interview.
    expect(verdict(allOf(no, dunno), {})).toBe('fail');
  });

  it('allOf is unknown while anything is unresolved', () => {
    expect(verdict(allOf(yes, dunno), {})).toBe('unknown');
  });

  it('allOf passes only when everything passes', () => {
    expect(verdict(allOf(yes, yes), {})).toBe('pass');
  });

  it('anyOf passes as soon as one child passes, even with unknowns present', () => {
    expect(verdict(anyOf(yes, dunno), {})).toBe('pass');
  });

  it('anyOf fails only when every branch fails', () => {
    expect(verdict(anyOf(no, no), {})).toBe('fail');
    expect(verdict(anyOf(no, dunno), {})).toBe('unknown');
  });

  it('not leaves unknown alone', () => {
    expect(verdict(not(dunno), {})).toBe('unknown');
    expect(verdict(not(yes), {})).toBe('fail');
  });

  it('stops reporting missing facts once the verdict is settled', () => {
    // Nothing is "missing" if learning it could not change the answer. The
    // next-question ranking depends on this to avoid chasing dead questions.
    expect(evaluate(allOf(no, dunno), {}).missingFacts).toEqual([]);
    expect(evaluate(allOf(yes, dunno), {}).missingFacts).toEqual(['state']);
  });
});

describe('manualReview', () => {
  it('never resolves, so the program stays in "might qualify"', () => {
    const criterion = manualReview('The waiting list is often closed.');
    expect(verdict(criterion, {})).toBe('unknown');
    expect(verdict(allOf(always(), criterion), { state: 'WI' })).toBe('unknown');
  });

  it('carries its note through to the trace', () => {
    expect(evaluate(manualReview('Funding is limited.'), {}).note).toBe('Funding is limited.');
  });
});

describe('income criteria', () => {
  it('needs both income and household size', () => {
    const rule = incomeAtOrBelow('fpl', 130);
    expect(evaluate(rule, {}).missingFacts).toEqual(['annualHouseholdIncome', 'householdSize']);
    expect(evaluate(rule, { householdSize: 3 }).missingFacts).toEqual(['annualHouseholdIncome']);
  });

  it('compares against the limit for that household size', () => {
    const limit = incomeLimit('fpl', 130, 3);
    expect(verdict(incomeAtOrBelow('fpl', 130), { householdSize: 3, annualHouseholdIncome: limit })).toBe('pass');
    expect(verdict(incomeAtOrBelow('fpl', 130), { householdSize: 3, annualHouseholdIncome: limit + 1 })).toBe('fail');
  });

  it('scales the limit with household size', () => {
    expect(incomeLimit('fpl', 100, 4)).toBeGreaterThan(incomeLimit('fpl', 100, 1));
    // Beyond the published table, the per-person increment continues.
    expect(incomeLimit('fpl', 100, 10)).toBeGreaterThan(incomeLimit('fpl', 100, 8));
  });
});

describe('explanations', () => {
  it('names the actual dollar cutoff once household size is known', () => {
    const withSize = evaluate(incomeAtOrBelow('fpl', 130), { householdSize: 2 });
    expect(withSize.description).toMatch(/\$[\d,]+ per year/);
    expect(withSize.description).toContain('household of 2');
  });

  it('falls back to the percentage when household size is unknown', () => {
    expect(evaluate(incomeAtOrBelow('fpl', 130), {}).description).toContain('130%');
  });

  it('phrases boolean facts as sentences in both directions', () => {
    expect(evaluate(isTrue('hasChildUnder5'), {}).description).toBe(
      'there is a child under 5 in the household',
    );
    expect(evaluate(is('hasChildUnder5', false), {}).description).toBe(
      'there is no child under 5 in the household',
    );
  });

  it('uses display labels rather than raw enum values', () => {
    expect(evaluate(is('county', 'dane'), {}).description).toContain('Dane County');
  });
});

describe('decidingReasons', () => {
  it('reports only the failing branch when an allOf fails', () => {
    const rule = allOf(is('state', 'WI'), is('county', 'dane'));
    const reasons = decidingReasons(evaluate(rule, { state: 'other', county: 'dane' }));
    expect(reasons).toHaveLength(1);
    expect(reasons[0]?.description).toContain('Wisconsin');
  });

  it('reports only the satisfied branch when an anyOf passes', () => {
    const rule = anyOf(is('state', 'WI'), isTrue('hasChildUnder5'));
    const reasons = decidingReasons(evaluate(rule, { state: 'WI', hasChildUnder5: false }));
    expect(reasons).toHaveLength(1);
    expect(reasons[0]?.verdict).toBe('pass');
  });
});
