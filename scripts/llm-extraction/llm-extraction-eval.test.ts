import { describe, expect, it } from 'vitest';
import { buildCriterionJsonSchema } from './criterion-schema';
import { gateCriterion } from './schema-gate';
import { describeEnumFacts, enumFacts } from './enum-vocab';
import {
  EVAL_CASES,
  casesInSplit,
  expectedAbstentionCount,
  EXPECTED_ABSTENTION_COUNT,
} from './eval-cases';
import { PROGRAMS } from '../../src/data/programs';
import { FACTS } from '../../src/domain/facts';
import { manualReview, oneOf, type Criterion } from '../../src/domain/criteria';

/**
 * Tests the LLM-extraction harness itself (schema, gate, enum vocab, eval-case
 * shape, the held-out split) -- NOT model behavior. A live run reports its
 * numbers into docs/eligibility-extraction.md Section 4; this file must never
 * be mistaken for one. See that doc for whether the current numbers are
 * live-measured or SKIPPED.
 *
 * What IS real and checked here: every eval case is grounded in real fetched
 * text, every hand-authored `targetCriterion` is itself schema-valid (ground
 * truth held to the bar it grades against), the gate agrees with
 * tests/data/vocabulary.test.ts on the full curated dataset (same gate, not a
 * look-alike), and the held-out split is a real partition weighted toward
 * Tier 3.
 *
 * Lives in scripts/llm-extraction/ (not tests/) so this directory can keep the
 * explicit ".ts" import specifiers run-eval.ts needs for direct `node`
 * execution -- see this directory's tsconfig.json. vitest picks it up via
 * vite.config.ts's include glob.
 */

interface LooseBranch {
  properties?: Record<string, { const?: string; enum?: string[] }>;
  additionalProperties?: unknown;
  anyOf?: LooseBranch[];
}

describe('Criterion JSON Schema (for the extraction tool-use call)', () => {
  it('builds a schema that enumerates the real fact vocabulary, not a stale copy', () => {
    const schema = buildCriterionJsonSchema();
    const criterionDef = schema.properties.criterion as unknown as { anyOf: LooseBranch[] };
    const compareBranch = criterionDef.anyOf.find((branch) => branch.properties?.kind?.const === 'compare');
    expect(compareBranch).toBeDefined();
    const factEnum = compareBranch!.properties!.fact!.enum!;
    expect(factEnum).toContain('annualHouseholdIncome');
    expect(factEnum).toContain('citizenshipStatus');
  });

  it('every node kind requires additionalProperties: false, so the model cannot smuggle extra fields', () => {
    const schema = buildCriterionJsonSchema();
    let nodesChecked = 0;
    const walk = (node: unknown): void => {
      if (typeof node !== 'object' || node === null) return;
      const obj = node as Record<string, unknown>;
      if (Array.isArray(obj.anyOf)) {
        for (const branch of obj.anyOf) {
          const props = (branch as { properties?: Record<string, unknown> }).properties;
          if (props && 'kind' in props) {
            expect((branch as { additionalProperties?: unknown }).additionalProperties).toBe(false);
            nodesChecked += 1;
          }
          walk(branch);
        }
      }
      for (const value of Object.values(obj)) walk(value);
    };
    walk(schema.properties.criterion as unknown);
    expect(nodesChecked).toBeGreaterThan(20);
  });
});

