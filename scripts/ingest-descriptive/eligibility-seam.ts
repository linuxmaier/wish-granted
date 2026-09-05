/**
 * The eligibility extraction integration point -- deliberately NOT wired up.
 *
 * Issue #14's scope, per the issue itself: "Ingestion mostly buys discovery and
 * freshness, not rules... the descriptive half of a record is the automatable
 * half." This pipeline does the descriptive half. Eligibility stays human.
 *
 * There IS a built LLM extractor -- `scripts/llm-extraction/` (issues #5, #23,
 * #43) -- that emits a `Criterion` tree plus a source excerpt and runs it
 * through `scripts/llm-extraction/schema-gate.ts`. It is not called from here,
 * and must not be, because:
 *
 *   - Its held-out eval was run live against claude-sonnet-5 and produced **1
 *     dangerous over-claim**, which is a BLOCKING result by that issue's own
 *     contract. Tracked as **issue #51**.
 *   - The failure (`lifeline-survivor-extended`): the model lifted a real "200%
 *     of the Federal Poverty Guidelines" threshold out of a survivor-only
 *     extended-eligibility branch and dropped all three conditions gating it
 *     (survivor status, an attempted line-separation request, financial
 *     hardship) -- none of which are facts the interview can ask. General
 *     Lifeline is 135% FPL, so that rule tells someone between the two
 *     thresholds they qualify when they do not.
 *   - Critically, that output is **schema-valid and semantically coherent** --
 *     `schema-gate.ts` cannot catch it. So the usual mitigation ("the gate
 *     protects us") does not apply.
 *
 * If a future extractor passes a frozen held-out eval with zero dangerous
 * over-claims, this is where it would attach: after `classify()` produces a
 * `RecordFinding`, an eligibility candidate would be added as a separate,
 * clearly-labelled proposal kind that the report renders in its own mandatory-
 * review section, never blended with descriptive proposals, and never
 * auto-merged. Until issue #51 is resolved, there is intentionally no code path
 * -- not even a flag -- that reaches the extractor from this pipeline.
 */

export const ELIGIBILITY_EXTRACTION = {
  wired: false,
  blockedBy: 'https://github.com/linuxmaier/wish-granted/issues/51',
  reason:
    'Held-out eval produced a schema-valid dangerous over-claim; the schema gate cannot catch it. ' +
    'Descriptive-field ingestion only until that is resolved.',
} as const;
