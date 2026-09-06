import type { Program } from '../../../src/domain/program.ts';
import { countManualReview } from './criterion-normalize.ts';

/**
 * Turning the curated dataset into benchmark cases (docs/program-benchmark.md,
 * "Ground truth").
 *
 * A record is VERIFIED when `source.lastVerified` is a date rather than null. It
 * is read from the record, not hard-coded: when #45 gives
 * dane-eviction-prevention a real verification date the scored set grows by one
 * automatically.
 *
 * Three buckets:
 *   - `scored`         verified records. Full scoring: eligibility equivalence,
 *                      dangerous wrongness, abstention, descriptive, coverage.
 *   - `abstentionOnly` an unverified record whose verified *state* is itself an
 *                      abstention (its eligibility contains a `manualReview`).
 *                      dane-eviction-prevention is the current example (#45): we
 *                      cannot score it for correctness because the ground truth
 *                      is unconfirmed, but "does the candidate also abstain?" is
 *                      still a fair, safe question. Never counted in a
 *                      correctness denominator.
 *   - `excluded`       an unverified record with a concrete eligibility rule --
 *                      nothing here can be trusted as ground truth, so it is
 *                      dropped entirely rather than inflating any denominator.
 */

export interface BenchmarkCase {
  readonly programId: string;
  readonly sourceUrl: string;
  readonly sourceName: string;
  readonly verified: Program;
}

export interface CasePartition {
  readonly scored: BenchmarkCase[];
  readonly abstentionOnly: BenchmarkCase[];
  readonly excluded: { readonly programId: string; readonly reason: string }[];
}

export function isVerified(p: Program): boolean {
  return p.source.lastVerified !== null;
}

function toCase(p: Program): BenchmarkCase {
  return { programId: p.id, sourceUrl: p.source.url, sourceName: p.source.name, verified: p };
}

export function partitionPrograms(programs: readonly Program[]): CasePartition {
  const scored: BenchmarkCase[] = [];
  const abstentionOnly: BenchmarkCase[] = [];
  const excluded: { programId: string; reason: string }[] = [];

  for (const p of programs) {
    if (isVerified(p)) {
      scored.push(toCase(p));
    } else if (countManualReview(p.eligibility) > 0) {
      abstentionOnly.push(toCase(p));
    } else {
      excluded.push({
        programId: p.id,
        reason: 'unverified (source.lastVerified is null) and its eligibility rule is concrete, so it is not usable ground truth',
      });
    }
  }

  return { scored, abstentionOnly, excluded };
}
