/**
 * Hypothesis 1 (issue #62): classify before extracting.
 *
 * Every dangerous over-claim measured to date -- SeniorCare, BadgerCare, SNAP
 * elderly-separate-household, CDA residency, Lifeline survivor, Head Start
 * over-income allowance -- is a *misclassification of what a number means*, never
 * a failure to find it. "Extract the eligibility rule" primes the model to locate
 * a threshold and build a rule around it, which is exactly wrong when the number
 * is a cost-sharing tier, a column header, a composition test, or a negation.
 *
 * This module replaces the one-step task with a bounded first step: for the given
 * excerpt, call `classify_excerpt` -- what does each number govern, and what shape
 * is the rule? Classification is multiple-choice; open-ended `Criterion`
 * generation is not. `decideAutonomy()` then routes: only an excerpt the
 * classifier is confident states a single unconditional ceiling (or a categorical
 * list) with every figure an eligibility ceiling and no structural scope signal
 * goes to the extraction call. Everything else is emitted as `manualReview`
 * automatically -- hypothesis 5, "autonomy by being far more selective about what
 * the LLM is allowed to decide", implemented as the routing rule rather than as a
 * better extractor.
 *
 * The tool schema is built here; the API plumbing lives in `run-framing-eval.ts`
 * (matching how `criterion-schema.ts` is pure and `run-eval.ts` does the fetch).
 */

export const FIGURE_ROLES = [
  'eligibility-income-ceiling',
  'cost-sharing-premium-copay-or-tier',
  'benefit-payment-amount',
  'income-deduction-or-disregard',
  'separate-subpopulation-limit',
  'program-year-or-effective-date',
  'other-or-unclear',
] as const;
export type FigureRole = (typeof FIGURE_ROLES)[number];

export const RULE_SHAPES = [
  'single-unconditional-threshold',
  'categorical-enrollment-list',
  'conditional-or-extended-eligibility-branch',
  'multi-factor-or-deduction-stack',
  'negation-or-no-rule-stated',
  'scope-set-by-table-structure',
] as const;
export type RuleShape = (typeof RULE_SHAPES)[number];

export interface Classification {
  readonly numericFigures: ReadonlyArray<{ readonly quote: string; readonly governs: FigureRole }>;
  readonly ruleShape: RuleShape;
  /**
   * Anything in the excerpt that scopes a number to a sub-population and would
   * be silently dropped by a naive extraction: a governing heading, a table
   * column label, an "extended/expanded eligibility" branch, a
   * "notwithstanding" clause, a negation ("residency is not required").
   *
   * NOT a scope signal: the categorical list that IS the rule when
   * `ruleShape === 'categorical-enrollment-list'`; "based on household/family
   * size", "based on your state", "before taxes and deductions" and similar
   * phrases that only describe how an income test is applied, never who it
   * applies to.
   */
  readonly scopeSignals: readonly string[];
  readonly confidence: 'high' | 'low';
  /**
   * 0-100. A finer-grained companion to `confidence` so a routing threshold can
   * be swept (issue #62 threshold sweep). `confidence: 'high'` should track
   * roughly `confidenceScore >= 70`, but the two are reported independently.
   */
  readonly confidenceScore: number;
}

