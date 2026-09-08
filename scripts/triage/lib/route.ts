/**
 * The triage routing decision (issue #68, part of epic #65).
 *
 * Three outcomes:
 *
 *   - `deterministic`      -- the Tier-3 parser produced a scoped rule at zero
 *                             token cost. Use it; no model call.
 *   - `agentic`            -- a rule is published but the deterministic path
 *                             cannot reach it (subpage, linked PDF, table-column
 *                             scope, cross-reference). Hand to the agentic
 *                             extractor, which has source access.
 *   - `no-rule-published`  -- the source itself declines to state a rule. Tier 4
 *                             of docs/eligibility-extraction.md Section 2.
 *                             `manualReview`, no extraction attempted, no tokens.
 *
 * ## The failure mode this must not become
 *
 * #63 reached 0 dangerous over-claims by routing 27/27 to `manualReview`. A
 * triage layer that sends everything to `no-rule-published` is that failure in
 * new clothing -- safe, useless, expensive to discover late. ./report.ts prints
 * the routing distribution explicitly and raises a degenerate-outcome warning,
 * the same guard scripts/cross-check uses for its agreement rate.
 *
 * ## The asymmetry that drives the design
 *
 * A false `no-rule-published` is a silent loss -- the program is never
 * extracted, no human sees it. A false `agentic` costs a few cents and produces
 * a visible abstention. So when the evidence is mixed, this routes to `agentic`
 * and marks the decision `uncertain: true` rather than dropping the source.
 *
 * ## Where the model is (not)
 *
 * This function does not call a model. The deterministic parser's outcome plus
 * ./signals.ts resolve every source in the offline corpus. An optional live
 * classifier (./classify-source.ts) can be passed in to confirm a
 * `no-rule-published` decision -- the one route with a silent-loss failure mode
 * -- and can only ever *rescue* a source toward `agentic`, never push one to
 * `no-rule-published` that the deterministic evidence did not already put there.
 */
import { detectVocabularyGap, type VocabularyGap } from './vocabulary.ts';
import { hasDecisiveNoRule, scanSignals, type Signal, type SignalScan } from './signals.ts';

export type TriageRoute = 'deterministic' | 'agentic' | 'no-rule-published';

/** The deterministic parser's result, reduced to what the router needs. */
export interface ParserOutcome {
  readonly decision: 'extract' | 'abstain' | 'not-run';
  /** The Tier-3 reason code (`EXTRACT`, `NO_RULE_STATED`, `COST_SHARING_TIER`, ...). */
  readonly code: string | null;
  readonly reason: string;
}

/**
 * Abstention codes that mean "the parser found an eligibility figure it could
 * not cleanly scope" -- i.e. a rule is *definitely* published, it is just not
 * deterministically parseable. These route straight to the agentic extractor.
 * (From scripts/tier3-extract/classify.mjs + extract.mjs.)
 */
const RULE_IS_PRESENT_CODES = new Set([
  'COST_SHARING_TIER',
  'COMPOSITION_NOT_ELIGIBILITY',
  'UNDECIDABLE_COCONDITION',
  'MULTIPLE_ADMIN_GATES',
  'EXCEPTION_ALLOWANCE_BRANCH',
  'DUAL_TEST',
  'DEDUCTION_STACK',
  'PROCESSING_OR_REPORTING',
  'CROSS_REFERENCE_TREE',
  'MULTI_POPULATION_TABLE',
  'FLOOR_OR_RANGE',
  'NO_SCALE',
]);

/**
 * Abstention codes that mean "the parser found nothing that even looks like a
 * rule". Whether the source publishes a rule at all is then decided by the
 * signal scan.
 */
const NOTHING_FOUND_CODES = new Set([
  'NO_RULE_STATED',
  'NO_ELIGIBILITY_CONTEXT',
]);

export interface TriageDecision {
  readonly route: TriageRoute;
  readonly reason: string;
  /** The spans that drove the decision, quoted verbatim (as #64's does). */
  readonly evidence: readonly Signal[];
  readonly parser: ParserOutcome;
  readonly signals: SignalScan;
  /**
   * Reserved facts (`src/domain/facts.ts` RESERVED_FACT_KEYS) the source's rule
   * turns on. Non-empty means "unextractable *with the current vocabulary*" --
   * a candidate question, per docs/data-authoring.md. The source still routes to
   * `agentic` (extract the income branch, `manualReview` the reserved gate).
   */
  readonly vocabularyGap: readonly VocabularyGap[];
  /**
   * True when the evidence was mixed and this deliberately chose extraction over
   * dropping the source (the #68 asymmetry). Reported so the bias is visible.
   */
  readonly uncertain: boolean;
  /** Set when a live classifier was consulted and changed or confirmed the route. */
  readonly classifierNote?: string;
}

