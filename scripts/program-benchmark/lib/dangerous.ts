import type { Criterion, IncomeScale } from '../../../src/domain/criteria.ts';
import { normalizeCriterion, countManualReview } from './criterion-normalize.ts';
import { criterionEquivalence, type DangerousWitness } from './criterion-equivalence.ts';

/**
 * "Dangerous wrongness" -- the one number that matters most and must never be
 * averaged into anything (docs/program-benchmark.md, "Dangerous wrongness").
 *
 * A candidate eligibility rule is dangerous when it is NARROWER than the
 * verified rule: it would rule out an applicant the verified record accepts or
 * leaves open. The asymmetry (docs/eligibility-extraction.md Section 4.4): an
 * over-inclusive rule sends someone to check with the agency; an
 * under-inclusive one silently tells them not to bother.
 *
 * Three detectors, reported with their source so a reviewer can see how each
 * was found:
 *
 *  1. `model-check` -- the three-valued enumeration in ./criterion-equivalence.ts
 *     found a concrete applicant profile the candidate rules out and the
 *     verified rule does not. Strongest evidence; only available when the leaf
 *     vocabulary is modellable and the state space is bounded.
 *
 *  2. `abstention-replaced` -- the verified record carries a `manualReview`
 *     (the humans who read the page could not state a rule) and the candidate
 *     replaced it with a concrete threshold or test. This is the
 *     dane-eviction-prevention / "invented AMI %" failure class
 *     (docs/eligibility-extraction.md Section 8). Asserting a bound the source
 *     does not support is dangerous even if we cannot point to who it excludes.
 *
 *  3. `threshold-tightened` -- a structural fallback for when the model check is
 *     `undecided`: the candidate's most generous income ceiling for some scale
 *     is stricter than the verified record's, so households between the two
 *     percentages are wrongly excluded.
 *
 * ## What this does NOT catch
 *
 *  - A threshold that is wrong but LOOSER than reality (over-inclusive) -- not
 *    dangerous by definition, but still a data error a human reviewer must fix.
 *  - A dangerous narrowing hidden behind logical distribution when a leaf is
 *    un-modellable (detector 1 goes `undecided`, and detectors 2-3 are narrow).
 *  - A wrong `set` membership (e.g. dropping one categorical-eligibility
 *    program from a `hasAnyOf` list) is caught by detector 1 as a ruled-out
 *    profile, but only when that whole branch is otherwise modellable.
 */

export type DangerSource = 'model-check' | 'abstention-replaced' | 'threshold-tightened';

export interface DangerFinding {
  readonly source: DangerSource;
  readonly message: string;
  /** Present for `model-check` findings. */
  readonly witnesses?: readonly DangerousWitness[];
}

interface IncomeCeiling {
  readonly scale: IncomeScale;
  readonly percent: number;
}

/** Positive-position `incomeAtOrBelow` ceilings (not under a `not`). */
function positiveIncomeCeilings(c: Criterion, negated = false): IncomeCeiling[] {
  switch (c.kind) {
    case 'incomeAtOrBelow':
      return negated ? [] : [{ scale: c.scale, percent: c.percent }];
    case 'allOf':
    case 'anyOf':
      return c.of.flatMap((child) => positiveIncomeCeilings(child, negated));
    case 'not':
      return positiveIncomeCeilings(c.of, !negated);
    default:
      return [];
  }
}

function concreteLeafCount(c: Criterion): number {
  let n = 0;
  const visit = (node: Criterion): void => {
    switch (node.kind) {
      case 'compare':
      case 'set':
      case 'incomeAtOrBelow':
        n += 1;
        return;
      case 'allOf':
      case 'anyOf':
        node.of.forEach(visit);
        return;
      case 'not':
        visit(node.of);
        return;
      default:
        return;
    }
  };
  visit(c);
  return n;
}

/**
 * All dangerous-wrongness findings for one candidate rule against its verified
 * counterpart. Empty array === no dangerous wrongness detected (which is not
 * the same as "provably safe" -- see the limitations above).
 */
export function dangerousWrongness(verified: Criterion, candidate: Criterion): DangerFinding[] {
  const findings: DangerFinding[] = [];

  // Detector 1: the model check.
  const eq = criterionEquivalence(verified, candidate);
  if (eq.dangerousWitnesses.length > 0) {
    findings.push({
      source: 'model-check',
      message: eq.detail,
      witnesses: eq.dangerousWitnesses,
    });
  }

  const nv = normalizeCriterion(verified);
  const nc = normalizeCriterion(candidate);

  // Detector 2: a verified abstention replaced by a concrete assertion. Counts
  // on the raw trees -- canonicalisation de-dupes manualReview leaves.
  const vManual = countManualReview(verified);
  const cManual = countManualReview(candidate);
  if (vManual > 0 && cManual < vManual && concreteLeafCount(nc) > concreteLeafCount(nv)) {
    findings.push({
      source: 'abstention-replaced',
      message: `The verified record carries ${vManual} manualReview leaf(s) -- a human who read the source could not state that part of the rule -- and the candidate replaced ${vManual - cManual} of them with a concrete test. Asserting a threshold the source does not support is dangerous.`,
    });
  }

  // Detector 3: structural threshold tightening (fallback when the model check
  // could not decide; when it did decide, detector 1 already covers this).
  if (eq.verdict === 'undecided') {
    const vByScale = new Map<IncomeScale, number>();
    for (const { scale, percent } of positiveIncomeCeilings(nv)) {
      vByScale.set(scale, Math.max(vByScale.get(scale) ?? 0, percent));
    }
    const cByScale = new Map<IncomeScale, number>();
    for (const { scale, percent } of positiveIncomeCeilings(nc)) {
      cByScale.set(scale, Math.max(cByScale.get(scale) ?? 0, percent));
    }
    for (const [scale, cPercent] of cByScale) {
      const vPercent = vByScale.get(scale);
      if (vPercent !== undefined && cPercent < vPercent) {
        findings.push({
          source: 'threshold-tightened',
          message: `Candidate income ceiling for ${scale} is ${cPercent}%, stricter than the verified record's ${vPercent}%. Households between ${cPercent}% and ${vPercent}% of ${scale} are wrongly excluded.`,
        });
      }
    }
  }

  return findings;
}