export const CLASSIFIER_SYSTEM_PROMPT = `You classify a verbatim excerpt from an assistance-program source. You are NOT extracting a rule -- a later step does that, and only for excerpts you classify as safe to extract from.

Call classify_excerpt exactly once.

For every dollar amount, percentage, or multiple-of-a-scale ("200% of the federal poverty level") that appears in the excerpt, decide what it GOVERNS:
- eligibility-income-ceiling: the income at or below which a person qualifies for the program.
- cost-sharing-premium-copay-or-tier: an amount that changes what an ENROLLED person pays or receives -- a premium threshold, a copay tier, a spend-down level. Not an eligibility cutoff.
- benefit-payment-amount: how much the program pays out.
- income-deduction-or-disregard: an amount subtracted before a test, not the test itself.
- separate-subpopulation-limit: a limit that applies only to a named subgroup (a table column's population, "households with an elderly member", a survivor-only branch).
- program-year-or-effective-date: a date or program-year figure.
- other-or-unclear: you cannot tell, or it is none of the above.

Then decide the ruleShape:
- single-unconditional-threshold: one income ceiling (possibly with residency/household-size), stated plainly, applying to everyone the program serves.
- categorical-enrollment-list: "you qualify if you already receive X, Y, or Z".
- conditional-or-extended-eligibility-branch: the rule shown is a branch -- "extended eligibility", "if you are a survivor of...", "in an emergency", "presumptive/temporary" -- not the general rule.
- multi-factor-or-deduction-stack: the rule needs a deduction computation, a multi-factor exception list, or a cross-reference to another section.
- negation-or-no-rule-stated: the excerpt says a condition is NOT required, or states no decidable rule at all.
- scope-set-by-table-structure: which number applies depends on a table row/column header, not on a sentence.

List every scopeSignal you see: a governing heading, a table column label, a branch condition ("extended eligibility", "if you are a survivor", "in an emergency"), a "notwithstanding", a negation -- anything that narrows a number or the whole rule to a subgroup and that a careless reader would drop.

Do NOT list as a scopeSignal:
- the categorical list itself when ruleShape is categorical-enrollment-list ("you qualify if you get X, Y, or Z" IS the rule, not a narrowing of it);
- phrases that only describe how an income test is computed or applied to everyone: "based on household size", "based on family size and state", "gross income before taxes and deductions", "combined income of all household members". These do not narrow WHO the rule covers.

Set confidence: "low" whenever you are not sure of the ruleShape or of any figure's role. Under-confidence is safe here; over-confidence is not.

Also set confidenceScore, an integer 0-100, for how sure you are overall that you have correctly identified the ruleShape and every figure's role. Reserve scores above 80 for excerpts where a single plain reading is the only reading. "confidence" high should correspond to roughly confidenceScore >= 70.`;

export function buildClassifierToolSchema() {
  return {
    type: 'object',
    properties: {
      numericFigures: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            quote: {
              type: 'string',
              description: 'The figure and just enough surrounding words to identify it, quoted verbatim from the excerpt.',
            },
            governs: { type: 'string', enum: [...FIGURE_ROLES] },
          },
          required: ['quote', 'governs'],
          additionalProperties: false,
        },
        description: 'Every dollar amount, percentage, or multiple-of-a-scale in the excerpt. Empty array if there are none.',
      },
      ruleShape: { type: 'string', enum: [...RULE_SHAPES] },
      scopeSignals: {
        type: 'array',
        items: { type: 'string' },
        description: 'Verbatim or near-verbatim phrases that scope a number to a subgroup and would be dropped by a naive extraction. Empty array if there are genuinely none.',
      },
      confidence: { type: 'string', enum: ['high', 'low'] },
      confidenceScore: {
        type: 'integer',
        minimum: 0,
        maximum: 100,
        description: 'How sure you are (0-100) that the ruleShape and every figure role is right. >80 only when one plain reading is the only reading.',
      },
    },
    required: ['numericFigures', 'ruleShape', 'scopeSignals', 'confidence', 'confidenceScore'],
    additionalProperties: false,
  };
}

export interface AutonomyDecision {
  readonly autonomous: boolean;
  readonly reason: string;
  /** Which gate fired (for reporting the two triggers separately). '' if autonomous. */
  readonly trigger: '' | 'confidence-categorical' | 'confidence-score' | 'scope-signal' | 'rule-shape' | 'figure-role' | 'no-figure';
}

const DEFAULT_AUTO_EXTRACTABLE_SHAPES: readonly RuleShape[] = [
  'single-unconditional-threshold',
  'categorical-enrollment-list',
];

