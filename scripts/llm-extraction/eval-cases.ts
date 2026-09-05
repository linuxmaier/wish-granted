import {
  allOf,
  anyOf,
  hasAnyOf,
  incomeAtOrBelow,
  isTrue,
  manualReview,
  type Criterion,
} from '../../src/domain/criteria.ts';

/**
 * Evaluation set for the LLM extraction prototype (docs/eligibility-extraction.md
 * Section 4, issue #43).
 *
 * ## Every excerpt is real fetched text
 *
 * Each `excerpt` below is verbatim text fetched from the `citationUrl` on the
 * date in `fetchedOn`, using a desktop-Chrome user agent (per Section 1: WI
 * state and some nonprofit sites 403 a naive fetcher's default UA). Typographic
 * punctuation is normalised to ASCII (curly quotes -> straight, en/em dashes ->
 * hyphens) to match the existing dataset's convention and keep the file
 * diff-clean; "..." marks a join between two non-adjacent verbatim spans, as the
 * original nine cases do. No wording is invented, paraphrased, or reordered.
 * This is the same "never invent data" rule the contributor brief
 * (docs/brief.md) applies to the shipped dataset.
 *
 * ## The held-out split (the whole point of #43)
 *
 * `split: 'tuning'` cases are fair game for prompt iteration. `split: 'heldout'`
 * cases were fetched and frozen BEFORE the enum-slug prompt fix (Section 4.6)
 * was written, and must never be looked at while tuning: "tuning the prompt
 * against a nine-case set and then re-reporting the same set would be measuring
 * the tuning, not the model" (Section 4.4). The nine original cases (#5 / #23)
 * are all `tuning` -- they were the set the enum fix was designed against.
 *
 * The held-out split is weighted toward Tier 3 (prose requiring real reading
 * comprehension -- Section 2), which is where extraction is genuinely hard.
 *
 * ## Scoring
 *
 * `expected: 'abstain'` is the case class that matters most (Section 4.4's
 * headline metric). A correct answer there is `manualReview` at the top level.
 * A specific rule where the source does not state one is a *dangerous
 * over-claim* -- a wrong threshold reaching a person in financial crisis as a
 * stated fact.
 *
 * `expected: 'extract'` cases carry a HAND-AUTHORED `targetCriterion` -- ground
 * truth for what a correct extraction looks like, held to the same schema gate
 * a model output faces (llm-extraction-eval.test.ts asserts this). A
 * `manualReview` leaf nested inside a larger `allOf` (e.g. `wishares-income-and-
 * activity`) is a correct, expected shape -- see madison-housing-choice-voucher.ts.
 */

export type EvalSplit = 'tuning' | 'heldout';

/** Corpus tier per docs/eligibility-extraction.md Section 2. */
export type CorpusTier = 1 | 2 | 3 | 4;

export interface EvalCase {
  readonly id: string;
  readonly split: EvalSplit;
  readonly tier: CorpusTier;
  readonly citationName: string;
  readonly citationUrl: string;
  readonly fetchedOn: string;
  readonly excerpt: string;
  readonly expected: 'extract' | 'abstain';
  /** Only present when `expected === 'extract'`. */
  readonly targetCriterion?: Criterion;
  readonly note: string;
}

