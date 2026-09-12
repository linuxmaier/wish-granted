import type { Answers, FactKey } from '@/domain/facts';
import { BENEFIT_ENROLLMENTS, FACTS, VETERAN_CONNECTIONS } from '@/domain/facts';

/**
 * The concrete v1 interview.
 *
 * The organising principle is that a question is expensive and a fact is cheap.
 * Every question asked is friction for someone who may be in a crisis, so the
 * interview is built to extract as many facts per question as the question can
 * honestly carry, and to skip anything that no longer changes an outcome.
 *
 * Three mechanisms do that work:
 *
 * 1. A single answer can establish several facts at once. "Where do you live?
 *    -> City of Madison" settles state, county, and city together; there is no
 *    reason to walk someone down a country/state/county/city ladder when the
 *    narrowest answer implies every wider one. Hence `implies` on a choice
 *    rather than one question per fact.
 *
 * 2. Related yes/no facts collapse into one multi-select. Three separate
 *    "is there a child under 5 / is anyone pregnant / is there a school-age
 *    child" questions become one "who is in your household" checklist that
 *    supplies all three facts. See the `flags` input type.
 *
 * 3. Questions are ordered by how many undecided programs they would resolve,
 *    and dropped entirely when the answer can no longer change anything. That
 *    lives in flow.ts, which needs the match results to compute it.
 */

// --- Question model -------------------------------------------------------

export interface Choice {
  /** Identity for the control. Not a fact value -- see `implies`. */
  readonly value: string;
  readonly label: string;
  readonly hint?: string;
  /**
   * The fact assignments this answer establishes. Usually more than one: the
   * whole point is that a specific answer entails the general ones.
   */
  readonly implies: Answers;
}

/** One checkbox in a `flags` question, standing for a single boolean fact. */
export interface Flag {
  readonly fact: FactKey;
  readonly label: string;
  readonly hint?: string;
}

export type QuestionInput =
  | {
      readonly type: 'number';
      readonly fact: FactKey;
      readonly min?: number;
      readonly max?: number;
      readonly step?: number;
      readonly prefix?: string;
      readonly suffix?: string;
      readonly placeholder?: string;
    }
  | { readonly type: 'choice'; readonly choices: readonly Choice[] }
  | {
      /**
       * A checklist over independent boolean facts. Checked means true and --
       * importantly -- submitting the screen sets every unchecked box to false.
       * That is what lets one question resolve several facts instead of leaving
       * the unchecked ones unknown.
       */
      readonly type: 'flags';
      readonly flags: readonly Flag[];
      readonly noneLabel: string;
    }
  | {
      /** A multi-select over the allowed values of one `enumSet` fact. */
      readonly type: 'multi';
      readonly fact: FactKey;
      readonly choices: readonly { value: string; label: string }[];
      readonly noneLabel: string;
    };

export interface Question {
  readonly id: string;
  /** Second person, plain language, no jargon. This is the actual UI text. */
  readonly prompt: string;
  /** Optional clarifier shown under the prompt. Use for "who counts" rules. */
  readonly help?: string;
  readonly input: QuestionInput;
  /**
   * Hides a question that is incoherent given earlier answers, regardless of
   * whether any program still wants it. Relevance -- "does anything undecided
   * depend on this?" -- is computed in flow.ts instead.
   */
  readonly showIf?: (answers: Answers) => boolean;
}

export interface Screen {
  readonly id: string;
  readonly title: string;
  readonly intro?: string;
  readonly questions: readonly Question[];
  /**
   * The id of a question on this screen that should stay first, ahead of the
   * impact sort, when it is relevant at all.
   *
   * An escape hatch, not a redesign: impact ordering is doing useful work and
   * remains the default for every other question on every other screen. Use
   * this only when a question is a natural preamble the others don't make
   * sense without -- e.g. asking someone's housing status before asking about
   * housing trouble. It does not exempt the anchor from the relevance filter:
   * an anchored question that no longer helps any undecided program settle is
   * still dropped entirely, same as any other question. See
   * `relevantQuestions` in flow.ts.
   */
  readonly anchorQuestionId?: string;
}

// --- Helpers --------------------------------------------------------------