/**
 * Every knob in the routing rule, so the #62 threshold sweep can vary them from
 * a CLI flag instead of editing this file. `DEFAULT_AUTONOMY_CONFIG` is the
 * PR #63 behaviour exactly.
 */
export interface AutonomyConfig {
  /** Require the categorical `confidence === 'high'` gate (PR #63 default: true). */
  readonly requireHighConfidence: boolean;
  /** Require `confidenceScore >= this`. 0 disables the numeric gate. */
  readonly minConfidenceScore: number;
  /** Route to manualReview if any scopeSignal is present (PR #63 default: true). */
  readonly blockOnScopeSignal: boolean;
  /** Rule shapes allowed onto the auto-extract path. */
  readonly autoExtractableShapes: ReadonlySet<RuleShape>;
  /** Require every numeric figure to govern an eligibility ceiling (PR #63 default: true). */
  readonly requireAllFiguresCeiling: boolean;
}

export const DEFAULT_AUTONOMY_CONFIG: AutonomyConfig = {
  requireHighConfidence: true,
  minConfidenceScore: 0,
  blockOnScopeSignal: true,
  autoExtractableShapes: new Set(DEFAULT_AUTO_EXTRACTABLE_SHAPES),
  requireAllFiguresCeiling: true,
};

/**
 * The routing rule. `autonomous: true` means "hand this excerpt to the
 * extraction call"; `false` means "emit manualReview without calling the
 * extractor". Deliberately strict: a false negative (a real ceiling routed to a
 * human) costs reviewer minutes; a false positive (a trap routed to the
 * extractor) is how a wrong threshold reaches someone in crisis.
 *
 * The order matters for the two-trigger reporting #62 asks for: confidence
 * gates are checked before scope-signal gates, so a case that would fail both
 * is attributed to confidence.
 */
export function decideAutonomy(
  c: Classification,
  cfg: AutonomyConfig = DEFAULT_AUTONOMY_CONFIG,
): AutonomyDecision {
  if (cfg.requireHighConfidence && c.confidence !== 'high') {
    return { autonomous: false, reason: 'classifier confidence is low', trigger: 'confidence-categorical' };
  }
  if (cfg.minConfidenceScore > 0 && c.confidenceScore < cfg.minConfidenceScore) {
    return {
      autonomous: false,
      reason: `confidenceScore ${c.confidenceScore} < ${cfg.minConfidenceScore}`,
      trigger: 'confidence-score',
    };
  }
  if (cfg.blockOnScopeSignal && c.scopeSignals.length > 0) {
    return { autonomous: false, reason: `scope signal present: ${c.scopeSignals.join('; ')}`, trigger: 'scope-signal' };
  }
  if (!cfg.autoExtractableShapes.has(c.ruleShape)) {
    return { autonomous: false, reason: `rule shape is ${c.ruleShape}`, trigger: 'rule-shape' };
  }
  if (cfg.requireAllFiguresCeiling) {
    const badFigure = c.numericFigures.find((f) => f.governs !== 'eligibility-income-ceiling');
    if (badFigure) {
      return {
        autonomous: false,
        reason: `figure "${badFigure.quote}" governs ${badFigure.governs}, not an eligibility ceiling`,
        trigger: 'figure-role',
      };
    }
  }
  if (c.ruleShape === 'single-unconditional-threshold' && c.numericFigures.length === 0) {
    return {
      autonomous: false,
      reason: 'rule shape is a threshold but no income ceiling figure was identified',
      trigger: 'no-figure',
    };
  }
  return {
    autonomous: true,
    reason: 'single unconditional ceiling / categorical list, no scope signal, confident',
    trigger: '',
  };
}

export function isClassification(v: unknown): v is Classification {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    Array.isArray(o.numericFigures) &&
    typeof o.ruleShape === 'string' &&
    (RULE_SHAPES as readonly string[]).includes(o.ruleShape) &&
    Array.isArray(o.scopeSignals) &&
    (o.confidence === 'high' || o.confidence === 'low') &&
    typeof o.confidenceScore === 'number'
  );
}
