import { FACTS, type FactKey } from '../../src/domain/facts.ts';

/**
 * The enum-slug fix (docs/eligibility-extraction.md Section 4.6, issue #43).
 *
 * The one gate failure in the #23 live run was `madcap-categorical`: the model
 * emitted `"FoodShare"`, `"Section 8"`, `"SNAP"`, `"WIC"` for `currentBenefits`,
 * where the fact declares slugs (`snap-foodshare`, `housing-choice-voucher`).
 * Semantically right, mechanically wrong, correctly caught by `schema-gate.ts`.
 *
 * JSON Schema cannot express "the value compared against enum fact X must be one
 * of *X's* declared options" -- a cross-field constraint (see
 * `criterion-schema.ts`). The fix the spike identified but deliberately did not
 * apply (tuning against the nine-case set and re-reporting it would measure the
 * tuning): list each enum fact's valid values, with their human-readable
 * labels, in the system prompt so the model knows the exact slug to emit.
 *
 * Built from `FACTS` at call time, so it can never list a stale value set.
 */

/** Enum / enumSet facts, in `FACT_KEYS` order, with their options. */
export function enumFacts(): { key: FactKey; type: 'enum' | 'enumSet'; options: readonly string[] }[] {
  const out: { key: FactKey; type: 'enum' | 'enumSet'; options: readonly string[] }[] = [];
  for (const key of Object.keys(FACTS) as FactKey[]) {
    const spec = FACTS[key];
    if ((spec.type === 'enum' || spec.type === 'enumSet') && spec.options) {
      out.push({ key, type: spec.type, options: spec.options });
    }
  }
  return out;
}

/**
 * A prompt fragment listing every enum fact's exact valid values. For each
 * value we give `slug` -- the only string the model may emit -- and, where the
 * fact declares one, the display label, so the model can match a source phrase
 * ("Section 8", "food stamps") to the right slug.
 */
export function describeEnumFacts(): string {
  const lines: string[] = [
    'ENUM FACT VALUES. When a `compare` or `set` node references one of the facts below, the `value` / `values` you emit MUST be one of that fact\'s exact slugs from this list -- never a display name, source phrase, or abbreviation. If a program or benefit named in the source has no slug here, do not invent one: leave it out, and if that makes the rule undecidable, use manualReview.',
    '',
  ];
  for (const fact of enumFacts()) {
    const spec = FACTS[fact.key];
    lines.push(`- ${fact.key} (${fact.type === 'enumSet' ? 'multi-select' : 'single-select'}): ${spec.label}`);
    for (const value of fact.options) {
      const label = spec.optionLabels?.[value];
      lines.push(label ? `    - ${value}  (source may call this: "${label}")` : `    - ${value}`);
    }
  }
  return lines.join('\n');
}
