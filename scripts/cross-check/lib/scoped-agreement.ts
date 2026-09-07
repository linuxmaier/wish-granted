/**
 * Scoped cross-method agreement -- the fix for issue #84's fragment-vs-record
 * flaw (PR #85 review).
 *
 * ## The flaw this replaces
 *
 * The deterministic Tier-3 parser emits a NARROW fragment: "the income (or
 * categorical) rule at this source is X." The agentic extractor emits a FULL
 * record: a geography envelope (`livesIn.wisconsin`), program gates
 * (`paysHeatingCost`, `hasSchoolAgeChild`), `manualReview` leaves -- real
 * conjuncts the parser never looks for.
 *
 * Feeding both whole trees to `criterionEquivalence` compares units that are not
 * comparable. A *correct* agentic record is legitimately narrower than a bare
 * income fragment, so whole-tree comparison reports "the agentic side rules out
 * profiles the parser accepts" almost every time -- for the wrong reason (it
 * added a `state = WI` leaf, not because it dropped a branch). Path A reduced to
 * a false-positive machine; its predicted 1-in-6 agreement rate was an artefact
 * of the comparison, not a finding about the two methods.
 *
 * ## What this does instead
 *
 * Compare only the dimension the parser actually speaks to. The parser's claim
 * is specific -- an `incomeAtOrBelow` scale, a `currentBenefits` set, a
 * pregnancy/child categorical. The right question is not "are these trees
 * equivalent" but:
 *
 *   On the dimension the parser has an opinion about, does the agentic tree
 *   exclude someone the parser's fragment admits?
 *
 * So we (1) read the parser fragment's constrained facts / income scales,
 * (2) PROJECT both trees onto that dimension -- pruning every leaf the parser is
 * silent on, collapsing the combinators through their identities -- and (3) hand
 * the two projections to `criterionEquivalence` UNCHANGED (the #84 constraint:
 * it is the referee, and three prior benchmark runs depend on it byte-for-byte).
 *
 * Geography, program gates and `manualReview` fall OUT of the comparison because
 * they are pruned before the referee ever sees them -- not counted as
 * divergence. What survives is a true positive: the parser admits an income
 * level the agentic tree rules out, or the parser offers a categorical path the
 * agentic tree lacks (the `foodshare-snap-wi` shape -- the exact failure this
 * whole design exists to catch).
 */
import type { Criterion, IncomeScale } from '../../../src/domain/criteria.ts';
import { criterionEquivalence, type EquivalenceResult } from '../../program-benchmark/lib/criterion-equivalence.ts';

/** The facts and income scales a parser fragment actually constrains. */
export interface ParserDimension {
  readonly facts: ReadonlySet<string>;
  readonly scales: ReadonlySet<IncomeScale>;
  /** True once the fragment has at least one concrete (non-`always`, non-`manualReview`) leaf. */
  readonly hasConcreteLeaf: boolean;
}

/**
 * Walk a parser fragment and collect the dimension it speaks to. `always` and
 * `manualReview` contribute nothing -- they are the parser having *no* opinion.
 */
export function parserDimension(fragment: Criterion): ParserDimension {
  const facts = new Set<string>();
  const scales = new Set<IncomeScale>();
  const visit = (n: Criterion): void => {
    switch (n.kind) {
      case 'compare':
      case 'set':
        facts.add(n.fact);
        return;
      case 'incomeAtOrBelow':
        scales.add(n.scale);
        return;
      case 'allOf':
      case 'anyOf':
        n.of.forEach(visit);
        return;
      case 'not':
        visit(n.of);
        return;
      case 'always':
      case 'manualReview':
        return;
    }
  };
  visit(fragment);
  return { facts, scales, hasConcreteLeaf: facts.size + scales.size > 0 };
}

const PRUNED = Symbol('pruned');
type MaybePruned = Criterion | typeof PRUNED;

function prune(node: Criterion, dim: ParserDimension): MaybePruned {
  switch (node.kind) {
    // The parser is silent on these -- out of scope for the comparison.
    case 'always':
    case 'manualReview':
      return PRUNED;
    case 'incomeAtOrBelow':
      return dim.scales.has(node.scale) ? node : PRUNED;
    case 'compare':
    case 'set':
      return dim.facts.has(node.fact) ? node : PRUNED;
    case 'not': {
      const inner = prune(node.of, dim);
      return inner === PRUNED ? PRUNED : { kind: 'not', of: inner };
    }
    case 'allOf':
    case 'anyOf': {
      // A dropped `allOf` conjunct is vacuously true; a dropped `anyOf`
      // alternative is a path the parser cannot see. Either way, keep only the
      // operands that still mention the parser's dimension.
      const kept = node.of
        .map((k) => prune(k, dim))
        .filter((k): k is Criterion => k !== PRUNED);
      if (kept.length === 0) return PRUNED;
      if (kept.length === 1) return kept[0]!;
      return { kind: node.kind, of: kept };
    }
  }
}

