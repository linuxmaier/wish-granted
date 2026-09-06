import type { Criterion } from '../../../src/domain/criteria.ts';
import { normalizeCriterion, countManualReview } from './criterion-normalize.ts';

/**
 * Correct-abstention scoring (docs/program-benchmark.md, "Correct abstention").
 *
 * A `manualReview` leaf is the honest encoding of a condition a rules engine
 * cannot decide. It can be the whole rule, or -- as in
 * madison-housing-choice-voucher.ts and wisconsin-shares-child-care.ts -- one
 * leaf inside a larger `allOf` alongside real criteria. Partial abstention is
 * correct and common, so this is scored by COUNT and POSITION, not
 * all-or-nothing.
 *
 * Verdicts:
 *   - `not-applicable`  the verified rule has no manualReview and neither does
 *                       the candidate.
 *   - `correct`         the candidate reproduced at least as many manualReview
 *                       leaves as the verified rule (full match).
 *   - `partial`         the candidate has some manualReview leaves but fewer
 *                       than the verified rule -- it abstained where needed but
 *                       not everywhere it should have.
 *   - `missing`         the verified rule abstains somewhere and the candidate
 *                       does not at all. Frequently coincides with a dangerous
 *                       finding (the abstention was replaced by a hard rule).
 *   - `spurious`        the candidate abstains where the verified rule states a
 *                       decidable rule. Over-cautious -- reduces usefulness, but
 *                       NOT dangerous (it keeps the program in "might qualify").
 *
 * Position note: matching is by count plus a check on whether the abstention is
 * whole-rule vs a leaf. It does not verify the manualReview sits beside the
 * *same* sibling criteria -- see docs/program-benchmark.md for why that is hard
 * to do without over-fitting.
 *
 * Counts are taken on the RAW tree, not the canonical form: canonicalisation
 * de-dupes `allOf(manualReview(a), manualReview(b))` down to one leaf (two
 * "unknown" conjuncts mean the same as one), which is right for equivalence but
 * would erase the multiplicity this dimension is trying to measure.
 */

export type AbstentionVerdict = 'not-applicable' | 'correct' | 'partial' | 'missing' | 'spurious';

export interface AbstentionScore {
  readonly verdict: AbstentionVerdict;
  readonly verifiedManualReviewCount: number;
  readonly candidateManualReviewCount: number;
  readonly verifiedWholeRule: boolean;
  readonly candidateWholeRule: boolean;
}

function isWholeRuleAbstention(c: Criterion): boolean {
  return normalizeCriterion(c).kind === 'manualReview';
}

export function scoreAbstention(verified: Criterion, candidate: Criterion): AbstentionScore {
  const v = countManualReview(verified);
  const c = countManualReview(candidate);

  let verdict: AbstentionVerdict;
  if (v === 0 && c === 0) verdict = 'not-applicable';
  else if (v === 0 && c > 0) verdict = 'spurious';
  else if (v > 0 && c === 0) verdict = 'missing';
  else if (c >= v) verdict = 'correct';
  else verdict = 'partial';

  return {
    verdict,
    verifiedManualReviewCount: v,
    candidateManualReviewCount: c,
    verifiedWholeRule: isWholeRuleAbstention(verified),
    candidateWholeRule: isWholeRuleAbstention(candidate),
  };
}
