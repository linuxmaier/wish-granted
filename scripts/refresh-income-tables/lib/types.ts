/**
 * Every source fetcher returns one of these. The four failure shapes are deliberately
 * distinct (see docs/data-authoring.md) because they call for different human responses:
 *
 * - `not-yet-published`  -- the next year's figures legitimately don't exist yet. Quiet,
 *   not an error.
 * - `fetch-failed`       -- couldn't reach or read the source at all (network, non-200,
 *   moved page). Fix: find the new URL or wait out the outage.
 * - `parse-failed`       -- reached the source, but its shape didn't match what this
 *   script expects. Fix: update the parser for the new layout.
 * - `disagreement`       -- reached and parsed every source, but two independent sources
 *   (or a source vs. a regulation-derived expectation) don't agree. Fix: a human has to
 *   work out which source is right -- never averaged or guessed here.
 */
export type SourceResult<T> =
  | { status: 'not-yet-published' }
  | { status: 'fetch-failed'; message: string }
  | { status: 'parse-failed'; message: string }
  | { status: 'disagreement'; message: string }
  | { status: 'ok'; data: T; provenance: string[] };

export interface BySizeTableData {
  readonly bySize: readonly number[];
  readonly perAdditionalPerson: number;
  readonly effectiveYear: number;
  readonly source: string;
}

export interface DaneAmiData {
  readonly fourPersonMedian: number;
  readonly effectiveYear: number;
  readonly source: string;
}
