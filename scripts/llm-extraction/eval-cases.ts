import { hasAnyOf, incomeAtOrBelow, type Criterion } from '../../src/domain/criteria.ts';

/**
 * Evaluation set for the LLM extraction prototype (docs/eligibility-extraction.md).
 *
 * Every `excerpt` below is real text this spike actually fetched (see the
 * `citationUrl`) -- none of it is invented for the purpose of the eval, per
 * the contributor brief's "never invent data" rule, which this spike treats
 * as applying to its own evidence, not only to the shipped dataset.
 *
 * `expected: 'extract'` cases carry a `targetCriterion`: a HAND-AUTHORED
 * ground truth for what a correct extraction should produce, used only to
 * grade a model's output against. It is not itself a model output, and
 * schema-gate.test.ts asserts every one of these targets is schema-valid --
 * i.e. the ground truth the eval grades against is held to the same bar as
 * the thing being graded.
 *
 * `expected: 'abstain'` cases are the ones that matter most (see the doc's
 * "headline metric" section): a correct extraction here is `manualReview`,
 * possibly nested inside a larger `allOf`, never a confident specific rule.
 * They come directly from docs/data-sources.md's "does not fit" list
 * (SNAP's deduction stack, immigration-status exceptions, work-requirement
 * exemptions, funding-contingent language).
 */

export interface EvalCase {
  readonly id: string;
  readonly citationName: string;
  readonly citationUrl: string;
  readonly excerpt: string;
  readonly expected: 'extract' | 'abstain';
  /** Only present when `expected === 'extract'`. */
  readonly targetCriterion?: Criterion;
  readonly note: string;
}

