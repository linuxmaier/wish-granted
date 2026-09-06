import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { gateCriterion } from '../schema-gate';
import { renderProse, renderStructured, decodeEntities } from './structure-excerpt';
import {
  buildClassifierToolSchema,
  decideAutonomy,
  type Classification,
} from './classify-role';
import { buildVerifierToolSchema, verdictRejects, type Counterexample } from './verify-counterexample';
import { FRAMING_EVAL_CASES, framingAbstainCount } from './framing-eval-cases';

/**
 * Tests the #62 framing harness -- the excerpt renderer, the classify->route
 * rule, the verifier verdict, and the shape of the supplementary eval set. NOT
 * model behaviour: a live run reports its numbers into
 * docs/eligibility-extraction-framing.md, and this file must never be mistaken
 * for one.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

describe('structure-excerpt (hypothesis 3)', () => {
  const html = readFileSync(join(HERE, 'fixtures', 'wi-medicaid-fpl-chart.html'), 'utf8');

  it('decodes the minimal entity set', () => {
    expect(decodeEntities('a&nbsp;b')).toBe('a b');
    expect(decodeEntities('AT&amp;T &#39;96')).toBe("AT&T '96");
  });

  it('structured rendering keeps MAPP in the same column as the 250% FPL header', () => {
    const md = renderStructured(html);
    const lines = md.split('\n');
    const header = lines.find((l) => l.includes('250% FPL'));
    const programLimits = lines.find((l) => l.startsWith('| Program limits'));
    expect(header, 'header row').toBeDefined();
    expect(programLimits, 'program-limits row').toBeDefined();

    const cols = (l: string) => l.split('|').map((c) => c.trim());
    const headerCols = cols(header!);
    const limitCols = cols(programLimits!);
    const mappColIndex = headerCols.indexOf('250% FPL');
    expect(mappColIndex).toBeGreaterThan(0);
    // MAPP (not "MAPP Premium Threshold") sits under 250% FPL.
    expect(limitCols[mappColIndex]).toBe('MAPP');
    // and the premium threshold sits under 100% FPL, not 250%.
    expect(limitCols[headerCols.indexOf('100% FPL')]).toContain('MAPP Premium Threshold');
  });

  it('prose flattening destroys that alignment (the failure the hypothesis targets)', () => {
    const prose = renderProse(html);
    expect(prose).toContain('MAPP');
    expect(prose).toContain('250% FPL');
    // "MAPP" and "250% FPL" end up far apart with unrelated tokens between them:
    // there is no way to recover that MAPP's limit is the 250% column.
    const between = prose.slice(prose.indexOf('250% FPL'), prose.lastIndexOf('MAPP'));
    expect(between.length).toBeGreaterThan(200);
    expect(between).toContain('QDWI');
  });

  it('falls back to prose for a fragment with no recognised structure', () => {
    expect(renderStructured('just some <b>bold</b> text')).toBe('just some bold text');
  });
});

describe('classify-role: decideAutonomy routing (hypothesis 1 / 5)', () => {
  const base: Classification = {
    numericFigures: [{ quote: 'at or below 250% of the federal poverty level', governs: 'eligibility-income-ceiling' }],
    ruleShape: 'single-unconditional-threshold',
    scopeSignals: [],
    confidence: 'high',
  };

  it('routes a confident single unconditional ceiling to the extractor', () => {
    expect(decideAutonomy(base).autonomous).toBe(true);
  });

  it('routes a categorical-enrollment list with no figures to the extractor', () => {
    expect(decideAutonomy({ ...base, ruleShape: 'categorical-enrollment-list', numericFigures: [] }).autonomous).toBe(true);
  });

  it('auto-routes to manualReview when a figure is a cost-sharing tier (the SeniorCare / MAPP-premium class)', () => {
    const d = decideAutonomy({
      ...base,
      numericFigures: [{ quote: 'above 100% federal poverty level ... pay a monthly premium', governs: 'cost-sharing-premium-copay-or-tier' }],
    });
    expect(d.autonomous).toBe(false);
    expect(d.reason).toContain('cost-sharing');
  });

  it('auto-routes to manualReview on any scope signal (the column-header / negation class)', () => {
    expect(decideAutonomy({ ...base, scopeSignals: ['column header: "Pregnant people and children (306% FPL)"'] }).autonomous).toBe(false);
    expect(decideAutonomy({ ...base, ruleShape: 'scope-set-by-table-structure' }).autonomous).toBe(false);
    expect(decideAutonomy({ ...base, ruleShape: 'negation-or-no-rule-stated' }).autonomous).toBe(false);
  });

  it('auto-routes to manualReview on a conditional / extended branch (the Lifeline-survivor class)', () => {
    expect(decideAutonomy({ ...base, ruleShape: 'conditional-or-extended-eligibility-branch' }).autonomous).toBe(false);
  });

  it('auto-routes to manualReview whenever classifier confidence is low', () => {
    expect(decideAutonomy({ ...base, confidence: 'low' }).autonomous).toBe(false);
  });

  it('builds a tool schema with the documented enums and no additional properties', () => {
    const schema = buildClassifierToolSchema() as {
      properties: Record<string, { items?: { properties?: Record<string, { enum?: string[] }> }; enum?: string[] }>;
      additionalProperties: boolean;
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.ruleShape!.enum).toContain('scope-set-by-table-structure');
    expect(schema.properties.numericFigures!.items!.properties!.governs!.enum).toContain('cost-sharing-premium-copay-or-tier');
  });
});

describe('verify-counterexample: verdict (hypothesis 2)', () => {
  const faithful: Counterexample = {
    attempt: 'a 50-year-old, household of 1, income at 240% FPL',
    satisfiesEmittedRule: true,
    actuallyEligible: 'yes',
    scopeThatWasDropped: '',
    confidence: 'high',
  };

  it('rejects only when a confident counterexample satisfies the rule but is ineligible', () => {
    expect(verdictRejects(faithful)).toBe(false);
    expect(
      verdictRejects({ ...faithful, actuallyEligible: 'no', scopeThatWasDropped: 'survivor-only branch', confidence: 'high' }),
    ).toBe(true);
    // low confidence does not reject
    expect(verdictRejects({ ...faithful, actuallyEligible: 'no', confidence: 'low' })).toBe(false);
    // "cannot tell" does not reject
    expect(verdictRejects({ ...faithful, actuallyEligible: 'cannot-tell-from-excerpt' })).toBe(false);
  });

  it('builds a tool schema with the documented shape', () => {
    const schema = buildVerifierToolSchema() as { required: string[]; additionalProperties: boolean };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(
      expect.arrayContaining(['attempt', 'satisfiesEmittedRule', 'actuallyEligible', 'scopeThatWasDropped', 'confidence']),
    );
  });
});

describe('framing eval set (issue #62 supplementary probe)', () => {
  it('is small, real, and frozen with a fetch date and a substantive note per case', () => {
    expect(FRAMING_EVAL_CASES.length).toBeGreaterThanOrEqual(6);
    for (const c of FRAMING_EVAL_CASES) {
      expect(c.citationUrl, c.id).toMatch(/^https:\/\/www\.dhs\.wisconsin\.gov\//);
      expect(c.fetchedOn, c.id).toBe('2026-09-06');
      expect(c.excerpt.length, c.id).toBeGreaterThan(80);
      expect(c.note.length, c.id).toBeGreaterThan(80);
    }
  });

  it('pairs trap classes with clean-ceiling controls', () => {
    const probes = new Set(FRAMING_EVAL_CASES.map((c) => c.probes));
    expect(probes.has('cost-sharing-tier')).toBe(true);
    expect(probes.has('column-header-scope')).toBe(true);
    expect(probes.has('negation-and-composition')).toBe(true);
    expect(probes.has('clean-ceiling-control')).toBe(true);
    expect(framingAbstainCount()).toBeGreaterThanOrEqual(3);
  });

  it('holds every extract target to the same schema gate a model output would face', () => {
    for (const c of FRAMING_EVAL_CASES.filter((c) => c.expected === 'extract')) {
      expect(c.targetCriterion, c.id).toBeDefined();
      const gate = gateCriterion(c.targetCriterion!);
      expect(gate.ok, `${c.id}: ${!gate.ok ? gate.problems.join('; ') : ''}`).toBe(true);
    }
    for (const c of FRAMING_EVAL_CASES.filter((c) => c.expected === 'abstain')) {
      expect(c.targetCriterion, c.id).toBeUndefined();
    }
  });

  it('every htmlFixture referenced by a case exists and renders both ways', () => {
    for (const c of FRAMING_EVAL_CASES) {
      if (!c.htmlFixture) continue;
      const html = readFileSync(join(HERE, 'fixtures', c.htmlFixture), 'utf8');
      expect(renderProse(html).length).toBeGreaterThan(50);
      expect(renderStructured(html)).toContain('|');
    }
  });
});