/** Every fact a question could establish, across all of its possible answers. */
export function factsSuppliedBy(question: Question): FactKey[] {
  const { input } = question;
  switch (input.type) {
    case 'number':
    case 'multi':
      return [input.fact];
    case 'flags':
      return input.flags.map((f) => f.fact);
    case 'choice':
      return [...new Set(input.choices.flatMap((c) => Object.keys(c.implies) as FactKey[]))];
  }
}

function multiChoices(fact: FactKey, order: readonly string[]) {
  const labels = FACTS[fact].optionLabels ?? {};
  return order.map((value) => ({ value, label: labels[value] ?? value }));
}

// --- The interview --------------------------------------------------------

export const SCREENS: readonly Screen[] = [
  {
    id: 'location',
    title: 'Where you live',
    intro: 'Most assistance is tied to a specific city, county, or state.',
    questions: [
      {
        id: 'where',
        prompt: 'Where do you live?',
        help: 'Pick the most specific one that applies.',
        input: {
          type: 'choice',
          choices: [
            {
              value: 'madison',
              label: 'In the City of Madison',
              // The narrowest answer settles the two broader facts too, so the
              // interview never has to ask about county or state separately.
              implies: { city: 'madison', county: 'dane', state: 'WI' },
            },
            {
              value: 'dane',
              label: 'Elsewhere in Dane County',
              hint: 'Fitchburg, Sun Prairie, Middleton, Verona, and the rest of the county.',
              implies: { city: 'other', county: 'dane', state: 'WI' },
            },
            {
              value: 'wi',
              label: 'Elsewhere in Wisconsin',
              implies: { city: 'other', county: 'other-wi-county', state: 'WI' },
            },
            {
              value: 'outside',
              label: 'Outside Wisconsin',
              hint: 'You will still see federal programs.',
              implies: { city: 'other', county: 'other-wi-county', state: 'other' },
            },
          ],
        },
      },
    ],
  },

  {
    id: 'household',
    title: 'Your household',
    intro: 'Nearly every income limit is set relative to how many people are in your household.',
    questions: [
      {
        id: 'household-size',
        prompt: 'How many people are in your household?',
        help: 'Count everyone you buy and prepare food with, including yourself and any children.',
        input: { type: 'number', fact: 'householdSize', min: 1, max: 20, step: 1, placeholder: '1' },
      },
      {
        id: 'income',
        prompt: 'Roughly what is your household income before taxes, per year?',
        help: 'A rough number is fine. Include wages, benefits, and support from everyone in the household. This never leaves your browser.',
        input: {
          type: 'number',
          fact: 'annualHouseholdIncome',
          min: 0,
          max: 500_000,
          step: 500,
          prefix: '$',
          suffix: '/ year',
          placeholder: '0',
        },
      },
      {
        id: 'household-members',
        prompt: 'Does your household include any of these?',
        help: 'Several food programs are tied to young children, pregnancy, or school enrollment.',
        input: {
          type: 'flags',
          flags: [
            { fact: 'hasChildUnder5', label: 'A child under 5' },
            {
              fact: 'isPregnantOrPostpartum',
              label: 'Someone pregnant, or who gave birth in the last 6 months',
            },
            { fact: 'hasSchoolAgeChild', label: 'A school-age child (K-12)' },
          ],
          noneLabel: 'None of these',
        },
      },
    ],
  },

  {
    id: 'housing',
    title: 'Your housing and utilities',
    // The trouble checklist usually scores higher on impact than housing
    // status does, which would otherwise put it first -- correct by the
    // ranking rule, backwards to a person asked about housing trouble before
    // they've said what their housing situation even is.
    anchorQuestionId: 'housing-status',
    questions: [
      {
        id: 'housing-status',
        prompt: 'Which best describes your housing right now?',
        input: {
          type: 'choice',
          choices: [
            { value: 'renting', label: 'Renting', implies: { housingStatus: 'renting' } },
            { value: 'own-home', label: 'I own my home', implies: { housingStatus: 'own-home' } },
            {
              value: 'unhoused-or-temporary',
              label: 'Unhoused or in temporary housing',
              // Tempting to also infer `facingLossOfHousing: true` here, but it
              // is the wrong inference twice over: that fact means "at risk of
              // losing housing", which is not the same as already having lost
              // it, and the checklist below owns the fact. Two questions writing
              // one fact can contradict each other -- the checklist would later
              // overwrite this with false -- so each fact has exactly one
              // owner. tests/data/vocabulary.test.ts enforces that.
              implies: { housingStatus: 'unhoused-or-temporary' },
            },
            {
              value: 'living-with-others',
              label: 'Staying with family or friends',
              implies: { housingStatus: 'living-with-others' },
            },
          ],
        },
      },
      {
        id: 'housing-trouble',
        prompt: 'Is any of this happening right now?',
        help: 'These can qualify you for emergency help that moves faster than the normal process.',
        input: {
          type: 'flags',
          flags: [
            {
              fact: 'facingLossOfHousing',
              label: 'Behind on rent, facing eviction, or at risk of losing housing',
            },
            { fact: 'utilityShutoffRisk', label: 'A utility shutoff notice, or no working heat' },
            {
              fact: 'paysHeatingCost',
              label: 'I pay a heating or electric bill',
              hint: 'Counts even if heat is included in your rent.',
            },
          ],
          noneLabel: 'None of these',
        },
      },
    ],
  },

  {
    id: 'situation',
    title: 'Help you already receive',
    questions: [
      {
        id: 'current-benefits',
        prompt: 'Do you already receive any of these?',
        help: 'Being enrolled in one program often qualifies you automatically for others, so this can shorten the rest of the process.',
        input: {
          type: 'multi',
          fact: 'currentBenefits',
          choices: multiChoices('currentBenefits', BENEFIT_ENROLLMENTS),
          noneLabel: 'None of these',
        },
      },
    ],
  },

  {
    // A dedicated screen, for the same reason `about-you` is one: on its own
    // the impact sort parks it late, and the relevance filter drops it the
    // moment nothing undecided needs it -- which is immediately, for anyone
    // outside Wisconsin, since all three veterans records gate on geography
    // first.
    //
    // It is the highest-value question the corpus asked for: across the 60
    // research candidates it settles more programs than any other, and it is
    // the only way to stop showing a whole category to the ~90% of people it
    // does not apply to. See docs/interview-roadmap.md.
    id: 'military',
    title: 'Military service',
    questions: [
      {
        id: 'veteran-connection',
        prompt: "Is anyone in your household a veteran, or a veteran's family member?",
        // A set rather than a yes/no because the programs are: two of the
        // three records here can be satisfied through a family route, so
        // "no, nobody served" would leave them undecided for everyone. See
        // the `veteranConnection` FactSpec in domain/facts.ts.
        help: 'Some benefits are for the veteran, and others are for a spouse, a widow or widower, or a child. Check everything that applies. Skip this if you would rather not say — nothing gets ruled out for a blank answer.',
        input: {
          type: 'multi',
          fact: 'veteranConnection',
          choices: multiChoices('veteranConnection', VETERAN_CONNECTIONS),
          noneLabel: 'No one in my household',
        },
      },
    ],
  },

  {
    // A dedicated screen for one question, on purpose. Age resolves exactly
    // one shipped program today (badgercare-plus's 0-64 adult scope), so on
    // its own screen the impact sort parks it last and the relevance filter
    // drops it entirely the moment badgercare-plus settles some other way --
    // a household with children clears the pregnant/child branch regardless
    // of the applicant's age, and a household over ~306% FPL with no children
    // is ruled out on income. So most people never see this screen. Folded
    // into an earlier screen it would show for every Wisconsin resident
    // before those facts were known. The coverage case for asking at all
    // rests on the senior programs the Tier 3 corpus queued up, not on the
    // one program it changes today -- see issue #88 and docs/data-authoring.md.
    id: 'about-you',
    title: 'About you',
    questions: [
      {
        id: 'age',
        prompt: 'How old are you?',
        help: 'A range is all we need — never your date of birth. Programs set their cut-offs at different ages, which is why the ranges are uneven. Skip this if you would rather not say; nothing gets ruled out for a blank answer.',
        input: {
          // One choice per band, in AGE_BANDS order. The bands are uneven
          // because every boundary is a real program cut-off -- see AGE_BANDS
          // in domain/facts.ts for which program asks for which.
          type: 'choice',
          choices: [
            { value: 'under-16', label: 'Under 16', implies: { age: 'under-16' } },
            { value: '16-17', label: '16 or 17', implies: { age: '16-17' } },
            { value: '18-39', label: '18 to 39', implies: { age: '18-39' } },
            { value: '40-54', label: '40 to 54', implies: { age: '40-54' } },
            { value: '55-59', label: '55 to 59', implies: { age: '55-59' } },
            { value: '60-61', label: '60 or 61', implies: { age: '60-61' } },
            { value: '62-64', label: '62 to 64', implies: { age: '62-64' } },
            { value: '65-plus', label: '65 or older', implies: { age: '65-plus' } },
          ],
        },
      },
    ],
  },

  {
    // A dedicated screen, not folded into `situation` -- that was tried
    // first and broke two different ways (issue #9), worth recording so
    // nobody repeats the attempt:
    //
    // 1. Without a `showIf` guard, this question showed up as "relevant"
    //    from the very first screen: every WHEAP-family program starts out
    //    undecided, so `recentIncomeDrop` sat in their `missingFacts` before
    //    annual income was even known -- asked of nearly everyone.
    // 2. Adding `showIf` (requiring housingStatus/paysHeatingCost to already
    //    be known) fixed that, but sharing a screen with `current-benefits`
    //    created a *second*, worse problem: `current-benefits` alone often
    //    has enough independent impact to make the `situation` screen rank
    //    ahead of `housing` in the impact sort -- before this question's
    //    `showIf` has ever turned true. Screens are never revisited once
    //    shown (the back-button-trustworthiness invariant, see flow.ts), so
    //    `situation` would get "used up" on `current-benefits` alone and
    //    this question would silently never be offered, permanently. A real
    //    e2e run caught this; no unit test did, because `runInterview`'s
    //    unit harness always answers whatever's on a screen the moment it's
    //    shown, which never exposed the "screen visited before this
    //    question's precondition was true" case (see
    //    tests/e2e/personas.spec.ts).
    //
    // A dedicated screen sidesteps both: with only one question and a
    // `showIf` guard, this screen's own impact is forced to zero (see
    // `screenImpact` in flow.ts, which skips `showIf`-hidden questions)
    // until housingStatus and paysHeatingCost are both known -- so the
    // screen itself is never relevant, and therefore never visited, until
    // its precondition holds. It cannot get "used up" by an unrelated
    // question the way sharing a screen allowed.
    id: 'recent-income',
    title: 'One more thing',
    questions: [
      {
        // Every WHEAP-family program (see wheap-energy-assistance.ts) also
        // gates directly (outside the income `anyOf`) on a heating/housing
        // fact -- paysHeatingCost, utilityShutoffRisk, or housingStatus --
        // asked on the *housing* screen. That guarantees the housing screen
        // stays relevant and gets shown before this one's `showIf` can ever
        // turn true, so there is no circular wait between the two screens.
        // See tests/interview/flow.test.ts's issue #9 describe block for the
        // mechanism-level proof, not just the outcome.
        id: 'recent-income-drop',
        prompt: 'Has your income dropped significantly in the last month or two?',
        help: 'For example, a job loss or a big cut in hours. Programs that pay for heat sometimes look at your most recent income instead of the whole year, so this can help even if the number you gave above says you are over the limit.',
        input: {
          type: 'choice',
          choices: [
            { value: 'yes', label: 'Yes', implies: { recentIncomeDrop: true } },
            { value: 'no', label: 'No', implies: { recentIncomeDrop: false } },
          ],
        },
        showIf: (answers) => answers.housingStatus !== undefined && answers.paysHeatingCost !== undefined,
      },
    ],
  },
];

export const ALL_QUESTIONS: readonly Question[] = SCREENS.flatMap((s) => s.questions);

/** Every fact the interview is capable of supplying. */
export const ASKED_FACTS: readonly FactKey[] = [
  ...new Set(ALL_QUESTIONS.flatMap(factsSuppliedBy)),
];

export function screenById(id: string): Screen | undefined {
  return SCREENS.find((s) => s.id === id);
}
