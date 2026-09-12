/**
 * What each candidate question would be worth, measured against the corpus.
 *
 * Run: node research/corpus/analysis/interview-value.mjs
 *
 * Produces every figure docs/interview-roadmap.md quotes. The question it
 * answers is not "how many candidates name this fact" (fact-demand.mjs does
 * that) but "how many programs would stop sitting in *might qualify* if we
 * asked". That is the number that decides whether a question earns its screen,
 * because a results page where three quarters of the entries say "might" has
 * handed the work back to the person reading it.
 *
 * Method, and its limits -- stated plainly because the corpus survey was
 * careful about this and this script should not be read as more than it is:
 *
 * - It evaluates the 60 **unverified** candidate rules in research/corpus/
 *   with the same three-valued logic as src/engine/evaluate.ts. If a candidate
 *   rule is wrong about its program, this is wrong in the same way.
 * - The five personas are **made up**. They are chosen to span the audience
 *   (a family, a senior, an unhoused adult, a veteran household, a single
 *   parent in a housing crisis), not sampled from anyone real, and no user
 *   answers exist to sample from -- collecting them is what the privacy
 *   constraint forbids. Ratios between bundles are the signal here; the
 *   absolute counts move if the personas do.
 * - `incomeAtOrBelow` is evaluated against the FPL table in
 *   src/data/reference/income-tables.ts. `wi-smi` and `dane-ami` are
 *   approximated as multiples of FPL, because this script measures the value
 *   of *non-income* questions and income is already asked.
 * - The `numeric-age` bundle models an exact age, which is an **upper bound**
 *   on what the 8 shipped AGE_BANDS buy: the bands express every boundary in
 *   the corpus except 17.5 and an exact 64.
 */

import { readCorpus } from './corpus.mjs';

// Mirrors FPL in src/data/reference/income-tables.ts (2026, to 30 Sep 2026).
const FPL = [15_960, 21_640, 27_320, 33_000, 38_680, 44_360, 50_040, 55_720];
const FPL_PER_ADDITIONAL = 5_680;

function scaleFor(scale, size) {
  const base = size <= 8 ? FPL[size - 1] : FPL[7] + (size - 8) * FPL_PER_ADDITIONAL;
  if (scale === 'fpl') return base;
  return scale === 'wi-smi' ? base * 2.2 : base * 3.2;
}

function evaluate(node, answers) {
  if (!node) return null;
  switch (node.kind) {
    case 'always':
      return 1;
    case 'manualReview':
      return null;
    case 'compare': {
      const value = answers[node.fact];
      if (value === undefined) return null;
      switch (node.op) {
        case 'eq': return value === node.value ? 1 : 0;
        case 'neq': return value !== node.value ? 1 : 0;
        case 'gte': return value >= node.value ? 1 : 0;
        case 'lte': return value <= node.value ? 1 : 0;
        case 'gt': return value > node.value ? 1 : 0;
        case 'lt': return value < node.value ? 1 : 0;
        default: return null;
      }
    }
    case 'set': {
      const value = answers[node.fact];
      if (value === undefined) return null;
      const held = Array.isArray(value) ? value : [value];
      switch (node.op) {
        case 'in': return node.values.includes(value) ? 1 : 0;
        case 'notIn': return node.values.includes(value) ? 0 : 1;
        case 'includesAny': return held.some((v) => node.values.includes(v)) ? 1 : 0;
        case 'includesAll': return node.values.every((v) => held.includes(v)) ? 1 : 0;
        case 'excludes': return held.some((v) => node.values.includes(v)) ? 0 : 1;
        default: return null;
      }
    }
    case 'incomeAtOrBelow': {
      const { annualHouseholdIncome: income, householdSize: size } = answers;
      if (income === undefined || size === undefined) return null;
      return income <= scaleFor(node.scale, size) * (node.percent / 100) ? 1 : 0;
    }
    case 'allOf': {
      const results = node.of.map((c) => evaluate(c, answers));
      if (results.includes(0)) return 0;
      return results.every((r) => r === 1) ? 1 : null;
    }
    case 'anyOf': {
      const results = node.of.map((c) => evaluate(c, answers));
      if (results.includes(1)) return 1;
      return results.every((r) => r === 0) ? 0 : null;
    }
    case 'not': {
      const inner = evaluate(node.of, answers);
      return inner === null ? null : inner ? 0 : 1;
    }
    default:
      return null;
  }
}

