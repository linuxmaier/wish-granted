/**
 * Hypothesis 2 (issue #62): verification by counterexample.
 *
 * Give a second call the emitted `Criterion` plus the original excerpt and ask
 * it to construct someone who SATISFIES the rule as written but is NOT eligible
 * under the excerpt. If it can, with confidence, reject the extraction and route
 * to `manualReview`.
 *
 * This targets scope-dropping directly and does not depend on the extracting
 * call having noticed anything. It is, however, strictly weaker than hypothesis
 * 1 for the *implicit*-scope class: `seniorcare-coverage-levels`,
 * `badgercare-plus-population-columns`, `cda-residency-not-required` -- where the
 * scope lives in a table structure or a negation the model does not perceive as
 * a condition. #61 measured that a call which cannot see the scope cannot report
 * it; a call that cannot see the scope also cannot build a counterexample from
 * it. Expect this gate to catch the "noticed a branch, dropped its gates" cases
 * (Lifeline survivor, Emergency Assistance) and miss the structural ones -- which
 * is exactly why it is paired with H1/H3, not proposed alone.
 *
 * Pure module: schema + prompt + verdict interpreter. API plumbing is in
 * `run-framing-eval.ts`.
 */

export interface Counterexample {
  readonly attempt: string;
  readonly satisfiesEmittedRule: boolean;
  readonly actuallyEligible: 'yes' | 'no' | 'cannot-tell-from-excerpt';
  /** The condition in the excerpt the emitted rule failed to carry. "" if none. */
  readonly scopeThatWasDropped: string;
  readonly confidence: 'high' | 'low';
}

export const VERIFIER_SYSTEM_PROMPT = `You are checking an eligibility rule that another model extracted from a source excerpt. You will be given the excerpt and the extracted rule (as JSON).

Your job: try to construct a specific person who SATISFIES THE EXTRACTED RULE EXACTLY AS WRITTEN but who the EXCERPT says is NOT eligible for the program. Call construct_counterexample exactly once.

- Read the excerpt for every condition it states: income ceilings, but also branch conditions ("extended eligibility", "if you are a survivor", "in an emergency"), sub-population scoping (a table column's population, "households with an elderly member"), negations ("residency is not required"), and requirements the rule may have flattened away.
- Describe your attempt concretely (age, household, income relative to the threshold, situation).
- satisfiesEmittedRule: does your person pass the extracted rule as written?
- actuallyEligible: does the EXCERPT say this person is eligible? "no" if a condition the rule dropped rules them out; "cannot-tell-from-excerpt" if the excerpt is silent.
- scopeThatWasDropped: the exact condition from the excerpt the rule failed to carry, or "" if the rule faithfully captures the excerpt.
- confidence: "high" only if you are sure the excerpt excludes your person while the rule admits them.

If you cannot construct such a person -- the rule faithfully captures the excerpt -- say so: satisfiesEmittedRule true, actuallyEligible "yes", scopeThatWasDropped "".`;

export function buildVerifierToolSchema() {
  return {
    type: 'object',
    properties: {
      attempt: {
        type: 'string',
        description: 'A concrete person: age, household size, income relative to any threshold, and situation.',
      },
      satisfiesEmittedRule: { type: 'boolean' },
      actuallyEligible: { type: 'string', enum: ['yes', 'no', 'cannot-tell-from-excerpt'] },
      scopeThatWasDropped: {
        type: 'string',
        description: 'The exact condition from the excerpt the emitted rule failed to carry. Empty string if the rule is faithful.',
      },
      confidence: { type: 'string', enum: ['high', 'low'] },
    },
    required: ['attempt', 'satisfiesEmittedRule', 'actuallyEligible', 'scopeThatWasDropped', 'confidence'],
    additionalProperties: false,
  };
}

/** Reject the extraction (route to manualReview) when the verifier found a confident counterexample. */
export function verdictRejects(v: Counterexample): boolean {
  return v.satisfiesEmittedRule && v.actuallyEligible === 'no' && v.confidence === 'high';
}

export function isCounterexample(v: unknown): v is Counterexample {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.attempt === 'string' &&
    typeof o.satisfiesEmittedRule === 'boolean' &&
    (o.actuallyEligible === 'yes' || o.actuallyEligible === 'no' || o.actuallyEligible === 'cannot-tell-from-excerpt') &&
    typeof o.scopeThatWasDropped === 'string' &&
    (o.confidence === 'high' || o.confidence === 'low')
  );
}
