import { useState } from 'react';
import type { MatchResult } from '@/engine/match';
import { NATIONAL_RESOURCES } from '@/data/national-resources';
import { ProgramCard } from './ProgramCard';
import { StateIcon } from './icons';
import { matchSummaryText } from './matchSummary';

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

/**
 * Where to go when this tool has nothing to offer. Shown instead of padding the
 * results with programs that do not actually apply.
 */
function NationalFallback({ heading, lead }: { readonly heading: string; readonly lead: string }) {
  return (
    <div className="fallback">
      <h3 className="fallback__title">{heading}</h3>
      <p>{lead}</p>
      <ul className="fallback__list">
        {NATIONAL_RESOURCES.map((resource) => (
          <li key={resource.url}>
            <a href={resource.url} target="_blank" rel="noreferrer">
              {resource.name}
            </a>
            {resource.phone && <span className="fallback__phone"> · dial {resource.phone}</span>}
            <span className="fallback__desc"> — {resource.description}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Results({
  result,
  isComplete,
  isOutOfScope,
}: {
  readonly result: MatchResult;
  readonly isComplete: boolean;
  /** The user told us they live outside Wisconsin, which v1 does not cover. */
  readonly isOutOfScope: boolean;
}) {
  const [showRuledOut, setShowRuledOut] = useState(false);
  const { eligible, maybe, ruledOut } = result;
  const foundNothing = eligible.length === 0 && maybe.length === 0;

  return (
    // Named via its own heading so it is exposed as a landmark region: results
    // change as the interview is answered, and a screen reader user needs to be
    // able to jump to them rather than hunt through the questions. This section
    // is deliberately NOT aria-live: it can hold up to 15 full program cards, and
    // wrapping the whole thing meant a screen reader re-announced all of it after
    // every single answer (issue #13). The one thing worth announcing -- how many
    // matches there are now -- gets its own narrow, visually-hidden status region
    // below, instead. See docs/design.md, "Live regions."
    <section className="results" aria-labelledby="results-title">
      <h2 className="results__title" id="results-title">
        {isComplete ? 'Your results' : 'Matches so far'}
      </h2>

      {/*
        The only thing announced to assistive tech as results change: a short
        count, nothing else. `role="status"` is implicitly `aria-live="polite"
        aria-atomic="true"` -- it queues rather than interrupts, and always reads
        the whole (short) sentence rather than a stray fragment. This is the one
        copy of this text that is actually in the accessibility tree at every
        viewport width; MobileSummary shows the same words but is `display: none`
        above 900px, so it can't be the source of truth for desktop.
      */}
      <p className="sr-only" role="status">
        {matchSummaryText(eligible.length, maybe.length)}
      </p>

      {eligible.length > 0 && (
        <div className="results__group">
          <h3 className="results__heading">
            <StateIcon bucket="eligible" className="results__heading-icon" />
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
            <StateIcon bucket="maybe" className="results__heading-icon" />
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

      {/*
        Three distinct situations, which used to be conflated into one vague
        "nothing matched yet" line:
          - outside Wisconsin, where we know we cannot help and should say so
            immediately rather than at the end of a pointless interview;
          - finished with genuinely nothing, which is a real outcome and needs
            somewhere else to send people;
          - mid-interview with nothing decided yet, which is just normal.
      */}
      {isOutOfScope && (
        <NationalFallback
          heading="This tool only covers Wisconsin"
          lead={
            eligible.length > 0 || maybe.length > 0
              ? 'Wish Granted covers Madison, Dane County, and Wisconsin. Any nationwide programs you may qualify for are still listed above — for everything else, start here:'
              : 'Wish Granted covers Madison, Dane County, and Wisconsin, so it cannot help with programs where you live. These cover the whole country:'
          }
        />
      )}

      {!isOutOfScope && foundNothing && isComplete && (
        <NationalFallback
          heading="No matches in our current data"
          lead="Nothing in this dataset fits your answers. That does not mean nothing exists — our coverage is limited to Housing & utilities and Food & basic needs, and to a small set of programs. These can look wider:"
        />
      )}

      {!isOutOfScope && foundNothing && !isComplete && (
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
            <StateIcon bucket="ruledOut" className="results__heading-icon" />
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