/**
 * Five invented households spanning the audience. `ageYears` and the trailing
 * flags are persona attributes, not facts: the bundles below decide which of
 * them the interview would actually learn.
 */
const PERSONAS = [
  {
    name: 'family of 4, Madison, kids 3 and 7, $28k',
    state: 'WI', county: 'dane', city: 'madison', householdSize: 4, annualHouseholdIncome: 28_000,
    housingStatus: 'renting', paysHeatingCost: true, facingLossOfHousing: false, utilityShutoffRisk: false,
    hasChildUnder5: true, hasSchoolAgeChild: true, isPregnantOrPostpartum: false,
    currentBenefits: ['snap-foodshare'],
    ageYears: 34, veteranHousehold: false, disability: false, insured: true,
    inCollege: false, businessOwner: false, lowAssets: true, onMedicare: false,
  },
  {
    name: 'senior homeowner alone, Madison, 72, $18k, disabled',
    state: 'WI', county: 'dane', city: 'madison', householdSize: 1, annualHouseholdIncome: 18_000,
    housingStatus: 'own-home', paysHeatingCost: true, facingLossOfHousing: false, utilityShutoffRisk: false,
    hasChildUnder5: false, hasSchoolAgeChild: false, isPregnantOrPostpartum: false,
    currentBenefits: ['medicaid-badgercare'],
    ageYears: 72, veteranHousehold: false, disability: true, insured: true,
    inCollege: false, businessOwner: false, lowAssets: true, onMedicare: true,
  },
  {
    name: 'unhoused single adult, Madison, 45, $4k',
    state: 'WI', county: 'dane', city: 'madison', householdSize: 1, annualHouseholdIncome: 4_000,
    housingStatus: 'unhoused-or-temporary', paysHeatingCost: false, facingLossOfHousing: false, utilityShutoffRisk: false,
    hasChildUnder5: false, hasSchoolAgeChild: false, isPregnantOrPostpartum: false,
    currentBenefits: [],
    ageYears: 45, veteranHousehold: false, disability: false, insured: false,
    inCollege: false, businessOwner: false, lowAssets: true, onMedicare: false,
  },
  {
    name: 'veteran and spouse, Dane outside Madison, 58, $30k, disabled',
    state: 'WI', county: 'dane', city: 'other', householdSize: 2, annualHouseholdIncome: 30_000,
    housingStatus: 'renting', paysHeatingCost: true, facingLossOfHousing: false, utilityShutoffRisk: false,
    hasChildUnder5: false, hasSchoolAgeChild: false, isPregnantOrPostpartum: false,
    currentBenefits: [],
    ageYears: 58, veteranHousehold: true, disability: true, insured: true,
    inCollege: false, businessOwner: false, lowAssets: true, onMedicare: false,
  },
  {
    name: 'single parent facing eviction, Madison, 29, $14k',
    state: 'WI', county: 'dane', city: 'madison', householdSize: 2, annualHouseholdIncome: 14_000,
    housingStatus: 'renting', paysHeatingCost: true, facingLossOfHousing: true, utilityShutoffRisk: true,
    hasChildUnder5: true, hasSchoolAgeChild: false, isPregnantOrPostpartum: false,
    currentBenefits: ['snap-foodshare', 'medicaid-badgercare'],
    ageYears: 29, veteranHousehold: false, disability: false, insured: true,
    inCollege: false, businessOwner: false, lowAssets: true, onMedicare: false,
  },
];

const PERSONA_ONLY = [
  'name', 'ageYears', 'veteranHousehold', 'disability', 'insured',
  'inCollege', 'businessOwner', 'lowAssets', 'onMedicare',
];

const ageBand = (years) =>
  years < 16 ? 'under-16'
  : years < 18 ? '16-17'
  : years < 40 ? '18-39'
  : years < 55 ? '40-54'
  : years < 60 ? '55-59'
  : years < 62 ? '60-61'
  : years < 65 ? '62-64'
  : '65-plus';

/**
 * One candidate change to the interview, expressed as the corpus fact keys it
 * would let the engine decide. Keys are the coinages in each candidate's
 * `factsNeeded`; a bundle answers all the spellings of one concept at once,
 * which is the point -- the interview asks a person once.
 */
