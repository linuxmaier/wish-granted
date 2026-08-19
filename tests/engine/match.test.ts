import { describe, expect, it } from 'vitest';
import type { Answers } from '@/domain/facts';
import { PROGRAMS } from '@/data/programs';
import { matchAll } from '@/engine/match';
import { incomeLimit } from '@/engine/thresholds';

/**
 * These run against the real seed dataset rather than fixtures. That is
 * deliberate: the point is to catch a curation mistake that makes the app tell
 * someone the wrong thing, which a synthetic fixture cannot do.
 */

const madisonFamily: Answers = {
  state: 'WI',
  county: 'dane',
  city: 'madison',
  householdSize: 4,
  annualHouseholdIncome: 30_000,
  hasChildUnder5: true,
  isPregnantOrPostpartum: false,
  hasSchoolAgeChild: true,
  housingStatus: 'renting',
  paysHeatingCost: true,
  facingLossOfHousing: false,
  utilityShutoffRisk: false,
  currentBenefits: [],
};

const ids = (matches: readonly { program: { id: string } }[]) => matches.map((m) => m.program.id);

describe('bucketing', () => {
  it('puts every program in exactly one bucket', () => {
    const result = matchAll(PROGRAMS, madisonFamily);
    const total = result.eligible.length + result.maybe.length + result.ruledOut.length;
    expect(total).toBe(PROGRAMS.length);
  });

  it('starts with everything undecided and nothing ruled out', () => {
    const result = matchAll(PROGRAMS, {});
    expect(result.ruledOut).toHaveLength(0);
    // 211 has no eligibility test, so it is confirmed from the very first screen.
    expect(ids(result.eligible)).toContain('wi-211');
  });

  it('surfaces matches for a low-income Madison family with children', () => {
    const result = matchAll(PROGRAMS, madisonFamily);
    const eligible = ids(result.eligible);
    expect(eligible).toContain('foodshare-snap-wi');
    expect(eligible).toContain('wic-wisconsin');
    expect(eligible).toContain('school-meals-wi');
    expect(eligible).toContain('wheap-energy-assistance');
  });

  it('rules out local programs for someone outside Wisconsin', () => {
    const result = matchAll(PROGRAMS, { ...madisonFamily, state: 'other', county: 'other-wi-county', city: 'other' });
    expect(ids(result.ruledOut)).toContain('foodshare-snap-wi');
    expect(ids(result.ruledOut)).toContain('wheap-energy-assistance');
    // Lifeline is genuinely nationwide, so it must survive.
    expect(ids(result.eligible)).toContain('lifeline-phone-internet');
  });

  it('rules out income-tested programs for a high earner but keeps the pantries', () => {
    const result = matchAll(PROGRAMS, { ...madisonFamily, annualHouseholdIncome: 250_000 });
    expect(ids(result.ruledOut)).toContain('foodshare-snap-wi');

    // Nobody should ever reach the end with an empty results page. Food
    // pantries and referral lines have no income test, by design.
    expect(result.eligible.length).toBeGreaterThan(0);
    expect(ids(result.eligible)).toContain('the-river-food-pantry');
  });

  it('honours categorical eligibility over the income test', () => {
    const richButEnrolled: Answers = {
      ...madisonFamily,
      annualHouseholdIncome: 250_000,
      currentBenefits: ['ssi'],
    };
    // SSI confers categorical eligibility for FoodShare regardless of income.
    expect(ids(matchAll(PROGRAMS, richButEnrolled).eligible)).toContain('foodshare-snap-wi');
  });

  it('keeps a waitlisted program in "might qualify" rather than promising it', () => {
    const result = matchAll(PROGRAMS, {
      ...madisonFamily,
      annualHouseholdIncome: incomeLimit('dane-ami', 50, 4) - 1_000,
    });
    expect(ids(result.maybe)).toContain('madison-housing-choice-voucher');
    expect(ids(result.eligible)).not.toContain('madison-housing-choice-voucher');
  });
});

describe('sorting and explanations', () => {
  it('lists the most local programs first', () => {
    const result = matchAll(PROGRAMS, madisonFamily);
    const order = result.eligible.map((m) => m.program.jurisdiction);
    const rank = { city: 0, county: 1, state: 2, federal: 3 } as const;
    const ranks = order.map((j) => rank[j]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('gives every ruled-out program a reason to show the user', () => {
    const result = matchAll(PROGRAMS, { ...madisonFamily, state: 'other' });
    for (const match of result.ruledOut) {
      expect(match.reasons.length).toBeGreaterThan(0);
      expect(match.reasons.every((r) => r.verdict === 'fail')).toBe(true);
      expect(match.reasons[0]?.description).toBeTruthy();
    }
  });
});

describe('fact ranking', () => {
  it('ranks geography and household facts highest when nothing is known', () => {
    const { factPriorities } = matchAll(PROGRAMS, {});
    expect(factPriorities.length).toBeGreaterThan(0);

    const top = factPriorities.slice(0, 3).map((p) => p.fact);
    expect(top.some((f) => f === 'state' || f === 'householdSize' || f === 'annualHouseholdIncome')).toBe(true);
  });

  it('drops facts once nothing undecided depends on them', () => {
    const settled = matchAll(PROGRAMS, madisonFamily);
    for (const priority of settled.factPriorities) {
      expect(madisonFamily[priority.fact]).toBeUndefined();
    }
  });

  it('never ranks a fact that is already answered', () => {
    const { factPriorities } = matchAll(PROGRAMS, { state: 'WI' });
    expect(factPriorities.map((p) => p.fact)).not.toContain('state');
  });
});
