import {
  allOf,
  atLeast,
  incomeAtOrBelow,
  livesIn,
  manualReview,
  type Criterion,
} from '../../../src/domain/criteria.ts';

/**
 * Supplementary evaluation set for the framing re-approach (issue #62).
 *
 * ## This is NOT the frozen held-out set
 *
 * `scripts/llm-extraction/eval-cases.ts` (27 held-out + 14 tuning) stays frozen
 * and is the primary instrument. Do not modify it, do not tune against it.
 *
 * This file is a small, separate probe built for the three framing hypotheses in
 * #62 -- classify-before-extracting (H1), structure-preserving excerpts (H3), and
 * verification by counterexample (H2). The frozen set has only two table cases
 * and its trap classes (cost-sharing tier, column-header scope, negation) each
 * appear once; that is enough to *detect* a failure but not to iterate a fix
 * against without burning held-out cases. These six give each hypothesis a
 * near-twin trap/control pair drawn from programs the frozen set does not touch
 * (MAPP, Katie Beckett, Wisconsin Well Woman), so a prototype can be developed
 * here and then measured once against the real held-out split.
 *
 * ## Every excerpt is real fetched text
 *
 * Fetched from `citationUrl` on `fetchedOn` with a desktop-Chrome user agent.
 * Typographic punctuation normalised to ASCII; bulleted requirement lists joined
 * into running text with the list stem kept; "..." marks a join between two
 * verbatim spans. No wording invented or paraphrased -- same rule as the frozen
 * set and the shipped dataset (docs/brief.md).
 *
 * Frozen 2026-09-06. If a hypothesis needs more cases, add dated ones here; do
 * not edit these once a measurement has been reported against them.
 *
 * ## Scoring
 *
 * Same four numbers as the main harness, never blended: correct abstentions /
 * dangerous over-claims / correct extractions / gate failures. `expected:
 * 'abstain'` traps carry a real, extractable-*looking* number whose true role is
 * not "eligibility income ceiling" -- the #62 failure pattern. `expected:
 * 'extract'` controls carry a genuine unconditional ceiling next to a qualifier
 * that looks scope-changing but is not, so the cost of an over-cautious pipeline
 * is measurable (the failure mode #61's option-2 fix hit).
 */

export type FramingExpectation = 'extract' | 'abstain';

export interface FramingEvalCase {
  readonly id: string;
  /** Which #62 failure class this probes. */
  readonly probes:
    | 'cost-sharing-tier'
    | 'column-header-scope'
    | 'negation-and-composition'
    | 'categorical-not-expressible'
    | 'clean-ceiling-control';
  readonly citationName: string;
  readonly citationUrl: string;
  readonly fetchedOn: string;
  readonly excerpt: string;
  /**
   * For H3 cases: the fixture under `fixtures/` whose real markup an excerpt
   * renderer (`structure-excerpt.ts`) operates on. `excerpt` above is the
   * prose-flattened rendering of the same fixture -- what the current pipeline
   * would feed the model.
   */
  readonly htmlFixture?: string;
  readonly expected: FramingExpectation;
  /** Present only when `expected === 'extract'`. Held to the same gate as model output. */
  readonly targetCriterion?: Criterion;
  readonly note: string;
}

