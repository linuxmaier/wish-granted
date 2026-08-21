import { useState } from 'react';
import { CATEGORY_LABELS, JURISDICTION_LABELS } from '@/domain/program';
import type { ProgramMatch } from '@/engine/match';
import { StateIcon } from './icons';

/**
 * One program in the results. The "why?" disclosure is the point of the whole
 * explainable-rules design: a verdict nobody can interrogate is not much better
 * than a guess, and someone told they do not qualify deserves to see which
 * specific thing ruled them out -- often it is something they can correct.
 */

const BUCKET_LABEL = {
  eligible: 'You likely qualify',
  maybe: 'You might qualify',
  ruledOut: 'Probably not a match',
} as const;

export function ProgramCard({ match }: { readonly match: ProgramMatch }) {
  const [showWhy, setShowWhy] = useState(false);
  const { program, bucket, reasons } = match;

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

      <p className="program__summary">{program.summary}</p>

      {bucket !== 'ruledOut' && (
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

      <button type="button" className="link-button" onClick={() => setShowWhy((v) => !v)}>
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
