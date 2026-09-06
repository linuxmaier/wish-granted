/**
 * The measured Tier-3 corpus for issue #62, experiment 3.
 *
 * Every entry points at real text fetched 2026-09-05/06 with a desktop-Chrome
 * user agent and saved verbatim under tests/fixtures/tier3/ (see SOURCES.md
 * there). `expected` is the correct answer a scope-preserving parser should
 * reach -- grounded in the shipped program records (src/data/programs/*.ts),
 * the fact vocabulary (src/domain/facts.ts), and the already-reviewed
 * judgements in scripts/llm-extraction/eval-cases.ts. It is NOT what the parser
 * happens to produce; the whole point is to measure the gap.
 *
 * `tierAssigned` is the tier from docs/eligibility-extraction.md Section 2 /
 * the eval set. Where the measurement shows that assignment is wrong, that is
 * a finding (see docs/eligibility-extraction-tier3.md).
 *
 * Correctness bar: an `extract` is only correct if the emitted Criterion
 * carries the figure's governing scope. A bare income ceiling lifted out of a
 * conditional branch is a dangerous over-claim, scored as a failure.
 */

/**
 * @typedef {Object} Tier3Source
 * @property {string} id
 * @property {'html'|'ecfr'} kind
 * @property {string} file          fixture filename under tests/fixtures/tier3/
 * @property {string} url
 * @property {string} fetchedOn
 * @property {string[]} [sections]   eCFR: sections to consider
 * @property {string} [paragraphFilter]  eCFR: regex narrowing a section to its
 *   relevant sub-tree (tested against "<citation> <runInHeading>" and the
 *   paragraph text) -- the CFR analogue of the HTML heading stack
 * @property {string} citationName
 * @property {1|2|3|4} tierAssigned
 * @property {{decision:'extract'|'abstain', mustMatch?: (c:any)=>boolean, why:string}} expected
 * @property {string} groundedIn
 */

const hasIncome = (c, scale, percent) => JSON.stringify(c).includes(`"scale":"${scale}","percent":${percent}`);
const hasSet = (c, fact) => JSON.stringify(c).includes(`"fact":"${fact}","op":"includesAny"`);
const hasCompareTrue = (c, fact) => JSON.stringify(c).includes(`"fact":"${fact}","op":"eq","value":true`);
const hasReview = (c) => JSON.stringify(c).includes('"kind":"manualReview"');