export const FRAMING_EVAL_CASES: readonly FramingEvalCase[] = [
  // --- Traps: a real number whose role is not "eligibility ceiling" ---------
  {
    id: 'mapp-premium-threshold-not-eligibility',
    probes: 'cost-sharing-tier',
    citationName: 'Wisconsin DHS -- Medicaid Purchase Plan (MAPP), Monthly premiums',
    citationUrl: 'https://www.dhs.wisconsin.gov/medicaid/medicaid-purchase-plan.htm',
    fetchedOn: '2026-09-06',
    excerpt:
      'A premium is a set amount of money we are required by state law to charge each month for your MAPP benefits if your gross monthly income is over a certain amount. ... Your premium amount is determined by your gross monthly income. If your total gross monthly income is above 100% federal poverty level (FPL), you will have to pay a monthly premium to keep your MAPP benefits. Premiums are based only on your income before taxes and other deductions-not the income of other people in your household. If your gross monthly income is below 100% FPL, you will not have to pay a monthly premium.',
    expected: 'abstain',
    note:
      "Fresh analogue of seniorcare-coverage-levels-not-eligibility. The 100% FPL figure is a premium (cost-sharing) threshold, not an eligibility ceiling: MAPP's actual income limit is 250% FPL, stated elsewhere on the same page. A model that emits incomeAtOrBelow(fpl, 100) from this excerpt both misreads a cost-sharing boundary as eligibility and invents a ceiling 2.5x below the real one -- the worst-error direction. Correct answer: manualReview (this passage states no eligibility rule).",
  },
  {
    id: 'katie-beckett-parental-income-not-counted',
    probes: 'negation-and-composition',
    citationName: 'Wisconsin DHS -- Katie Beckett Medicaid: Eligibility',
    citationUrl: 'https://www.dhs.wisconsin.gov/kbp/eligibility.htm',
    fetchedOn: '2026-09-06',
    excerpt:
      'Katie Beckett Medicaid provides Wisconsin Medicaid coverage to children living in the community who have disabilities, chronic illness, or mental health needs to the point of meeting special eligibility requirements. Children can still qualify even if: Their parents have too much income or assets to qualify for other kinds of Medicaid. They are covered by private health insurance. ... To be eligible, a child must: Be under age 19. Meet the definition of "disabled" under the Social Security Act. Be a U.S. citizen or qualifying immigrant. Be a Wisconsin resident. ... Meet "functional level of care" eligibility, which means the child requires the kind of care typically provided by a hospital or long-term care facility. ... Not have income in their name that is more than the current income limit for those living in an institution.',
    expected: 'abstain',
    note:
      'Fresh analogue of cda-residency-not-required (negation) crossed with snap-cfr-elderly-separate-household (composition). The only income test is on the CHILD\'s own income against an unstated institutional limit; "parents have too much income or assets" is explicitly a non-barrier ("children can still qualify even if"). A model that builds incomeAtOrBelow on household income inverts the rule. "Functional level of care" is undecidable by any fact. Correct answer: manualReview.',
  },
  {
    id: 'wwm-feeder-enrollment-not-expressible',
    probes: 'categorical-not-expressible',
    citationName: 'Wisconsin DHS -- Wisconsin Well Woman Medicaid',
    citationUrl: 'https://www.dhs.wisconsin.gov/medicaid/well-woman-medicaid.htm',
    fetchedOn: '2026-09-06',
    excerpt:
      'You must be enrolled in one of the following programs before you can initially enroll in Wisconsin Well Woman Medicaid: Wisconsin Well Woman Program through local coordinating agencies. Family Planning Only Services. BadgerCare Plus. You must also meet all the following requirements: Live in Wisconsin and are either a U.S. citizen or qualifying immigrant. Are under age 65. ... Were screened for breast or cervical cancer through the Well Woman Program. Have one or more of the following diagnoses that requires treatment: Breast cancer. Cervical cancer. A condition that could lead to breast or cervical cancer. Can\'t get other health care coverage for breast or cervical cancer treatment. ... You can get temporary Medicaid, also called presumptive eligibility, if you\'re in the Well Woman Program.',
    expected: 'abstain',
    note:
      'A categorical-enrollment rule that looks expressible but is not: two of the three feeder programs ("Wisconsin Well Woman Program", "Family Planning Only Services") have no slug in currentBenefits, and the medical-necessity and "can\'t get other coverage" gates are undecidable. A model that emits a partial set/allOf on medicaid-badgercare alone drops the diagnosis requirement and both other feeders -- an over-claim. Correct answer: manualReview. Tests whether a classifier routes "categorical but un-encodable" away from the auto-extract path.',
  },

  // --- Controls: a genuine unconditional ceiling next to a scope-flavoured qualifier
  {
    id: 'mapp-eligibility-list-control',
    probes: 'clean-ceiling-control',
    citationName: 'Wisconsin DHS -- Medicaid Purchase Plan (MAPP), Who can get MAPP?',
    citationUrl: 'https://www.dhs.wisconsin.gov/medicaid/medicaid-purchase-plan.htm',
    fetchedOn: '2026-09-06',
    excerpt:
      'To qualify for MAPP, you must: Be at least 18 years old. Be a resident of Wisconsin. Be a U.S. citizen or qualifying immigrant. Be determined disabled by the Disability Determination Bureau. Have an adjusted family income of 250% of the federal poverty level (FPL) or less, based on your family size. Have individual assets of $15,000 or less. ... Meet the MAPP work requirement. Pay a monthly premium, if required.',
    expected: 'extract',
    targetCriterion: allOf(
      atLeast('age', 18),
      livesIn.wisconsin,
      incomeAtOrBelow('fpl', 250),
      manualReview(
        'MAPP also requires a disability determination by the Disability Determination Bureau, meeting the MAPP work requirement, and countable individual assets of $15,000 or less. The enrollment agency confirms these.',
      ),
    ),
    note:
      'Control for mapp-premium-threshold. "Have an adjusted family income of 250% of the FPL or less" is a genuine unconditional eligibility ceiling. "Pay a monthly premium, if required" sits in the same list but is not scope-changing. Correct: allOf(age>=18, livesIn WI, incomeAtOrBelow(fpl,250), manualReview[disability + work + $15k asset test]). A model that abstains because of the disability/work/asset gates is over-cautious -- the manualReview-leaf-inside-allOf pattern (madison-housing-choice-voucher.ts) is the right shape.',
  },
  {
    id: 'wwwp-income-ceiling-control',
    probes: 'clean-ceiling-control',
    citationName: 'Wisconsin DHS -- Wisconsin Well Woman Program, Who is eligible',
    citationUrl: 'https://www.dhs.wisconsin.gov/wwwp/index.htm',
    fetchedOn: '2026-09-06',
    excerpt:
      "You can enroll in the program if you Are a woman between ages 40 and 64. Don't have health insurance, or Have insurance that doesn't include routine check-ups and screenings. Aren't able to pay the deductible or co-payment. Live in Wisconsin Meet income requirements (at or below 250% of the federal poverty level). There are exceptions to the 40-64 age group if you are: 65 or older and not eligible for Medicare or if you can't afford Medicare Part B; 35-39, and receiving Medicaid Family Planning Only services, and you are referred to the WWWP after an abnormal breast exam or abnormal mammogram; 35-39, and not eligible for Medicaid Family Planning Only services and self-reports breast symptoms to the coordinating agency.",
    expected: 'extract',
    targetCriterion: allOf(
      livesIn.wisconsin,
      incomeAtOrBelow('fpl', 250),
      manualReview(
        'The Wisconsin Well Woman Program also requires being uninsured or underinsured for screening services, and is generally for ages 40-64 with several documented exceptions (35-39 or 65+). The coordinating agency confirms these.',
      ),
    ),
    note:
      'Control. "Meet income requirements (at or below 250% of the federal poverty level)" is an unconditional ceiling that applies across every age-exception branch. The multi-branch age-exception list looks scope-changing but does not touch the income limit. A model that abstains here because of the branching is over-cautious.',
  },

  // --- H3: same source, prose rendering vs structure-preserving rendering ---
  {
    id: 'wi-medicaid-fpl-chart-mapp-column',
    probes: 'column-header-scope',
    citationName: 'Wisconsin DHS -- Medicaid Purchase Plan (MAPP) income limit, from the ForwardHealth FPL chart',
    citationUrl: 'https://www.dhs.wisconsin.gov/medicaid/fpl.htm',
    fetchedOn: '2026-09-06',
    htmlFixture: 'wi-medicaid-fpl-chart.html',
    excerpt:
      'The following income levels are used to determine enrollment in Wisconsin\'s health care plans. Effective February 1, 2026-January 31, 2027 Family Size Annual 100% FPL 120% FPL 135% FPL 150% FPL 185% FPL 200% FPL 250% FPL 300% FPL 1 $15,960 $1,330.00 $1,596.00 $1,795.50 $1,995.00 $2,460.50 $2,660.00 $3,325.00 $3,990.00 4 $33,000 $2,750.00 $3,300.00 $3,712.50 $4,125.00 $5,087.50 $5,500.00 $6,875.00 $8,250.00 Each extra person $5,680 $473.33 $568.00 $639.00 $710.00 $875.66 $946.66 $1,183.33 $1,419.99 Program limits N/A QMB MAPP Premium Threshold SLMB SLMB+ N/A N/A QDWI and Lower MAPP N/A These amounts are based on federal guidelines, which may change each year.',
    expected: 'extract',
    targetCriterion: incomeAtOrBelow('fpl', 250),
    note:
      'Fresh structural analogue of badgercare-plus-population-columns. In the source HTML the "Program limits" row aligns each program under a percent-of-FPL column header: MAPP under "250% FPL", "MAPP Premium Threshold" under "100% FPL". The `excerpt` above is the prose-flattened rendering the current pipeline produces -- the column alignment is gone and "MAPP" appears twice with no anchor. Run this case with --excerpt=prose (expect the model to grab 100%, a dollar figure, or abstain) vs --excerpt=structured (expect it to recover MAPP -> 250% FPL). The narrower rule incomeAtOrBelow(fpl,250) is the target; MAPP also requires disability + employment, so a real record needs a manualReview leaf, but this case is scored on whether the *percent* is recovered from structure.',
  },
  {
    id: 'badgercare-plus-fpl-table-columns',
    probes: 'column-header-scope',
    citationName: 'Wisconsin DHS -- BadgerCare Plus income limits (income table)',
    citationUrl: 'https://www.dhs.wisconsin.gov/badgercareplus/fpl.htm',
    fetchedOn: '2026-09-06',
    htmlFixture: 'wi-badgercare-plus-fpl-chart.html',
    excerpt:
      'BadgerCare Plus income limits and thresholds, effective February 1, 2026-January 31, 2027 Family size Adult monthly income limit (100% FPL) Children premium threshold (201% FPL) Pregnant people and children monthly income limit (306% FPL) 1 $1,330.00 $2,673.30 $4,069.80 4 $2,750.00 $5,527.50 $8,415.00 For each extra person, add $473.33 $951.39 $1,448.39',
    expected: 'abstain',
    note:
      "Re-fetch of the exact source table behind the frozen heldout case badgercare-plus-population-columns, added 2026-09-06 so H3 can be tested end to end on more than one table (the heldout case must not be run during tuning). Three FPL percentages, each scoped by a column header to a different population: 100% adults, 201% children premium, 306% pregnant people and children. There is no single eligibility ceiling to extract -- the correct answer is manualReview under both excerpt modes. The `excerpt` field is the prose flattening the current pipeline feeds the model; --excerpt=structured renders the same fixture as a Markdown table. The question this case answers: does structure preservation help the classifier route to scope-set-by-table-structure / raise a scope signal, rather than letting the extractor grab 306% (or 201%) and drop the population scope -- the badgercare failure class.",
  },
];

/** Cases whose `expected` is `abstain` -- the class that matters most (Section 4.4). */
export function framingAbstainCount(): number {
  return FRAMING_EVAL_CASES.filter((c) => c.expected === 'abstain').length;
}
