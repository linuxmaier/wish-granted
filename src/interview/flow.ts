import type { Answers, FactKey } from '@/domain/facts';
import type { MatchResult, ProgramMatch } from '@/engine/match';
import { SCREENS, factsSuppliedBy } from './screens';
import type { Question, Screen } from './screens';

/**
 * Decides what to ask next, and what not to ask at all.
 *
 * The rule is: a question earns its place only by changing an outcome. After
 * every answer we re-evaluate the whole dataset, and any question that can no
 * longer move a program between buckets is dropped. Someone outside Wisconsin
 * is left with a handful of federal questions rather than the full interview,
 * and nobody is asked about heating bills once every energy program has already
 * been settled.
 *
 * Ordering follows the same logic: ask whichever remaining question resolves
 * the most undecided programs. Combined with the compound questions in
 * screens.ts -- where one answer can supply several facts -- this is what keeps
 * the interview short.
 *
 * One deliberate constraint on the adaptivity: a screen the user has already
 * visited keeps its place in history, and re-ranking only ever applies to
 * screens not yet seen. Without that, going back could change what "next"
 * means and the back button stops being trustworthy.
 */

/** Facts this question would newly establish, given what is already answered. */
export function unansweredFacts(question: Question, answers: Answers): FactKey[] {
  return factsSuppliedBy(question).filter((f) => answers[f] === undefined);
}

/**
 * How many still-undecided programs this question could resolve.
 *
 * Counts distinct programs rather than summing per-fact tallies: a program
 * waiting on both `householdSize` and `annualHouseholdIncome` should count once
 * toward a question that supplies both, not twice.
 */
export function questionImpact(
  question: Question,
  answers: Answers,
  result: MatchResult,
): number {
  if (!(question.showIf?.(answers) ?? true)) return 0;

  const supplies = new Set(unansweredFacts(question, answers));
  if (supplies.size === 0) return 0;

  return result.maybe.filter((m: ProgramMatch) =>
    m.missingFacts.some((f) => supplies.has(f)),
  ).length;
}

/** A question is worth asking when it would still change someone's results. */
export function isQuestionRelevant(
  question: Question,
  answers: Answers,
  result: MatchResult,
): boolean {
  return questionImpact(question, answers, result) > 0;
}

/**
 * The questions on a screen still worth asking, most decisive first -- unless
 * the screen names an `anchorQuestionId`, in which case that question leads
 * (when it is still relevant at all) and the rest follow in impact order.
 *
 * The anchor is not exempt from the relevance filter: it is scored and
 * dropped like any other question, so a screen cannot resurrect a question
 * nothing undecided depends on just because it was marked as the anchor.
 */
export function relevantQuestions(
  screen: Screen,
  answers: Answers,
  result: MatchResult,
): Question[] {
  const scored = screen.questions
    .map((question) => ({ question, impact: questionImpact(question, answers, result) }))
    .filter((q) => q.impact > 0);

  const anchorIndex = screen.anchorQuestionId
    ? scored.findIndex((q) => q.question.id === screen.anchorQuestionId)
    : -1;
  const anchor = anchorIndex >= 0 ? scored[anchorIndex] : undefined;
  const rest = anchor ? scored.filter((_, i) => i !== anchorIndex) : scored;

  rest.sort((a, b) => b.impact - a.impact || a.question.id.localeCompare(b.question.id));

  return anchor ? [anchor.question, ...rest.map((q) => q.question)] : rest.map((q) => q.question);
}

export function isScreenRelevant(
  screen: Screen,
  answers: Answers,
  result: MatchResult,
): boolean {
  return relevantQuestions(screen, answers, result).length > 0;
}

/** How much of the remaining board a screen could resolve. */
export function screenImpact(
  screen: Screen,
  answers: Answers,
  result: MatchResult,
): number {
  const supplies = new Set<FactKey>();
  for (const question of screen.questions) {
    if (!(question.showIf?.(answers) ?? true)) continue;
    for (const fact of unansweredFacts(question, answers)) supplies.add(fact);
  }
  if (supplies.size === 0) return 0;

  return result.maybe.filter((m) => m.missingFacts.some((f) => supplies.has(f))).length;
}

/** Screens still worth showing, most decisive first. */
export function relevantScreens(
  answers: Answers,
  result: MatchResult,
  visited: readonly string[] = [],
): Screen[] {
  const seen = new Set(visited);
  return SCREENS.filter((s) => !seen.has(s.id) && isScreenRelevant(s, answers, result)).sort(
    (a, b) =>
      screenImpact(b, answers, result) - screenImpact(a, answers, result) ||
      SCREENS.indexOf(a) - SCREENS.indexOf(b),
  );
}

/**
 * The next screen to show, or null when nothing left to ask would change the
 * results. `visited` is the screens already shown, which are never re-offered.
 */
export function nextScreen(
  answers: Answers,
  result: MatchResult,
  visited: readonly string[] = [],
): Screen | null {
  return relevantScreens(answers, result, visited)[0] ?? null;
}

/**
 * The screen to go back to. Driven by visit history rather than recomputed
 * relevance: a screen is usually irrelevant *because* the user answered it, and
 * going back must still reach it.
 */
export function previousScreen(history: readonly string[]): string | null {
  return history.length >= 2 ? (history[history.length - 2] ?? null) : null;
}

/**
 * Rough progress, for the progress bar. It can jump forward when an answer
 * makes several later screens irrelevant, which is honest -- the interview
 * really did just get shorter.
 */
export function progress(
  history: readonly string[],
  answers: Answers,
  result: MatchResult,
): number {
  const done = history.length;
  const remaining = relevantScreens(answers, result, history).length;
  const total = done + remaining;
  return total === 0 ? 1 : done / total;
}
