import type { Criterion, IncomeScale } from '../../../src/domain/criteria.ts';
import { normalizeCriterion, countManualReview } from './criterion-normalize.ts';
import { criterionEquivalence, type OverClaimWitness } from './criterion-equivalence.ts';

/**
 * "Over-claim" -- the candidate rule tells someone they qualify when they do
 * not. The mirror of ./dangerous.ts (which measures under-claim); read the two
 * as a pair. Ranking and rationale: docs/standing-decisions.md, "The two harms".
 *
 * Three detectors, mirroring dangerous.ts's structure:
 *
 *  1. `model-check` -- the three-valued enumeration in ./criterion-equivalence.ts
 *     found a concrete applicant profile the candidate calls eligible and the
 *     verified rule rules out or cannot decide. Strongest evidence.
 *
 *  2. `abstention-dropped` -- the verified record carries `manualReview` leaves
 *     and the candidate carries fewer, so a condition the source leaves open has
 *     become a machine-decidable pass. (dangerous.ts's `abstention-replaced` is
 *     the same event seen from the other side; each file reports the evidence it
 *     can actually show.)
 *
 *  3. `threshold-loosened` -- structural fallback for when the model check is
 *     `undecided`: the candidate's most generous income ceiling for a scale is
 *     looser than the verified record's.
 *
 * ## What this does NOT catch
 *
 *  - An over-claim hidden behind logical distribution when a leaf is
 *    un-modellable (detector 1 goes `undecided`, and detectors 2-3 are narrow).
 *  - Fields this benchmark does not model -- a wrong `status`, a stale
 *    `seasonalNote`, a program that closed. A reviewer's job.
 *  - Anything in `eligibilityCaveats`. The engine never evaluates them (#79), so
 *    a condition parked there is invisible here too.
 */

export type OverClaimSource = 'model-check' | 'abstention-dropped' | 'threshold-loosened';

export interface OverClaimFinding {
  readonly source: OverClaimSource;
  readonly message: string;
  /** Present for `model-check` findings. */
  readonly witnesses?: readonly OverClaimWitness[];
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

/**
 * All over-claim findings for one candidate rule against its verified
 * counterpart. Empty array === no over-claim detected, which is NOT the same as
 * "provably safe" -- see the limitations above.
 */
export function overClaimWrongness(verified: Criterion, candidate: Criterion): OverClaimFinding[] {
  const findings: OverClaimFinding[] = [];

  // Detector 1: the model check.
  const eq = criterionEquivalence(verified, candidate);
  if (eq.overClaimWitnesses.length > 0) {
    findings.push({
      source: 'model-check',
      message: eq.detail,
      witnesses: eq.overClaimWitnesses,
    });
  }

  const nv = normalizeCriterion(verified);
  const nc = normalizeCriterion(candidate);

  // Detector 2: a verified abstention dropped for a decidable rule.
  const verifiedAbstentions = countManualReview(nv);
  const candidateAbstentions = countManualReview(nc);
  if (verifiedAbstentions > 0 && candidateAbstentions < verifiedAbstentions) {
    findings.push({
      source: 'abstention-dropped',
      message:
        `The verified record abstains in ${verifiedAbstentions} place(s) (a human could not state the rule there) ` +
        `and the candidate abstains in ${candidateAbstentions}. A condition the source leaves open has been turned ` +
        `into a machine-decidable pass, so the app can say "you qualify" where the truth is "someone has to check".`,
    });
  }

  // Detector 3: structural fallback when the model check could not decide.
  if (eq.verdict === 'undecided') {
    const vBest = new Map<IncomeScale, number>();
    for (const { scale, percent } of positiveIncomeCeilings(nv)) {
      vBest.set(scale, Math.max(vBest.get(scale) ?? 0, percent));
    }
    for (const { scale, percent } of positiveIncomeCeilings(nc)) {
      const v = vBest.get(scale);
      if (v !== undefined && percent > v) {
        findings.push({
          source: 'threshold-loosened',
          message:
            `Candidate admits income up to ${percent}% of ${scale}; the verified record's most generous ceiling ` +
            `on that scale is ${v}%. Households between ${v}% and ${percent}% are told they qualify when they do not.`,
        });
      }
    }
  }

  return findings;
}
