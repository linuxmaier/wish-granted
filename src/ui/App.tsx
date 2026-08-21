import { useEffect, useRef, useState } from 'react';
import { useInterview } from './useInterview';
import { QuestionField } from './components/QuestionField';
import { Results } from './components/Results';
import { MobileSummary } from './components/MobileSummary';
import { unverifiedPrograms } from '@/data/programs';
import { allIncomeTablesVerified } from '@/engine/thresholds';

/**
 * The whole app: interview on the left, live results on the right (a single
 * stacked column on narrow screens, with a bottom strip that jumps to
 * results without scrolling past the interview -- see `MobileSummary`).
 *
 * There is no router and no server. Every screen transition is local state, so
 * there is no URL carrying answers around and nothing to leak in a referrer
 * header or a browser history entry.
 */

const DATA_IS_UNVERIFIED = unverifiedPrograms().length > 0 || !allIncomeTablesVerified();

/**
 * A question can make several later screens irrelevant at once, so the
 * progress bar can legitimately leap forward on one answer. Left
 * unexplained that reads as broken. Rather than hide the jump, this names
 * it: a one-line note appears for a few seconds the first time progress
 * advances by more than a small step.
 */
function useProgressJumpNote(progress: number): boolean {
  const previous = useRef(progress);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const delta = progress - previous.current;
    previous.current = progress;
    if (delta > 0.12) {
      setVisible(true);
      const timer = setTimeout(() => setVisible(false), 4000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [progress]);

  return visible;
}

export function App() {
  const interview = useInterview();
  const { screen, questions, answers, result, isComplete } = interview;
  const showJumpNote = useProgressJumpNote(interview.progress);

  // `progress` is done / (done + remaining) and `done` is always exactly
  // history.length (see src/interview/flow.ts), so the total screen count
  // can be reconstructed exactly rather than estimated.
  const stepNumber = interview.history.length;
  const stepTotal = Math.max(stepNumber, Math.round(stepNumber / interview.progress));

  return (
    <div className="app">
      {/*
        This banner is load-bearing, not decoration. The seed dataset has not
        been checked against its sources, and shipping benefit figures that
        might be wrong without saying so would be worse than shipping nothing.
        It disappears on its own once every record carries a verification date.

        Styled as a calm, factual notice rather than a caution-tape warning --
        this audience may already be anxious, and a loud yellow alert as the
        first thing on the page reads as "something is wrong with this site"
        rather than "double check these numbers". The wording keeps the exact
        phrase tests/ui/app.test.tsx asserts on ("not yet been checked").
      */}
      {DATA_IS_UNVERIFIED && (
        <div className="banner banner--notice" role="alert">
          <svg className="banner__icon" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
            <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M10 6.2v4.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="10" cy="13.6" r="0.9" fill="currentColor" />
          </svg>
          <p>
            <strong>Not yet verified.</strong> The program details and income limits here have
            not yet been checked against their official sources. Treat every result as a lead
            to confirm, not an answer.
          </p>
        </div>
      )}

      <header className="masthead">
        <h1>Wish Granted</h1>
        <p className="masthead__tagline">
          Find grants and assistance you may qualify for in Madison, Dane County, and
          Wisconsin.
        </p>
        <p className="masthead__privacy">
          Your answers stay in this browser tab. Nothing is sent anywhere, nothing is
          saved, and there is no account.
        </p>
      </header>

      <main className="layout">
        <section className="interview">
          {screen ? (
            <>
              <div className="progress-wrap">
                <div
                  className="progress"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(interview.progress * 100)}
                  aria-label={`Step ${stepNumber} of about ${stepTotal}`}
                >
                  <div className="progress__bar" style={{ width: `${interview.progress * 100}%` }} />
                </div>
                <p className="progress__label">
                  Step {stepNumber} of about {stepTotal}
                  {showJumpNote && (
                    <span className="progress__note">
                      {' '}
                      · A couple of questions were skipped — your answers so far already settle them.
                    </span>
                  )}
                </p>
              </div>

              <h2 className="interview__title">{screen.title}</h2>
              {screen.intro && <p className="interview__intro">{screen.intro}</p>}

              {questions.map((question) => (
                <QuestionField
                  key={question.id}
                  question={question}
                  answers={answers}
                  onChoice={interview.answerChoice}
                  onFlags={interview.answerFlags}
                  onNumber={interview.answerNumber}
                  onMulti={interview.answerMulti}
                />
              ))}

              <div className="interview__nav">
                {interview.canGoBack && (
                  <button type="button" className="button button--quiet" onClick={interview.goBack}>
                    Back
                  </button>
                )}
                <button type="button" className="button" onClick={interview.goNext}>
                  Continue
                </button>
                <p className="interview__skip">
                  You can skip anything you would rather not answer. Programs that depend on
                  it will stay in “might qualify” rather than being ruled out.
                </p>
              </div>
            </>
          ) : (
            <div className="interview__done">
              <h2>That is everything we need to ask.</h2>
              <p>
                Nothing left to ask would change your results. Your matches are in the
                results panel — open “Why this result?” on any of them to see the reasoning.
              </p>
              <div className="interview__nav">
                <button type="button" className="button button--quiet" onClick={interview.goBack}>
                  Back
                </button>
                <button type="button" className="button button--quiet" onClick={interview.restart}>
                  Start over
                </button>
              </div>
            </div>
          )}
        </section>

        {/*
          Keyboard/tab order note: this sits between the interview controls
          and the results cards in document order, so it is reachable right
          after "Continue" -- a shortcut to the results, not a detour before
          the current question. Hidden entirely above the two-column
          breakpoint (see .mobile-summary in styles.css), where the results
          column is already visible without scrolling.
        */}
        <MobileSummary eligibleCount={result.eligible.length} maybeCount={result.maybe.length} />

        <Results
          result={result}
          isComplete={isComplete}
          isOutOfScope={answers.state === 'other'}
        />
      </main>

      <footer className="footer">
        <p>
          <strong>This is not legal or financial advice.</strong> Wish Granted is an
          unofficial guide. Eligibility rules change, funding runs out, and only the agency
          running a program can tell you whether you qualify. Always confirm with the
          source linked on each program before relying on anything here.
        </p>
        <p>
          Results are generated by matching your answers against published eligibility
          rules. Every program links to the official source it was written from.
        </p>
      </footer>
    </div>
  );
}