export const EVAL_CASES: readonly EvalCase[] = [
  // --- Should extract -----------------------------------------------------
  {
    id: 'madcap-categorical',
    citationName: 'City of Madison -- MadCAP',
    citationUrl: 'https://www.cityofmadison.com/pay/madcap',
    excerpt:
      "If you qualify for FoodShare, Section 8, SNAP, or the Women, Infants, and Children (WIC) program, you meet MadCAP's income requirements.",
    expected: 'extract',
    targetCriterion: hasAnyOf('currentBenefits', ['snap-foodshare', 'wic', 'housing-choice-voucher']),
    note:
      'Tests terminology mapping, not just pattern-matching: "Section 8" must map to our canonical `housing-choice-voucher`, and "FoodShare"/"SNAP" (listed separately in the source, as WI-specific and federal names for the same program) must collapse to one value, `snap-foodshare`, not two.',
  },
  {
    id: 'madcap-ami',
    citationName: 'City of Madison -- MadCAP',
    citationUrl: 'https://www.cityofmadison.com/pay/madcap',
    excerpt:
      'Households whose total gross income is the same or less than 50% of area median income (AMI) are eligible. AMI is determined by US Housing and Urban Development (HUD).',
    expected: 'extract',
    targetCriterion: incomeAtOrBelow('dane-ami', 50),
    note: 'Straightforward percent-of-AMI statement; an easy positive control alongside the harder cases.',
  },
  {
    id: 'lifeline-fpl',
    citationName: 'Lifeline -- How to Qualify',
    citationUrl: 'http://www.lifelinesupport.org/how-to-qualify/',
    excerpt: 'You can get Lifeline if your income is at 135% or less than the 2026 Federal Poverty Guidelines.',
    expected: 'extract',
    targetCriterion: incomeAtOrBelow('fpl', 135),
    note: 'Plain percent-of-FPL statement, the most common Tier-2 pattern found in this spike\'s corpus.',
  },
  {
    id: 'wheap-smi',
    citationName: 'WHEAP -- Energy Assistance income limits',
    citationUrl: 'https://energyandhousing.wi.gov/Pages/AgencyResources/energy-assistance.aspx',
    excerpt:
      'Households with income at or below the amounts shown may qualify during the 2025-2026 program year (October 1, 2025 - September 30, 2026). Based on 60% of Wisconsin\'s median income.',
    expected: 'extract',
    // The cited income table IS the 60%-of-SMI figure already (see
    // src/data/reference/income-tables.ts, WI_SMI_60_2025), so the rule is
    // "at or below 100% of that table" -- matching the convention the
    // existing wheap-energy-assistance.ts and wheap-crisis-assistance.ts
    // records already use (`incomeAtOrBelow('wi-smi', 100)`). A model that
    // instead emitted `incomeAtOrBelow('wi-smi', 60)` would be double-
    // applying the 60% and understating who qualifies -- a plausible and
    // dangerous near-miss, not a wild guess, which is exactly why this case
    // is included rather than a more obviously "easy" one.
    targetCriterion: incomeAtOrBelow('wi-smi', 100),
    note:
      'Tests whether the model understands the scale it is comparing against is already a derived (60%-of-SMI) table, not raw SMI -- confusing the two silently understates eligibility, which is the worst-error direction this project cares most about.',
  },

  // --- Should abstain (manualReview) --------------------------------------
  {
    id: 'snap-shelter-deduction',
    citationName: '7 CFR 273.9(d)(2)(ii) -- SNAP excess shelter deduction',
    citationUrl: 'https://www.ecfr.gov/current/title-7/subtitle-B/chapter-II/subchapter-C/part-273',
    excerpt:
      'Excess shelter deduction. Monthly shelter expenses in excess of 50 percent of the household\'s income after all other deductions ... have been allowed. If the household does not contain an elderly or disabled member ... the shelter deduction cannot exceed the maximum shelter deduction limit established for the area. For fiscal year 2001, effective March 1, 2001, the maximum monthly excess shelter expense deduction limits are $340 for the 48 contiguous States and the District of Columbia ... FNS will set the maximum monthly excess shelter expense deduction limits for fiscal year 2002 and future years by adjusting the previous year\'s limits.',
    expected: 'abstain',
    note:
      'Multi-step deduction stack (this spike\'s single hardest real example): the dollar figure literally printed in the current regulation text is from fiscal year 2001 and is superseded every year by an FNS notice the regulation text itself does not contain. A extractor that hard-codes "$340" -- deterministic or LLM -- would be citing a 25-year-stale number with total confidence. Matches docs/data-sources.md\'s "does not fit" list.',
  },
  {
    id: 'snap-alien-status',
    citationName: '7 CFR 273 -- SNAP alien/citizenship eligibility',
    citationUrl: 'https://www.ecfr.gov/current/title-7/subtitle-B/chapter-II/subchapter-C/part-273',
    excerpt:
      'As provided in § 273.4, the following information may also be relevant to the eligibility of some aliens: date of admission or date status was granted; military connection; battered status; if the alien was lawfully residing in the United States on August 22, 1996; membership in certain Indian tribes; if the person was age 65 or older...',
    expected: 'abstain',
    note:
      'Confirms facts.ts\'s own existing decision to leave `citizenshipStatus` unasked in v1 ("children frequently qualify when adults do not... getting it wrong risks the worst failure mode"). A five-factor eligibility test with a hard 1996 cutoff date is not a `compare`/`set` node.',
  },
  {
    id: 'snap-abawd',
    citationName: '7 CFR 273 -- SNAP work-requirement time limit (ABAWD)',
    citationUrl: 'https://www.ecfr.gov/current/title-7/subtitle-B/chapter-II/subchapter-C/part-273',
    excerpt: 'Persons ineligible under § 273.24, the time limit for able-bodied adults.',
    expected: 'abstain',
    note:
      'A one-line cross-reference to an entire other section\'s exemption tree (age, disability, parenting, geographic waivers). Tests whether the model resists "there\'s only one sentence here, I can encode one sentence" reasoning when the sentence itself is a pointer to real complexity elsewhere.',
  },
  {
    id: 'trc-funding-contingent',
    citationName: 'Tenant Resource Center -- eviction prevention screening',
    citationUrl: 'https://www.tenantresourcecenter.org/',
    excerpt:
      "This screening is not an application for financial assistance; there is no guarantee we'll be able to match you to a funding source.",
    expected: 'abstain',
    note:
      'A source that explicitly declines to state a rule at all (Tier 4, not Tier 3 -- see the doc). The correct output is not a low-confidence guess at a threshold; it is recognizing no threshold is published here.',
  },
  {
    id: 'trc-no-published-ami',
    citationName: 'Tenant Resource Center -- eviction prevention screening',
    citationUrl: 'https://www.tenantresourcecenter.org/',
    excerpt:
      "This screening is not an application for financial assistance; there is no guarantee we'll be able to match you to a funding source.",
    expected: 'abstain',
    note:
      'The same homepage excerpt as trc-funding-contingent, included as its own case for a specific reason: the seed dataset\'s dane-eviction-prevention.ts currently encodes `incomeAtOrBelow(\'dane-ami\', 80)` as this program\'s eligibility, and that figure does not appear anywhere on this page. A prompt that resists inventing a plausible-sounding AMI percentage when the source does not state one would have caught, not caused, the issue flagged to the #2 agent in this spike\'s findings. This is the single most direct test of the "under-claiming beats over-claiming" principle in the whole eval set.',
  },
];

/** Sanity constant used by the harness test: how many cases should abstain. */
export const EXPECTED_ABSTENTION_COUNT = EVAL_CASES.filter((c) => c.expected === 'abstain').length;
