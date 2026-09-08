/**
 * The eligibility extraction integration point -- deliberately NOT wired up.
 *
 * This pipeline does the descriptive half of a record (#14). Eligibility is not
 * proposed from here, and the bar for changing that is below.
 *
 * Where it would attach: after `classify()` produces a `RecordFinding`, an
 * eligibility candidate becomes a separate, clearly-labelled proposal kind that
 * the report renders in its own mandatory-review section -- never blended with
 * descriptive proposals, and never auto-merged. There is intentionally no code
 * path, not even a flag, that reaches an extractor from here today.
 *
 * ## The bar
 *
 * An extractor may attach here when a frozen held-out run shows, together:
 *
 *   1. **zero over-claims** -- no rule that tells someone they qualify when the
 *      verified record rules them out or cannot say, and
 *   2. **zero under-claims**, and
 *   3. **a yield above `MIN_USABLE_RULE_RATE`** -- so the first two are not
 *      bought by abstaining on everything.
 *
 * All three, measured by `scripts/program-benchmark/`. Tracked at #92 (the live
 * run) and #94 (the seam that lets a pipeline express a partial rule at all).
 *
 * Clearing the bar does not remove human review: every eligibility change is
 * reviewed before it lands (#1, #14). It removes only the refusal to *propose*.
 *
 * ## Why the bar is shaped that way
 *
 * The failure that closed this path (`lifeline-survivor-extended`, #51) is worth
 * knowing because it defeats the obvious mitigation. The model lifted a real
 * "200% of the Federal Poverty Guidelines" threshold out of a survivor-only
 * extended-eligibility branch and dropped the three conditions gating it, none
 * of which the interview can ask. General Lifeline is 135% FPL, so the rule
 * tells someone between the two that they qualify when they do not. The output
 * was schema-valid and semantically coherent, so `schema-gate.ts` could not
 * catch it -- "the gate protects us" does not apply here.
 *
 * Note which direction that is: an **over-claim**. Until 2026-09-08 the
 * benchmark measured only the under-claim direction, so this seam's original
 * unblock condition ("zero dangerous over-claims") was written against a metric
 * that could not see the failure it was blocking on. Both directions are now
 * measured and both block, which is why the bar above names them separately.
 * See docs/standing-decisions.md, "The two harms".
 */

export const ELIGIBILITY_EXTRACTION = {
  wired: false,
  /** The measurement that would clear the bar in the docblock above. */
  blockedBy: 'https://github.com/linuxmaier/wish-granted/issues/92',
  reason:
    'No extractor has yet shown zero over-claims AND zero under-claims AND a yield above the floor ' +
    'on a frozen held-out run. Descriptive-field ingestion only until it does.',
} as const;
