import type { Program } from '../../../src/domain/program.ts';
import { gateCriterion } from '../../llm-extraction/schema-gate.ts';
import { criterionEquivalence, type EquivalenceResult } from './criterion-equivalence.ts';
import { dangerousWrongness, type DangerFinding } from './dangerous.ts';
import { overClaimWrongness, type OverClaimFinding } from './over-claim.ts';
import { scoreAbstention, type AbstentionScore } from './abstention.ts';
import {
  comparePhone,
  compareUrl,
  compareShortText,
  compareProse,
  compareDocuments,
  type DescriptiveFieldResult,
} from './descriptive.ts';
import { isAbstention, type ExtractionResult } from './extractor.ts';
import type { BenchmarkCase } from './cases.ts';

/**
 * Scoring one case. Every dimension is reported SEPARATELY and never blended
 * into a single figure -- the fields of a Program record have wildly different
 * stakes (docs/program-benchmark.md, "Six scores, never one").
 *
 * The six dimensions:
 *   1. eligibility     -- does the candidate Criterion MEAN the same rule?
 *   2. overClaim       -- did the candidate tell someone they are eligible when
 *                         the verified record rules them out or cannot say?
 *   3. dangerous       -- the mirror: did the candidate rule out someone the
 *                         verified record includes?
 *   4. abstention      -- did the candidate emit manualReview where the
 *                         verified record does?
 *   5. descriptive     -- name / administeredBy / phone / url / summary /
 *                         benefit / requiredDocuments accuracy.
 *   6. coverage        -- did the extractor produce any usable output at all
 *                         (a gate-valid record, or an honest abstention)?
 *
 * Dimensions 2 and 3 are a PAIR and must be read together; both are blocking.
 * Ranking and rationale: docs/standing-decisions.md, "The two harms".
 */

export type CaseOutcome =
  | 'scored'
  | 'skipped-no-key'
  | 'not-wired'
  | 'extractor-error'
  | 'gate-failed'
  | 'extractor-abstained';

export type EligibilityVerdict = 'equivalent' | 'divergent' | 'undecided' | 'candidate-abstained' | 'not-scored';

export interface CaseScore {
  readonly programId: string;
  readonly sourceUrl: string;
  readonly kind: 'scored' | 'abstention-only';
  readonly outcome: CaseOutcome;
  /** Detail for non-`scored` outcomes (error message, gate problems, ...). */
  readonly outcomeDetail?: string;

  /** Dimension 6. True when the extractor produced usable output. */
  readonly coverage: boolean;

  /** Dimension 1. */
  readonly eligibility: EligibilityVerdict;
  readonly eligibilityDetail?: string;
  readonly equivalence?: EquivalenceResult;

  /**
   * Dimension 2. Empty array === none detected (not "provably safe"). Read as a
   * pair with `dangerous`, never on its own.
   */
  readonly overClaim: readonly OverClaimFinding[];

  /** Dimension 3. Empty array === none detected (not "provably safe"). */
  readonly dangerous: readonly DangerFinding[];

  /** Dimension 4. */
  readonly abstention?: AbstentionScore;

  /** Dimension 5. */
  readonly descriptive: readonly DescriptiveFieldResult[];
}

export interface ErrorResult {
  readonly error: 'skipped-no-key' | 'not-wired' | 'extractor-error';
  readonly message: string;
}

export interface ScoreCaseInput {
  readonly case: BenchmarkCase;
  readonly kind: 'scored' | 'abstention-only';
  /**
   * The extractor's result, OR an error it threw. The runner catches
   * MissingApiKeyError / ExtractorNotWiredError and passes the right sentinel.
   */
  readonly result: ExtractionResult | ErrorResult;
}

function isErrorResult(r: ExtractionResult | ErrorResult): r is ErrorResult {
  return typeof (r as { error?: unknown }).error === 'string';
}

const EMPTY_DESCRIPTIVE: readonly DescriptiveFieldResult[] = [];

