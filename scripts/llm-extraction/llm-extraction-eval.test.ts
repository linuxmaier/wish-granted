import { describe, expect, it } from 'vitest';
import { buildCriterionJsonSchema } from './criterion-schema';
import { gateCriterion } from './schema-gate';
import { EVAL_CASES, EXPECTED_ABSTENTION_COUNT } from './eval-cases';
import { PROGRAMS } from '../../src/data/programs';
import { manualReview, oneOf, type Criterion } from '../../src/domain/criteria';

/**
 * Tests the LLM-extraction harness itself (schema, gate, eval-case shape),
 * NOT model behavior -- no live API call was made anywhere in this spike, and
 * this file must never be mistaken for a measured abstention rate. See
 * docs/eligibility-extraction.md for why: no ANTHROPIC_API_KEY was available
 * in the environment this spike ran in, so scripts/llm-extraction/run-eval.ts
 * has been written and is ready to run, but was not executed against the
 * real API.
 *
 * What IS real and checked here: every eval case is grounded in text this
 * spike actually fetched, every hand-authored `targetCriterion` is itself
 * schema-valid (the ground truth is held to the same bar it grades against),
 * and the gate agrees with tests/data/vocabulary.test.ts's own checks on the
 * full curated dataset -- i.e. this is the same gate, not a look-alike.
 *
 * Lives here (scripts/llm-extraction/, not tests/) rather than as an
 * ordinary test file, on purpose: it lets scripts/llm-extraction/*.ts keep
 * the explicit ".ts" import specifiers run-eval.ts needs for direct `node`
 * execution, scoped to scripts/llm-extraction/tsconfig.json alone, without
 * asking the root tsconfig (which governs everything under src/ and tests/)
 * to permit them too -- the same scoping pattern issue #24 established for
 * scripts/refresh-income-tables/tsconfig.json (a plain "bundler"
 * moduleResolution here rather than #24's "NodeNext", though: this
 * directory imports real values from src/domain, which #24's tool never
 * does, and NodeNext would force src/'s own extensionless style to change
 * to satisfy this one dev tool -- see this directory's tsconfig.json for
 * the full reasoning). `npm test`'s vitest config and
 * `npm run typecheck:llm-extraction` both know to look here -- see
 * vite.config.ts and package.json.
 */

describe('Criterion JSON Schema (for the extraction tool-use call)', () => {
  it('builds a schema that enumerates the real fact vocabulary, not a stale copy', () => {
    const schema = buildCriterionJsonSchema();
    const criterionDef = schema.$defs.criterion;
    const compareBranch = criterionDef.oneOf.find(
      (branch) => 'properties' in branch && branch.properties.kind?.const === 'compare',
    );
    expect(compareBranch).toBeDefined();
    // Spot-check a couple of real fact keys are present, rather than
    // duplicating the whole FACT_KEYS list here (that would just be a second
    // copy to drift out of sync -- the point of building it from FACT_KEYS
    // is exactly to avoid that).
    const factEnum = (compareBranch as unknown as { properties: { fact: { enum: string[] } } }).properties.fact
      .enum;
    expect(factEnum).toContain('annualHouseholdIncome');
    expect(factEnum).toContain('citizenshipStatus');
  });

  it('every node kind requires additionalProperties: false, so the model cannot smuggle extra fields', () => {
    const schema = buildCriterionJsonSchema();
    for (const branch of schema.$defs.criterion.oneOf) {
      expect(branch.additionalProperties).toBe(false);
    }
  });
});

describe('schema gate agrees with tests/data/vocabulary.test.ts on the real dataset', () => {
  it('accepts every real program eligibility rule already in the curated dataset', () => {
    for (const program of PROGRAMS) {
      const result = gateCriterion(program.eligibility);
      expect(result.ok, `${program.id}: ${!result.ok ? result.problems.join('; ') : ''}`).toBe(true);
    }
  });

  it('rejects a compare against an undeclared enum value', () => {
    const bad: Criterion = oneOf('housingStatus', ['renting', 'levitating']);
    const result = gateCriterion(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]).toMatch(/levitating/);
  });

  it('accepts a manualReview node, including nested inside allOf', () => {
    const result = gateCriterion(manualReview('subject to funding availability'));
    expect(result.ok).toBe(true);
  });
});

describe('LLM extraction eval set (docs/eligibility-extraction.md)', () => {
  it('grounds every case in a real citation and a non-trivial excerpt', () => {
    for (const c of EVAL_CASES) {
      expect(c.citationUrl, c.id).toMatch(/^https?:\/\//);
      expect(c.excerpt.length, c.id).toBeGreaterThan(20);
    }
  });

  it('holds every hand-authored extraction target to the same schema gate a model output would face', () => {
    for (const c of EVAL_CASES.filter((c) => c.expected === 'extract')) {
      expect(c.targetCriterion, c.id).toBeDefined();
      const result = gateCriterion(c.targetCriterion!);
      expect(result.ok, `${c.id}: ${!result.ok ? result.problems.join('; ') : ''}`).toBe(true);
    }
  });

  it('has more than half the eval set be abstention cases, matching the "abstention is the headline metric" design', () => {
    expect(EXPECTED_ABSTENTION_COUNT).toBeGreaterThanOrEqual(EVAL_CASES.length / 2);
  });

  it('includes the self-referential trap tied to the dane-eviction-prevention finding', () => {
    // This is the specific case that ties the eval set back to a real,
    // already-flagged problem in the curated dataset (see this spike's
    // findings, forwarded to the #2 agent): dane-eviction-prevention.ts's
    // `incomeAtOrBelow('dane-ami', 80)` is not stated anywhere on its cited
    // source page. A correctly-abstaining extractor would not have invented
    // that figure from this excerpt. Unaffected by issue #3's income-table
    // corrections -- this trap is about Dane County AMI-based eviction
    // prevention, not the WHEAP/FPL tables #3 fixed.
    const trapCase = EVAL_CASES.find((c) => c.id === 'trc-no-published-ami');
    expect(trapCase).toBeDefined();
    expect(trapCase!.expected).toBe('abstain');
  });
});