export const EVAL_CASES: readonly EvalCase[] = [
  // =====================================================================
  // TUNING SPLIT
  // The nine original cases (#5 / #23) plus five added in #43. The
  // enum-slug prompt fix (Section 4.6) was designed against this split.
  // =====================================================================

  // --- Should extract --------------------------------------------------
  {
    id: 'madcap-categorical',
    split: 'tuning',
    tier: 2,
    citationName: 'City of Madison -- MadCAP',
    citationUrl: 'https://www.cityofmadison.com/pay/madcap',
    fetchedOn: '2026-09-05',
    excerpt:
      "If you qualify for FoodShare, Section 8, SNAP, or the Women, Infants, and Children (WIC) program, you meet MadCAP's income requirements.",
    expected: 'extract',
    targetCriterion: hasAnyOf('currentBenefits', ['snap-foodshare', 'wic', 'housing-choice-voucher']),
    note:
      'The original gate failure (#23): the model emitted "FoodShare"/"Section 8"/"SNAP"/"WIC" where currentBenefits declares slugs. Tests terminology mapping -- "Section 8" -> housing-choice-voucher, and "FoodShare"/"SNAP" collapse to one value, not two.',
  },
  {
    id: 'madcap-ami',
    split: 'tuning',
    tier: 2,
    citationName: 'City of Madison -- MadCAP',
    citationUrl: 'https://www.cityofmadison.com/pay/madcap',
    fetchedOn: '2026-09-05',
    excerpt:
      'Households whose total gross income is the same or less than 50% of area median income (AMI) are eligible. AMI is determined by US Housing and Urban Development (HUD).',
    expected: 'extract',
    targetCriterion: incomeAtOrBelow('dane-ami', 50),
    note: 'Straightforward percent-of-AMI statement; an easy positive control alongside the harder cases.',
  },
  {
    id: 'lifeline-fpl',
    split: 'tuning',
    tier: 2,
    citationName: 'Lifeline -- How to Qualify',
    citationUrl: 'https://www.lifelinesupport.org/do-i-qualify/',
    fetchedOn: '2026-09-05',
    excerpt:
      'You can get Lifeline if your income is at 135% or less than the 2026 Federal Poverty Guidelines. The guideline is based on your household size and state.',
    expected: 'extract',
    targetCriterion: incomeAtOrBelow('fpl', 135),
    note: "Plain percent-of-FPL statement, the most common Tier-2 pattern in this corpus.",
  },
  {
    id: 'wheap-smi',
    split: 'tuning',
    tier: 3,
    citationName: 'WHEAP -- Energy Assistance income limits',
    citationUrl: 'https://energyandhousing.wi.gov/Pages/AgencyResources/energy-assistance.aspx',
    fetchedOn: '2026-09-05',
    excerpt:
      "Households with income at or below the amounts shown may qualify during the 2025-2026 program year (October 1, 2025 - September 30, 2026). Based on 60% of Wisconsin's median income.",
    expected: 'extract',
    // The cited income table IS the 60%-of-SMI figure already (WI_SMI_60,
    // verified by #3), so the rule is "at or below 100% of that table",
    // matching wheap-energy-assistance.ts. A model that emits
    // incomeAtOrBelow('wi-smi', 60) double-applies the 60% and silently
    // understates who qualifies -- the worst-error direction.
    targetCriterion: incomeAtOrBelow('wi-smi', 100),
    note:
      'Near-miss trap: the scale being compared against is already a derived (60%-of-SMI) table, not raw SMI. Confusing the two understates eligibility.',
  },
  {
    id: 'lifeline-categorical',
    split: 'tuning',
    tier: 2,
    citationName: 'Lifeline -- How to Qualify',
    citationUrl: 'https://www.lifelinesupport.org/do-i-qualify/',
    fetchedOn: '2026-09-05',
    excerpt:
      'You can get Lifeline if you (or someone in your household) participate in one of these programs: Medicaid; Supplemental Nutrition Assistance Program (SNAP), formerly known as Food Stamps; Supplemental Security Income (SSI); Federal Public Housing Assistance (FPHA); Housing Choice Voucher (HCV) Program (Section 8 Vouchers); Project-based Rental Assistance (PBRA)/2020/811; Public Housing; Affordable Housing Programs for American Indians, Alaska Natives, or Native Hawaiians; Veterans Pension and Survivors Benefit.',
    expected: 'extract',
    targetCriterion: hasAnyOf('currentBenefits', [
      'medicaid-badgercare',
      'snap-foodshare',
      'ssi',
      'federal-public-housing',
      'housing-choice-voucher',
    ]),
    note:
      'Enum-slug case, added for #43 tuning: nine program names, only five of which have a declared currentBenefits slug. The model must map the five it can (Medicaid -> medicaid-badgercare, SNAP -> snap-foodshare, FPHA -> federal-public-housing, Section 8 -> housing-choice-voucher, SSI -> ssi) and NOT invent slugs for PBRA, Public Housing, the Native housing programs, or the Veterans pension.',
  },
  {
    id: 'foodshare-gross-income-test',
    split: 'tuning',
    tier: 3,
    citationName: 'FoodShare Wisconsin -- Your Income Could Make You Eligible',
    citationUrl: 'https://www.dhs.wisconsin.gov/foodshare/fpl.htm',
    fetchedOn: '2026-09-05',
    excerpt:
      "See if your family's gross monthly income is at or below 200% of the federal poverty level (FPL). If it is, your family passes the Gross Income Test. You'll earn certain credits to be subtracted from your gross income. ... Contact your agency if your family's monthly gross income goes above 130% FPL after you enroll in FoodShare.",
    expected: 'extract',
    targetCriterion: incomeAtOrBelow('fpl', 200),
    note:
      'Trap: two percentages in one excerpt. 200% FPL is the gross-income eligibility test (WI broad-based categorical eligibility, matching foodshare-snap-wi.ts). 130% FPL is a post-enrolment reporting threshold, not an eligibility bar. A model that emits incomeAtOrBelow(fpl, 130) understates who qualifies.',
  },

  // --- Should abstain -------------------------------------------------
  {
    id: 'snap-shelter-deduction',
    split: 'tuning',
    tier: 3,
    citationName: '7 CFR 273.9(d)(2)(ii) -- SNAP excess shelter deduction',
    citationUrl: 'https://www.ecfr.gov/current/title-7/subtitle-B/chapter-II/subchapter-C/part-273',
    fetchedOn: '2026-09-05',
    excerpt:
      "Excess shelter deduction. Monthly shelter expenses in excess of 50 percent of the household's income after all other deductions in paragraphs (d)(1) through (d)(5) of this section have been allowed. If the household does not contain an elderly or disabled member, as defined in § 271.2 of this chapter, the shelter deduction cannot exceed the maximum shelter deduction limit established for the area. For fiscal year 2001, effective March 1, 2001, the maximum monthly excess shelter expense deduction limits are $340 for the 48 contiguous States and the District of Columbia, $543 for Alaska, $458 for Hawaii, $399 for Guam, and $268 for the Virgin Islands. FNS will set the maximum monthly excess shelter expense deduction limits for fiscal year 2002 and future years by adjusting the previous year's limits.",
    expected: 'abstain',
    note:
      "This spike's single hardest real example: a multi-step deduction stack whose one printed dollar figure is from fiscal year 2001, superseded every year by an FNS notice the regulation text does not contain. Hard-coding $340 cites a 25-year-stale number with total confidence.",
  },
  {
    id: 'snap-alien-status',
    split: 'tuning',
    tier: 3,
    citationName: '7 CFR 273.2(f)(1)(ii) -- SNAP alien eligibility verification',
    citationUrl: 'https://www.ecfr.gov/current/title-7/subtitle-B/chapter-II/subchapter-C/part-273',
    fetchedOn: '2026-09-05',
    excerpt:
      'As provided in § 273.4, the following information may also be relevant to the eligibility of some aliens: date of admission or date status was granted; military connection; battered status; if the alien was lawfully residing in the United States on August 22, 1996; membership in certain Indian tribes; if the person was age 65 or older on August 22, 1996; if a lawful permanent resident can be credited with 40 qualifying quarters of covered work and if any Federal means-tested public benefits were received in any quarter after December 31, 1996; or if the alien was a member of certain Hmong or Highland Laotian tribes during a certain period of time or is the spouse or unmarried dependent of such a person.',
    expected: 'abstain',
    note:
      "Confirms facts.ts's own decision to leave citizenshipStatus unasked in v1. A multi-factor test with hard historical cutoff dates is not a compare/set node.",
  },
  {
    id: 'snap-abawd',
    split: 'tuning',
    tier: 3,
    citationName: '7 CFR 273.2(f)(1)(i) -- SNAP work-requirement time limit (ABAWD)',
    citationUrl: 'https://www.ecfr.gov/current/title-7/subtitle-B/chapter-II/subchapter-C/part-273',
    fetchedOn: '2026-09-05',
    excerpt: 'Persons ineligible under § 273.24, the time limit for able-bodied adults.',
    expected: 'abstain',
    note:
      'A one-line cross-reference to an entire other section\'s exemption tree. Tests whether the model resists "there is only one sentence here, I can encode one sentence" reasoning when the sentence is a pointer to real complexity elsewhere.',
  },
  {
    id: 'trc-funding-contingent',
    split: 'tuning',
    tier: 4,
    citationName: 'Tenant Resource Center -- eviction prevention screening',
    citationUrl: 'https://www.tenantresourcecenter.org/',
    fetchedOn: '2026-09-05',
    excerpt:
      "This screening is not an application for financial assistance; there is no guarantee we'll be able to match you to a funding source.",
    expected: 'abstain',
    note:
      'A source that explicitly declines to state a rule at all (Tier 4). The correct output is recognizing no threshold is published here, not a low-confidence guess.',
  },
  {
    id: 'trc-no-published-ami',
    split: 'tuning',
    tier: 4,
    citationName: 'Tenant Resource Center -- eviction prevention screening',
    citationUrl: 'https://www.tenantresourcecenter.org/',
    fetchedOn: '2026-09-05',
    excerpt:
      "You can fill out an eviction prevention screening here. This screening tool is designed to give Dane County renters a faster way to see what forms of assistance they may be eligible for and start the application process sooner. Please Note: This screening is not an application for financial assistance; there is no guarantee we'll be able to match you to a funding source.",
    expected: 'abstain',
    note:
      "dane-eviction-prevention.ts currently encodes incomeAtOrBelow('dane-ami', 80), and that figure appears nowhere on this page. A prompt that resists inventing a plausible AMI percentage would have caught, not caused, the issue flagged to the #2 agent. The most direct test of \"under-claiming beats over-claiming\" in the set.",
  },
  {
    id: 'snap-cfr-dual-income-standard',
    split: 'tuning',
    tier: 3,
    citationName: '7 CFR 273.9(a) -- SNAP income eligibility standards',
    citationUrl: 'https://www.ecfr.gov/current/title-7/subtitle-B/chapter-II/subchapter-C/part-273',
    fetchedOn: '2026-09-05',
    excerpt:
      'Income eligibility standards. Households which contain an elderly or disabled member shall meet the net income eligibility standards for SNAP. Households which do not contain an elderly or disabled member shall meet both the net income eligibility standards and the gross income eligibility standards for SNAP. Households which are categorically eligible as defined in § 273.2(j)(2) or 273.2(j)(4) do not have to meet either the gross or net income eligibility standards. ... 130 percent of the annual income poverty guidelines shall be divided by 12 to determine the monthly gross income standards. ... The annual income poverty guidelines shall be divided by 12 to determine the monthly net income eligibility standards.',
    expected: 'abstain',
    note:
      'The gross test (130% FPL) is expressible, but the excerpt requires BOTH the gross and net tests for non-elderly/disabled households, and the net test depends on the deduction stack we have no facts for. Emitting only incomeAtOrBelow(fpl, 130) would tell someone who passes gross but fails net that they qualify on income -- an over-claim. Abstain, or extract only with an explicit manualReview leaf for the net test.',
  },
  {
    id: 'snap-expedited-service-threshold',
    split: 'tuning',
    tier: 3,
    citationName: '7 CFR 273.2(i)(1) -- SNAP expedited service',
    citationUrl: 'https://www.ecfr.gov/current/title-7/subtitle-B/chapter-II/subchapter-C/part-273',
    fetchedOn: '2026-09-05',
    excerpt:
      'Households with less than $150 in monthly gross income, as computed in § 273.10 provided their liquid resources (i.e., cash on hand, checking or savings accounts, savings certificates, and lump sum payments as specified in § 273.9(c)(8)) do not exceed $100 ... Households whose combined monthly gross income and liquid resources are less than the household\'s monthly rent or mortgage, and utilities.',
    expected: 'abstain',
    note:
      'A hard $150 / $100 threshold that looks eminently extractable -- and is not an eligibility rule at all. It is the trigger for *expedited processing* (a 7-day rather than 30-day decision) for households that are otherwise eligible. Tests whether the model checks what the number actually governs.',
  },
  {
    id: 'cda-section8-income-table',
    split: 'tuning',
    tier: 3,
    citationName: 'City of Madison CDA -- Housing eligibility',
    citationUrl: 'https://www.cityofmadison.com/dpced/housing/applicants',
    fetchedOn: '2026-09-05',
    excerpt:
      'To qualify, your household income needs to be at or less than these federal income limits: Household Size / Public Housing / Section 8. 1 $74,800 $47,400 ... 4 $106,800 $67,650 ... 8 $141,000 $89,300.',
    expected: 'abstain',
    note:
      'A raw dollar table with no percentage and no named scale. incomeAtOrBelow needs a scale (fpl/wi-smi/dane-ami) and a percent; a bare dollar figure per household size cannot be expressed as a Criterion without inventing a scale. A model emitting compare(annualHouseholdIncome, lte, 67650) would drop the household-size dimension entirely.',
  },

  // =====================================================================
  // HELD-OUT SPLIT
  // Fetched and frozen 2026-09-05, before the enum-slug fix was written.
  // Never inspected during prompt tuning. Weighted toward Tier 3.
  // =====================================================================

  // --- Should extract --------------------------------------------------
  {
    id: 'wic-adjunctive-eligibility',
    split: 'heldout',
    tier: 2,
    citationName: 'Wisconsin WIC -- Income guidelines',
    citationUrl: 'https://www.dhs.wisconsin.gov/wic/income-guidelines.htm',
    fetchedOn: '2026-09-05',
    excerpt:
      'You may be able to get WIC benefits if you already use one of these programs: BadgerCare Plus; Food Distribution Program on Indian Reservations (FDPIR); FoodShare; Foster care and Kinship Care; Medicaid; Temporary Assistance to Needy Families (TANF); Wisconsin Works Program (W-2).',
    expected: 'extract',
    targetCriterion: hasAnyOf('currentBenefits', ['medicaid-badgercare', 'snap-foodshare', 'w2-tanf']),
    note:
      'Held-out enum-slug case (demonstrates the Section 4.6 fix). "BadgerCare Plus" and "Medicaid" both map to medicaid-badgercare; "TANF" and "Wisconsin Works Program (W-2)" both map to w2-tanf; "FoodShare" maps to snap-foodshare. FDPIR and foster care have no slug and must be dropped, not invented. Same failure class as madcap-categorical, on data the prompt was not tuned against.',
  },
  {
    id: 'wic-category-test',
    split: 'heldout',
    tier: 3,
    citationName: 'Wisconsin WIC -- Income guidelines',
    citationUrl: 'https://www.dhs.wisconsin.gov/wic/income-guidelines.htm',
    fetchedOn: '2026-09-05',
    excerpt:
      'Have one of these apply to you: You are pregnant now or had a baby in the past six months. You are providing your breastmilk to a WIC enrolled baby under 1 year of age. You care for a child younger than 5 years of age.',
    expected: 'extract',
    targetCriterion: anyOf(isTrue('isPregnantOrPostpartum'), isTrue('hasChildUnder5')),
    note:
      'A categorical (non-income) test. "Pregnant now or had a baby in the past six months" maps to isPregnantOrPostpartum; "care for a child younger than 5" maps to hasChildUnder5. The breastfeeding-a-WIC-baby branch has no fact and is dropped. Matches wic-wisconsin.ts.',
  },
  {
    id: 'schoolmeals-direct-certification',
    split: 'heldout',
    tier: 3,
    citationName: 'Wisconsin DPI -- Free and Reduced Meal Eligibility',
    citationUrl: 'https://dpi.wi.gov/school-nutrition/program-requirements/free-reduced-meal-eligibility',
    fetchedOn: '2026-09-05',
    excerpt:
      'DC electronically matches your student enrollment file to a state database (Division of Children and Families - DCF) of children in families enrolled in the following: FoodShare (SNAP), W-2 (TANF) cash benefits, Food Distribution Program on Indian Reservations (FDPIR), or the foster care system. Some Medicaid programs may apply.',
    expected: 'extract',
    targetCriterion: hasAnyOf('currentBenefits', ['snap-foodshare', 'w2-tanf']),
    note:
      'Held-out enum-slug case. "FoodShare (SNAP)" -> snap-foodshare, "W-2 (TANF) cash benefits" -> w2-tanf. FDPIR and foster care have no slug; "Some Medicaid programs may apply" is too hedged to encode. Matches school-meals-wi.ts.',
  },
  {
    id: 'wishares-income-and-activity',
    split: 'heldout',
    tier: 3,
    citationName: 'Wisconsin Shares -- Income eligibility',
    citationUrl: 'https://dcf.wisconsin.gov/wishares/parents',
    fetchedOn: '2026-09-05',
    excerpt:
      "To become eligible, your family's monthly gross income must not be more than 200% of the Federal Poverty Level (FPL). After you have been determined eligible, you can remain financially eligible until your income reaches 85% of the state median income (SMI). ... Wisconsin Shares helps eligible families with the cost of quality child care while parents, including foster parents and kinship caregivers, work, go to school and work, or engage in a job training activity.",
    expected: 'extract',
    targetCriterion: allOf(
      incomeAtOrBelow('fpl', 200),
      manualReview(
        'Wisconsin Shares requires a parent or caregiver to be working, in school, or in an approved job-training activity. Contact your local agency to confirm your activity qualifies.',
      ),
    ),
    note:
      'Exercises the manualReview-leaf-inside-allOf pattern (madison-housing-choice-voucher.ts) AND a near-miss trap: 200% FPL is the entry test; 85% SMI is only the higher threshold to *remain* eligible after enrolling. A model that emits incomeAtOrBelow(wi-smi, 85) picks the wrong number, and one that omits the work-activity leaf over-claims. Matches wisconsin-shares-child-care.ts.',
  },

  // --- Should abstain -------------------------------------------------
  {
    id: 'wic-income-limits-unstated',
    split: 'heldout',
    tier: 3,
    citationName: 'Wisconsin WIC -- Income guidelines',
    citationUrl: 'https://www.dhs.wisconsin.gov/wic/income-guidelines.htm',
    fetchedOn: '2026-09-05',
    excerpt:
      'Many working families are part of WIC. There are limits on how much money WIC families can make based on: Family Size - How many adults live with you? They can be relatives but do not have to be. Gross Household Income - How much money do you make before taxes or deductions? This includes any money you make.',
    expected: 'abstain',
    note:
      'States plainly that an income limit exists and what it depends on -- and never gives the number or percentage. The WIC income limit is 185% FPL (see wic-wisconsin.ts), but it is not on this page; emitting incomeAtOrBelow(fpl, 185) here would be filling in a remembered figure the source does not state.',
  },
  {
    id: 'sebt-income-based-automatic',
    split: 'heldout',
    tier: 3,
    citationName: 'Wisconsin DHS -- Summer EBT',
    citationUrl: 'https://www.dhs.wisconsin.gov/sebt/index.htm',
    fetchedOn: '2026-09-05',
    excerpt:
      'Summer Electronic Benefit Transfer (EBT) is an income-based program that helps families who qualify buy food for their children while school is out. ... We use information from various sources to determine who is eligible for Summer EBT so we can send their benefits automatically.',
    expected: 'abstain',
    note:
      '"Income-based" and "families who qualify" with no threshold, and an explicit statement that eligibility is determined from matched records, not a rule on this page. sun-bucks-wi.ts encodes 185% FPL plus categorical routes -- none of which appears here.',
  },
  {
    id: 'badgercare-apply-to-know',
    split: 'heldout',
    tier: 3,
    citationName: 'Wisconsin DHS -- BadgerCare Plus',
    citationUrl: 'https://www.dhs.wisconsin.gov/badgercareplus/index.htm',
    fetchedOn: '2026-09-05',
    excerpt:
      'BadgerCare Plus is full coverage Medicaid. It helps Wisconsinites age 0-64 who have low-income. Covered services include doctor visits, prescriptions, urgent and emergency care, lab tests, and more. The only way to know if you can enroll in BadgerCare Plus is to apply.',
    expected: 'abstain',
    note:
      'An age band (0-64) that looks encodable, but `age` is a reserved/unasked fact (facts.ts), "low-income" is unquantified, and the page itself says the only way to know is to apply. badgercare-plus.ts uses a 100%/306% FPL structure that is nowhere on this landing page.',
  },
  {
    id: 'foodshare-who-we-help',
    split: 'heldout',
    tier: 3,
    citationName: 'FoodShare Wisconsin -- A Recipe for Good Health',
    citationUrl: 'https://www.dhs.wisconsin.gov/foodshare/index.htm',
    fetchedOn: '2026-09-05',
    excerpt:
      'People all over Wisconsin get help from FoodShare. We help people of all ages who: Have low-income jobs. Live on a small or fixed income. Are retired. Have lost their jobs. Are disabled and cannot work.',
    expected: 'abstain',
    note:
      'Marketing prose describing who benefits, not an eligibility rule. "Retired", "lost their jobs", "disabled" are situations, not conditions this program tests. Tests whether the model can tell a description of a population from a decidable rule.',
  },
  {
    id: 'foodshare-public-charge',
    split: 'heldout',
    tier: 3,
    citationName: 'FoodShare Wisconsin -- Public charge rule',
    citationUrl: 'https://www.dhs.wisconsin.gov/foodshare/index.htm',
    fetchedOn: '2026-09-05',
    excerpt:
      "A noncitizen's immigration status will not be affected by receiving health care, food, housing, and many other government benefits. The only government benefits that could affect immigration status are cash assistance (SSI and W-2) and institutional long-term care paid for by Medicaid. Public benefits received by children and pregnant women will not impact their parents' or spouse's immigration status. This information provided is in accordance with 8 C.F.R. 103, 212, 213, and 245.",
    expected: 'abstain',
    note:
      'Immigration-policy prose with a cross-reference to four parts of 8 CFR. Not an eligibility rule for FoodShare at all; a model that pattern-matches on "SSI", "W-2", "Medicaid", "children", "pregnant" could emit something. The correct answer is that this paragraph decides nothing about who gets FoodShare.',
  },
  {
    id: 'foodshare-elderly-different-limits',
    split: 'heldout',
    tier: 3,
    citationName: 'FoodShare Wisconsin -- Your Income Could Make You Eligible',
    citationUrl: 'https://www.dhs.wisconsin.gov/foodshare/fpl.htm',
    fetchedOn: '2026-09-05',
    excerpt:
      'We can help you figure out if your family\'s gross monthly income is above or below the poverty line. There are different income limits for some people. For example, people who are at least 60 years, disabled, and not able to buy and prepare their own food.',
    expected: 'abstain',
    note:
      'Signals that a different, unstated income rule applies to elderly/disabled households (this is the uncapped-net-income path). No number, and the facts (age, disability) are unasked. Abstain -- do not guess the alternate limit.',
  },
  {
    id: 'snap-cfr-standard-deduction',
    split: 'heldout',
    tier: 3,
    citationName: '7 CFR 273.9(d)(1) -- SNAP standard deduction',
    citationUrl: 'https://www.ecfr.gov/current/title-7/subtitle-B/chapter-II/subchapter-C/part-273',
    fetchedOn: '2026-09-05',
    excerpt:
      'Standard deduction. Effective October 1, 2002, in the 48 States and the District of Columbia, Alaska, Hawaii, and the Virgin Islands, the standard deduction for household sizes one through six shall be equal to 8.31 percent of the monthly net income eligibility standard for each household size established under paragraph (a)(2) of this section rounded up to the nearest whole dollar. ... the standard deduction for FY 2009 for each household in the 48 States and the District of Columbia ... shall not be less than $144.',
    expected: 'abstain',
    note:
      'A precise percentage (8.31%) and dollar floor ($144) that describe how to compute a deduction inside the net-income test -- not an income eligibility threshold. Tests whether the model encodes numbers by what they govern, not just their presence.',
  },
  {
    id: 'snap-cfr-elderly-separate-household',
    split: 'heldout',
    tier: 3,
    citationName: '7 CFR 273.1(b)(2) -- SNAP separate household status',
    citationUrl: 'https://www.ecfr.gov/current/title-7/subtitle-B/chapter-II/subchapter-C/part-273',
    fetchedOn: '2026-09-05',
    excerpt:
      'Elderly and disabled persons. Notwithstanding the provisions of paragraph (a) of this section, an otherwise eligible member of a household who is 60 years of age or older and is unable to purchase and prepare meals because he or she suffers from a disability considered permanent under the Social Security Act ... may be considered, together with his or her spouse (if living there), a separate household from the others with whom the individual lives. Separate household status under this provision must not be granted when the income of the others with whom the elderly disabled individual resides ... exceeds 165 percent of the poverty line.',
    expected: 'abstain',
    note:
      'A clean "165 percent of the poverty line" figure that governs household *composition* (whether an elderly disabled person counts as their own household), not program eligibility. incomeAtOrBelow(fpl, 165) would be a confident, wrong extraction.',
  },
  {
    id: 'snap-cfr-abawd-exemption-tree',
    split: 'heldout',
    tier: 3,
    citationName: '7 CFR 273.7 -- SNAP ABAWD work rules and 3-month time limit',
    citationUrl: 'https://www.ecfr.gov/current/title-7/subtitle-B/chapter-II/subchapter-C/part-273',
    fetchedOn: '2026-09-05',
    excerpt:
      'FNS will allocate $20 million in Federal funds each fiscal year to State agencies that ensure availability of education, training, or workfare opportunities that permit ABAWDs to remain eligible beyond the 3-month time limit ... to each applicant and recipient who is: In the last month of the 3-month time limit described in § 273.24(b); Not eligible for an exception to the 3-month time limit under § 273.24(c); Not a resident of an area of the State granted a waiver of the 3-month time limit under § 273.24(f); and Not included in each State agency\'s 15 percent ABAWD exemption allotment under § 273.24(g).',
    expected: 'abstain',
    note:
      'The ABAWD 3-month limit with four interacting carve-outs (exception, geographic waiver, discretionary exemption, pledge funding). "3 months" is a number; the rule around it is an exemption tree with its own facts. Same shape problem as snap-abawd, spelled out in full.',
  },
  {
    id: 'foodshare-basic-work-rules',
    split: 'heldout',
    tier: 3,
    citationName: 'Wisconsin DHS -- FoodShare Basic Work Rules',
    citationUrl: 'https://www.dhs.wisconsin.gov/foodshare/basic-work-rules.htm',
    fetchedOn: '2026-09-05',
    excerpt:
      'Federal rules require FoodShare applicants and members who are ages 16 to 59 to follow FoodShare basic work rules. If you do not follow FoodShare basic work rules, and you do not have an exemption or a good cause reason, you will not be able to get FoodShare benefits for a period of time. This is called a sanction period. ... You do not have to follow basic work rules if: You are 16 or 17 years old and are not the head of a FoodShare household. You are in a school, training program, or college at least half-time. You are physically or mentally unable to work. You are participating in W-2. You are care for a child who is age 5 or younger who does not live with you. You care for another person who cannot care for themselves. You are getting or have applied for unemployment benefits. You are in an alcohol or other drug abuse (AODA) treatment or rehabilitation program.',
    expected: 'abstain',
    note:
      'An age band (16-59) plus an eight-branch exemption list, most branches referencing facts we do not ask (employment status, disability, AODA treatment). "Sanction for a period of time" is not the same as ineligible. Abstain.',
  },
  {
    id: 'weatherization-landing',
    split: 'heldout',
    tier: 3,
    citationName: 'WI DOA -- Weatherization Assistance Program',
    citationUrl: 'https://energyandhousing.wi.gov/Pages/AgencyResources/weatherization.aspx',
    fetchedOn: '2026-09-05',
    excerpt:
      'The federal Weatherization Assistance Program (WAP) was created in 1976 to assist low-income families who lacked resources to invest in energy efficiency. Funds are used to improve the energy efficiency of homes occupied by low-income households, using the most advanced technologies and testing protocols available in the housing industry.',
    expected: 'abstain',
    note:
      '"Low-income families" and "low-income households" twice, no threshold anywhere. The actual income rule (60% SMI, or automatic via WHEAP) lives in a PDF program manual this page only links to. Abstain rather than import the number from a sibling program.',
  },
  {
    id: 'wheap-commitment-to-community',
    split: 'heldout',
    tier: 3,
    citationName: 'WHEAP -- Public Benefits program',
    citationUrl: 'https://energyandhousing.wi.gov/Pages/AgencyResources/energy-assistance.aspx',
    fetchedOn: '2026-09-05',
    excerpt:
      'The law that established the PB program permits cooperative and municipal utilities to operate a Commitment to Community Program instead of participating in the state PB fund. Customers of utilities that choose to operate a Commitment to Community Program are not eligible for benefits from the state\'s PB programs (under energy assistance or Weatherization).',
    expected: 'abstain',
    note:
      'A real exclusion -- but it turns on whether the applicant\'s specific electric utility opted out of the state fund, which no fact in facts.ts captures. A not() rule here would be undecidable for every real user. Abstain.',
  },
  {
    id: 'lifeline-survivor-extended',
    split: 'heldout',
    tier: 3,
    citationName: 'Lifeline -- Survivor of Domestic Violence, Human Trafficking, or Related Crimes',
    citationUrl: 'https://www.lifelinesupport.org/do-i-qualify/',
    fetchedOn: '2026-09-05',
    excerpt:
      'If you are a survivor, you can participate in the Lifeline program if you provide proof of an attempted line separation request and if you are experiencing financial hardship. Survivors may qualify through existing Lifeline program requirements mentioned above or through the extended eligibility criteria: If your household income is at or below 200% of the Federal Poverty Guidelines; Enrollment in the Special Supplemental Nutrition Program for Women, Infants, and Children (WIC); Enrollment in the Free and Reduced-Price School Lunch or Breakfast program; Received a Federal Pell Grant in the current award year.',
    expected: 'abstain',
    note:
      'Contains an extractable-looking 200% FPL clause, but it is gated on survivor status, "proof of an attempted line separation request", and "experiencing financial hardship" -- none of which are facts, and two of the four alternative routes (Pell grant, free/reduced lunch) have no fact either. The whole branch is conditional on an undecidable predicate.',
  },
  {
    id: 'cda-residency-not-required',
    split: 'heldout',
    tier: 3,
    citationName: 'City of Madison CDA -- Housing Applicants',
    citationUrl: 'https://www.cityofmadison.com/dpced/housing/applicants',
    fetchedOn: '2026-09-05',
    excerpt:
      'Households must: Include an adult. Qualify as a family as defined by the HUD and CDA. Provide social security numbers for eligible family members. Have at least one family member who is a citizen, national, or noncitizen with eligible immigration status. Housing assistance will be prorated, or reduced, for families that have some ineligible members. Applicants do not need to live in the City of Madison currently. However, we give preference to City of Madison residents.',
    expected: 'abstain',
    note:
      'Says outright that Madison residency is NOT required (only preferred). A model that emits livesIn.madison here inverts the source. The citizenship clause is a reserved/unasked fact. There is no clean positive rule to extract; abstain (this is exactly the reasoning in madison-housing-choice-voucher.ts\'s own comments).',
  },
  {
    id: 'cda-section8-closed',
    split: 'heldout',
    tier: 3,
    citationName: 'City of Madison CDA -- Housing Applicants',
    citationUrl: 'https://www.cityofmadison.com/dpced/housing/applicants',
    fetchedOn: '2026-09-05',
    excerpt:
      'Housing vouchers (Section 8): Voucher holders live in privately-owned housing and receive a rental subsidy. The Section 8 lottery closed on April 2, 2023. We are not currently accepting applications.',
    expected: 'abstain',
    note:
      'A closed waitlist that no rules engine can resolve -- the correct output is manualReview (which the harness scores as a correct abstention), matching the manualReview leaf in madison-housing-choice-voucher.ts. Not a dangerous case, but a check that "the honest answer is manualReview" survives a substantive-sounding excerpt.',
  },
];

/** Cases in a given split. */
export function casesInSplit(split: EvalSplit): readonly EvalCase[] {
  return EVAL_CASES.filter((c) => c.split === split);
}

/** How many cases in a split should abstain -- used by the harness test. */
export function expectedAbstentionCount(split: EvalSplit): number {
  return casesInSplit(split).filter((c) => c.expected === 'abstain').length;
}

/** Back-compat: total abstention count across the whole set. */
export const EXPECTED_ABSTENTION_COUNT = EVAL_CASES.filter((c) => c.expected === 'abstain').length;
