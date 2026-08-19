import { useState } from 'react';
import type { MatchResult } from '@/engine/match';
import { ProgramCard } from './ProgramCard';

/**
 * The results panel, visible from the first screen onward.
 *
 * Showing matches while the interview is still running is the core of the
 * product: it gives an immediate reason to answer the next question, and it
 * means someone who abandons halfway still leaves with something useful. The
 * "might qualify" group is therefore not a holding pen -- early on it is where
 * almost everything lives, and it is presented as genuine leads rather than as
 * incomplete work.
 */

export function Results({
  result,
  isComplete,
}: {
  readonly result: MatchResult;
  readonly isComplete: boolean;
}) {
  const [showRuledOut, setShowRuledOut] = useState(false);
  const { eligible, maybe, ruledOut } = result;

  return (
    // Named via its own heading so it is exposed as a landmark region: results
    // change as the interview is answered, and a screen reader user needs to be
    // able to jump to them rather than hunt through the questions.
    <section className="results" aria-live="polite" aria-labelledby="results-title">
      <h2 className="results__title" id="results-title">
        {isComplete ? 'Your results' : 'Matches so far'}
      </h2>

      {eligible.length > 0 && (
        <div className="results__group">
          <h3 className="results__heading">
            Likely a match <span className="count">{eligible.length}</span>
          </h3>
          {eligible.map((match) => (
            <ProgramCard key={match.program.id} match={match} />
          ))}
        </div>
      )}

      {maybe.length > 0 && (
        <div className="results__group">
          <h3 className="results__heading">
            Might qualify <span className="count">{maybe.length}</span>
          </h3>
          <p className="results__note">
            {isComplete
              ? 'These depend on something we cannot check for you — a waiting list, or funding that may have run out. They are worth a call.'
              : 'Answer a few more questions to narrow these down.'}
          </p>
          {maybe.map((match) => (
            <ProgramCard key={match.program.id} match={match} />
          ))}
        </div>
      )}

      {eligible.length === 0 && maybe.length === 0 && (
        <p className="results__empty">
          Nothing matched yet. Keep going — most programs need a couple of answers before
          they can be checked.
        </p>
      )}

      {ruledOut.length > 0 && (
        <div className="results__group">
          <button
            type="button"
            className="link-button"
            onClick={() => setShowRuledOut((v) => !v)}
            aria-expanded={showRuledOut}
          >
            {showRuledOut ? 'Hide' : 'Show'} {ruledOut.length} ruled out
          </button>
          {/*
            Ruled-out programs stay reachable on purpose. The reason a program
            did not match is frequently something the person can act on -- an
            income figure they estimated high, a county line they were wrong
            about -- and hiding it entirely would remove that chance.
          */}
          {showRuledOut &&
            ruledOut.map((match) => <ProgramCard key={match.program.id} match={match} />)}
        </div>
      )}
    </section>
  );
}