const BUNDLES = {
  'numeric-age': (p, a) => {
    a.age = p.ageYears;
    a.isAdult = p.ageYears >= 18;
    a.isAtLeast16 = p.ageYears >= 16;
    a.ageAtLeast17AndAHalf = p.ageYears >= 17.5;
    a.ageBetween18And59 = p.ageYears >= 18 && p.ageYears <= 59;
    a.ageAtLeast55 = p.ageYears >= 55;
    a.ageExact = p.ageYears;
    a.age62Plus = p.ageYears >= 62;
    a.age18to61 = p.ageYears >= 18 && p.ageYears <= 61;
    a.householdIncludesAnAdult = true;
  },
  'veteran-boolean-only': (p, a) => {
    a.isVeteran = p.veteranHousehold;
  },
  'veteran-connection': (p, a) => {
    a.isVeteran = p.veteranHousehold;
    a.isSpouseOrDependentOfVeteran = p.veteranHousehold;
    a.isSpouseOfVeteran = p.veteranHousehold;
    a.isDependentOrSurvivorOfVeteran = p.veteranHousehold;
    a.isSurvivingSpouseOrDependentOfEligibleVeteran = p.veteranHousehold;
    a.isSpouseOrChildOfVeteran = p.veteranHousehold;
    a.isGoldStarParent = false;
  },
  disability: (p, a) => {
    a.hasDisability = p.disability;
    a.isDisabled = p.disability;
  },
  'child-under-18': (p, a) => {
    const child = p.hasChildUnder5 || p.hasSchoolAgeChild;
    a.hasChildUnder18InHome = child;
    a.isParent = child;
    a.livingWithAndCaringForOwnMinorChild = child;
    a.hasChildUnder6 = p.hasChildUnder5;
    a.hasChildUnder3 = p.hasChildUnder5;
    a.childUnder19 = child;
  },
  // No new question: these are existing answers re-read, which is why the
  // roadmap calls this the cheapest item on the list.
  'homelessness-mapping': (p, a) => {
    a.isExperiencingHomelessness = p.housingStatus === 'unhoused-or-temporary';
    a.atRiskOfHomelessness = p.facingLossOfHousing;
    a.facingImpendingHomelessness = p.facingLossOfHousing;
    a.housingStabilityAtRisk = p.facingLossOfHousing;
    a.childIsHomeless =
      p.housingStatus === 'unhoused-or-temporary' && (p.hasChildUnder5 || p.hasSchoolAgeChild);
  },
  'benefit-list-additions': (p, a) => {
    a.currentBenefits = [...p.currentBenefits, ...(p.onMedicare ? ['medicare'] : [])];
    a.entitledToMedicarePartAOrBID = p.onMedicare;
    a.eligibleForMedicare = p.onMedicare;
    a.receivesWisconsinSSIPayment = p.currentBenefits.includes('ssi');
  },
  'health-insurance': (p, a) => {
    a.hasHealthInsurance = p.insured;
    a.insuranceCoversScreenings = p.insured;
    a.canAffordInsuranceCostSharing = p.insured;
  },
  'college-enrolment': (p, a) => {
    a.enrolledAtParticipatingWisconsinInstitution = p.inCollege;
    a.enrolledAtLeastPartTime = p.inCollege;
    a.enrolledAtLeastHalfTime = p.inCollege;
    a.isUndergraduateInDegreeOrCertificateProgram = p.inCollege;
  },
  'business-owner': (p, a) => {
    a.isBusinessOwnerOrEntrepreneur = p.businessOwner;
    a.businessOperatesInWisconsin = p.businessOwner;
  },
  'coarse-assets': (p, a) => {
    a.assetsAtOrBelow2500ExcludingModestCar = p.lowAssets;
    a.assetsWithinEALimitExcludingModestCar = p.lowAssets;
    a.countableAssetsAtOrBelowMspLimit = p.lowAssets;
    a.liquidAssetsAtOrBelow46000 = p.lowAssets;
  },
};

// Candidates written against the 3-band AGE_BANDS. Rewritten to numeric
// comparisons when a bundle supplies an exact age, so the two are comparable.
const BAND_TESTS = [
  ['{"kind":"set","fact":"age","op":"in","values":["60-64","65-plus","under-60"]}', '{"kind":"always"}'],
  ['{"kind":"set","fact":"age","op":"in","values":["60-64","65-plus"]}', '{"kind":"compare","fact":"age","op":"gte","value":60}'],
  ['{"kind":"set","fact":"age","op":"in","values":["65-plus"]}', '{"kind":"compare","fact":"age","op":"gte","value":65}'],
];

function asNumericAge(rule) {
  let text = JSON.stringify(rule);
  for (const [band, numeric] of BAND_TESTS) text = text.split(band).join(numeric);
  return JSON.parse(text);
}

