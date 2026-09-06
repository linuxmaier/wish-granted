import { FACTS } from '../../../src/domain/facts.ts';
import type { Criterion } from '../../../src/domain/criteria.ts';

/**
 * Canonicalisation for `Criterion` trees -- the "normalise" half of the
 * normalise-then-compare equivalence check (see ./criterion-equivalence.ts and
 * docs/program-benchmark.md).
 *
 * The goal: two `Criterion` trees that a human would call "the same rule,
 * written differently" should canonicalise to the byte-identical structure, so
 * a working extractor is not marked wrong for choosing a different-but-faithful
 * encoding.
 *
 * ## What canonicalisation does (and why each step is sound)
 *
 *  1. Drops `label`. It is cosmetic -- the engine regenerates explanations by
 *     walking the evaluated tree (src/domain/criteria.ts docblock). Extraction
 *     never emits one.
 *  2. Negation normal form. `not` is pushed to the leaves:
 *       not(allOf(a,b))  -> anyOf(not a, not b)     (De Morgan)
 *       not(anyOf(a,b))  -> allOf(not a, not b)     (De Morgan)
 *       not(not(x))      -> x
 *     Three-valued (Kleene) De Morgan holds -- `not` swaps T/F and fixes U, and
 *     min/max distribute over that -- so this preserves meaning under partial
 *     answers, not just complete ones.
 *  3. Folds `not` into a leaf's operator where an exact dual exists:
 *       not(compare eq)  <-> compare neq   (and lt<->gte, lte<->gt)
 *       not(set in)      <-> set notIn
 *       not(set includesAny) <-> set excludes
 *     `set includesAll` has no single-operator dual, so `not(set includesAll)`
 *     is left as a wrapped leaf.
 *  4. Flattens nested same-kind combinators: allOf(a, allOf(b,c)) -> allOf(a,b,c).
 *  5. Drops identity elements: `always` inside `allOf` is removed; `always`
 *     inside `anyOf` collapses the whole node to `always`.
 *  6. De-duplicates and sorts the operands of allOf/anyOf by a stable key, so
 *     operand order and repetition never matter.
 *  7. Unwraps singletons: allOf(x) -> x, anyOf(x) -> x.
 *  8. Canonicalises leaves: set `values` are sorted and de-duped; a boolean
 *     `compare(fact, neq, false)` becomes `compare(fact, eq, true)` (and the
 *     mirror), using the fact's declared type from FACTS.
 *
 * ## What it deliberately does NOT do -- these produce FALSE MISMATCHES
 *
 *  - No absorption or distribution. `anyOf(a, allOf(a, b))` is really just `a`,
 *    and `allOf(a, anyOf(b, c))` equals `anyOf(allOf(a,b), allOf(a,c))`, but
 *    this function does not rewrite either. ./criterion-equivalence.ts's bounded
 *    semantic check recovers some of these; where it cannot, the pair is scored
 *    "divergent" even though the rules mean the same thing.
 *  - No threshold arithmetic. `compare(age, gte, 60)` and `compare(age, gt, 59)`
 *    are equal over integers; canonicalisation keeps them distinct.
 *  - No cross-scale reasoning. `incomeAtOrBelow('wi-smi', 60)` against a table
 *    that is *already* 60%-of-SMI is, for this dataset, the same set as
 *    `incomeAtOrBelow('wi-smi', 100)` -- canonicalisation cannot know that and
 *    treats them as different.
 *  - `manualReview` note text is dropped from the comparison key. Two
 *    abstention leaves with different prose are "the same" structurally; the
 *    accuracy of the note is not scored here.
 *
 * These limits are stated at length in docs/program-benchmark.md, "Where the
 * equivalence check is wrong".
 */

const FLIP_COMPARE: Record<string, 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte'> = {
  eq: 'neq',
  neq: 'eq',
  lt: 'gte',
  gte: 'lt',
  lte: 'gt',
  gt: 'lte',
};

const FLIP_SET: Record<string, 'in' | 'notIn' | 'includesAny' | 'excludes'> = {
  in: 'notIn',
  notIn: 'in',
  includesAny: 'excludes',
  excludes: 'includesAny',
  // includesAll: intentionally absent -- no single-operator dual.
};

/** Push `not` inward to the leaves. Input may be any tree; output is in NNF. */
export function toNegationNormalForm(c: Criterion): Criterion {
  switch (c.kind) {
    case 'allOf':
      return { kind: 'allOf', of: c.of.map(toNegationNormalForm) };
    case 'anyOf':
      return { kind: 'anyOf', of: c.of.map(toNegationNormalForm) };
    case 'not':
      return negate(toNegationNormalForm(c.of));
    default:
      return c;
  }
}

