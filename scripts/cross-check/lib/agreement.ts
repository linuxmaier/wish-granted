/**
 * Path A of issue #84 -- cross-method agreement.
 *
 * The two independent `Criterion` trees are the deterministic Tier-3 parser's
 * output and the agentic extractor's. The referee is `criterionEquivalence`
 * from scripts/program-benchmark, used UNCHANGED (#84 constraint: modifying it
 * would invalidate comparison against the three prior benchmark runs). It
 * decides equivalence by three-valued model checking with NO model call, and it
 * already reports the narrower-than-reality direction:
 *
 *   "the candidate rules out N applicant profile(s) the verified rule accepts
 *    or flags for review"
 *
 * ## The fragment-vs-record fix (PR #85 review, issue #84)
 *
 * The parser emits a NARROW fragment -- "the income/categorical rule here is X".
 * The agentic extractor emits a FULL record -- geography envelope, program
 * gates, `manualReview`. Feeding both WHOLE trees to `criterionEquivalence`
 * compares units that are not comparable: a correct agentic record is
 * legitimately narrower than a bare income fragment, so whole-tree comparison
 * reported the agentic side as "rules out profiles the parser accepts" almost
 * every time -- because it added a `state = WI` leaf, not because a branch was
 * dropped.
 *
 * So Path A now compares only the dimension the parser actually speaks to
 * (./scoped-agreement.ts): project BOTH trees onto the parser fragment's
 * constrained facts / income scales, then run the referee both ways on the
 * projections. Everything the parser is silent on is pruned before the referee
 * sees it. A dangerous witness that survives projection is a true positive: the
 * parser admits an income level the agentic tree rules out, or offers a
 * categorical path the agentic tree lacks (the `foodshare-snap-wi` shape).
 *
 * `criterionEquivalence(a, b)` is asymmetric -- it only flags when `b` is
 * narrower than `a`. #84 says: divergent in the dangerous direction, either way,
 * routes to a human, and we do not need to know which method is wrong. So we run
 * it BOTH ways (on the projections) and treat a dangerous witness in EITHER
 * direction as the dangerous outcome.
 */
import type { Criterion } from '../../../src/domain/criteria.ts';
import { criterionEquivalence, type EquivalenceResult } from '../../program-benchmark/lib/criterion-equivalence.ts';
import { isExtract, type MethodOutcome } from './methods.ts';
import { scopedAgreement } from './scoped-agreement.ts';

export type AgreementVerdict =
  /** Both methods produced a rule and, on the parser's dimension, they agree. */
  | 'equivalent'
  /** Both produced a rule; on the parser's dimension they diverge dangerously. */
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
  /** Forward equivalence result -- parser (projection) as the wider `verified` side. */
  readonly forward?: EquivalenceResult;
  /** Reverse equivalence result -- agentic (projection) as the wider `verified` side. */
  readonly reverse?: EquivalenceResult;
  /** A dangerous witness was found with the agentic rule as the narrower one. */
  readonly agenticNarrower: boolean;
  /** A dangerous witness was found with the deterministic rule as the narrower one. */
  readonly deterministicNarrower: boolean;
  /** The parser fragment's projected form (what it says about its own dimension). */
  readonly deterministicProjected?: Criterion | null;
  /** The agentic record's projected form (what it says about the parser's dimension). */
  readonly agenticProjected?: Criterion | null;
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

  const scoped = scopedAgreement(deterministic.criterion, agentic.criterion);

  // Degenerate: the parser fragment carried no concrete leaf (only `always` /
  // `manualReview`), so there is no dimension to scope onto. Real parser output
  // always has a concrete leaf; this is a guard for synthetic inputs. Fall back
  // to comparing the trees whole.
  if (scoped.verdict === 'no-parser-dimension') {
    return wholeTreeAgreement(deterministic.criterion, agentic.criterion);
  }

  const base = {
    comparable: true as const,
    forward: scoped.forward,
    reverse: scoped.reverse,
    deterministicProjected: scoped.deterministicProjected,
    agenticProjected: scoped.agenticProjected,
  };

  switch (scoped.verdict) {
    case 'equivalent':
      return {
        ...base,
        verdict: 'equivalent',
        agenticNarrower: false,
        deterministicNarrower: false,
        detail: scoped.detail,
      };
    case 'divergent-dangerous':
      return {
        ...base,
        verdict: 'divergent-dangerous',
        agenticNarrower: scoped.agenticNarrower,
        deterministicNarrower: scoped.deterministicNarrower,
        detail: `The two methods disagree and one dropped a branch: ${scoped.detail}`,
      };
    case 'no-shared-dimension':
    case 'undecided':
      return {
        ...base,
        verdict: 'undecided',
        agenticNarrower: false,
        deterministicNarrower: false,
        detail: scoped.detail,
      };
    case 'divergent-safe':
      return {
        ...base,
        verdict: 'divergent-safe',
        agenticNarrower: false,
        deterministicNarrower: false,
        detail: scoped.detail,
      };
  }
}

/**
 * The original whole-tree both-ways comparison. Retained only for the degenerate
 * case where the parser fragment constrains nothing concrete -- there is then no
 * dimension to project onto, so projection is the identity and this is exactly
 * equivalent to the scoped path.
 */
function wholeTreeAgreement(deterministic: Criterion, agentic: Criterion): AgreementResult {
  const forward = criterionEquivalence(deterministic, agentic);
  const reverse = criterionEquivalence(agentic, deterministic);

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
