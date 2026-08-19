import type { Answers, FactKey, FactValue } from '@/domain/facts';
import { FACTS } from '@/domain/facts';
import type { ComparisonOp, Criterion, SetOp } from '@/domain/criteria';
import { incomeLimit, SCALE_NAMES } from './thresholds';

/**
 * Three-valued evaluation of a criterion tree against partial answers.
 *
 * `unknown` is a first-class result, not an error: it means "nothing we know so
 * far settles this". That is what makes progressive matching possible -- a
 * program sits in "possibly eligible" precisely while some part of its rule is
 * still unknown and no part has failed.
 *
 * The combinators use Kleene logic:
 *   allOf -> fail if any child fails, else unknown if any is unknown, else pass
 *   anyOf -> pass if any child passes, else unknown if any is unknown, else fail
 *   not   -> swaps pass/fail, leaves unknown alone
 *
 * Note the asymmetry: `allOf` reports fail even while siblings are unknown,
 * because one disqualifying answer rules a program out no matter what else we
 * learn. `anyOf` reports pass the same way. This is what lets the app rule
 * programs in and out early instead of waiting for a complete interview.
 */

export type Verdict = 'pass' | 'fail' | 'unknown';

export interface Trace {
  readonly criterion: Criterion;
  readonly verdict: Verdict;
  /** Human-readable statement of what this node requires. */
  readonly description: string;
  /** Facts that, if known, could move this subtree off `unknown`. */
  readonly missingFacts: readonly FactKey[];
  readonly children?: readonly Trace[];
  /** Present for `manualReview` nodes: why a machine cannot decide this. */
  readonly note?: string;
}

// --- Value formatting -----------------------------------------------------

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function displayValue(fact: FactKey, value: unknown): string {
  const spec = FACTS[fact];
  if (typeof value === 'number') {
    return spec.format === 'currency' ? currency.format(value) : String(value);
  }
  if (typeof value === 'string') return spec.optionLabels?.[value] ?? value;
  return String(value);
}

function displayList(fact: FactKey, values: readonly string[]): string {
  const shown = values.map((v) => displayValue(fact, v));
  if (shown.length <= 1) return shown[0] ?? '';
  if (shown.length === 2) return `${shown[0]} or ${shown[1]}`;
  return `${shown.slice(0, -1).join(', ')}, or ${shown[shown.length - 1]}`;
}

const COMPARISON_PHRASE: Record<ComparisonOp, string> = {
  eq: 'is',
  neq: 'is not',
  lt: 'is under',
  lte: 'is at most',
  gt: 'is over',
  gte: 'is at least',
};

// --- Descriptions ---------------------------------------------------------

function describe(criterion: Criterion): string {
  if (criterion.label) return criterion.label;

  switch (criterion.kind) {
    case 'always':
      return 'no eligibility test';

    case 'manualReview':
      return criterion.note;

    case 'compare': {
      const spec = FACTS[criterion.fact];
      // Boolean facts carry sentence-shaped labels, so they read better on
      // their own than run through the comparison phrasing.
      if (spec.type === 'boolean' && criterion.op === 'eq') {
        return criterion.value === true ? spec.label : (spec.negated ?? `not ${spec.label}`);
      }
      const shown = displayValue(criterion.fact, criterion.value);
      return `${spec.label} ${COMPARISON_PHRASE[criterion.op]} ${shown}`;
    }

    case 'set': {
      const spec = FACTS[criterion.fact];
      const list = displayList(criterion.fact, criterion.values);
      switch (criterion.op) {
        case 'in':
          return `${spec.label} is ${list}`;
        case 'notIn':
          return `${spec.label} is not ${list}`;
        case 'includesAny':
          return `${spec.label} includes ${list}`;
        case 'includesAll':
          return `${spec.label} includes all of ${list}`;
        case 'excludes':
          return `${spec.label} does not include ${list}`;
      }
    }

    case 'incomeAtOrBelow': {
      const scale = SCALE_NAMES[criterion.scale];
      return `household income is at or below ${criterion.percent}% of ${scale}`;
    }

    case 'allOf':
      return 'all of the following';
    case 'anyOf':
      return 'any of the following';
    case 'not':
      return 'not the following';
  }
}

/**
 * Same as `describe`, but resolved against the answers so income rules can name
 * the actual dollar cutoff instead of a percentage. "at or below $40,690/year"
 * is far more useful than "at or below 130% of the federal poverty level", but
 * we can only produce it once household size is known.
 */
function describeResolved(criterion: Criterion, answers: Answers): string {
  if (criterion.kind === 'incomeAtOrBelow' && criterion.label === undefined) {
    const size = answers.householdSize;
    if (typeof size === 'number') {
      const limit = incomeLimit(criterion.scale, criterion.percent, size);
      const scale = SCALE_NAMES[criterion.scale];
      return (
        `household income is at or below ${currency.format(limit)} per year ` +
        `(${criterion.percent}% of ${scale} for a household of ${size})`
      );
    }
  }
  return describe(criterion);
}

// --- Leaf evaluation ------------------------------------------------------