export function scoreCase(input: ScoreCaseInput): CaseScore {
  const { programId, sourceUrl } = input.case;
  const base = { programId, sourceUrl, kind: input.kind } as const;
  const result = input.result;

  if (isErrorResult(result)) {
    return {
      ...base,
      outcome: result.error,
      outcomeDetail: result.message,
      coverage: false,
      eligibility: 'not-scored',
      overClaim: [],
      dangerous: [],
      descriptive: EMPTY_DESCRIPTIVE,
    };
  }

  const verified: Program = input.case.verified;

  // The extractor declined to produce a record at all. Model it as a
  // whole-rule manualReview and score the abstention dimension against the
  // verified rule (works for both `scored` and `abstention-only` kinds).
  if (isAbstention(result)) {
    const abstention = scoreAbstention(verified.eligibility, {
      kind: 'manualReview',
      note: result.reason,
    });
    return {
      ...base,
      outcome: 'extractor-abstained',
      outcomeDetail: result.reason,
      // A whole-record abstention is still an honest, usable output.
      coverage: true,
      eligibility: 'candidate-abstained',
      // An abstention promises nothing, so it cannot over-claim.
      overClaim: [],
      dangerous: [],
      abstention,
      descriptive: EMPTY_DESCRIPTIVE,
    };
  }

  const candidate = result;

  // Schema gate -- identical bar to a hand-authored rule (reused from
  // scripts/llm-extraction/schema-gate.ts, not re-implemented).
  const gate = gateCriterion(candidate.eligibility);
  if (!gate.ok) {
    return {
      ...base,
      outcome: 'gate-failed',
      outcomeDetail: gate.problems.join('; '),
      coverage: false,
      eligibility: 'not-scored',
      overClaim: [],
      dangerous: [],
      descriptive: EMPTY_DESCRIPTIVE,
    };
  }

  const descriptive = scoreDescriptiveFields(verified, candidate);

  // abstention-only cases: ground truth for the RULE is unconfirmed (#45), so
  // only the abstention question and coverage are answered.
  if (input.kind === 'abstention-only') {
    return {
      ...base,
      outcome: 'scored',
      coverage: true,
      eligibility: 'not-scored',
      eligibilityDetail: 'record is unverified (#45); scored only for correct abstention',
      overClaim: [],
      dangerous: [],
      abstention: scoreAbstention(verified.eligibility, candidate.eligibility),
      descriptive,
    };
  }

  const equivalence = criterionEquivalence(verified.eligibility, candidate.eligibility);
  const overClaim = overClaimWrongness(verified.eligibility, candidate.eligibility);
  const dangerous = dangerousWrongness(verified.eligibility, candidate.eligibility);
  const abstention = scoreAbstention(verified.eligibility, candidate.eligibility);

  const eligibility: EligibilityVerdict =
    equivalence.verdict === 'equivalent'
      ? 'equivalent'
      : equivalence.verdict === 'undecided'
        ? 'undecided'
        : 'divergent';

  return {
    ...base,
    outcome: 'scored',
    coverage: true,
    eligibility,
    eligibilityDetail: equivalence.detail,
    equivalence,
    overClaim,
    dangerous,
    abstention,
    descriptive,
  };
}

function scoreDescriptiveFields(verified: Program, candidate: { name?: string; administeredBy?: string; summary?: string; benefit?: string; howToApply?: { url?: string; phone?: string }; requiredDocuments?: readonly string[] }): DescriptiveFieldResult[] {
  return [
    compareShortText('name', verified.name, candidate.name),
    compareShortText('administeredBy', verified.administeredBy, candidate.administeredBy),
    comparePhone(verified.howToApply.phone, candidate.howToApply?.phone),
    compareUrl(verified.howToApply.url, candidate.howToApply?.url),
    compareProse('summary', verified.summary, candidate.summary),
    compareProse('benefit', verified.benefit, candidate.benefit),
    compareDocuments(verified.requiredDocuments, candidate.requiredDocuments),
  ];
}