/** Negate an already-NNF tree, staying in NNF. Never recurses into `not`. */
function negate(c: Criterion): Criterion {
  switch (c.kind) {
    case 'allOf':
      return { kind: 'anyOf', of: c.of.map(negate) };
    case 'anyOf':
      return { kind: 'allOf', of: c.of.map(negate) };
    case 'not':
      // Only survives on a leaf with no operator dual; double negation cancels.
      return c.of;
    case 'always':
      // No "never" node in the language; keep an explicit wrapped negation.
      return { kind: 'not', of: c };
    case 'manualReview':
      // not(unknown) === unknown.
      return c;
    case 'compare':
      return { kind: 'compare', fact: c.fact, op: FLIP_COMPARE[c.op]!, value: c.value };
    case 'set': {
      const dual = FLIP_SET[c.op];
      return dual ? { kind: 'set', fact: c.fact, op: dual, values: c.values } : { kind: 'not', of: c };
    }
    case 'incomeAtOrBelow':
      // "income is NOT at or below p%" -- no dual node; wrap it.
      return { kind: 'not', of: c };
    default: {
      const _exhaustive: never = c;
      return _exhaustive;
    }
  }
}

/** Canonicalise a tree that is already in NNF. */
function canonicalize(c: Criterion): Criterion {
  switch (c.kind) {
    case 'always':
      return { kind: 'always' };
    case 'manualReview':
      return { kind: 'manualReview', note: c.note };
    case 'incomeAtOrBelow':
      return { kind: 'incomeAtOrBelow', scale: c.scale, percent: c.percent };
    case 'compare': {
      const spec = FACTS[c.fact];
      if (spec?.type === 'boolean' && c.op === 'neq' && typeof c.value === 'boolean') {
        return { kind: 'compare', fact: c.fact, op: 'eq', value: !c.value };
      }
      return { kind: 'compare', fact: c.fact, op: c.op, value: c.value };
    }
    case 'set': {
      const values = [...new Set(c.values)].sort();
      return { kind: 'set', fact: c.fact, op: c.op, values };
    }
    case 'not':
      return { kind: 'not', of: canonicalize(c.of) };
    case 'allOf':
    case 'anyOf': {
      const kind = c.kind;
      let kids = c.of
        .map(canonicalize)
        .flatMap((k) => (k.kind === kind ? k.of : [k]));

      if (kind === 'allOf') {
        kids = kids.filter((k) => k.kind !== 'always');
      } else if (kids.some((k) => k.kind === 'always')) {
        return { kind: 'always' };
      }

      const seen = new Map<string, Criterion>();
      for (const k of kids) {
        const key = comparisonKey(k);
        if (!seen.has(key)) seen.set(key, k);
      }
      const uniq = [...seen.values()].sort((a, b) => {
        const ka = comparisonKey(a);
        const kb = comparisonKey(b);
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      });

      // allOf() -> always (vacuously true). anyOf() cannot be produced from a
      // gate-valid input (empty combinators are rejected); if it somehow is,
      // treat it as always rather than throwing -- documented in
      // docs/program-benchmark.md.
      if (uniq.length === 0) return { kind: 'always' };
      if (uniq.length === 1) return uniq[0]!;
      return { kind, of: uniq };
    }
    default: {
      const _exhaustive: never = c;
      return _exhaustive;
    }
  }
}

/** The public entry point: NNF, then canonicalise. */
export function normalizeCriterion(c: Criterion): Criterion {
  return canonicalize(toNegationNormalForm(c));
}

/**
 * A stable string identifying a `Criterion` for equality and sorting. Object
 * keys are emitted in a fixed order and `manualReview` note text is dropped, so
 * two abstention leaves with different prose share a key. Call on a normalised
 * tree (this does not normalise for you).
 */
export function comparisonKey(c: Criterion): string {
  return JSON.stringify(keyShape(c));
}

function keyShape(c: Criterion): unknown {
  switch (c.kind) {
    case 'always':
      return { k: 'always' };
    case 'manualReview':
      return { k: 'manualReview' };
    case 'compare':
      return { k: 'compare', fact: c.fact, op: c.op, value: c.value };
    case 'set':
      return { k: 'set', fact: c.fact, op: c.op, values: [...c.values] };
    case 'incomeAtOrBelow':
      return { k: 'incomeAtOrBelow', scale: c.scale, percent: c.percent };
    case 'not':
      return { k: 'not', of: keyShape(c.of) };
    case 'allOf':
    case 'anyOf':
      return { k: c.kind, of: c.of.map(keyShape) };
    default: {
      const _exhaustive: never = c;
      return _exhaustive;
    }
  }
}

/** True when two trees canonicalise to the same structure. */
export function sameCanonicalForm(a: Criterion, b: Criterion): boolean {
  return comparisonKey(normalizeCriterion(a)) === comparisonKey(normalizeCriterion(b));
}

/** Count `manualReview` leaves anywhere in a tree. */
export function countManualReview(c: Criterion): number {
  let n = 0;
  const visit = (node: Criterion): void => {
    if (node.kind === 'manualReview') n += 1;
    else if (node.kind === 'allOf' || node.kind === 'anyOf') node.of.forEach(visit);
    else if (node.kind === 'not') visit(node.of);
  };
  visit(c);
  return n;
}