function compareValues(op: ComparisonOp, actual: FactValue, expected: unknown): Verdict {
  if (op === 'eq') return actual === expected ? 'pass' : 'fail';
  if (op === 'neq') return actual !== expected ? 'pass' : 'fail';

  if (typeof actual !== 'number' || typeof expected !== 'number') {
    // An ordering comparison against a non-numeric answer is a data bug, not a
    // user situation. Treat it as unknown rather than silently ruling the
    // program out; tests/data/vocabulary.test.ts catches these at build time.
    return 'unknown';
  }

  switch (op) {
    case 'lt':
      return actual < expected ? 'pass' : 'fail';
    case 'lte':
      return actual <= expected ? 'pass' : 'fail';
    case 'gt':
      return actual > expected ? 'pass' : 'fail';
    case 'gte':
      return actual >= expected ? 'pass' : 'fail';
  }
}

function evaluateSet(op: SetOp, actual: FactValue, values: readonly string[]): Verdict {
  const has = (v: string) => (Array.isArray(actual) ? actual.includes(v) : actual === v);
  switch (op) {
    case 'in':
      return values.includes(String(actual)) ? 'pass' : 'fail';
    case 'notIn':
      return values.includes(String(actual)) ? 'fail' : 'pass';
    case 'includesAny':
      return values.some(has) ? 'pass' : 'fail';
    case 'includesAll':
      return values.every(has) ? 'pass' : 'fail';
    case 'excludes':
      return values.some(has) ? 'fail' : 'pass';
  }
}

// --- Combinators ----------------------------------------------------------

function combineAll(verdicts: readonly Verdict[]): Verdict {
  if (verdicts.includes('fail')) return 'fail';
  if (verdicts.includes('unknown')) return 'unknown';
  return 'pass';
}

function combineAny(verdicts: readonly Verdict[]): Verdict {
  if (verdicts.includes('pass')) return 'pass';
  if (verdicts.includes('unknown')) return 'unknown';
  return 'fail';
}

const NEGATE: Record<Verdict, Verdict> = { pass: 'fail', fail: 'pass', unknown: 'unknown' };

function dedupe(keys: readonly FactKey[]): FactKey[] {
  return [...new Set(keys)];
}

// --- Entry point ----------------------------------------------------------

export function evaluate(criterion: Criterion, answers: Answers): Trace {
  const description = describeResolved(criterion, answers);

  switch (criterion.kind) {
    case 'always':
      return { criterion, verdict: 'pass', description, missingFacts: [] };

    case 'manualReview':
      return {
        criterion,
        verdict: 'unknown',
        description,
        missingFacts: [],
        note: criterion.note,
      };

    case 'compare': {
      const actual = answers[criterion.fact];
      if (actual === undefined) {
        return { criterion, verdict: 'unknown', description, missingFacts: [criterion.fact] };
      }
      return {
        criterion,
        verdict: compareValues(criterion.op, actual, criterion.value),
        description,
        missingFacts: [],
      };
    }

    case 'set': {
      const actual = answers[criterion.fact];
      if (actual === undefined) {
        return { criterion, verdict: 'unknown', description, missingFacts: [criterion.fact] };
      }
      return {
        criterion,
        verdict: evaluateSet(criterion.op, actual, criterion.values),
        description,
        missingFacts: [],
      };
    }

    case 'incomeAtOrBelow': {
      const income = answers.annualHouseholdIncome;
      const size = answers.householdSize;
      const missing: FactKey[] = [];
      if (typeof income !== 'number') missing.push('annualHouseholdIncome');
      if (typeof size !== 'number') missing.push('householdSize');
      if (typeof income !== 'number' || typeof size !== 'number') {
        return { criterion, verdict: 'unknown', description, missingFacts: missing };
      }
      const limit = incomeLimit(criterion.scale, criterion.percent, size);
      return {
        criterion,
        verdict: income <= limit ? 'pass' : 'fail',
        description,
        missingFacts: [],
      };
    }

    case 'allOf':
    case 'anyOf': {
      const children = criterion.of.map((child) => evaluate(child, answers));
      const verdicts = children.map((c) => c.verdict);
      const verdict = criterion.kind === 'allOf' ? combineAll(verdicts) : combineAny(verdicts);
      return {
        criterion,
        verdict,
        description,
        // Once the verdict is settled nothing is "missing" any more: asking for
        // those facts could not change the outcome. This is what keeps the
        // next-question ranking in match.ts from chasing pointless questions.
        missingFacts: verdict === 'unknown' ? dedupe(children.flatMap((c) => c.missingFacts)) : [],
        children,
      };
    }

    case 'not': {
      const child = evaluate(criterion.of, answers);
      return {
        criterion,
        verdict: NEGATE[child.verdict],
        description,
        missingFacts: child.missingFacts,
        children: [child],
      };
    }
  }
}

/**
 * Flattens a trace down to the leaf nodes that actually decided the verdict, so
 * the UI can say "ruled out because you live outside Dane County" instead of
 * dumping the whole rule tree at someone.
 */
export function decidingReasons(trace: Trace): Trace[] {
  const children = trace.children;
  if (children === undefined || children.length === 0) return [trace];

  switch (trace.criterion.kind) {
    case 'allOf':
      // A failure is explained by the children that failed; a pass, by all of them.
      return trace.verdict === 'fail'
        ? children.filter((c) => c.verdict === 'fail').flatMap(decidingReasons)
        : children.flatMap(decidingReasons);

    case 'anyOf':
      // A pass is explained by whichever branch succeeded, not by all of them.
      return trace.verdict === 'pass'
        ? children.filter((c) => c.verdict === 'pass').flatMap(decidingReasons)
        : children.flatMap(decidingReasons);

    default:
      return children.flatMap(decidingReasons);
  }
}
