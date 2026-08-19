import { useCallback, useMemo, useState } from 'react';
import type { Answers, FactKey } from '@/domain/facts';
import { PROGRAMS } from '@/data/programs';
import { matchAll } from '@/engine/match';
import type { MatchResult } from '@/engine/match';
import { SCREENS } from '@/interview/screens';
import type { Question, Screen } from '@/interview/screens';
import { nextScreen, progress, relevantQuestions } from '@/interview/flow';
import {
  applyChoice,
  applyFlags,
  applyMulti,
  applyNumber,
} from '@/interview/answers';

/**
 * All interview state, held in React and nowhere else.
 *
 * This is the privacy constraint made concrete: answers live in a `useState`
 * hook for the lifetime of the tab. Nothing here writes to localStorage,
 * sessionStorage, cookies, the URL, or any network call. Closing the tab
 * destroys the data, which is the intended behaviour, not a limitation --
 * see docs/design.md, "Privacy architecture".
 *
 * If a future change adds persistence of any kind, it has to start here, which
 * is why all of it is deliberately funnelled through this one hook.
 */

export interface InterviewState {
  readonly answers: Answers;
  readonly result: MatchResult;
  readonly screen: Screen | null;
  readonly questions: readonly Question[];
  readonly history: readonly string[];
  readonly progress: number;
  readonly isComplete: boolean;
  readonly canGoBack: boolean;
  readonly answerChoice: (question: Question, value: string) => void;
  readonly answerFlags: (question: Question, checked: readonly FactKey[]) => void;
  readonly answerNumber: (fact: FactKey, value: number) => void;
  readonly answerMulti: (fact: FactKey, values: readonly string[]) => void;
  readonly goNext: () => void;
  readonly goBack: () => void;
  readonly restart: () => void;
}

const FIRST_SCREEN = SCREENS[0]?.id ?? '';

export function useInterview(): InterviewState {
  const [answers, setAnswers] = useState<Answers>({});
  const [history, setHistory] = useState<readonly string[]>([FIRST_SCREEN]);
  const [isComplete, setIsComplete] = useState(false);

  // Re-matching the whole dataset on every answer keeps the results provably in
  // sync with the answers. With a dataset this size it is far cheaper than the
  // bookkeeping needed to avoid it.
  const result = useMemo(() => matchAll(PROGRAMS, answers), [answers]);

  const currentId = history[history.length - 1] ?? null;
  const screen = useMemo(
    () => (isComplete ? null : (SCREENS.find((s) => s.id === currentId) ?? null)),
    [currentId, isComplete],
  );

  /**
   * Questions are ranked against the answers as they were when the screen
   * opened, not as they are now. Re-ranking live would reshuffle the controls
   * under the user's cursor as they fill the screen in.
   */
  const [screenSnapshot, setScreenSnapshot] = useState<Answers>({});
  const questions = useMemo(() => {
    if (!screen) return [];
    return relevantQuestions(screen, screenSnapshot, matchAll(PROGRAMS, screenSnapshot));
  }, [screen, screenSnapshot]);

  const goNext = useCallback(() => {
    const next = nextScreen(answers, matchAll(PROGRAMS, answers), history);
    if (next) {
      setScreenSnapshot(answers);
      setHistory((h) => [...h, next.id]);
    } else {
      setIsComplete(true);
    }
  }, [answers, history]);

  const goBack = useCallback(() => {
    if (isComplete) {
      setIsComplete(false);
      return;
    }
    setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h));
  }, [isComplete]);

  const restart = useCallback(() => {
    setAnswers({});
    setHistory([FIRST_SCREEN]);
    setScreenSnapshot({});
    setIsComplete(false);
  }, []);

  return {
    answers,
    result,
    screen,
    questions,
    history,
    progress: progress(history, answers, result),
    isComplete,
    canGoBack: history.length > 1 || isComplete,
    answerChoice: useCallback(
      (question, value) => setAnswers((a) => applyChoice(a, question, value)),
      [],
    ),
    answerFlags: useCallback(
      (question, checked) => setAnswers((a) => applyFlags(a, question, checked)),
      [],
    ),
    answerNumber: useCallback((fact, value) => setAnswers((a) => applyNumber(a, fact, value)), []),
    answerMulti: useCallback((fact, values) => setAnswers((a) => applyMulti(a, fact, values)), []),
    goNext,
    goBack,
    restart,
  };
}
