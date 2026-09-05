import {
  PROGRAMS,
  SNAPSHOT_GENERATED_AT,
  stalePrograms,
  unverifiedPrograms,
} from '@/data/programs';

/**
 * The global "data as of" line (issue #44).
 *
 * Two different claims are made about this dataset, and conflating them would
 * mislead people who may make financial decisions on the results:
 *
 *   - **Assembled** -- `SNAPSHOT_GENERATED_AT`, the instant `build:snapshot`
 *     compiled the records into `snapshot.json`. It moves only when a record's
 *     content actually changes (the generator carries the previous timestamp
 *     forward on a byte-for-byte-identical rebuild -- see
 *     `src/data/programs/build-snapshot.ts`), so it is a real "the data
 *     changed" signal, not a CI build clock. But a fresh build says *nothing*
 *     about whether a human has re-read any source page.
 *
 *   - **Verified** -- `source.lastVerified` per record, surfaced here as a
 *     count via `stalePrograms()` / `unverifiedPrograms()`. This is the half
 *     that says a person checked the figures against the official page, and
 *     when.
 *
 * So this component states the assembled date and, separately, how much of the
 * corpus is currently verified. It deliberately does not compute one blended
 * "freshness" number -- there isn't an honest one. The per-record date lives on
 * each program's "Why this result?" panel (`ProgramCard`), and the same
 * assembled-vs-verified split is the one `scripts/check-sources` reports use.
 *
 * Register: this is provenance, not a headline. It sits in the footer in the
 * footer's own quiet type, below the results and below the unverified-data
 * banner, and must stay quieter than both. It conveys nothing by colour.
 */

/** Days after which a record counts as due for re-checking; mirrors `stalePrograms()`'s default. */
const VERIFICATION_WINDOW_DAYS = 180;

/**
 * Format an ISO 8601 instant as e.g. "September 5, 2026", in UTC.
 *
 * `en-US`, not the viewer's locale: this app serves Madison, Wisconsin, and
 * month-first is what that audience reads without pausing. It also matches the
 * only other `Intl` call in the codebase (`src/engine/evaluate.ts` formats
 * currency as `en-US`).
 *
 * UTC, not the viewer's zone: `SNAPSHOT_GENERATED_AT` is a UTC instant and the
 * `<time datetime>` carries it in full, so the visible text should name the
 * same calendar day the instant falls on rather than shifting it west of
 * Greenwich for a US reader. No date library -- `Intl.DateTimeFormat` is in
 * every browser we target.
 */
export function formatSnapshotDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function DataProvenance() {
  const total = PROGRAMS.length;
  const neverChecked = unverifiedPrograms().length;
  const stale = stalePrograms(VERIFICATION_WINDOW_DAYS).length;
  const verified = total - stale;
  // stale includes the never-checked records, so this is the "checked once, but
  // long enough ago that it no longer counts" remainder.
  const lapsed = stale - neverChecked;

  return (
    <p className="footer__provenance">
      Program data assembled{' '}
      <time dateTime={SNAPSHOT_GENERATED_AT}>{formatSnapshotDate(SNAPSHOT_GENERATED_AT)}</time>.
      That is when the records were compiled into this app, not when their sources were last
      checked.{' '}
      {stale === 0 ? (
        <>All {total} programs have been verified against their source within the last six months.</>
      ) : (
        <>
          {verified} of {total} programs have been verified against their source within the last six
          months
          {neverChecked > 0 && (
            <>
              ; {neverChecked === 1 ? 'one' : neverChecked} {neverChecked === 1 ? 'has' : 'have'}{' '}
              never been checked
            </>
          )}
          {lapsed > 0 && (
            <>
              {neverChecked > 0 ? ' and' : ';'} {lapsed === 1 ? 'one is' : `${lapsed} are`} overdue
              for re-checking
            </>
          )}
          . Each program shows its own last-checked date under &ldquo;Why this result?&rdquo;.
        </>
      )}
    </p>
  );
}
