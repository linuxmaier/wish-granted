/**
 * The vocabulary of things the interview can learn about a person.
 *
 * A "fact" is one atomic, structured piece of information. Programs express
 * their eligibility rules in terms of these keys, and the interview asks
 * questions that fill them in. Keeping the two sides talking through a single
 * declared vocabulary is what lets us validate -- in a test -- that every rule
 * in the dataset is actually answerable by some question, and that every
 * question we ask is actually used by some rule.
 *
 * Adding a new fact is deliberately a three-step change: declare it here, have
 * some program reference it, and add a question that supplies it. The test in
 * tests/data/vocabulary.test.ts fails if those get out of sync.
 *
 * A fact is worth asking when it unlocks programs worth including -- coverage,
 * not "does an existing rule already need it". See docs/standing-decisions.md,
 * "When a fact earns a question", for the rule and why; docs/data-authoring.md
 * for the procedure.
 */

export const FACT_KEYS = [
  // --- Geography -----------------------------------------------------------
  'state',
  'county',
  'city',

  // --- Household -----------------------------------------------------------
  'householdSize',
  'annualHouseholdIncome',
  'age',
  'citizenshipStatus',

  // --- Children / pregnancy ------------------------------------------------
  'isPregnantOrPostpartum',
  'hasChildUnder5',
  'hasSchoolAgeChild',

  // --- Housing & utilities -------------------------------------------------
  'housingStatus',
  'paysHeatingCost',
  'facingLossOfHousing',
  'utilityShutoffRisk',

  // --- Situation -----------------------------------------------------------
  'currentBenefits',
  'employmentStatus',
  // See the FactSpec below for why this is a boolean, not a dollar figure.
  'recentIncomeDrop',

  // --- Declared, awaiting their first record --------------------------------
  // Shapes settled ahead of the records that will use them, so that promoting
  // a candidate out of research/corpus/ is a data change and so that two
  // authors cannot coin two spellings of the same fact. No program references
  // these and no question supplies them; the vocabulary test allows exactly
  // the keys listed in RESERVED_FACT_KEYS to be unused.
  //
  // These are no longer deferred on principle -- see
  // docs/standing-decisions.md and docs/interview-roadmap.md for what each
  // unlocks and in what order.
  'veteranConnection',
  'hasDisability',
  'hasChildUnder18',
] as const;

export type FactKey = (typeof FACT_KEYS)[number];

/**
 * Facts declared ahead of any question that supplies them.
 *
 * Two different reasons sit in this list, and they are not the same:
 *
 * - `hasDisability` and `hasChildUnder18` are *queued*. Each has a measured
 *   question to ask and a named set of programs behind it; they are unused
 *   only because no record in front of them needs them yet. Adding the
 *   question is step 3 of the three-step change, and it lands with the first
 *   record that does -- see docs/interview-roadmap.md. `veteranConnection`
 *   left this list that way.
 * - `citizenshipStatus` and `employmentStatus` are *declined*. Nothing is
 *   waiting on them.
 *
 * Each is a standing decision with a reopen condition, recorded in
 * docs/standing-decisions.md -- do not re-derive the reasoning here.
 *
 * tests/data/vocabulary.test.ts allows exactly these keys to be unused, and
 * fails on any other unused or unaskable fact.
 */
export const RESERVED_FACT_KEYS: readonly FactKey[] = [
  'hasDisability',
  'hasChildUnder18',
  'citizenshipStatus',
  'employmentStatus',
];

export type FactType = 'number' | 'boolean' | 'enum' | 'enumSet';

