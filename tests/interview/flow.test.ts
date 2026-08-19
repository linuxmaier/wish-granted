import { describe, expect, it } from 'vitest';
import type { Answers, FactKey } from '@/domain/facts';
import { PROGRAMS } from '@/data/programs';
import { matchAll } from '@/engine/match';
import { ALL_QUESTIONS, SCREENS, factsSuppliedBy } from '@/interview/screens';
import type { Question } from '@/interview/screens';
import {
  isQuestionRelevant,
  nextScreen,
  questionImpact,
  relevantQuestions,
} from '@/interview/flow';
import {
  applyChoice,
  applyFlags,
  applyMulti,
  applyNumber,
  checkedFlags,
  selectedChoice,
} from '@/interview/answers';

/**
 * These tests exist to protect the property the interview is built around: no
 * question is asked that could not change someone's results, and a single
 * answer settles as many facts as it honestly can.
 */

// --- Interview simulation -------------------------------------------------

/** Answers one question the way `persona` would, returning the updated answers. */
function answerAs(persona: Answers, answers: Answers, question: Question): Answers {
  const { input } = question;
  switch (input.type) {
    case 'number': {
      const value = persona[input.fact];
      return typeof value === 'number' ? applyNumber(answers, input.fact, value) : answers;
    }
    case 'multi': {
      const value = persona[input.fact];
      return Array.isArray(value) ? applyMulti(answers, input.fact, value) : answers;
    }
    case 'flags': {
      const checked = input.flags.filter((f) => persona[f.fact] === true).map((f) => f.fact);
      return applyFlags(answers, question, checked);
    }
    case 'choice': {
      const choice = input.choices.find((c) =>
        Object.entries(c.implies).every(([fact, v]) => persona[fact as FactKey] === v),
      );
      return choice ? applyChoice(answers, question, choice.value) : answers;
    }
  }
}

interface Run {
  answers: Answers;
  questionsAsked: number;
  screensShown: string[];
}

/** Plays the whole interview as `persona` would, exactly as the UI drives it. */
function runInterview(persona: Answers): Run {
  let answers: Answers = {};
  const screensShown: string[] = [];
  let questionsAsked = 0;

  for (let guard = 0; guard < 50; guard += 1) {
    const result = matchAll(PROGRAMS, answers);
    const screen = nextScreen(answers, result, screensShown);
    if (!screen) break;

    for (const question of relevantQuestions(screen, answers, matchAll(PROGRAMS, answers))) {
      answers = answerAs(persona, answers, question);
      questionsAsked += 1;
    }
    screensShown.push(screen.id);
  }

  return { answers, questionsAsked, screensShown };
}

// --- Personas -------------------------------------------------------------

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

const outOfState: Answers = {
  ...madisonFamily,
  state: 'other',
  county: 'other-wi-county',
  city: 'other',
};

// --- Compound questions ---------------------------------------------------

describe('one answer settles as many facts as it can', () => {
  it('asks about location once, not as a country/state/county/city ladder', () => {
    const locationQuestions = SCREENS.find((s) => s.id === 'location')?.questions ?? [];
    expect(locationQuestions).toHaveLength(1);
  });

  it('derives state and county from the narrowest location answer', () => {
    const where = ALL_QUESTIONS.find((q) => q.id === 'where')!;
    const answers = applyChoice({}, where, 'madison');
    expect(answers).toEqual({ city: 'madison', county: 'dane', state: 'WI' });
  });

  it('never asks separately for a fact an earlier answer already implied', () => {
    const { answers } = runInterview(madisonFamily);
    const supplied = ALL_QUESTIONS.flatMap(factsSuppliedBy);
    // Every geography fact is settled, yet only one question covers them.
    expect(answers.state).toBe('WI');
    expect(answers.county).toBe('dane');
    expect(answers.city).toBe('madison');
    expect(supplied.filter((f) => f === 'state')).toHaveLength(1);
  });

  it('records unchecked boxes as false so one checklist resolves every fact in it', () => {
    const members = ALL_QUESTIONS.find((q) => q.id === 'household-members')!;
    const answers = applyFlags({}, members, ['hasChildUnder5']);
    expect(answers.hasChildUnder5).toBe(true);
    expect(answers.isPregnantOrPostpartum).toBe(false);
    expect(answers.hasSchoolAgeChild).toBe(false);
  });

  it('only infers facts the answering question owns', () => {
    // An implication is only safe when no other question also writes the fact.
    // "Unhoused" looks like it implies `facingLossOfHousing`, but the housing
    // checklist owns that fact and would later overwrite the inference with
    // false. Implications must not cross question boundaries.
    const status = ALL_QUESTIONS.find((q) => q.id === 'housing-status')!;
    const answers = applyChoice({}, status, 'unhoused-or-temporary');
    expect(answers).toEqual({ housingStatus: 'unhoused-or-temporary' });
  });
});