function answersFor(persona, bundleNames) {
  const answers = { ...persona };
  for (const key of PERSONA_ONLY) delete answers[key];
  answers.age = ageBand(persona.ageYears);
  for (const name of bundleNames) BUNDLES[name](persona, answers);
  return answers;
}

const corpus = readCorpus();

/** Mean buckets across the personas, for one set of bundles. */
function score(bundleNames) {
  let eligible = 0;
  let might = 0;
  let ruledOut = 0;
  for (const persona of PERSONAS) {
    const answers = answersFor(persona, bundleNames);
    for (const { doc } of corpus) {
      let rule = doc.rule?.eligibility;
      if (!rule) {
        might += 1;
        continue;
      }
      if (typeof answers.age === 'number') rule = asNumericAge(rule);
      const verdict = evaluate(rule, answers);
      if (verdict === 1) eligible += 1;
      else if (verdict === 0) ruledOut += 1;
      else might += 1;
    }
  }
  const n = PERSONAS.length;
  return { eligible: eligible / n, might: might / n, ruledOut: ruledOut / n };
}

const pct = (n) => `${Math.round((n / corpus.length) * 100)}%`;
const line = (label, s) =>
  `${label.padEnd(36)} eligible ${s.eligible.toFixed(1).padStart(4)}  |  might ${s.might
    .toFixed(1)
    .padStart(5)} (${pct(s.might).padStart(4)})  |  ruled out ${s.ruledOut.toFixed(1).padStart(5)}`;

const TIER_1 = [
  'veteran-connection', 'disability', 'child-under-18',
  'homelessness-mapping', 'benefit-list-additions', 'numeric-age',
];
const TIER_2 = ['health-insurance', 'college-enrolment', 'business-owner'];

const today = score([]);
const tier1 = score(TIER_1);
const both = score([...TIER_1, ...TIER_2]);

console.log(`${corpus.length} candidates, ${PERSONAS.length} personas\n`);
console.log('=== per persona, with today\'s vocabulary ===');
for (const persona of PERSONAS) {
  const answers = answersFor(persona, []);
  let eligible = 0;
  let might = 0;
  let ruledOut = 0;
  for (const { doc } of corpus) {
    const rule = doc.rule?.eligibility;
    if (!rule) {
      might += 1;
      continue;
    }
    const verdict = evaluate(rule, answers);
    if (verdict === 1) eligible += 1;
    else if (verdict === 0) ruledOut += 1;
    else might += 1;
  }
  console.log(line(persona.name.slice(0, 34), { eligible, might, ruledOut }));
}

console.log('\n=== tiers (mean across personas) ===');
console.log(line('today only', today));
console.log(line('tier 1 without the age change', score(TIER_1.filter((b) => b !== 'numeric-age'))));
console.log(line('tier 1', tier1));
console.log(line('tier 1 + tier 2', both));
console.log(line('tier 1 + tier 2 + coarse assets', score([...TIER_1, ...TIER_2, 'coarse-assets'])));

console.log('\n=== each bundle alone, on top of today ===');
const solo = Object.keys(BUNDLES)
  .map((b) => ({ b, s: score([b]) }))
  .sort((x, y) => x.s.might - y.s.might);
for (const { b, s } of solo) {
  console.log(`${b.padEnd(24)} might ${s.might.toFixed(1).padStart(5)}   settles ${(today.might - s.might).toFixed(1).padStart(5)}`);
}

console.log('\n=== each bundle removed from tier 1 + tier 2 (what omitting it costs) ===');
const all = [...TIER_1, ...TIER_2];
const marginal = all
  .map((b) => ({ b, s: score(all.filter((x) => x !== b)) }))
  .sort((x, y) => y.s.might - x.s.might);
for (const { b, s } of marginal) {
  console.log(`${b.padEnd(24)} might ${s.might.toFixed(1).padStart(5)}   costs +${(s.might - both.might).toFixed(1)}`);
}

console.log('\n=== still "might" for all five personas, with tier 1 + tier 2 answered ===');
const stuck = corpus
  .filter(({ doc }) =>
    PERSONAS.every((persona) => {
      let rule = doc.rule?.eligibility;
      if (!rule) return true;
      const answers = answersFor(persona, all);
      if (typeof answers.age === 'number') rule = asNumericAge(rule);
      return evaluate(rule, answers) === null;
    }),
  )
  .map(({ id }) => id);
console.log(`${stuck.length} of ${corpus.length}:`);
for (const id of stuck) console.log(`  ${id}`);
