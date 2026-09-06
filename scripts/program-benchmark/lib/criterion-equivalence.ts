import type { Criterion, IncomeScale } from '../../../src/domain/criteria.ts';
import { normalizeCriterion, comparisonKey } from './criterion-normalize.ts';

/**
 * Semantic equivalence for `Criterion` trees, and the detection of *dangerous*
 * divergence -- the load-bearing design decision of the program benchmark.
 * Read docs/program-benchmark.md, "How equivalence is judged", alongside this.
 *
 * Two layers, in order:
 *
 *  1. Canonical form (./criterion-normalize.ts). If the two trees canonicalise
 *     to the same structure, they are equivalent. Fast, total, and never wrong
 *     in the "said equivalent when they weren't" direction.
 *
 *  2. Bounded three-valued model check. When canonical forms differ, we try to
 *     decide equivalence by evaluating both trees under Kleene (strong
 *     three-valued) logic over *every* combination of leaf truth values -- the
 *     same T/F/unknown the real rules engine uses (src/domain, docs/design.md
 *     "Three-valued logic"). This catches equivalences that canonicalisation
 *     misses: absorption, distribution, a rule re-expressed with a different
 *     combinator shape.
 *
 *     Leaves are abstracted to variables:
 *       - each distinct non-income leaf  -> a variable over {true, false, unknown}
 *       - each `incomeAtOrBelow` scale   -> one ordered variable capturing where
 *         the household's income sits relative to that scale's thresholds, plus
 *         an "unknown" state. `incomeAtOrBelow(s, 100)` and `incomeAtOrBelow(s,
 *         200)` are then correctly linked: income at or below 100% is also at or
 *         below 200%.
 *       - `manualReview` -> constant unknown
 *       - `always`       -> constant true
 *
 *     The enumeration is skipped (verdict `undecided`) when the state space
 *     exceeds MAX_STATES, or when a leaf cannot be modelled (a numeric
 *     `compare` against a fact that also appears with a different operator or
 *     bound -- we do not build an interval solver). `undecided` is reported
 *     honestly; it is never silently treated as a match or a mismatch.
 *
 * ## The asymmetry this encodes
 *
 * Wrongly excluding someone is far worse than wrongly including them (an
 * over-inclusive result sends a person to ask the agency; an under-inclusive
 * one tells them not to bother -- docs/eligibility-extraction.md Section 4.4).
 * So when the model check finds the two trees disagree, it separates the
 * directions: an assignment where the verified rule says "eligible" or "needs
 * review" but the candidate says "ruled out" is a DANGEROUS witness. The
 * reverse is divergence but not dangerous.
 *
 * ## Where this is still wrong
 *
 *  - `undecided` cases fall back to canonical-form equality only, so a
 *    distribution/absorption rewrite of a rule with an un-modellable leaf is
 *    scored divergent.
 *  - Leaf abstraction treats `oneOf(fact, [x])` (set `in`) and `hasAnyOf(fact,
 *    [x])` (set `includesAny`) as unrelated variables -- they get different
 *    keys. For a fact where the two happen to coincide, that is a false
 *    mismatch.
 *  - Two `incomeAtOrBelow` nodes on *different* scales are independent
 *    variables; a real-world identity between, say, a % of SMI and a % of FPL
 *    is invisible.
 *  - The model check proves equivalence over the abstracted variables. If the
 *    abstraction is too coarse (it lost a real constraint between leaves), a
 *    "proven equivalent" could in principle be wrong. The abstraction only
 *    loses constraints for numeric `compare` on a shared fact, which is exactly
 *    the case pushed to `undecided`.
 */

export type EquivalenceVerdict = 'equivalent' | 'divergent' | 'undecided';

export interface DangerousWitness {
  /** Human-readable description of the applicant profile that is wrongly excluded. */
  readonly profile: string;
  /** What the verified rule returns for that profile: 'eligible' or 'needs-review'. */
  readonly verified: 'eligible' | 'needs-review';
  /** Always 'ruled-out' -- that is what makes it a witness. */
  readonly candidate: 'ruled-out';
}

export interface EquivalenceResult {
  readonly verdict: EquivalenceVerdict;
  readonly method: 'canonical-form' | 'model-check' | 'canonical-form-only';
  readonly detail: string;
  /**
   * Non-empty only when the model check ran and found the candidate excludes
   * someone the verified rule includes. Never populated for `undecided`.
   */
  readonly dangerousWitnesses: readonly DangerousWitness[];
  /** All disagreeing profiles (both directions), for debugging. Capped. */
  readonly divergenceWitnesses: readonly string[];
}

const MAX_STATES = 50_000;
const MAX_WITNESSES = 5;

type Tri = 'T' | 'F' | 'U';