export interface FactSpec {
  readonly key: FactKey;
  readonly type: FactType;
  /**
   * Noun phrase used to build human-readable explanations, e.g. "household
   * size" becomes "household size is 4 or fewer". Lowercase, no trailing
   * punctuation.
   */
  readonly label: string;
  /** Allowed values for `enum` / `enumSet` facts. */
  readonly options?: readonly string[];
  /**
   * For boolean facts: how to phrase the false case. `label` is the affirmative
   * clause, so explanations can read "there is a child under 5 in the
   * household" or "there is no child under 5 in the household" rather than
   * mechanically negating the affirmative.
   */
  readonly negated?: string;
  /** Display text for `enum` / `enumSet` values. Falls back to the raw value. */
  readonly optionLabels?: Readonly<Record<string, string>>;
  /** How a value is rendered inside an explanation. */
  readonly format?: 'currency' | 'plain';
}

/**
 * Age is asked as a band, not an exact number. That much is unchanged; what
 * changed is how many cut points a band list needs.
 *
 * Each boundary below is required by a named program in the corpus survey
 * (research/corpus/FINDINGS.md §2c), so the list is derived, not guessed:
 *
 *   16   FoodShare Employment and Training
 *   18   the five candidates that gate on "is an adult"
 *   40   Wisconsin Well Woman (a 40-64 window -- neither end expressible before)
 *   55   Senior Farmers' Market Nutrition, the Native American route
 *   60   CSFP senior food, the ADRC elder benefit specialist
 *   62   Homestead Credit
 *   64   Well Woman's upper bound
 *   65   SeniorCare, the Medicare Savings Programs
 *
 * Two boundaries are still rounded, and both round outward so the program
 * stays in "might qualify" rather than ruling anyone out: the ADRC long-term
 * care functional screen's 17.5 falls in `16-17`, and a rule needing exactly
 * 64 gets `62-64`. See docs/standing-decisions.md, "AGE_BANDS", for why bands
 * rather than a number, and the condition for revisiting that.
 */
export const AGE_BANDS = [
  'under-16',
  '16-17',
  '18-39',
  '40-54',
  '55-59',
  '60-61',
  '62-64',
  '65-plus',
] as const;

export const CITIZENSHIP_STATUSES = [
  'us-citizen',
  'qualified-immigrant',
  'other-immigration-status',
  'prefer-not-to-say',
] as const;

export const HOUSING_STATUSES = [
  'renting',
  'own-home',
  'unhoused-or-temporary',
  'living-with-others',
] as const;

export const EMPLOYMENT_STATUSES = [
  'employed',
  'unemployed',
  'retired',
  'unable-to-work',
  'student',
] as const;

/**
 * How a household connects to military service. Every value is a qualifying
 * route some candidate names in its own right; see the `veteranConnection`
 * FactSpec below for why this is a set rather than a boolean.
 *
 * Deliberately absent: discharge characterisation, service dates, war-period
 * service, and VA disability rating percentages. Those gate several of the
 * same programs and are all left to `manualReview` -- nobody can answer
 * "did you serve during a defined war period?" from memory, and a wrong answer
 * would tell someone they qualify when they do not. See
 * docs/standing-decisions.md, "Facts that stay unasked on purpose".
 */
export const VETERAN_CONNECTIONS = [
  'veteran',
  'spouse-or-partner',
  'surviving-spouse',
  'child-or-dependent',
  'gold-star-parent',
] as const;

/**
 * Benefits a person may already receive. Several programs grant automatic
 * ("categorical") eligibility to people already enrolled in another program,
 * so this is load-bearing, not just context.
 */
export const BENEFIT_ENROLLMENTS = [
  'snap-foodshare',
  'wic',
  'medicaid-badgercare',
  'ssi',
  'w2-tanf',
  'wheap-energy-assistance',
  'housing-choice-voucher',
  // Confirmed on Lifeline's own qualify page (see lifeline-phone-internet.ts's
  // source note). In the shared checklist rather than a per-program caveat: the
  // marginal cost of one more checkbox on an existing `multi` question is zero.
  // See docs/standing-decisions.md, "When a fact earns a question".
  'federal-public-housing',
] as const;

