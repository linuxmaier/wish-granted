import { FACTS } from '../../src/domain/facts.ts';
import { walk, type Criterion } from '../../src/domain/criteria.ts';

/**
 * Post-hoc validity gate for a model-extracted `Criterion`.
 *
 * This deliberately mirrors the checks in tests/data/vocabulary.test.ts's
 * "criteria are well formed" block rather than inventing new ones -- the
 * issue asks to reuse the existing schema gate, and duplicating the logic
 * (instead of importing the test file, which pulls in the whole curated
 * PROGRAMS/interview graph) keeps this usable standalone by a build-time
 * extraction script. If the two ever drift, that is a real bug: any
 * extracted `Criterion` this gate accepts must be indistinguishable, to the
 * rest of the app, from one a human wrote by hand.
 *
 * A model output failing this gate must never reach a human reviewer as if
 * it were a candidate rule -- it goes back for another attempt or gets
 * logged as a failed extraction. "Never auto-merge" (per the issue) is
 * necessary but not sufficient; this is the check that runs before a human
 * even sees a diff.
 */
export type GateResult = { readonly ok: true } | { readonly ok: false; readonly problems: readonly string[] };

/**
 * One entry in the model's precondition inventory (issue #51, option 2). The
 * model reports these alongside the `Criterion`; `gateScopeContract` below
 * enforces them. Shape mirrors `PRECONDITION_SCHEMA` in criterion-schema.ts.
 */
export interface PreconditionReport {
  readonly text: string;
  readonly status: 'encoded' | 'undecidable' | 'dropped';
}

/**
 * The scope-carrying obligation (issue #51, option 2).
 *
 * The held-out run lifted real income thresholds out of conditional branches
 * (survivor-only, emergency-only, a cost-tier that is not a ceiling) and
 * dropped the conditions gating them. Every such output was schema-valid, so
 * `gateCriterion` above -- which only checks shape and vocabulary -- could not
 * see it. This gate checks the model's own precondition inventory instead: a
 * precondition the model marked `undecidable` or `dropped`, where nothing in
 * the emitted rule routes the case to a human, is a dropped conditional scope.
 * It never reaches a reviewer, so it is a gate failure.
 *
 * "Routes to a human" means: the whole `criterion` is a manualReview, or a
 * manualReview appears as a direct leaf of an allOf anywhere in the tree. An
 * anyOf leaf does NOT count -- an optional "...or a human checks" branch gates
 * nothing. This is the same shape madison-housing-choice-voucher.ts uses for a
 * real precondition the rules engine cannot decide.
 *
 * Known limit (stated, not hidden): the inventory is self-reported. This gate
 * catches "the model noticed the condition and did not carry it", not "the
 * model never noticed it". A gating clause the model fails to perceive is
 * simply absent from the list and the inventory looks complete. The
 * enumerate-before-you-build ordering in the prompt is what pushes against
 * that; this gate is the backstop for when it does not.
 */
export function gateScopeContract(
  criterion: Criterion,
  preconditions: readonly PreconditionReport[],
): GateResult {
  const unencoded = preconditions.filter((p) => p.status !== 'encoded');
  if (unencoded.length === 0 || routesToAHuman(criterion)) return { ok: true };

  return {
    ok: false,
    problems: unencoded.map(
      (p) =>
        `precondition "${p.text}" is marked "${p.status}" but the emitted rule (${criterion.kind}) contains no manualReview -- neither the whole rule nor an allOf leaf. A ${p.status} precondition with nothing routing it to a human is a dropped conditional scope (issue #51): abstain, or add a manualReview leaf.`,
    ),
  };
}

/** Whole rule is manualReview, or a manualReview sits as a direct allOf leaf. */
function routesToAHuman(criterion: Criterion): boolean {
  if (criterion.kind === 'manualReview') return true;
  for (const node of walk(criterion)) {
    if (node.kind === 'allOf' && node.of.some((child) => child.kind === 'manualReview')) return true;
  }
  return false;
}

export function gateCriterion(criterion: Criterion): GateResult {
  const problems: string[] = [];

  for (const node of walk(criterion)) {
    if (node.kind === 'compare' && typeof node.value === 'string') {
      const spec = FACTS[node.fact];
      if (spec.options && !spec.options.includes(node.value)) {
        problems.push(
          `compare references ${node.fact} = "${node.value}", which is not one of its declared options (${spec.options.join(', ')})`,
        );
      }
    }

    if (node.kind === 'set') {
      const spec = FACTS[node.fact];
      if (spec.options) {
        for (const value of node.values) {
          if (!spec.options.includes(value)) {
            problems.push(
              `set references ${node.fact} value "${value}", which is not one of its declared options (${spec.options.join(', ')})`,
            );
          }
        }
      }
    }

    if (node.kind === 'compare' && node.op !== 'eq' && node.op !== 'neq') {
      if (FACTS[node.fact].type !== 'number') {
        problems.push(`compare orders ${node.fact} with "${node.op}", but ${node.fact} is not numeric`);
      }
    }

    if (node.kind === 'allOf' || node.kind === 'anyOf') {
      if (node.of.length === 0) problems.push(`${node.kind} has no children -- an empty rule is not decidable`);
    }
  }

  return problems.length > 0 ? { ok: false, problems } : { ok: true };
}