/** Minimal shape of the optional live classifier's answer (./classify-source.ts). */
export interface SourceClassification {
  /** Does the source state an eligibility rule of any kind? */
  readonly statesEligibilityRule: boolean;
  /** 0-100. Numeric only -- the categorical `confidence: 'low'` form is banned (#64). */
  readonly confidenceScore: number;
  /** The span the model based its answer on, quoted from the source. */
  readonly evidenceQuote: string;
}

export interface TriageInput {
  readonly parser: ParserOutcome;
  /** Meaningful text of the source (scripts/check-sources/lib/normalize). */
  readonly sourceText: string;
  /**
   * Optional live classifier answer. Consulted only to second-guess a
   * `no-rule-published` decision. Absent offline / without a key.
   */
  readonly classification?: SourceClassification;
}

function collectEvidence(...groups: ReadonlyArray<readonly Signal[]>): Signal[] {
  return groups.flat();
}

export function triage(input: TriageInput): TriageDecision {
  const { parser, sourceText } = input;
  const signals = scanSignals(sourceText);

  // 1. The deterministic path already produced a scoped rule. Cheapest route.
  if (parser.decision === 'extract') {
    return {
      route: 'deterministic',
      reason: `the deterministic Tier-3 parser extracted a scoped rule (${parser.reason})`,
      evidence: signals.rulePresent.slice(0, 3),
      parser,
      signals,
      vocabularyGap: [],
      uncertain: false,
    };
  }

  const vocabularyGap =
    parser.code === 'UNDECIDABLE_COCONDITION' || parser.code === 'MULTIPLE_ADMIN_GATES'
      ? detectVocabularyGap(parser.reason, sourceText)
      : [];

  // 2. The parser found an eligibility figure it could not scope. A rule is
  //    published; it just needs source access to extract. Straight to agentic.
  if (parser.code && RULE_IS_PRESENT_CODES.has(parser.code)) {
    return {
      route: 'agentic',
      reason:
        `the deterministic parser found an eligibility figure it could not cleanly scope ` +
        `(${parser.code}); a rule is published but needs source access to extract`,
      evidence: collectEvidence([{ kind: 'rule-present', tag: `parser:${parser.code}`, quote: parser.reason }], signals.rulePresent.slice(0, 2)),
      parser,
      signals,
      vocabularyGap,
      uncertain: false,
    };
  }

  // 3. The parser found nothing (or was not run). The signal scan decides
  //    whether a rule is published at all.
  const parserFoundNothing =
    parser.decision === 'not-run' || (parser.code !== null && NOTHING_FOUND_CODES.has(parser.code)) || parser.code === null;

  if (parserFoundNothing && hasDecisiveNoRule(signals)) {
    // A NO-RULE signal and nothing pulling the other way. Before committing to
    // the silent-loss route, let a live classifier (if supplied) veto it.
    const c = input.classification;
    if (c && c.statesEligibilityRule) {
      return {
        route: 'agentic',
        reason:
          `the deterministic parser and the signal scan both found no rule, but the live classifier ` +
          `read an eligibility rule in the source (confidenceScore ${c.confidenceScore})`,
        evidence: collectEvidence([{ kind: 'rule-present', tag: 'classifier', quote: c.evidenceQuote }]),
        parser,
        signals,
        vocabularyGap: [],
        uncertain: true,
        classifierNote: `live classifier rescued this source from no-rule-published (score ${c.confidenceScore})`,
      };
    }
    return {
      route: 'no-rule-published',
      reason: 'the source explicitly declines to state an eligibility rule (Tier 4); no extraction attempted, no tokens spent',
      evidence: signals.noRule.slice(0, 3),
      parser,
      signals,
      vocabularyGap: [],
      uncertain: false,
      ...(c ? { classifierNote: `live classifier agreed no rule is stated (score ${c.confidenceScore})` } : {}),
    };
  }

  // 4. Mixed or thin evidence: the parser found nothing decisive, but a
  //    RULE-PRESENT signal fired (or no NO-RULE signal did). Prefer extraction
  //    -- a false no-rule-published is the unrecoverable error.
  return {
    route: 'agentic',
    reason:
      signals.rulePresent.length > 0
        ? 'the deterministic parser could not parse a rule, but the source states an eligibility condition the agentic extractor may be able to reach'
        : 'the evidence is thin in both directions; routing to extraction because a false "no rule here" is a silent loss (#68 asymmetry)',
    evidence: signals.rulePresent.slice(0, 3),
    parser,
    signals,
    vocabularyGap,
    uncertain: true,
  };
}