const andTri = (a: Tri, b: Tri): Tri => (a === 'F' || b === 'F' ? 'F' : a === 'U' || b === 'U' ? 'U' : 'T');
const orTri = (a: Tri, b: Tri): Tri => (a === 'T' || b === 'T' ? 'T' : a === 'U' || b === 'U' ? 'U' : 'F');
const notTri = (a: Tri): Tri => (a === 'T' ? 'F' : a === 'F' ? 'T' : 'U');

interface Abstraction {
  /** Distinct non-income leaf keys, each a {T,F,U} variable. */
  readonly boolKeys: string[];
  /** Per scale: the sorted distinct percents that appear. */
  readonly scalePercents: Map<IncomeScale, number[]>;
  /** Set when a leaf cannot be modelled -- forces `undecided`. */
  readonly unmodellable: string | null;
}

/** Collect the leaf vocabulary of both trees, and decide if it is modellable. */
function abstract2(a: Criterion, b: Criterion): Abstraction {
  const boolKeys = new Set<string>();
  const scalePercents = new Map<IncomeScale, Set<number>>();
  // fact -> set of "op|value" signatures for numeric compares; >1 distinct
  // ordering signature on one fact means we would need an interval solver.
  const numericCompareSigs = new Map<string, Set<string>>();
  let unmodellable: string | null = null;

  const visit = (node: Criterion): void => {
    switch (node.kind) {
      case 'always':
        return;
      case 'manualReview':
        return;
      case 'incomeAtOrBelow': {
        const set = scalePercents.get(node.scale) ?? new Set<number>();
        set.add(node.percent);
        scalePercents.set(node.scale, set);
        return;
      }
      case 'allOf':
      case 'anyOf':
        node.of.forEach(visit);
        return;
      case 'not':
        visit(node.of);
        return;
      case 'compare': {
        if (node.op !== 'eq' && node.op !== 'neq' && typeof node.value === 'number') {
          const sigs = numericCompareSigs.get(node.fact) ?? new Set<string>();
          sigs.add(`${node.op}|${node.value}`);
          numericCompareSigs.set(node.fact, sigs);
        }
        boolKeys.add(comparisonKey(node));
        return;
      }
      case 'set':
        boolKeys.add(comparisonKey(node));
        return;
    }
  };
  visit(a);
  visit(b);

  for (const [fact, sigs] of numericCompareSigs) {
    if (sigs.size > 1) {
      unmodellable = `numeric compares on "${fact}" with more than one bound (${[...sigs].join(', ')}) -- no interval solver`;
      break;
    }
  }

  return {
    boolKeys: [...boolKeys].sort(),
    scalePercents: new Map([...scalePercents].map(([k, v]) => [k, [...v].sort((x, y) => x - y)])),
    unmodellable,
  };
}

interface State {
  readonly bools: Map<string, Tri>;
  /** Per scale: index in {0..percents.length} of the smallest threshold met, or -1 for unknown. */
  readonly income: Map<IncomeScale, number>;
}

function stateSpaceSize(abs: Abstraction): number {
  let size = 3 ** abs.boolKeys.length;
  for (const percents of abs.scalePercents.values()) size *= percents.length + 2;
  return size;
}

function* enumerateStates(abs: Abstraction): Generator<State> {
  const tris: Tri[] = ['T', 'F', 'U'];
  const scales = [...abs.scalePercents.keys()];

  const rec = function* (bi: number, bools: Map<string, Tri>): Generator<Map<string, Tri>> {
    if (bi === abs.boolKeys.length) {
      yield bools;
      return;
    }
    for (const t of tris) {
      const next = new Map(bools);
      next.set(abs.boolKeys[bi]!, t);
      yield* rec(bi + 1, next);
    }
  };

  const recIncome = function* (si: number, income: Map<IncomeScale, number>): Generator<Map<IncomeScale, number>> {
    if (si === scales.length) {
      yield income;
      return;
    }
    const scale = scales[si]!;
    const k = abs.scalePercents.get(scale)!.length;
    // index -1 == unknown; 0..k == "smallest threshold met" (k == none met)
    for (let idx = -1; idx <= k; idx++) {
      const next = new Map(income);
      next.set(scale, idx);
      yield* recIncome(si + 1, next);
    }
  };

  for (const bools of rec(0, new Map())) {
    for (const income of recIncome(0, new Map())) {
      yield { bools, income };
    }
  }
}