/**
 * Project a criterion tree onto the parser's dimension. Returns `null` when the
 * tree mentions none of it (nothing to compare on that dimension).
 */
export function projectOntoDimension(tree: Criterion, dim: ParserDimension): Criterion | null {
  const p = prune(tree, dim);
  return p === PRUNED ? null : p;
}

export type ScopedVerdict =
  /** On the parser's dimension, both methods describe the same rule. */
  | 'equivalent'
  /** On that dimension, one side rules out someone the other admits. */
  | 'divergent-dangerous'
  /** On that dimension, they differ only in the over-inclusive direction. */
  | 'divergent-safe'
  /** Projections differ and the referee could not decide equivalence. */
  | 'undecided'
  /** The agentic tree mentions none of the parser's dimension. */
  | 'no-shared-dimension'
  /** The parser fragment constrains nothing concrete (degenerate input). */
  | 'no-parser-dimension';

export interface ScopedComparison {
  readonly verdict: ScopedVerdict;
  /** The agentic projection rules out someone the parser's projection admits. */
  readonly agenticNarrower: boolean;
  /** The parser's projection rules out someone the agentic projection admits. */
  readonly deterministicNarrower: boolean;
  readonly deterministicProjected: Criterion | null;
  readonly agenticProjected: Criterion | null;
  /** `criterionEquivalence(parserProjection, agenticProjection)`. */
  readonly forward?: EquivalenceResult;
  /** `criterionEquivalence(agenticProjection, parserProjection)`. */
  readonly reverse?: EquivalenceResult;
  readonly detail: string;
}

/**
 * Compare the agentic tree against the parser fragment ON THE PARSER'S OWN
 * DIMENSION. `fragment` is the deterministic parser's output; `tree` is the
 * agentic extractor's full record.
 */
export function scopedAgreement(fragment: Criterion, tree: Criterion): ScopedComparison {
  const dim = parserDimension(fragment);

  if (!dim.hasConcreteLeaf) {
    return {
      verdict: 'no-parser-dimension',
      agenticNarrower: false,
      deterministicNarrower: false,
      deterministicProjected: null,
      agenticProjected: null,
      detail:
        'The deterministic fragment constrains no concrete fact or income scale ' +
        '(only `always` / `manualReview`); there is no dimension to scope onto.',
    };
  }

  const deterministicProjected = projectOntoDimension(fragment, dim)!; // hasConcreteLeaf => non-null
  const agenticProjected = projectOntoDimension(tree, dim);

  if (agenticProjected === null) {
    return {
      verdict: 'no-shared-dimension',
      agenticNarrower: false,
      deterministicNarrower: false,
      deterministicProjected,
      agenticProjected: null,
      detail:
        'The agentic rule mentions none of the facts or income scales the parser ' +
        'fragment constrains -- the two methods examined different dimensions.',
    };
  }

  const forward = criterionEquivalence(deterministicProjected, agenticProjected);
  const reverse = criterionEquivalence(agenticProjected, deterministicProjected);
  const agenticNarrower = forward.dangerousWitnesses.length > 0;
  const deterministicNarrower = reverse.dangerousWitnesses.length > 0;

  if (forward.verdict === 'equivalent' && reverse.verdict === 'equivalent') {
    return {
      verdict: 'equivalent',
      agenticNarrower: false,
      deterministicNarrower: false,
      deterministicProjected,
      agenticProjected,
      forward,
      reverse,
      detail:
        forward.method === 'canonical-form'
          ? 'On the dimension the parser constrains, both methods canonicalise to the same rule.'
          : `On the dimension the parser constrains, the two projections agree on every truth assignment (${forward.method}).`,
    };
  }

  if (agenticNarrower || deterministicNarrower) {
    const dirs: string[] = [];
    if (agenticNarrower) dirs.push('the agentic rule excludes someone the parser fragment admits');
    if (deterministicNarrower) dirs.push('the parser fragment excludes someone the agentic rule admits');
    return {
      verdict: 'divergent-dangerous',
      agenticNarrower,
      deterministicNarrower,
      deterministicProjected,
      agenticProjected,
      forward,
      reverse,
      detail: `On the parser's own dimension, ${dirs.join('; ')}.`,
    };
  }

  if (forward.verdict === 'undecided' || reverse.verdict === 'undecided') {
    return {
      verdict: 'undecided',
      agenticNarrower: false,
      deterministicNarrower: false,
      deterministicProjected,
      agenticProjected,
      forward,
      reverse,
      detail:
        'The projections onto the parser dimension differ and the referee could not ' +
        'decide equivalence (un-modellable leaf or state space too large). Not provably safe.',
    };
  }

  return {
    verdict: 'divergent-safe',
    agenticNarrower: false,
    deterministicNarrower: false,
    deterministicProjected,
    agenticProjected,
    forward,
    reverse,
    detail:
      'On the parser dimension the two projections differ, but only in the ' +
      'over-inclusive (not dangerous) direction.',
  };
}
