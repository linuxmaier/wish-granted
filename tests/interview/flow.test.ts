import { describe, expect, it } from 'vitest';
import type { Answers, FactKey } from '@/domain/facts';
import type { Program } from '@/domain/program';
import { isTrue } from '@/domain/criteria';
import { PROGRAMS } from '@/data/programs';
import { matchAll } from '@/engine/match';
import { ALL_QUESTIONS, SCREENS, factsSuppliedBy } from '@/interview/screens';
import type { Question, Screen } from '@/interview/screens';
import {
  isQuestionRelevant,
  isScreenRelevant,
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

// --- Anchored questions -----------------------------------------------------

/**
 * A minimal, otherwise-inert program whose entire `eligibility` is "this one
 * fact must be true." Used to build synthetic `maybe` buckets with exactly the
 * `missingFacts` a test wants, independent of anything in the real seed
 * dataset. Two fixture programs differing only in which fact they gate on is
 * enough to give two synthetic questions a controlled, deterministic impact
 * gap -- no coincidence of real income thresholds involved.
 */
function fixtureProgram(id: string, fact: FactKey): Program {
  return {
    id,
    name: id,
    administeredBy: 'fixture',
    jurisdiction: 'state',
    provider: 'government',
    categories: ['housing-utilities'],
    summary: 'fixture program for anchor tests',
    benefit: 'fixture',
    eligibility: isTrue(fact),
    howToApply: { url: 'https://example.test' },
    status: 'open',
    source: { url: 'https://example.test', name: 'fixture', lastVerified: null },
  };
}

describe('a screen can anchor one question ahead of the impact sort', () => {
  it('every anchorQuestionId names a real question on that screen', () => {
    // A typo here fails silently otherwise: the anchor just stops taking
    // effect and every other test still passes. Check it explicitly, and
    // across all screens so this keeps working when a second screen grows
    // an anchor later.
    for (const screen of SCREENS) {
      if (screen.anchorQuestionId === undefined) continue;
      expect(
        screen.questions.some((q) => q.id === screen.anchorQuestionId),
        `${screen.id} anchors '${screen.anchorQuestionId}', which is not one of its questions`,
      ).toBe(true);
    }
  });

  it('asks housing status before housing trouble', () => {
    const answers = { state: 'WI', county: 'dane', city: 'madison' };
    const result = matchAll(PROGRAMS, answers);
    const housing = SCREENS.find((s) => s.id === 'housing')!;
    const ordered = relevantQuestions(housing, answers, result);

    expect(ordered.map((q) => q.id)).toEqual(['housing-status', 'housing-trouble']);
    // Every housing-adjacent program in the seed set that gates on
    // facingLossOfHousing/utilityShutoffRisk/paysHeatingCost (housing-trouble's
    // facts) is income-tested against the same dane-ami/wi-smi thresholds as
    // the programs that gate on housingStatus, so at this stage -- nothing but
    // geography answered -- the two questions tie in raw impact rather than
    // trouble outscoring status. The anchor's job is to guarantee status leads
    // regardless of how that tally lands, not to overturn a scoring upset;
    // assert the tie holds so a future data change that breaks it (giving
    // trouble a program status can't match) gets noticed here.
    expect(questionImpact(ordered[1]!, answers, result)).toBe(questionImpact(ordered[0]!, answers, result));
  });

  it('drops the anchor along with the rest of the screen once nothing on it is undecided', () => {
    // High income decides every housing-adjacent program in the seed set --
    // not just the housingStatus-dependent ones. dane-eviction-prevention
    // fails on facingLossOfHousing; madison-housing-choice-voucher,
    // wisconsin-weatherization, madison-water-bill-assistance (MadCAP), and
    // both WHEAP programs all fail their income test (dane-ami or wi-smi,
    // both well under $200k for a 2-person household). So this demonstrates
    // more than "the anchor gets dropped like anything else" -- the whole
    // screen resolves, proving the anchor cannot keep a screen alive on its
    // own once nothing on it, anchored or not, is still undecided.
    const answers = {
      state: 'WI',
      county: 'dane',
      city: 'other',
      householdSize: 2,
      annualHouseholdIncome: 200_000,
      currentBenefits: [] as string[],
      facingLossOfHousing: false,
    };
    const result = matchAll(PROGRAMS, answers);
    const housing = SCREENS.find((s) => s.id === 'housing')!;

    expect(questionImpact(ALL_QUESTIONS.find((q) => q.id === 'housing-status')!, answers, result)).toBe(
      0,
    );
    expect(questionImpact(ALL_QUESTIONS.find((q) => q.id === 'housing-trouble')!, answers, result)).toBe(
      0,
    );
    expect(relevantQuestions(housing, answers, result)).toEqual([]);
    expect(isScreenRelevant(housing, answers, result)).toBe(false);
  });

  it('leads with the anchor even when a sibling question clearly outscores it (synthetic)', () => {
    // The real housing screen ties at this stage (see the test above) -- a
    // tie alone can't prove the anchor mechanism does anything, since
    // `relevantQuestions`' own tie-break (`a.question.id.localeCompare(b...)`)
    // happens to also put "housing-status" before "housing-trouble"
    // alphabetically. A synthetic screen with a real, controlled score gap is
    // what actually exercises the anchor: three fixture programs depend on
    // `hasChildUnder5`, only one depends on `isVeteran`, so left to impact
    // alone "outscores" would sort first -- and it does not.
    const anchorFact: FactKey = 'isVeteran';
    const outscoresFact: FactKey = 'hasChildUnder5';
    const programs: Program[] = [
      fixtureProgram('fixture-anchor-1', anchorFact),
      fixtureProgram('fixture-outscores-1', outscoresFact),
      fixtureProgram('fixture-outscores-2', outscoresFact),
      fixtureProgram('fixture-outscores-3', outscoresFact),
    ];
    const anchorQuestion: Question = {
      id: 'fixture-anchor',
      prompt: 'fixture anchor question',
      input: { type: 'multi', fact: anchorFact, choices: [], noneLabel: 'None' },
    };
    const outscoresQuestion: Question = {
      id: 'fixture-outscores',
      prompt: 'fixture outscoring question',
      input: { type: 'multi', fact: outscoresFact, choices: [], noneLabel: 'None' },
    };
    const screen: Screen = {
      id: 'fixture-screen',
      title: 'fixture screen',
      questions: [anchorQuestion, outscoresQuestion],
      anchorQuestionId: 'fixture-anchor',
    };

    const result = matchAll(programs, {});

    // The gap is real, not assumed: outscores wins on impact alone.
    expect(questionImpact(outscoresQuestion, {}, result)).toBe(3);
    expect(questionImpact(anchorQuestion, {}, result)).toBe(1);
    expect(questionImpact(outscoresQuestion, {}, result)).toBeGreaterThan(
      questionImpact(anchorQuestion, {}, result),
    );

    // Yet the anchor still leads -- this is the anchor mechanism doing real
    // work, not an artifact of impact order or id sort order (an unanchored
    // sort here would put 'fixture-outscores' first on impact, and it also
    // sorts before 'fixture-anchor' alphabetically, so both of the ordering's
    // other possible explanations are ruled out).
    expect(relevantQuestions(screen, {}, result).map((q) => q.id)).toEqual([
      'fixture-anchor',
      'fixture-outscores',
    ]);
  });

  it('drops the anchor while a sibling question on the same screen stays relevant (synthetic)', () => {
    // This is the property #16 was written to guarantee: an anchor doesn't
    // resurrect itself within a screen that is still genuinely alive for
    // other reasons. It used to be demonstrable on the real housing screen
    // (housing-status dropping while housing-trouble survived on
    // wheap-crisis-assistance's utilityShutoffRisk dependency), but the fix
    // to that program's income-test bug (see wheap-crisis-assistance.ts)
    // removed the loophole that made it independently decidable from
    // wisconsin-weatherization's -- both now gate on the identical wi-smi
    // income test, and madison-housing-choice-voucher's `manualReview` leaf
    // means it can only ever be decided by *failing* that same coupling.
    // Exhaustively searched a wide grid of income/household-size/benefit/
    // geography combinations against the real seed data (household sizes
    // 1-10, ~17 income levels, 8 benefit combinations, both cities/counties,
    // facingLossOfHousing true/unset): zero combinations produce "housing-
    // status resolved, housing-trouble still undecided." That is a real,
    // provable consequence of the corrected data, not a search gap -- see the
    // "drops the anchor along with the rest of the screen" test above for the
    // real-data case this collapses into instead. A synthetic screen is what
    // lets this property stay under test in the meantime.
    const anchorFact: FactKey = 'isVeteran';
    const survivingFact: FactKey = 'hasChildUnder5';
    const programs: Program[] = [
      fixtureProgram('fixture-anchor-only', anchorFact),
      fixtureProgram('fixture-surviving-only', survivingFact),
    ];
    const anchorQuestion: Question = {
      id: 'fixture-anchor',
      prompt: 'fixture anchor question',
      input: { type: 'multi', fact: anchorFact, choices: [], noneLabel: 'None' },
    };
    const survivingQuestion: Question = {
      id: 'fixture-surviving',
      prompt: 'fixture surviving question',
      input: { type: 'multi', fact: survivingFact, choices: [], noneLabel: 'None' },
    };
    const screen: Screen = {
      id: 'fixture-screen-2',
      title: 'fixture screen',
      questions: [anchorQuestion, survivingQuestion],
      anchorQuestionId: 'fixture-anchor',
    };

    // Answering isVeteran resolves (rules out) the fixture program that
    // depends on it, so the anchor question no longer helps anything --
    // while hasChildUnder5 stays unanswered, so the surviving question and
    // the screen itself both stay alive.
    const answers: Answers = { isVeteran: false };
    const result = matchAll(programs, answers);

    expect(questionImpact(anchorQuestion, answers, result)).toBe(0);
    expect(questionImpact(survivingQuestion, answers, result)).toBeGreaterThan(0);
    expect(relevantQuestions(screen, answers, result).map((q) => q.id)).toEqual(['fixture-surviving']);
    expect(isScreenRelevant(screen, answers, result)).toBe(true);
  });

  it('leaves non-anchored screens sorted purely by impact', () => {
    const result = matchAll(PROGRAMS, { state: 'WI', county: 'dane', city: 'madison' });
    const household = SCREENS.find((s) => s.id === 'household')!;
    expect(household.anchorQuestionId).toBeUndefined();
    const ordered = relevantQuestions(household, { state: 'WI', county: 'dane', city: 'madison' }, result);
    const impacts = ordered.map((q) =>
      questionImpact(q, { state: 'WI', county: 'dane', city: 'madison' }, result),
    );
    expect(impacts).toEqual([...impacts].sort((a, b) => b - a));
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
