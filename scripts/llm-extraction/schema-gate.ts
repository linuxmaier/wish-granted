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
