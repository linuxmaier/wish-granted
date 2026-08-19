import type { Answers, FactKey } from '@/domain/facts';
import { BENEFIT_ENROLLMENTS, FACTS } from '@/domain/facts';

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
];

export const ALL_QUESTIONS: readonly Question[] = SCREENS.flatMap((s) => s.questions);

/** Every fact the interview is capable of supplying. */
export const ASKED_FACTS: readonly FactKey[] = [
  ...new Set(ALL_QUESTIONS.flatMap(factsSuppliedBy)),
];

export function screenById(id: string): Screen | undefined {
  return SCREENS.find((s) => s.id === id);
}
