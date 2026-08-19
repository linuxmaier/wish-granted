import type { Answers, FactKey } from '@/domain/facts';
import type { Jurisdiction, Program } from '@/domain/program';
import { evaluate, decidingReasons } from './evaluate';
import type { Trace } from './evaluate';

/**
 * Runs the whole dataset against the answers so far and sorts programs into the
 * three buckets the product shows, plus the ranking of which facts are worth
 * asking about next.
 *
 * Everything here is a pure function of (programs, answers). No caching, no
 * mutation, no I/O -- with a dataset of this size (tens of programs) a full
 * re-evaluation on every keystroke is far cheaper than the machinery needed to
 * avoid one, and it means the displayed results can never drift out of sync
 * with the answers.
 */

export type Bucket =
  /** Every criterion we can check passes. Still subject to `eligibilityCaveats`. */
  | 'eligible'
  /** Nothing has failed, but something is still unknown. */
  | 'maybe'
  /** At least one criterion definitively fails. */
  | 'ruledOut';

export interface ProgramMatch {
  readonly program: Program;
  readonly bucket: Bucket;
  readonly trace: Trace;
  /** The leaf criteria that actually decided this verdict, for the "why?" panel. */
  readonly reasons: readonly Trace[];
  /** Unanswered facts that could still move this program out of `maybe`. */
  readonly missingFacts: readonly FactKey[];
}

export interface FactPriority {
  readonly fact: FactKey;
  /**
   * How many `maybe` programs are waiting on this fact. Higher means answering
   * it resolves more of the board.
   */
  readonly resolves: number;
}

export interface MatchResult {
  readonly eligible: readonly ProgramMatch[];
  readonly maybe: readonly ProgramMatch[];
  readonly ruledOut: readonly ProgramMatch[];
  readonly all: readonly ProgramMatch[];
  /** Unanswered facts, most informative first. Drives adaptive screen ordering. */
  readonly factPriorities: readonly FactPriority[];
}

/** Most local first -- the brief's Madison -> Dane -> WI -> Federal framing. */
const JURISDICTION_ORDER: Record<Jurisdiction, number> = {
  city: 0,
  county: 1,
  state: 2,
  federal: 3,
};

function byLocalityThenName(a: ProgramMatch, b: ProgramMatch): number {
  const byLocality =
    JURISDICTION_ORDER[a.program.jurisdiction] - JURISDICTION_ORDER[b.program.jurisdiction];
  return byLocality !== 0 ? byLocality : a.program.name.localeCompare(b.program.name);
}

function bucketFor(trace: Trace): Bucket {
  switch (trace.verdict) {
    case 'pass':
      return 'eligible';
    case 'fail':
      return 'ruledOut';
    case 'unknown':
      return 'maybe';
  }
}

export function matchProgram(program: Program, answers: Answers): ProgramMatch {
  const trace = evaluate(program.eligibility, answers);
  return {
    program,
    bucket: bucketFor(trace),
    trace,
    reasons: decidingReasons(trace),
    missingFacts: trace.missingFacts,
  };
}

export function matchAll(programs: readonly Program[], answers: Answers): MatchResult {
  const all = programs.map((p) => matchProgram(p, answers));

  const eligible = all.filter((m) => m.bucket === 'eligible').sort(byLocalityThenName);
  const maybe = all.filter((m) => m.bucket === 'maybe').sort(byLocalityThenName);
  const ruledOut = all.filter((m) => m.bucket === 'ruledOut').sort(byLocalityThenName);

  return { eligible, maybe, ruledOut, all, factPriorities: rankFacts(maybe, answers) };
}

/**
 * Ranks unanswered facts by how many still-undecided programs are waiting on
 * them.
 *
 * Deliberately a plain count rather than an information-theoretic score. A true
 * entropy calculation would need a prior over how people answer, which we do
 * not have and could only get by collecting answers -- exactly what the privacy
 * constraint forbids. Counting how many programs a fact would unblock needs no
 * data about anyone, and on a dataset this size it picks the same questions an
 * entropy measure would in almost every case.
 *
 * Only `maybe` programs contribute: a fact that only appears in already-decided
 * programs has nothing left to resolve.
 */
export function rankFacts(maybe: readonly ProgramMatch[], answers: Answers): FactPriority[] {
  const counts = new Map<FactKey, number>();

  for (const match of maybe) {
    for (const fact of match.missingFacts) {
      if (answers[fact] !== undefined) continue;
      counts.set(fact, (counts.get(fact) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([fact, resolves]) => ({ fact, resolves }))
    .sort((a, b) => b.resolves - a.resolves || a.fact.localeCompare(b.fact));
}

/** Convenience for progress UI: how much of the board is still undecided. */
export function isSettled(result: MatchResult): boolean {
  return result.maybe.length === 0;
}
