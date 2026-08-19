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

  // --- Declared but not asked in v1 ---------------------------------------
  // Reserved so the schema can carry the deferred categories (veterans,
  // health/disability) without a migration. No v1 program references these,
  // and no v1 question supplies them; the vocabulary test allows exactly the
  // keys listed in RESERVED_FACT_KEYS to be unused.
  'isVeteran',
  'hasDisability',
] as const;

export type FactKey = (typeof FACT_KEYS)[number];

/**
 * Facts declared ahead of any question that supplies them.
 *
 * Two reasons a fact sits here. Some belong to deferred categories (veterans,
 * health/disability) and are declared so adding those categories is a data
 * change rather than a schema change. The others -- `citizenshipStatus`,
 * `employmentStatus`, `age` -- are cases where the vocabulary is ready but no
 * v1 program rule actually depends on them, so asking would be pure friction.
 *
 * Immigration status is the pointed example. It genuinely affects federal food
 * benefits, but the rules are full of exceptions (children frequently qualify
 * when adults do not), and a rules engine that got them slightly wrong would
 * tell a family they are ineligible when they are not. That is the worst error
 * this app can make, so v1 declines to encode it: the affected programs carry a
 * plain-language caveat instead, and stay in "might qualify".
 *
 * tests/data/vocabulary.test.ts allows exactly these keys to be unused, and
 * fails on any other unused or unaskable fact.
 */
export const RESERVED_FACT_KEYS: readonly FactKey[] = [
  'isVeteran',
  'hasDisability',
  'citizenshipStatus',
  'employmentStatus',
  'age',
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
  age: { key: 'age', type: 'number', label: 'age' },
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

  isVeteran: {
    key: 'isVeteran',
    type: 'boolean',
    label: 'someone in the household is a veteran',
    negated: 'no one in the household is a veteran',
  },
  hasDisability: {
    key: 'hasDisability',
    type: 'boolean',
    label: 'someone in the household has a qualifying disability',
    negated: 'no one in the household has a qualifying disability',
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