// --- Not asking pointless questions --------------------------------------

describe('questions earn their place', () => {
  it('drops a question once nothing undecided depends on it', () => {
    const settled = matchAll(PROGRAMS, madisonFamily);
    for (const question of ALL_QUESTIONS) {
      expect(isQuestionRelevant(question, madisonFamily, settled)).toBe(false);
    }
  });

  it('gives an already-answered question zero impact', () => {
    const where = ALL_QUESTIONS.find((q) => q.id === 'where')!;
    const answers = applyChoice({}, where, 'madison');
    expect(questionImpact(where, answers, matchAll(PROGRAMS, answers))).toBe(0);
  });

  it('orders the most decisive question first within a screen', () => {
    const result = matchAll(PROGRAMS, { state: 'WI', county: 'dane', city: 'madison' });
    const household = SCREENS.find((s) => s.id === 'household')!;
    const ordered = relevantQuestions(household, { state: 'WI', county: 'dane', city: 'madison' }, result);
    const impacts = ordered.map((q) =>
      questionImpact(q, { state: 'WI', county: 'dane', city: 'madison' }, result),
    );
    expect(impacts).toEqual([...impacts].sort((a, b) => b - a));
  });

  it('asks location first, because it decides the most', () => {
    expect(nextScreen({}, matchAll(PROGRAMS, {}), [])?.id).toBe('location');
  });
});

// --- Whole-interview behaviour -------------------------------------------

describe('the interview as a whole', () => {
  it('terminates', () => {
    expect(runInterview(madisonFamily).screensShown.length).toBeGreaterThan(0);
    expect(nextForRun(madisonFamily)).toBeNull();
  });

  function nextForRun(persona: Answers) {
    const run = runInterview(persona);
    return nextScreen(run.answers, matchAll(PROGRAMS, run.answers), run.screensShown);
  }

  it('is markedly shorter for someone outside Wisconsin', () => {
    const local = runInterview(madisonFamily);
    const away = runInterview(outOfState);
    expect(away.questionsAsked).toBeLessThan(local.questionsAsked);
  });

  it('reaches the same verdicts the engine would from the full answer set', () => {
    const run = runInterview(madisonFamily);
    const viaInterview = matchAll(PROGRAMS, run.answers);
    const viaFullAnswers = matchAll(PROGRAMS, madisonFamily);
    expect(viaInterview.eligible.map((m) => m.program.id)).toEqual(
      viaFullAnswers.eligible.map((m) => m.program.id),
    );
  });

  it('leaves nothing undecided that another question could settle', () => {
    // Some programs stay in "might qualify" no matter how much we ask, because
    // a `manualReview` node models something no rules engine can decide -- an
    // open waiting list, funding that may have run out. Those are correct to
    // leave unresolved. What must not survive the interview is a program still
    // waiting on a *fact*, which would mean a question we failed to ask.
    const { answers } = runInterview(madisonFamily);
    const stillWaitingOnFacts = matchAll(PROGRAMS, answers).maybe.filter(
      (m) => m.missingFacts.length > 0,
    );
    expect(stillWaitingOnFacts.map((m) => m.program.id)).toEqual([]);
  });

  it('explains every remaining "might qualify" with a human-review note', () => {
    const { answers } = runInterview(madisonFamily);
    for (const match of matchAll(PROGRAMS, answers).maybe) {
      const notes = match.reasons.filter((r) => r.note !== undefined);
      expect(notes.length, `${match.program.id} has no explanation`).toBeGreaterThan(0);
    }
  });
});

// --- Round-tripping answers for back-navigation ---------------------------

describe('reconstructing control state from answers', () => {
  it('recovers the selected choice, preferring the most specific match', () => {
    const where = ALL_QUESTIONS.find((q) => q.id === 'where')!;
    for (const choice of where.input.type === 'choice' ? where.input.choices : []) {
      const answers = applyChoice({}, where, choice.value);
      expect(selectedChoice(where, answers)).toBe(choice.value);
    }
  });

  it('recovers checked flags', () => {
    const members = ALL_QUESTIONS.find((q) => q.id === 'household-members')!;
    const answers = applyFlags({}, members, ['hasChildUnder5', 'hasSchoolAgeChild']);
    expect(checkedFlags(members, answers).sort()).toEqual(['hasChildUnder5', 'hasSchoolAgeChild']);
  });

  it('clears stale facts when a choice is changed to a narrower one', () => {
    const where = ALL_QUESTIONS.find((q) => q.id === 'where')!;
    const madison = applyChoice({}, where, 'madison');
    const elsewhere = applyChoice(madison, where, 'outside');
    expect(elsewhere.state).toBe('other');
    expect(elsewhere.city).toBe('other');
    expect(elsewhere.county).toBe('other-wi-county');
  });
});
