import { useState } from 'react';
import { CATEGORY_LABELS, JURISDICTION_LABELS } from '@/domain/program';
import type { ProgramMatch } from '@/engine/match';
import { StateIcon } from './icons';

/**
 * One program in the results.
 *
 * Progressive disclosure (#11): the topline -- name, badge, meta, the concrete
 * `benefit` line, a status note when relevant, and the apply action -- is
 * always visible. It is deliberately the part someone in a hurry needs without
 * clicking anything: what is this, and how do I get it. Expanding reveals the
 * program description, the numbered steps, and "before you apply" caveats,
 * which are real but secondary once the action itself is in hand.
 *
 * The "why?" disclosure is independent of that and always available at both
 * levels -- it is the point of the whole explainable-rules design: a verdict
 * nobody can interrogate is not much better than a guess, and someone told
 * they do not qualify deserves to see which specific thing ruled them out,
 * often something they can correct.
 *
 * `ruledOut` cards get neither the apply action nor the details disclosure --
 * there is nothing to act on, so the summary alone (in place of `benefit`)
 * plus "why this result?" is the whole card. That is not new in this change;
 * it is the existing `bucket !== 'ruledOut'` gate, kept as is.
 */

const BUCKET_LABEL = {
  eligible: 'You likely qualify',
  maybe: 'You might qualify',
  ruledOut: 'Probably not a match',
} as const;

export function ProgramCard({ match }: { readonly match: ProgramMatch }) {
  const { program, bucket, reasons } = match;

  /*
   * All buckets start collapsed. The original plan here was "eligible starts
   * expanded, maybe starts collapsed" on the theory that eligible is the
   * small, actionable bucket. Measured instead of assumed, on the
   * crisis-family persona (13 eligible + 2 maybe -- eligible is *not* small
   * for a realistic household) at 360px, results-panel height:
   *
   *   main (current production)     18386px
   *   eligible expanded by default  17397px  (-5%)
   *   everything collapsed           7976px  (-57%)
   *
   * Now that the apply action lives in the topline rather than behind this
   * disclosure (per review on this PR), expanding an eligible card by default
   * buys the reader almost nothing they urgently need -- name, benefit,
   * badge, status, and the "How to apply" button/phone are already visible
   * collapsed -- while costing more than half the space savings this issue
   * exists to deliver. So: collapsed by default for every bucket that gets
   * this disclosure at all (`ruledOut` never does, see above).
   *
   * This reads `bucket` only at mount, not on every render, which would be a
   * bug if a card's bucket could change under a live instance -- a manual
   * expand/collapse would then survive a bucket transition it should not.
   * It cannot happen here: verified that Results.tsx renders the eligible and
   * maybe groups as separate sibling JSX blocks, so a program moving between
   * buckets moves to a different parent and React remounts the card (fresh
   * state) rather than reconciling it in place, even though `key` is the same
   * `program.id` in both places. A remount is exactly the right time to
   * re-decide the default -- which, since it is the same `false` regardless
   * of bucket, is moot today but keeps this correct if a future bucket ever
   * wants a different default.
   */
  const [expanded, setExpanded] = useState(false);
  const [showWhy, setShowWhy] = useState(false);

  return (
    <article className={`program program--${bucket}`}>
      <header className="program__head">
        <h3 className="program__name">{program.name}</h3>
        <span className={`badge badge--${bucket}`}>
          <StateIcon bucket={bucket} className="badge__icon" />
          {BUCKET_LABEL[bucket]}
        </span>
      </header>

      <p className="program__meta">
        {JURISDICTION_LABELS[program.jurisdiction]}
        {' · '}
        {program.categories.map((c) => CATEGORY_LABELS[c]).join(', ')}
        {program.provider === 'nonprofit' && ' · Non-government'}
      </p>

      {bucket === 'ruledOut' ? (
        <p className="program__summary">{program.summary}</p>
      ) : (
        <>
          <p className="program__benefit">
            <strong>What you get:</strong> {program.benefit}
          </p>

          {program.status !== 'open' && (
            <p className="program__status">
              {program.status === 'waitlist' && 'There is usually a waiting list. '}
              {program.status === 'seasonal' && 'Seasonal. '}
              {program.status === 'closed' && 'Not currently accepting applications. '}
              {program.seasonalNote}
            </p>
          )}

          <div className="program__apply">
            <a
              className="button button--quiet"
              href={program.howToApply.url}
              target="_blank"
              rel="noreferrer"
            >
              How to apply
            </a>
            {program.howToApply.phone && (
              <a className="button button--quiet" href={`tel:${program.howToApply.phone}`}>
                {program.howToApply.phone}
              </a>
            )}
          </div>

          {/*
            aria-label carries the program name into the accessible name.
            Without it, a screen-reader user tabbing through up to fifteen
            cards hears "Show details" fifteen times with nothing to tell them
            apart; the visible label stays short for sighted scanning.
          */}
          <button
            type="button"
            className="link-button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Hide' : 'Show'} details for ${program.name}`}
          >
            {expanded ? 'Hide details' : 'Show details'}
          </button>

          {expanded && (
            <>
              <p className="program__summary">{program.summary}</p>

              {program.howToApply.steps && (
                <ol className="program__steps">
                  {program.howToApply.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              )}

              {program.eligibilityCaveats && program.eligibilityCaveats.length > 0 && (
                <div className="program__caveats">
                  <strong>Before you apply</strong>
                  <ul>
                    {program.eligibilityCaveats.map((caveat) => (
                      <li key={caveat}>{caveat}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </>
      )}

      <button
        type="button"
        className="link-button"
        onClick={() => setShowWhy((v) => !v)}
        aria-expanded={showWhy}
        aria-label={`${showWhy ? 'Hide reasoning for' : 'Why this result:'} ${program.name}`}
      >
        {showWhy ? 'Hide reasoning' : 'Why this result?'}
      </button>

      {showWhy && (
        <div className="program__why">
          <ul>
            {reasons.map((reason, i) => (
              <li key={i} className={`reason reason--${reason.verdict}`}>
                {reason.description}
                {reason.note && <em> {reason.note}</em>}
              </li>
            ))}
          </ul>
          <p className="program__source">
            Source:{' '}
            <a href={program.source.url} target="_blank" rel="noreferrer">
              {program.source.name}
            </a>
            {program.source.lastVerified
              ? ` · last checked ${program.source.lastVerified}`
              : ' · not yet verified'}
          </p>
        </div>
      )}
    </article>
  );
}