function evaluate(node: Criterion, state: State, abs: Abstraction): Tri {
  switch (node.kind) {
    case 'always':
      return 'T';
    case 'manualReview':
      return 'U';
    case 'incomeAtOrBelow': {
      const idx = state.income.get(node.scale)!;
      if (idx === -1) return 'U';
      const percents = abs.scalePercents.get(node.scale)!;
      const myPos = percents.indexOf(node.percent);
      // income meets thresholds [idx .. k-1]; it meets node.percent iff myPos >= idx
      return myPos >= idx ? 'T' : 'F';
    }
    case 'compare':
      return state.bools.get(comparisonKey(node)) ?? 'U';
    case 'set':
      return state.bools.get(comparisonKey(node)) ?? 'U';
    case 'not':
      if (node.of.kind === 'always') return 'F';
      return notTri(evaluate(node.of, state, abs));
    case 'allOf':
      return node.of.reduce<Tri>((acc, c) => andTri(acc, evaluate(c, state, abs)), 'T');
    case 'anyOf':
      return node.of.reduce<Tri>((acc, c) => orTri(acc, evaluate(c, state, abs)), 'F');
  }
}

function describeState(state: State, abs: Abstraction): string {
  const parts: string[] = [];
  for (const key of abs.boolKeys) {
    const v = state.bools.get(key)!;
    const shape = JSON.parse(key) as { fact?: string; op?: string; value?: unknown; values?: unknown };
    const name = shape.fact
      ? `${shape.fact} ${shape.op} ${JSON.stringify(shape.value ?? shape.values)}`
      : key;
    parts.push(`[${name}]=${v === 'T' ? 'yes' : v === 'F' ? 'no' : 'unknown'}`);
  }
  for (const [scale, percents] of abs.scalePercents) {
    const idx = state.income.get(scale)!;
    if (idx === -1) parts.push(`income vs ${scale}: unknown`);
    else if (idx === 0) parts.push(`income <= ${percents[0]}% ${scale}`);
    else if (idx === percents.length) parts.push(`income > ${percents[percents.length - 1]}% ${scale}`);
    else parts.push(`income in (${percents[idx - 1]}%, ${percents[idx]}%] ${scale}`);
  }
  return parts.join(', ') || '(no facts referenced)';
}

/**
 * Judge whether `candidate` means the same rule as `verified`, and if not,
 * whether the divergence is dangerous (candidate excludes someone verified
 * includes).
 */
export function criterionEquivalence(verified: Criterion, candidate: Criterion): EquivalenceResult {
  const nv = normalizeCriterion(verified);
  const nc = normalizeCriterion(candidate);

  if (comparisonKey(nv) === comparisonKey(nc)) {
    return {
      verdict: 'equivalent',
      method: 'canonical-form',
      detail: 'Both rules canonicalise to the same structure.',
      dangerousWitnesses: [],
      divergenceWitnesses: [],
    };
  }

  const abs = abstract2(nv, nc);
  if (abs.unmodellable) {
    return {
      verdict: 'undecided',
      method: 'canonical-form-only',
      detail: `Canonical forms differ and the model check cannot run: ${abs.unmodellable}. Scored as divergent, but a faithful re-encoding cannot be ruled out -- see docs/program-benchmark.md.`,
      dangerousWitnesses: [],
      divergenceWitnesses: [],
    };
  }

  const size = stateSpaceSize(abs);
  if (size > MAX_STATES) {
    return {
      verdict: 'undecided',
      method: 'canonical-form-only',
      detail: `Canonical forms differ and the model check state space (${size}) exceeds ${MAX_STATES}. Scored as divergent; equivalence not decided.`,
      dangerousWitnesses: [],
      divergenceWitnesses: [],
    };
  }

  const dangerous: DangerousWitness[] = [];
  const divergences: string[] = [];
  let agree = true;

  for (const state of enumerateStates(abs)) {
    const rv = evaluate(nv, state, abs);
    const rc = evaluate(nc, state, abs);
    if (rv === rc) continue;
    agree = false;
    if (divergences.length < MAX_WITNESSES) divergences.push(`${describeState(state, abs)} -> verified=${rv}, candidate=${rc}`);
    if ((rv === 'T' || rv === 'U') && rc === 'F' && dangerous.length < MAX_WITNESSES) {
      dangerous.push({
        profile: describeState(state, abs),
        verified: rv === 'T' ? 'eligible' : 'needs-review',
        candidate: 'ruled-out',
      });
    }
  }

  if (agree) {
    return {
      verdict: 'equivalent',
      method: 'model-check',
      detail: `Canonical forms differ, but the two rules agree on all ${size} truth assignments under three-valued logic.`,
      dangerousWitnesses: [],
      divergenceWitnesses: [],
    };
  }

  return {
    verdict: 'divergent',
    method: 'model-check',
    detail:
      dangerous.length > 0
        ? `The candidate rules out ${dangerous.length === MAX_WITNESSES ? MAX_WITNESSES + '+' : dangerous.length} applicant profile(s) the verified rule accepts or flags for review.`
        : 'The rules disagree, but only in the over-inclusive (not dangerous) direction.',
    dangerousWitnesses: dangerous,
    divergenceWitnesses: divergences,
  };
}