/** @type {Tier3Source[]} */
export const TIER3_SOURCES = [
  // ===================== eCFR: 7 CFR 273 (SNAP) & 45 CFR 1302.12 (Head Start)
  {
    id: 'headstart-1302.12',
    kind: 'ecfr',
    file: 'ecfr-45-cfr-1302-12.xml',
    url: 'https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-45.xml?section=1302.12',
    fetchedOn: '2026-09-06',
    sections: ['1302.12'],
    citationName: '45 CFR 1302.12 -- Head Start eligibility',
    tierAssigned: 3,
    expected: {
      decision: 'extract',
      mustMatch: (c) => hasIncome(c, 'fpl', 100) && hasReview(c) && !JSON.stringify(c).includes('percent":130'),
      why: 'The (c)(1) rule is "income at or below the poverty line" OR one of three categorical routes. The 130% figure in (d) is a capped, discretionary over-income ALLOWANCE for families who do NOT meet (c) -- structurally a different lettered paragraph under the run-in heading "Additional allowances for programs." A parser that keeps the tree extracts 100% + a manualReview branch and never surfaces 130%.',
    },
    groundedIn: 'eval-cases.ts headstart-cfr-over-income-allowance; the (c)(1) structure is unambiguous in the XML.',
  },
  {
    id: 'snap-273.9a-income-standards',
    kind: 'ecfr',
    file: 'ecfr-7-cfr-273.xml',
    url: 'https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-7.xml?part=273',
    fetchedOn: '2026-09-06',
    sections: ['273.9'],
    paragraphFilter: 'Income eligibility standards',
    citationName: '7 CFR 273.9(a) -- SNAP income eligibility standards',
    tierAssigned: 3,
    expected: {
      decision: 'abstain',
      why: 'Non-elderly/disabled households must meet BOTH the gross (130% FPL) AND net income standards, and the net standard runs through the 273.9(d) deduction stack the fact vocabulary cannot represent. The 130% is also only the federal floor -- Wisconsin BBCE raises the effective gross test to 200% FPL (foodshare-snap-wi.ts). Bare incomeAtOrBelow(fpl,130) is an over-claim in both directions.',
    },
    groundedIn: 'eval-cases.ts snap-cfr-dual-income-standard; foodshare-snap-wi.ts comment block.',
  },
  {
    id: 'snap-273.1b2-elderly-separate-household',
    kind: 'ecfr',
    file: 'ecfr-7-cfr-273.xml',
    url: 'https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-7.xml?part=273',
    fetchedOn: '2026-09-06',
    sections: ['273.1'],
    paragraphFilter: 'Elderly and disabled persons|separate household',
    citationName: '7 CFR 273.1(b)(2) -- SNAP separate household status',
    tierAssigned: 3,
    expected: {
      decision: 'abstain',
      why: 'The clean "165 percent of the poverty line" governs household COMPOSITION (whether an elderly disabled person counts as their own household), not program eligibility. The run-in heading is "Elderly and disabled persons." and the sentence subject is "Separate household status". incomeAtOrBelow(fpl,165) would be a confident wrong extraction.',
    },
    groundedIn: 'eval-cases.ts snap-cfr-elderly-separate-household (a measured LLM dangerous over-claim).',
  },
  {
    id: 'snap-273.9d-deductions',
    kind: 'ecfr',
    file: 'ecfr-7-cfr-273-9.xml',
    url: 'https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-7.xml?section=273.9',
    fetchedOn: '2026-09-06',
    sections: ['273.9'],
    paragraphFilter: 'deduction',
    citationName: '7 CFR 273.9(d) -- SNAP deductions (standard, excess shelter)',
    tierAssigned: 3,
    expected: {
      decision: 'abstain',
      why: 'Percentages (50%, 8.31%) and dollar figures ($340 for FY2001, $144 floor for FY2009) that describe how to COMPUTE deductions inside the net-income test. Not eligibility thresholds, and the printed dollars are year-superseded by FNS notices the regulation does not contain. This is the genuinely intractable case -- abstain is the only correct answer.',
    },
    groundedIn: 'eval-cases.ts snap-shelter-deduction, snap-cfr-standard-deduction.',
  },
  {
    id: 'snap-273.2i-expedited',
    kind: 'ecfr',
    file: 'ecfr-7-cfr-273.xml',
    url: 'https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-7.xml?part=273',
    fetchedOn: '2026-09-06',
    sections: ['273.2'],
    paragraphFilter: 'expedit',
    citationName: '7 CFR 273.2(i) -- SNAP expedited service',
    tierAssigned: 3,
    expected: {
      decision: 'abstain',
      why: 'The $150 gross-income / $100 liquid-resources thresholds trigger EXPEDITED PROCESSING (a 7-day rather than 30-day decision) for households that are otherwise eligible -- not an eligibility rule. The run-in heading is "Expedited service."',
    },
    groundedIn: 'eval-cases.ts snap-expedited-service-threshold.',
  },
  {
    id: 'snap-273.7-abawd',
    kind: 'ecfr',
    file: 'ecfr-7-cfr-273.xml',
    url: 'https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-7.xml?part=273',
    fetchedOn: '2026-09-06',
    sections: ['273.7', '273.24'],
    paragraphFilter: 'work requirement|able-bodied|time limit|ABAWD',
    citationName: '7 CFR 273.7 / 273.24 -- SNAP ABAWD work rules and time limit',
    tierAssigned: 3,
    expected: {
      decision: 'abstain',
      why: 'The 3-month time limit sits inside a four-way exemption tree (exception, geographic waiver, discretionary exemption, pledge funding), each with its own cross-referenced section and its own facts. Not encodable.',
    },
    groundedIn: 'eval-cases.ts snap-abawd, snap-cfr-abawd-exemption-tree.',
  },
  {
    id: 'snap-273.4-noncitizen',
    kind: 'ecfr',
    file: 'ecfr-7-cfr-273.xml',
    url: 'https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-7.xml?part=273',
    fetchedOn: '2026-09-06',
    sections: ['273.4'],
    paragraphFilter: 'citizenship or alien status requirements|meeting citizenship',
    citationName: '7 CFR 273.4 -- SNAP citizenship / noncitizen eligibility',
    tierAssigned: 3,
    expected: {
      decision: 'abstain',
      why: 'A multi-factor test with hard historical cutoff dates (Aug 22 1996, 40 qualifying quarters, Dec 31 1996). facts.ts deliberately leaves citizenshipStatus unasked in v1. No number here is an income threshold.',
    },
    groundedIn: 'eval-cases.ts snap-alien-status; facts.ts RESERVED_FACT_KEYS.',
  },

  // ===================== WI Administrative Code
  {
    id: 'wi-admin-dhs-101',
    kind: 'html',
    file: 'wi-admin-dhs-101.html',
    url: 'https://docs.legis.wisconsin.gov/document/administrativecode/ch.%20DHS%20101',
    fetchedOn: '2026-09-06',
    citationName: 'Wis. Admin. Code ch. DHS 101 -- Introduction and Definitions',
    tierAssigned: 3,
    expected: {
      decision: 'abstain',
      why: 'DHS 101 is definitions only ("Accredited means...", "Active treatment means..."). No eligibility rule and no income figure. Correct answer is to state that nothing is published here.',
    },
    groundedIn: 'docs/eligibility-extraction.md Section 2 names DHS 101 as a Tier-3 source; the page itself.',
  },
  {
    id: 'wi-admin-dhs-103-04',
    kind: 'html',
    file: 'wi-admin-dhs-103-04.html',
    url: 'https://docs.legis.wisconsin.gov/document/administrativecode/DHS%20103.04',
    fetchedOn: '2026-09-06',
    citationName: 'Wis. Admin. Code s. DHS 103.04 -- Asset and income limits (Medicaid)',
    tierAssigned: 3,
    expected: {
      decision: 'abstain',
      why: 'The categorically/medically-needy standards defer to Wisconsin Statutes (s. 49.46, s. 49.47) and s. DHS 103.03; the one concrete figure -- "total net family income is less than 250% of the federal poverty line ... calculated using the standard SSI disregards" (the MAPP provision) -- is a MAGI/deduction stack gated per population (children under 19, pregnant women, family-planning-only). No clean ceiling.',
    },
    groundedIn: 'The page itself; docs/eligibility-extraction.md Section 2 (WI Administrative Code).',
  },

  // ===================== WI DHS: FoodShare
  {
    id: 'foodshare-fpl',
    kind: 'html',
    file: 'foodshare-fpl.html',
    url: 'https://www.dhs.wisconsin.gov/foodshare/fpl.htm',
    fetchedOn: '2026-09-06',
    citationName: 'FoodShare Wisconsin -- Monthly Income Limits',
    tierAssigned: 3,
    expected: {
      decision: 'extract',
      mustMatch: (c) => hasIncome(c, 'fpl', 200) && !JSON.stringify(c).includes('percent":130'),
      why: 'The table has three columns; only the "*200% FPL Gross Income Limit" column is an eligibility ceiling. The "130% FPL ... Reporting Limit" column is a post-enrolment reporting threshold (its own header says so), and "Maximum Allotment" is a benefit amount. incomeAtOrBelow(fpl,200) matches foodshare-snap-wi.ts. Emitting 130% understates who qualifies.',
    },
    groundedIn: 'eval-cases.ts foodshare-gross-income-test; foodshare-snap-wi.ts.',
  },
  {
    id: 'foodshare-index',
    kind: 'html',
    file: 'foodshare-index.html',
    url: 'https://www.dhs.wisconsin.gov/foodshare/index.htm',
    fetchedOn: '2026-09-06',
    citationName: 'FoodShare Wisconsin -- A Recipe for Good Health',
    tierAssigned: 3,
    expected: {
      decision: 'abstain',
      why: 'Marketing prose ("We help people of all ages who: Have low-income jobs...") plus an immigration/public-charge paragraph. No eligibility rule.',
    },
    groundedIn: 'eval-cases.ts foodshare-who-we-help, foodshare-public-charge.',
  },
  {
    id: 'foodshare-basic-work-rules',
    kind: 'html',
    file: 'foodshare-basic-work-rules.html',
    url: 'https://www.dhs.wisconsin.gov/foodshare/basic-work-rules.htm',
    fetchedOn: '2026-09-06',
    citationName: 'FoodShare Wisconsin -- Basic Work Rules',
    tierAssigned: 3,
    expected: {
      decision: 'abstain',
      why: 'An age band (16-59) plus an eight-branch exemption list on facts the app does not ask. "Sanction for a period of time" is not the same as ineligible.',
    },
    groundedIn: 'eval-cases.ts foodshare-basic-work-rules.',
  },

  // ===================== WI DHS: WIC
  {
    id: 'wic-income-guidelines',
    kind: 'html',
    file: 'wic-income-guidelines.html',
    url: 'https://www.dhs.wisconsin.gov/wic/income-guidelines.htm',
    fetchedOn: '2026-09-06',
    citationName: 'Wisconsin WIC -- Income guidelines',
    tierAssigned: 3,
    expected: {
      decision: 'extract',
      mustMatch: (c) => hasSet(c, 'currentBenefits') && !JSON.stringify(c).includes('incomeAtOrBelow'),
      why: 'The page states an income limit exists but never gives the number/percent (the 185% FPL in wic-wisconsin.ts is NOT on this page) -- so the income rule must be abstained on. But the adjunctive-eligibility list IS here and clean: "if you already use one of these programs: BadgerCare Plus; FoodShare; TANF; W-2". Correct output is hasAnyOf(currentBenefits, [...]) and nothing else. Inventing 185% is a dangerous over-claim; abstaining on the whole page misses a real, scoped categorical rule.',
    },
    groundedIn: 'eval-cases.ts wic-income-limits-unstated + wic-adjunctive-eligibility; wic-wisconsin.ts.',
  },
  {
    id: 'wic-apply',
    kind: 'html',
    file: 'wic-apply.html',
    url: 'https://www.dhs.wisconsin.gov/wic/apply.htm',
    fetchedOn: '2026-09-06',
    citationName: 'Wisconsin WIC -- How to apply',
    tierAssigned: 3,
    expected: {
      decision: 'extract',
      mustMatch: (c) => hasCompareTrue(c, 'isPregnantOrPostpartum') || hasCompareTrue(c, 'hasChildUnder5'),
      why: 'Categorical (non-income) test: "pregnant, breastfeeding, or postpartum, as well as infants and children up to age five". "Foster parents and relatives may also apply on behalf of..." changes WHO applies, not who is eligible -- a parser that abstains on the "may also" clause is over-cautious (this is a #51 control).',
    },
    groundedIn: 'eval-cases.ts wic-may-also-apply (control); wic-wisconsin.ts.',
  },

  // ===================== WI DHS: BadgerCare Plus
  {
    id: 'badgercareplus-fpl',
    kind: 'html',
    file: 'badgercareplus-fpl.html',
    url: 'https://www.dhs.wisconsin.gov/badgercareplus/fpl.htm',
    fetchedOn: '2026-09-06',
    citationName: 'Wisconsin DHS -- BadgerCare Plus income limits',
    tierAssigned: 3,
    expected: {
      decision: 'extract',
      mustMatch: (c) =>
        hasIncome(c, 'fpl', 100) &&
        hasIncome(c, 'fpl', 306) &&
        !JSON.stringify(c).includes('percent":201'),
      why: 'The table column headers carry the scope precisely: "Adult monthly income limit (100% FPL)", "Children premium threshold (201% FPL)", "Pregnant people and children monthly income limit (306% FPL)". The premium-threshold column is not an eligibility ceiling. A scope-preserving parser reconstructs badgercare-plus.ts almost exactly: anyOf(incomeAtOrBelow(fpl,100), allOf(pregnant-or-child, incomeAtOrBelow(fpl,306))). Emitting a bare 306% (or 201%) drops the population scope -- a measured LLM failure.',
    },
    groundedIn: 'eval-cases.ts badgercare-plus-population-columns (measured LLM dangerous over-claim); badgercare-plus.ts.',
  },
  {
    id: 'badgercareplus-index',
    kind: 'html',
    file: 'badgercareplus-index.html',
    url: 'https://www.dhs.wisconsin.gov/badgercareplus/index.htm',
    fetchedOn: '2026-09-06',
    citationName: 'Wisconsin DHS -- BadgerCare Plus',
    tierAssigned: 3,
    expected: {
      decision: 'abstain',
      why: 'Landing page: "helps Wisconsinites age 0-64 who have low-income ... The only way to know if you can enroll is to apply." An age band on a reserved fact, "low-income" unquantified, no number.',
    },
    groundedIn: 'eval-cases.ts badgercare-apply-to-know.',
  },

  // ===================== WI DHS: SeniorCare, QMB
  {
    id: 'seniorcare-fpl',
    kind: 'html',
    file: 'seniorcare-fpl.html',
    url: 'https://www.dhs.wisconsin.gov/seniorcare/fpl.htm',
    fetchedOn: '2026-09-06',
    citationName: 'Wisconsin DHS -- SeniorCare annual income limits',
    tierAssigned: 3,
    expected: {
      decision: 'abstain',
      why: 'There is NO income eligibility ceiling. The 160/200/240% FPL figures are prescription cost-sharing tier boundaries ("Your annual income determines how much of your prescription drug costs SeniorCare will cover"), each under a "Level N income limits" heading, and "Level 3 ... Income more than 240%" is still an enrolled level with a spenddown. Any incomeAtOrBelow here invents a cutoff that does not exist.',
    },
    groundedIn: 'eval-cases.ts seniorcare-coverage-levels-not-eligibility (measured LLM dangerous over-claim).',
  },
  {
    id: 'qmb',
    kind: 'html',
    file: 'qmb.html',
    url: 'https://www.dhs.wisconsin.gov/medicaid/qmb.htm',
    fetchedOn: '2026-09-06',
    citationName: 'Wisconsin DHS -- Qualified Medicare Beneficiary (QMB) Program',
    tierAssigned: 3,
    expected: {
      decision: 'abstain',
      why: 'The "100% of the federal poverty level" bullet is "countable monthly income ... after certain credits are applied" (a deduction stack), and it is one bullet in an AND-list whose siblings are "Are entitled to Medicare Part A or Part B-ID" and an asset test -- neither a fact. incomeAtOrBelow(fpl,100) drops the Medicare-entitlement gate.',
    },
    groundedIn: 'eval-cases.ts qmb-fpl-gated-on-medicare.',
  },

  // ===================== WI DHS: Summer EBT
  {
    id: 'sebt-index',
    kind: 'html',
    file: 'sebt-index.html',
    url: 'https://www.dhs.wisconsin.gov/sebt/index.htm',
    fetchedOn: '2026-09-06',
    citationName: 'Wisconsin DHS -- Summer EBT',
    tierAssigned: 3,
    expected: {
      decision: 'abstain',
      why: '"Income-based program" and "families who qualify" with no threshold, plus an explicit statement that eligibility is determined from matched records. sun-bucks-wi.ts encodes 185% FPL + categorical routes -- none on this page.',
    },
    groundedIn: 'eval-cases.ts sebt-income-based-automatic.',
  },

  // ===================== WI energy/housing: WHEAP, Weatherization
  {
    id: 'weatherization',
    kind: 'html',
    file: 'weatherization.html',
    url: 'https://energyandhousing.wi.gov/Pages/AgencyResources/weatherization.aspx',
    fetchedOn: '2026-09-06',
    citationName: 'WI DOA -- Weatherization Assistance Program',
    tierAssigned: 3,
    expected: {
      decision: 'abstain',
      why: '"Low-income families" / "low-income households", no threshold anywhere. The real rule (60% SMI, or automatic via WHEAP) lives in a linked PDF manual.',
    },
    groundedIn: 'eval-cases.ts weatherization-landing.',
  },
  {
    id: 'energy-assistance',
    kind: 'html',
    file: 'energy-assistance.html',
    url: 'https://energyandhousing.wi.gov/Pages/AgencyResources/energy-assistance.aspx',
    fetchedOn: '2026-09-06',
    citationName: 'WHEAP -- Energy Assistance',
    tierAssigned: 3,
    expected: {
      decision: 'extract',
      mustMatch: (c) =>
        hasIncome(c, 'wi-smi', 100) && !JSON.stringify(c).includes('wi-smi","percent":60'),
      why: 'This page carries a real by-household-size income table under prose that says "Households with income at or below the amounts shown may qualify ... Based on 60% of Wisconsin\'s median income." The published amounts ARE the 60%-SMI figure, so the rule is incomeAtOrBelow(wi-smi, 100) -- matching wheap-energy-assistance.ts. A parser that emits incomeAtOrBelow(wi-smi, 60) double-applies the 60% and understates eligibility (the wheap-smi near-miss trap). The Commitment-to-Community carve-out is undecidable and belongs in a manualReview leaf, not as a reason to abstain on the whole rule.',
    },
    groundedIn: 'eval-cases.ts wheap-smi (tuning; target incomeAtOrBelow(wi-smi,100)); wheap-energy-assistance.ts; docs/eligibility-extraction.md Section 3.',
  },

  // ===================== WI DCF: Emergency Assistance, Wisconsin Shares
  {
    id: 'emergency-assistance',
    kind: 'html',
    file: 'emergency-assistance.html',
    url: 'https://dcf.wisconsin.gov/ea',
    fetchedOn: '2026-09-06',
    citationName: 'Wisconsin DCF -- Emergency Assistance (EA)',
    tierAssigned: 3,
    expected: {
      decision: 'abstain',
      why: 'The clean "at or below 115% of the Federal Poverty Level" is gated on "facing a setback due to an emergency" (fire, disaster, domestic violence, energy crisis -- no fact), on caring for a child under 18, and on an asset test. incomeAtOrBelow(fpl,115) alone tells any low-income family they qualify for EA cash.',
    },
    groundedIn: 'eval-cases.ts emergency-assistance-emergency-gate (measured LLM dangerous over-claim).',
  },
  {
    id: 'wishares-parents',
    kind: 'html',
    file: 'wishares-parents.html',
    url: 'https://dcf.wisconsin.gov/wishares/parents',
    fetchedOn: '2026-09-06',
    citationName: 'Wisconsin Shares -- Income eligibility',
    tierAssigned: 3,
    expected: {
      decision: 'extract',
      mustMatch: (c) =>
        hasIncome(c, 'fpl', 200) && hasReview(c) && !JSON.stringify(c).includes('wi-smi","percent":85'),
      why: '"To become eligible, your family\'s monthly gross income must not be more than 200% of the FPL." The "85% of the state median income" is only the higher threshold to REMAIN eligible after enrolling -- picking it is the wrong number. The work/school/training activity requirement has no fact, so it belongs in a manualReview leaf inside an allOf. Matches wisconsin-shares-child-care.ts.',
    },
    groundedIn: 'eval-cases.ts wishares-income-and-activity; wisconsin-shares-child-care.ts.',
  },

  // ===================== WI DOR: Homestead Credit
  {
    id: 'homestead-credit',
    kind: 'html',
    file: 'homestead-credit.html',
    url: 'https://www.revenue.wi.gov/Pages/FAQS/ise-home.aspx',
    fetchedOn: '2026-09-06',
    citationName: 'Wisconsin DOR -- Claiming Homestead Credit',
    tierAssigned: 3,
    expected: {
      decision: 'abstain',
      why: 'The "$24,680 in household income" is a bare dollar figure with no scale or percent (cannot become an incomeAtOrBelow), "household income" is a defined term (not annualHouseholdIncome), and the threshold is gated on a "You meet one of the following conditions:" list stem plus age 18 and homestead ownership.',
    },
    groundedIn: 'eval-cases.ts homestead-credit-one-of-conditions.',
  },
];

