/**
 * Path A of issue #84 -- cross-method agreement.
 *
 * Feed the two independent `Criterion` trees (deterministic parser, agentic
 * extractor) to `criterionEquivalence` from scripts/program-benchmark. That
 * function is the referee and is used UNCHANGED (#84 constraint: modifying it
 * would invalidate comparison against the three prior benchmark runs). It
 * decides equivalence by three-valued model checking with NO model call, and it
 * already reports the narrower-than-reality direction:
 *
 *   "the candidate rules out N applicant profile(s) the verified rule accepts
 *    or flags for review"
 *
 * `criterionEquivalence(a, b)` is asymmetric -- it only flags when `b` is
 * narrower than `a`. #84 says: divergent *in the dangerous direction, either
 * way* routes to a human, and we do not need to know which method is wrong. So
 * we run it BOTH ways and treat a dangerous witness in EITHER direction as the
 * dangerous outcome.
 */
import { criterionEquivalence, type EquivalenceResult } from '../../program-benchmark/lib/criterion-equivalence.ts';
import { isExtract, type MethodOutcome } from './methods.ts';

export type AgreementVerdict =
  /** Both methods produced a rule and the referee proved them equivalent. */
  | 'equivalent'
  /** Both produced a rule; they diverge and at least one direction is dangerous. */
  | 'divergent-dangerous'
  /** Both produced a rule; they diverge only in the over-inclusive direction. */
  | 'divergent-safe'
  /** Both produced a rule; the referee could not decide equivalence. */
  | 'undecided'
  /** At least one method abstained -- Path A has nothing to compare. */
  | 'not-comparable';

export interface AgreementResult {
  readonly verdict: AgreementVerdict;
  /** True only when both methods emitted a rule (the referee actually ran). */
  readonly comparable: boolean;
  /** `criterionEquivalence(deterministic, agentic)` -- agentic-narrower witnesses. */
  readonly forward?: EquivalenceResult;
  /** `criterionEquivalence(agentic, deterministic)` -- deterministic-narrower witnesses. */
  readonly reverse?: EquivalenceResult;
  /** A dangerous witness was found with the agentic rule as the narrower one. */
  readonly agenticNarrower: boolean;
  /** A dangerous witness was found with the deterministic rule as the narrower one. */
  readonly deterministicNarrower: boolean;
  readonly detail: string;
}

export function crossMethodAgreement(
  deterministic: MethodOutcome,
  agentic: MethodOutcome,
): AgreementResult {
  if (!isExtract(deterministic) || !isExtract(agentic)) {
    return {
      verdict: 'not-comparable',
      comparable: false,
      agenticNarrower: false,
      deterministicNarrower: false,
      detail:
        `Path A cannot fire: ` +
        `${deterministic.decision === 'abstain' ? 'the deterministic parser abstained' : 'the deterministic parser emitted a rule'}; ` +
        `${agentic.decision === 'abstain' ? 'the agentic extractor abstained' : 'the agentic extractor emitted a rule'}.`,
    };
  }

  const forward = criterionEquivalence(deterministic.criterion, agentic.criterion);
  const reverse = criterionEquivalence(agentic.criterion, deterministic.criterion);

  const agenticNarrower = forward.dangerousWitnesses.length > 0;
  const deterministicNarrower = reverse.dangerousWitnesses.length > 0;

  if (forward.verdict === 'equivalent' && reverse.verdict === 'equivalent') {
    return {
      verdict: 'equivalent',
      comparable: true,
      forward,
      reverse,
      agenticNarrower: false,
      deterministicNarrower: false,
      detail:
        forward.method === 'canonical-form'
          ? 'Both methods canonicalise to the same rule.'
          : `Both methods agree on every truth assignment (${forward.method}).`,
    };
  }

  if (agenticNarrower || deterministicNarrower) {
    const dirs: string[] = [];
    if (agenticNarrower) dirs.push('the agentic rule excludes people the deterministic rule accepts');
    if (deterministicNarrower) dirs.push('the deterministic rule excludes people the agentic rule accepts');
    return {
      verdict: 'divergent-dangerous',
      comparable: true,
      forward,
      reverse,
      agenticNarrower,
      deterministicNarrower,
      detail: `The two methods disagree and one dropped a branch: ${dirs.join('; ')}.`,
    };
  }

  if (forward.verdict === 'undecided' || reverse.verdict === 'undecided') {
    return {
      verdict: 'undecided',
      comparable: true,
      forward,
      reverse,
      agenticNarrower: false,
      deterministicNarrower: false,
      detail:
        'Canonical forms differ and the referee could not decide equivalence ' +
        '(un-modellable leaf or state space too large). Not provably safe.',
    };
  }

  return {
    verdict: 'divergent-safe',
    comparable: true,
    forward,
    reverse,
    agenticNarrower: false,
    deterministicNarrower: false,
    detail: 'The two methods disagree, but only in the over-inclusive (not dangerous) direction.',
  };
}
