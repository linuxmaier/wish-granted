import type { FactKey } from './facts';

/**
 * A small, serializable expression language for eligibility rules.
 *
 * Two properties drive the design:
 *
 * 1. It must evaluate against *partial* answers. Every node returns pass, fail,
 *    or unknown, and the boolean combinators use three-valued (Kleene) logic.
 *    This is what lets the app show "you qualify", "you might qualify, we need
 *    one more thing", and "ruled out" from the first screen onward.
 *
 * 2. It must explain itself. Nodes are data, not functions, so the engine can
 *    walk the same tree it evaluated and render a human-readable reason for the
 *    verdict. That rules out closures/predicates as a representation.
 */

export type ComparisonOp = 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte';
export type SetOp = 'in' | 'notIn' | 'includesAny' | 'includesAll' | 'excludes';

/** Income yardsticks programs measure against. See engine/thresholds.ts. */
export type IncomeScale =
  /** Federal Poverty Level (HHS poverty guidelines), by household size. */
  | 'fpl'
  /** Wisconsin State Median Income, by household size. Used by WHEAP. */
  | 'wi-smi'
  /** HUD Area Median Income for the Madison, WI MSA (Dane County). */
  | 'dane-ami';

interface Labeled {
  /**
   * Overrides the auto-generated explanation for this node. Prefer letting the
   * engine generate it -- a hand-written label silently goes stale when the
   * rule beside it changes. Use only where the generated phrasing is genuinely
   * misleading.
   */
  readonly label?: string;
}

export type Criterion =
  /** Unconditional. Used by programs with no eligibility test of their own. */
  | (Labeled & { readonly kind: 'always' })
  /**
   * Never resolves -- always unknown, so the program can never be auto-confirmed
   * or auto-ruled-out and always lands in "possibly eligible" with `note` shown.
   *
   * This is the honest representation of criteria a rules engine cannot decide:
   * "subject to funding availability", "at caseworker discretion", "waitlist
   * currently closed". Encoding these as `always` would overstate what we know.
   */
  | (Labeled & { readonly kind: 'manualReview'; readonly note: string })
  | (Labeled & {
      readonly kind: 'compare';
      readonly fact: FactKey;
      readonly op: ComparisonOp;
      readonly value: number | string | boolean;
    })
  | (Labeled & {
      readonly kind: 'set';
      readonly fact: FactKey;
      readonly op: SetOp;
      readonly values: readonly string[];
    })
  /**
   * Household income at or below `percent` of `scale` for the household's size.
   * Depends on two facts at once (income and household size), which is why it
   * is a node type rather than a plain `compare`.
   */
  | (Labeled & {
      readonly kind: 'incomeAtOrBelow';
      readonly scale: IncomeScale;
      readonly percent: number;
    })
  | (Labeled & { readonly kind: 'allOf'; readonly of: readonly Criterion[] })
  | (Labeled & { readonly kind: 'anyOf'; readonly of: readonly Criterion[] })
  | (Labeled & { readonly kind: 'not'; readonly of: Criterion });

// --- Builders -------------------------------------------------------------
// Program records read far better as `allOf(livesIn.wisconsin, incomeAtOrBelow(...))`
// than as raw object literals, and the builders keep the shapes correct.

export const always = (label?: string): Criterion => ({ kind: 'always', label });

export const manualReview = (note: string, label?: string): Criterion => ({
  kind: 'manualReview',
  note,
  label,
});

export const allOf = (...of: Criterion[]): Criterion => ({ kind: 'allOf', of });
export const anyOf = (...of: Criterion[]): Criterion => ({ kind: 'anyOf', of });
export const not = (of: Criterion): Criterion => ({ kind: 'not', of });

export const is = (fact: FactKey, value: string | number | boolean): Criterion => ({
  kind: 'compare',
  fact,
  op: 'eq',
  value,
});

export const isTrue = (fact: FactKey): Criterion => is(fact, true);
export const isFalse = (fact: FactKey): Criterion => is(fact, false);

export const atMost = (fact: FactKey, value: number): Criterion => ({
  kind: 'compare',
  fact,
  op: 'lte',
  value,
});

export const atLeast = (fact: FactKey, value: number): Criterion => ({
  kind: 'compare',
  fact,
  op: 'gte',
  value,
});

export const oneOf = (fact: FactKey, values: readonly string[]): Criterion => ({
  kind: 'set',
  fact,
  op: 'in',
  values,
});

export const noneOf = (fact: FactKey, values: readonly string[]): Criterion => ({
  kind: 'set',
  fact,
  op: 'notIn',
  values,
});

/** True when the multi-select fact contains at least one of `values`. */
export const hasAnyOf = (fact: FactKey, values: readonly string[]): Criterion => ({
  kind: 'set',
  fact,
  op: 'includesAny',
  values,
});

export const incomeAtOrBelow = (scale: IncomeScale, percent: number): Criterion => ({
  kind: 'incomeAtOrBelow',
  scale,
  percent,
});

/** Geography shorthands -- by far the most repeated criteria in the dataset. */
export const livesIn = {
  wisconsin: is('state', 'WI'),
  daneCounty: allOf(is('state', 'WI'), is('county', 'dane')),
  madison: allOf(is('state', 'WI'), is('county', 'dane'), is('city', 'madison')),
} as const;

/** Walks a criterion tree, yielding every node. */
export function* walk(criterion: Criterion): Generator<Criterion> {
  yield criterion;
  switch (criterion.kind) {
    case 'allOf':
    case 'anyOf':
      for (const child of criterion.of) yield* walk(child);
      break;
    case 'not':
      yield* walk(criterion.of);
      break;
    default:
      break;
  }
}

/** Every fact key a criterion tree could consult. */
export function factsReferenced(criterion: Criterion): Set<FactKey> {
  const keys = new Set<FactKey>();
  for (const node of walk(criterion)) {
    if (node.kind === 'compare' || node.kind === 'set') keys.add(node.fact);
    if (node.kind === 'incomeAtOrBelow') {
      keys.add('annualHouseholdIncome');
      keys.add('householdSize');
    }
  }
  return keys;
}
