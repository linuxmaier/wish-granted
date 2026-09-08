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
    expect(result.maybe).toHaveLength(PROGRAMS.length);
    // Nothing is confirmed before any answer: every program in the seed set is
    // scoped to at least a geography, so all of them start as "might qualify".
    expect(result.eligible).toHaveLength(0);
  });

  it('surfaces matches for a low-income Madison family with children', () => {
    const result = matchAll(PROGRAMS, madisonFamily);
    const eligible = ids(result.eligible);
    expect(eligible).toContain('foodshare-snap-wi');
    expect(eligible).toContain('wic-wisconsin');
    expect(eligible).toContain('school-meals-wi');
    expect(eligible).toContain('wheap-energy-assistance');
    // madisonFamily's $30,000 income for a household of 4 clears even
    // BadgerCare's 100% FPL "adult" tier ($33,000), so the whole household
    // qualifies outright, not just the children -- see badgercare-plus.ts.
    expect(eligible).toContain('badgercare-plus');
  });

  describe('BadgerCare Plus and the age bound (issues #79, #88)', () => {
    // A low-income Wisconsin adult with no children in the household. Which
    // bucket badgercare-plus lands in is entirely a question of age.
    const soloAdult: Answers = {
      state: 'WI',
      county: 'dane',
      city: 'madison',
      householdSize: 1,
      annualHouseholdIncome: 12_000,
      hasChildUnder5: false,
      isPregnantOrPostpartum: false,
      hasSchoolAgeChild: false,
      currentBenefits: [],
    };
    const bucketOf = (answers: Answers) =>
      matchAll(PROGRAMS, answers).all.find((m) => m.program.id === 'badgercare-plus')?.bucket;

    it('rules out an over-65 childless adult, rather than showing them eligible (the #79 bug)', () => {
      expect(bucketOf({ ...soloAdult, age: '65-plus' })).toBe('ruledOut');
    });

    it('confirms an under-65 childless adult at or below 100% FPL', () => {
      expect(bucketOf({ ...soloAdult, age: 'under-60' })).toBe('eligible');
      expect(bucketOf({ ...soloAdult, age: '60-64' })).toBe('eligible');
    });

    it('leaves the program at "might qualify" when age is unanswered -- never ruled out', () => {
      const match = matchAll(PROGRAMS, soloAdult).all.find((m) => m.program.id === 'badgercare-plus');
      expect(match?.bucket).toBe('maybe');
      // ...and the interview knows age is the fact that would settle it.
      expect(match?.missingFacts).toContain('age');
    });

    it('does not rule out an over-65 applicant with a child in the household -- the asymmetry (#5 §4.4)', () => {
      // A 66-year-old raising a young grandchild: the grandchild qualifies
      // through the household branch, which is not age-gated.
      const grandparent: Answers = { ...soloAdult, age: '65-plus', hasChildUnder5: true, householdSize: 2, annualHouseholdIncome: 30_000 };
      expect(bucketOf(grandparent)).toBe('eligible');
    });
  });

  it('keeps Wisconsin Shares at "might qualify" even when income and children clear, because the approved-activity requirement is never encoded as a pass', () => {
    // This is the manualReview cap's safety property: wisconsin-shares-child-
    // care.ts can never resolve to `pass` because it has no fact to confirm
    // the approved-activity requirement (work/school/training) against, only
    // a manualReview leaf. Asserting `maybe` here, not just "not ruled out",
    // means deleting that leaf later would break this test rather than
    // silently starting to promise a subsidy the app never actually checked.
    const result = matchAll(PROGRAMS, madisonFamily);
    expect(ids(result.maybe)).toContain('wisconsin-shares-child-care');
    expect(ids(result.eligible)).not.toContain('wisconsin-shares-child-care');
  });

  const outOfState = {
    ...madisonFamily,
    state: 'other',
    county: 'other-wi-county',
    city: 'other',
  } as const;

  it('rules out local programs for someone outside Wisconsin', () => {
    const result = matchAll(PROGRAMS, outOfState);
    expect(ids(result.ruledOut)).toContain('foodshare-snap-wi');
    expect(ids(result.ruledOut)).toContain('wheap-energy-assistance');
    // Lifeline is genuinely nationwide, so it must survive.
    expect(ids(result.eligible)).toContain('lifeline-phone-internet');
  });

  it('does not offer a Wisconsin-scoped service to someone out of state', () => {
    // Regression: 211 Wisconsin used to carry an `always()` rule so that results
    // were never empty, which told out-of-state users they qualified for a
    // Wisconsin service. Padding results with something inapplicable is worse
    // than an empty state; the UI now handles "nothing applies" instead.
    const result = matchAll(PROGRAMS, outOfState);
    expect(ids(result.eligible)).not.toContain('wi-211');
    expect(ids(result.ruledOut)).toContain('wi-211');
  });

  it('can legitimately return nothing, rather than inventing a match', () => {
    const result = matchAll(PROGRAMS, { ...outOfState, annualHouseholdIncome: 250_000 });
    expect(result.eligible).toHaveLength(0);
    expect(result.maybe).toHaveLength(0);
    expect(result.ruledOut).toHaveLength(PROGRAMS.length);
  });

  it('rules out income-tested programs for a high earner but keeps the pantries', () => {
    const result = matchAll(PROGRAMS, { ...madisonFamily, annualHouseholdIncome: 250_000 });
    expect(ids(result.ruledOut)).toContain('foodshare-snap-wi');

    // Nobody should ever reach the end with an empty results page. The River
    // Food Pantry is county-scoped only in `eligibility` -- it is not
    // income-gated by this engine. (In practice The River does ask people to
    // self-attest to a TEFAP income guideline for groceries, a generous 200%
    // FPL that is not verified at intake; that is documented in
    // `eligibilityCaveats`, deliberately not encoded as a rule here, so a
    // high earner is never wrongly told they don't qualify for community
    // meals or other services that are not TEFAP-gated.)
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
