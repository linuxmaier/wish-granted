/**
 * The two-method seam for issue #84 (part of epic #65).
 *
 * Cross-method agreement does NOT ask the extracting model to police itself
 * (option 2, classify-first, and the agentic self-check all failed at that --
 * see issue #84). Instead it runs two *independent* methods against the same
 * source and cross-checks them mechanically:
 *
 *   - the deterministic Tier-3 parser (scripts/tier3-extract) -- structural
 *     document parsing, NO model call, ~14% dangerous on its own clean held-out
 *     split (#71/#73);
 *   - the agentic extractor (scripts/agentic-extract) -- an LLM with real source
 *     access.
 *
 * The two fail differently: the parser fails on open-ended prose, the LLM fails
 * on structure and scope. `MethodOutcome` is the common shape both are reduced
 * to before the referee (scripts/program-benchmark's `criterionEquivalence`)
 * compares them.
 */
import type { Criterion } from '../../../src/domain/criteria.ts';
import { isAbstention, type ExtractionResult } from '../../program-benchmark/lib/extractor.ts';

/** Which method produced an outcome -- carried through for reporting only. */
export type MethodName = 'deterministic' | 'agentic';

export type MethodOutcome =
  | { readonly decision: 'extract'; readonly criterion: Criterion }
  | { readonly decision: 'abstain'; readonly reason: string };

/**
 * The subset of scripts/tier3-extract's result this module needs. The parser
 * returns `unknown` for `criterion` (it is plain `.mjs`); the shape it builds
 * is a `Criterion` by construction (same builders, src/domain/criteria.ts).
 */
export interface DeterministicResult {
  readonly decision: 'extract' | 'abstain';
  readonly code: string;
  readonly reason: string;
  readonly criterion: unknown;
}

/** Adapt the deterministic Tier-3 parser's result to `MethodOutcome`. */
export function fromDeterministic(r: DeterministicResult): MethodOutcome {
  if (r.decision === 'extract' && r.criterion != null) {
    return { decision: 'extract', criterion: r.criterion as Criterion };
  }
  return { decision: 'abstain', reason: `${r.code}: ${r.reason}` };
}

/** Adapt the agentic extractor's `ExtractionResult` to `MethodOutcome`. */
export function fromAgentic(r: ExtractionResult): MethodOutcome {
  if (isAbstention(r)) return { decision: 'abstain', reason: r.reason };
  return { decision: 'extract', criterion: r.eligibility };
}

export function isExtract(
  o: MethodOutcome,
): o is { decision: 'extract'; criterion: Criterion } {
  return o.decision === 'extract';
}
