import type { Answers, FactKey } from '@/domain/facts';
import { factsSuppliedBy } from './screens';
import type { Question } from './screens';

/**
 * Turning UI events into fact assignments.
 *
 * Kept apart from the React components because the mapping is not always one
 * control to one fact -- a choice can imply several facts, and a checklist
 * assigns `false` to the boxes left unchecked. That logic is worth testing
 * directly rather than through a rendered component.
 *
 * Every function here returns a new object. Answers are treated as immutable so
 * React re-renders predictably and so the "go back and change an answer" path
 * cannot leave stale facts behind.
 */

export function applyChoice(
  answers: Answers,
  question: Question,
  choiceValue: string,
): Answers {
  if (question.input.type !== 'choice') return answers;
  const choice = question.input.choices.find((c) => c.value === choiceValue);
  if (!choice) return answers;

  // Clear first: a different choice may imply fewer facts than the previous
  // one, and those stale facts would otherwise survive the change.
  return { ...clearQuestion(answers, question), ...choice.implies };
}

/**
 * Applies a checklist answer.
 *
 * The important half is the unchecked boxes: they are recorded as `false`, not
 * left unknown. Submitting "none of these" is a real answer that resolves every
 * fact in the group, which is what makes one checklist worth three questions.
 */
export function applyFlags(
  answers: Answers,
  question: Question,
  checked: readonly FactKey[],
): Answers {
  if (question.input.type !== 'flags') return answers;
  const checkedSet = new Set(checked);

  const next: Answers = { ...answers };
  for (const flag of question.input.flags) {
    next[flag.fact] = checkedSet.has(flag.fact);
  }
  return next;
}

export function applyNumber(answers: Answers, fact: FactKey, value: number): Answers {
  return { ...answers, [fact]: value };
}

export function applyMulti(
  answers: Answers,
  fact: FactKey,
  values: readonly string[],
): Answers {
  return { ...answers, [fact]: [...values] };
}

/** Removes everything a question established. Used when an answer is changed. */
export function clearQuestion(answers: Answers, question: Question): Answers {
  const next: Answers = { ...answers };
  for (const fact of factsSuppliedBy(question)) delete next[fact];
  return next;
}

/**
 * Which choice is currently selected, reconstructed from the facts rather than
 * stored separately.
 *
 * Answers are the single source of truth, so navigating back has to re-derive
 * the control state from them. A choice counts as selected when every fact it
 * implies matches -- and the most specific match wins, since "Madison" and
 * "elsewhere in Dane County" both imply `county: 'dane'`.
 */
export function selectedChoice(question: Question, answers: Answers): string | undefined {
  if (question.input.type !== 'choice') return undefined;

  const matches = question.input.choices.filter((choice) =>
    Object.entries(choice.implies).every(
      ([fact, value]) => answers[fact as FactKey] === value,
    ),
  );

  return matches.sort(
    (a, b) => Object.keys(b.implies).length - Object.keys(a.implies).length,
  )[0]?.value;
}

/** Facts checked in a `flags` question, for re-rendering after navigating back. */
export function checkedFlags(question: Question, answers: Answers): FactKey[] {
  if (question.input.type !== 'flags') return [];
  return question.input.flags.filter((f) => answers[f.fact] === true).map((f) => f.fact);
}

/** True once every fact a `flags` question covers has been recorded either way. */
export function isFlagsAnswered(question: Question, answers: Answers): boolean {
  if (question.input.type !== 'flags') return false;
  return question.input.flags.every((f) => answers[f.fact] !== undefined);
}

/** Has this question been answered at all? */
export function isAnswered(question: Question, answers: Answers): boolean {
  if (question.input.type === 'flags') return isFlagsAnswered(question, answers);
  return factsSuppliedBy(question).some((f) => answers[f] !== undefined);
}