export const FACTS: Readonly<Record<FactKey, FactSpec>> = {
  state: {
    key: 'state',
    type: 'enum',
    label: 'state of residence',
    options: ['WI', 'other'],
    optionLabels: { WI: 'Wisconsin', other: 'another state' },
  },
  county: {
    key: 'county',
    type: 'enum',
    label: 'county',
    options: ['dane', 'other-wi-county'],
    optionLabels: { dane: 'Dane County', 'other-wi-county': 'another Wisconsin county' },
  },
  city: {
    key: 'city',
    type: 'enum',
    label: 'city',
    options: ['madison', 'other'],
    optionLabels: { madison: 'the City of Madison', other: 'somewhere else' },
  },

  householdSize: { key: 'householdSize', type: 'number', label: 'household size' },
  annualHouseholdIncome: {
    key: 'annualHouseholdIncome',
    type: 'number',
    label: 'annual household income',
    format: 'currency',
  },
  age: {
    key: 'age',
    type: 'enum',
    label: 'age',
    options: AGE_BANDS,
    optionLabels: {
      'under-16': 'under 16',
      '16-17': '16 or 17',
      '18-39': '18 to 39',
      '40-54': '40 to 54',
      '55-59': '55 to 59',
      '60-61': '60 or 61',
      '62-64': '62 to 64',
      '65-plus': '65 or older',
    },
  },
  citizenshipStatus: {
    key: 'citizenshipStatus',
    type: 'enum',
    label: 'immigration status',
    options: CITIZENSHIP_STATUSES,
    optionLabels: {
      'us-citizen': 'U.S. citizen',
      'qualified-immigrant': 'qualified immigrant',
      'other-immigration-status': 'another immigration status',
      'prefer-not-to-say': 'prefer not to say',
    },
  },

  isPregnantOrPostpartum: {
    key: 'isPregnantOrPostpartum',
    type: 'boolean',
    label: 'someone in the household is pregnant or recently gave birth',
    negated: 'no one in the household is pregnant or recently gave birth',
  },
  hasChildUnder5: {
    key: 'hasChildUnder5',
    type: 'boolean',
    label: 'there is a child under 5 in the household',
    negated: 'there is no child under 5 in the household',
  },
  hasSchoolAgeChild: {
    key: 'hasSchoolAgeChild',
    type: 'boolean',
    label: 'there is a school-age child in the household',
    negated: 'there is no school-age child in the household',
  },

  housingStatus: {
    key: 'housingStatus',
    type: 'enum',
    label: 'housing situation',
    options: HOUSING_STATUSES,
    optionLabels: {
      renting: 'renting',
      'own-home': 'owning a home',
      'unhoused-or-temporary': 'unhoused or in temporary housing',
      'living-with-others': 'staying with family or friends',
    },
  },
  paysHeatingCost: {
    key: 'paysHeatingCost',
    type: 'boolean',
    label: 'the household pays a heating or electric bill',
    negated: 'the household does not pay a heating or electric bill',
  },
  facingLossOfHousing: {
    key: 'facingLossOfHousing',
    type: 'boolean',
    label: 'the household is facing eviction or loss of housing',
    negated: 'the household is not facing eviction or loss of housing',
  },
  utilityShutoffRisk: {
    key: 'utilityShutoffRisk',
    type: 'boolean',
    label: 'the household has a shutoff notice or no working heat',
    negated: 'the household has no shutoff notice and has working heat',
  },

  currentBenefits: {
    key: 'currentBenefits',
    type: 'enumSet',
    label: 'benefits already received',
    options: BENEFIT_ENROLLMENTS,
    optionLabels: {
      'snap-foodshare': 'FoodShare (SNAP)',
      wic: 'WIC',
      'medicaid-badgercare': 'BadgerCare Plus / Medicaid',
      ssi: 'SSI',
      'w2-tanf': 'Wisconsin Works (W-2)',
      'wheap-energy-assistance': 'WHEAP energy assistance',
      'housing-choice-voucher': 'a Housing Choice Voucher',
      'federal-public-housing': 'Federal Public Housing Assistance',
    },
  },
  employmentStatus: {
    key: 'employmentStatus',
    type: 'enum',
    label: 'employment status',
    options: EMPLOYMENT_STATUSES,
    optionLabels: {
      employed: 'employed',
      unemployed: 'unemployed',
      retired: 'retired',
      'unable-to-work': 'unable to work',
      student: 'a student',
    },
  },
  /**
   * WHEAP's real income test looks at one prior month, annualized -- not the
   * full year `annualHouseholdIncome` asks for (see docs/design.md, issue #9,
   * quoting the WHEAP PY26 Manual). A household whose annual figure is too
   * high can still pass the real test after a recent layoff.
   *
   * We deliberately ask "has it dropped?" rather than "what was last month's
   * income?": a precise recent-month dollar figure is hard to estimate
   * accurately mid-crisis, and even a precise one couldn't be safely compared
   * against the WHEAP income table without parameterising `incomeAtOrBelow`'s
   * fact source in the engine, which is out of scope here (tracked as a
   * follow-up issue). This fact only ever keeps a program from being wrongly
   * ruled out on income -- it never turns a `manualReview` branch into a
   * `pass` -- see the WHEAP/weatherization program records.
   */
  recentIncomeDrop: {
    key: 'recentIncomeDrop',
    type: 'boolean',
    label: 'household income has dropped significantly in the last month or two',
    negated: 'household income has not changed significantly in the last month or two',
  },

  /**
   * A set, not a boolean, and the corpus survey is the reason: 6 of the 11
   * veterans candidates satisfy their veteran test through a *family* route --
   * `anyOf(veteran, spouse-or-dependent)` -- so a bare "is anyone here a
   * veteran?" answered "no" leaves those 6 undecided for everybody. Measured:
   * the boolean settles 4.2 of 60 candidates, the set 8.2.
   * See docs/interview-roadmap.md.
   */
  veteranConnection: {
    key: 'veteranConnection',
    type: 'enumSet',
    label: 'connection to military service',
    options: VETERAN_CONNECTIONS,
    optionLabels: {
      veteran: 'a veteran or current service member',
      'spouse-or-partner': "a veteran's spouse or partner",
      'surviving-spouse': "a veteran's widow or widower",
      'child-or-dependent': "a veteran's child or dependent",
      'gold-star-parent': 'the parent of a service member who died in service',
    },
  },
  /**
   * Household-scoped, like every other person fact here, while several rules
   * mean the applicant specifically (Family Care and IRIS both read "an adult
   * with a disability"). That over-includes rather than excludes, so it can
   * only hold a program at "might qualify" -- the same trade the age bands
   * make. A rule that needs the distinction should say so in `manualReview`.
   */
  hasDisability: {
    key: 'hasDisability',
    type: 'boolean',
    label: 'someone in the household has a disability or long-term health condition',
    negated: 'no one in the household has a disability or long-term health condition',
  },
  /**
   * Rides the existing household-members checklist, so it costs no new
   * question. Distinct from `hasChildUnder5` + `hasSchoolAgeChild`: those two
   * miss a 16-to-17-year-old out of school, and W-2, Emergency Assistance and
   * Kinship Care all turn on a minor in the home rather than a school
   * enrolment.
   */
  hasChildUnder18: {
    key: 'hasChildUnder18',
    type: 'boolean',
    label: 'there is a child under 18 in the household',
    negated: 'there is no child under 18 in the household',
  },
};

/** A single value supplied for a fact. */
export type FactValue = number | boolean | string | readonly string[];

/**
 * Everything the interview knows so far. Always partial -- the engine is built
 * to reason about incomplete answers, which is the whole point of surfacing
 * matches progressively.
 *
 * This object lives in React state and nowhere else. It is never serialized to
 * a server, never written to localStorage, never put in the URL.
 */
export type Answers = Partial<Record<FactKey, FactValue>>;