describe('enum-vocab (the Section 4.6 enum-slug fix)', () => {
  it('lists every enum / enumSet fact and every one of its declared options', () => {
    const text = describeEnumFacts();
    for (const fact of enumFacts()) {
      expect(text, `missing fact ${fact.key}`).toContain(fact.key);
      for (const option of fact.options) {
        expect(text, `${fact.key} missing option ${option}`).toContain(option);
      }
    }
  });

  it('covers currentBenefits, the fact the #23 gate failure was on', () => {
    const currentBenefits = enumFacts().find((f) => f.key === 'currentBenefits');
    expect(currentBenefits).toBeDefined();
    // The exact slugs the model emitted display names for in #23.
    expect(currentBenefits!.options).toContain('snap-foodshare');
    expect(currentBenefits!.options).toContain('housing-choice-voucher');
    const text = describeEnumFacts();
    expect(text).toContain('FoodShare (SNAP)'); // display label, so the model can map the source phrase
    expect(text).toContain('a Housing Choice Voucher');
  });

  it('does not drift from FACTS -- every listed option is a real declared option', () => {
    for (const fact of enumFacts()) {
      const declared = FACTS[fact.key].options ?? [];
      expect([...fact.options].sort()).toEqual([...declared].sort());
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

  it('rejects the exact #23 failure class: a set against currentBenefits using display names', () => {
    const bad: Criterion = { kind: 'set', fact: 'currentBenefits', op: 'includesAny', values: ['FoodShare', 'Section 8'] };
    const result = gateCriterion(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(' ')).toMatch(/FoodShare|Section 8/);
  });

  it('accepts a manualReview node, including nested inside allOf', () => {
    const result = gateCriterion(manualReview('subject to funding availability'));
    expect(result.ok).toBe(true);
  });

  it('rejects a compare/set over a RESERVED fact (PR #72: the [citizenshipStatus ...] / [employmentStatus ...] dangerous cases)', () => {
    // `age` used to be the headline example here; issue #88 made it an asked
    // fact, so a compare/set over it is now allowed (see the badgercare-plus
    // 0-64 bound). `citizenshipStatus` and `employmentStatus` stay reserved.
    const citizenshipRule = gateCriterion({
      kind: 'set',
      fact: 'citizenshipStatus',
      op: 'includesAny',
      values: ['us-citizen', 'qualified-immigrant'],
    });
    expect(citizenshipRule.ok).toBe(false);
    if (!citizenshipRule.ok) {
      expect(citizenshipRule.problems.join(' ')).toMatch(/citizenshipStatus.*reserved|reserved.*citizenshipStatus/i);
    }

    const employmentRule = gateCriterion({ kind: 'compare', fact: 'employmentStatus', op: 'eq', value: 'employed' });
    expect(employmentRule.ok).toBe(false);

    // An age band, by contrast, now passes the gate -- the same rule the
    // engine enforces on badgercare-plus.
    const ageRule = gateCriterion({ kind: 'set', fact: 'age', op: 'notIn', values: ['65-plus'] });
    expect(ageRule.ok).toBe(true);

    // A still-reserved condition is fine as prose inside a manualReview note.
    const routed = gateCriterion({
      kind: 'allOf',
      of: [oneOf('state', ['WI']), manualReview('SeniorCare requires U.S. citizen / qualifying immigrant status; not an asked fact.')],
    });
    expect(routed.ok).toBe(true);
  });
});

describe('LLM extraction eval set (docs/eligibility-extraction.md Section 4)', () => {
  it('is substantially larger than the original nine cases', () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(24);
  });

  it('grounds every case in a real citation, a fetch date, and a non-trivial excerpt', () => {
    for (const c of EVAL_CASES) {
      expect(c.citationUrl, c.id).toMatch(/^https?:\/\//);
      expect(c.excerpt.length, c.id).toBeGreaterThan(20);
      expect(c.fetchedOn, c.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(c.note.length, c.id).toBeGreaterThan(20);
    }
  });

  it('holds every hand-authored extraction target to the same schema gate a model output would face', () => {
    for (const c of EVAL_CASES.filter((c) => c.expected === 'extract')) {
      expect(c.targetCriterion, c.id).toBeDefined();
      const result = gateCriterion(c.targetCriterion!);
      expect(result.ok, `${c.id}: ${!result.ok ? result.problems.join('; ') : ''}`).toBe(true);
    }
  });

  it('has both splits, each non-trivial, with abstention as the majority class in each', () => {
    const tuning = casesInSplit('tuning');
    const heldout = casesInSplit('heldout');
    expect(tuning.length).toBeGreaterThanOrEqual(9);
    expect(heldout.length).toBeGreaterThanOrEqual(12);
    expect(expectedAbstentionCount('tuning')).toBeGreaterThanOrEqual(tuning.length / 2);
    expect(expectedAbstentionCount('heldout')).toBeGreaterThanOrEqual(heldout.length / 2);
    expect(tuning.length + heldout.length).toBe(EVAL_CASES.length);
  });

  it('weights the held-out split toward Tier 3 (the genuinely hard part)', () => {
    const heldout = casesInSplit('heldout');
    const tier3 = heldout.filter((c) => c.tier === 3).length;
    expect(tier3 / heldout.length).toBeGreaterThan(0.5);
  });

  it('keeps the nine original cases (and only those) in the tuning split, so the held-out set is untuned', () => {
    const originalIds = [
      'madcap-categorical',
      'madcap-ami',
      'lifeline-fpl',
      'wheap-smi',
      'snap-shelter-deduction',
      'snap-alien-status',
      'snap-abawd',
      'trc-funding-contingent',
      'trc-no-published-ami',
    ];
    for (const id of originalIds) {
      const c = EVAL_CASES.find((c) => c.id === id);
      expect(c, id).toBeDefined();
      expect(c!.split, id).toBe('tuning');
    }
  });

  it('demonstrates the enum-slug fix on held-out data: currentBenefits extract cases the prompt was not tuned against', () => {
    const heldoutEnumCases = casesInSplit('heldout').filter((c) => {
      const t = c.targetCriterion;
      return c.expected === 'extract' && t !== undefined && t.kind === 'set' && t.fact === 'currentBenefits';
    });
    expect(heldoutEnumCases.length).toBeGreaterThanOrEqual(2);
  });

  it('still includes the self-referential trap tied to the dane-eviction-prevention finding', () => {
    const trapCase = EVAL_CASES.find((c) => c.id === 'trc-no-published-ami');
    expect(trapCase).toBeDefined();
    expect(trapCase!.expected).toBe('abstain');
  });

  it('exports a back-compatible total abstention count', () => {
    expect(EXPECTED_ABSTENTION_COUNT).toBe(EVAL_CASES.filter((c) => c.expected === 'abstain').length);
  });
});