/**
 * HELD-OUT split. Fetched and frozen 2026-09-06, AFTER the classifier
 * (classify.mjs / extract.mjs) was iterated against TIER3_SOURCES above and
 * BEFORE it was run against these. `expected` was assigned by reading each
 * source and the fact vocabulary -- never by looking at parser output. The
 * classifier was not touched after this array was frozen. This is the #43 /
 * #51 held-out methodology: the tuning number measures the tuning, this one
 * measures the approach.
 *
 * It leans heavily `abstain` because a fairly-drawn slice of Tier 3 does --
 * that is itself the finding. The two `extract` controls (a categorical
 * direct-certification list; a page that carries a clean rule AND a
 * survivor-only 200%-FPL trap in the same document) are where over-caution and
 * scope-dropping would show up.
 */
/** @type {Tier3Source[]} */
export const TIER3_HELDOUT = [
  {
    id: 'ho-mapp',
    kind: 'html',
    file: 'mapp.html',
    url: 'https://www.dhs.wisconsin.gov/medicaid/medicaid-purchase-plan.htm',
    fetchedOn: '2026-09-06',
    citationName: 'Wisconsin DHS -- Medicaid Purchase Plan (MAPP)',
    tierAssigned: 3,
    expected: {
      decision: 'abstain',
      why: 'The "adjusted family income of 250% of the FPL or less" is one bullet in an AND-list whose siblings are "Be determined disabled by the Disability Determination Bureau", a $15,000 asset test, and "Meet the MAPP work requirement" -- none a fact (hasDisability is reserved). "Adjusted family income" is also a deduction stack. incomeAtOrBelow(fpl,250) drops the disability and work gates.',
    },
    groundedIn: 'facts.ts RESERVED_FACT_KEYS (hasDisability); the QMB/emergency-assistance failure shape.',
  },
  {
    id: 'ho-well-woman',
    kind: 'html',
    file: 'well-woman.html',
    url: 'https://www.dhs.wisconsin.gov/wwwp/index.htm',
    fetchedOn: '2026-09-06',
    citationName: 'Wisconsin DHS -- Wisconsin Well Woman Program',
    tierAssigned: 3,
    expected: {
      decision: 'abstain',
      why: '"Meet income requirements (at or below 250% of the federal poverty level)" is gated on an age band (40-64, with five enumerated exceptions), being uninsured/underinsured, and not being able to pay a deductible/co-pay -- none a fact. incomeAtOrBelow(fpl,250) alone would tell an insured 30-year-old they qualify.',
    },
    groundedIn: 'facts.ts (age reserved; no insurance-status fact).',
  },
  {
    id: 'ho-katie-beckett',
    kind: 'html',
    file: 'katie-beckett-eligibility.html',
    url: 'https://www.dhs.wisconsin.gov/kbp/eligibility.htm',
    fetchedOn: '2026-09-06',
    citationName: 'Wisconsin DHS -- Katie Beckett Medicaid: Eligibility',
    tierAssigned: 3,
    expected: {
      decision: 'abstain',
      why: 'No income figure at all -- "Not have income in their name that is more than the current income limit for those living in an institution" is a cross-reference to an unstated number. The real gates are disability, functional level of care, and age <19. Parental income explicitly does not count.',
    },
    groundedIn: 'The page; facts.ts (hasDisability reserved).',
  },
  {
    id: 'ho-family-planning-only',
    kind: 'html',
    file: 'family-planning-only.html',
    url: 'https://www.dhs.wisconsin.gov/fpos/index.htm',
    fetchedOn: '2026-09-06',
    citationName: 'Wisconsin DHS -- Family Planning Only Services Program',
    tierAssigned: 3,
    expected: {
      decision: 'abstain',
      why: '"Your income is $4,069.80 or less per month" is a bare dollar figure with no scale or percent, gated on "of childbearing or reproductive age" (no fact) and a negation ("not enrolled in Wisconsin Medicaid or BadgerCare Plus"). Looks extractable; is not.',
    },
    groundedIn: 'eval-cases.ts homestead-credit-one-of-conditions / cda-residency-not-required (bare dollar + negation shapes).',
  },
  {
    id: 'ho-slmb',
    kind: 'html',
    file: 'slmb.html',
    url: 'https://www.dhs.wisconsin.gov/medicaid/slmb.htm',
    fetchedOn: '2026-09-06',
    citationName: 'Wisconsin DHS -- Specified Low-Income Medicare Beneficiary (SLMB)',
    tierAssigned: 3,
    expected: {
      decision: 'abstain',
      why: 'Countable monthly income "between 100% and 120% of the federal poverty level after certain credits are applied" -- a RANGE (not a ceiling), a deduction stack ("after certain credits"), gated on "entitled to Medicare Part A or Part B-ID" and an asset test. The QMB shape exactly.',
    },
    groundedIn: 'eval-cases.ts qmb-fpl-gated-on-medicare.',
  },
  {
    id: 'ho-w2-parents',
    kind: 'html',
    file: 'w2-parents.html',
    url: 'https://dcf.wisconsin.gov/w2/parents',
    fetchedOn: '2026-09-06',
    citationName: 'Wisconsin DCF -- Employment Services for Parents (W-2)',
    tierAssigned: 3,
    expected: {
      decision: 'abstain',
      why: 'A landing page listing employment programs (W-2, TMJ, TJ, Job Access Loans). No income figure, no eligibility rule.',
    },
    groundedIn: 'The page.',
  },
  {
    id: 'ho-dpi-free-reduced-meals',
    kind: 'html',
    file: 'dpi-free-reduced-meals.html',
    url: 'https://dpi.wi.gov/school-nutrition/program-requirements/free-reduced-meal-eligibility',
    fetchedOn: '2026-09-06',
    citationName: 'Wisconsin DPI -- Free and Reduced Meal Eligibility',
    tierAssigned: 3,
    expected: {
      decision: 'extract',
      mustMatch: (c) => hasSet(c, 'currentBenefits') && !JSON.stringify(c).includes('incomeAtOrBelow'),
      why: 'The page states no income percentage. The extractable rule is the direct-certification categorical list: "children in families enrolled in the following: FoodShare (SNAP), W-2 (TANF) cash benefits, FDPIR, or the foster care system" -> hasAnyOf(currentBenefits, [snap-foodshare, w2-tanf]). FDPIR and foster care have no slug. Matches school-meals-wi.ts and eval-cases.ts schoolmeals-direct-certification.',
    },
    groundedIn: 'eval-cases.ts schoolmeals-direct-certification; school-meals-wi.ts.',
  },
  {
    id: 'ho-medicaid-fpl-guidelines',
    kind: 'html',
    file: 'medicaid-fpl-guidelines.html',
    url: 'https://www.dhs.wisconsin.gov/medicaid/fpl.htm',
    fetchedOn: '2026-09-06',
    citationName: 'Wisconsin DHS -- Medicaid: Federal Poverty Level Guidelines',
    tierAssigned: 3,
    expected: {
      decision: 'abstain',
      why: 'A reference table of FPL multiples (100/120/135/150/185/200/250/300% FPL by family size) with a "Program limits" row mapping columns to programs (QMB, MAPP Premium Threshold, SLMB, SLMB+, QDWI/Lower MAPP). No single program, no single ceiling -- any lone incomeAtOrBelow drops which program the column is for.',
    },
    groundedIn: 'The page; the badgercare-plus-population-columns shape (scope in table structure).',
  },
  {
    id: 'ho-wic-cfr-246.7',
    kind: 'ecfr',
    file: 'ecfr-7-cfr-246-7.xml',
    url: 'https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-7.xml?section=246.7',
    fetchedOn: '2026-09-06',
    sections: ['246.7'],
    paragraphFilter: 'Income criteria|Income eligibility guidelines|automatically income-eligible',
    citationName: '7 CFR 246.7(d) -- WIC income eligibility',
    tierAssigned: 3,
    expected: {
      decision: 'abstain',
      why: 'The federal rule is a STATE OPTION expressed as a range: guidelines "equaling the income guidelines ... for reduced-price school meals" or local health-care guidelines, but "not ... less than 100 percent of the revised poverty income guidelines". No fixed percentage is stated; 185% is only referenced indirectly via the National School Lunch Act.',
    },
    groundedIn: 'The regulation text; wic-wisconsin.ts uses 185% but that is the WI state choice, not this federal text.',
  },
  {
    id: 'ho-lifeline-qualify',
    kind: 'html',
    file: 'lifeline-do-i-qualify.html',
    url: 'https://www.lifelinesupport.org/do-i-qualify/',
    fetchedOn: '2026-09-06',
    citationName: 'Lifeline -- How to Qualify',
    tierAssigned: 2,
    expected: {
      decision: 'extract',
      mustMatch: (c) =>
        hasIncome(c, 'fpl', 135) &&
        hasSet(c, 'currentBenefits') &&
        !JSON.stringify(c).includes('percent":200'),
      why: 'The page carries a clean rule -- "income at 135% or less than the 2026 Federal Poverty Guidelines" OR "participate in one of these programs: Medicaid; SNAP; SSI; Federal Public Housing Assistance; ..." -- AND a trap in the same document: the "200% of the Federal Poverty Guidelines" clause is extended eligibility for survivors of domestic violence/trafficking only. A scope-preserving parser extracts 135% + the categorical list and never surfaces 200%. Matches lifeline-phone-internet.ts.',
    },
    groundedIn: 'eval-cases.ts lifeline-fpl, lifeline-categorical, lifeline-survivor-extended; lifeline-phone-internet.ts.',
  },
];
