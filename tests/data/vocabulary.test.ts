import { describe, expect, it } from 'vitest';
import { FACTS, FACT_KEYS, RESERVED_FACT_KEYS } from '@/domain/facts';
import type { FactKey } from '@/domain/facts';
import { factsReferenced, walk } from '@/domain/criteria';
import { CATEGORIES } from '@/domain/program';
import { PROGRAMS, unverifiedPrograms } from '@/data/programs';
import { ALL_QUESTIONS, ASKED_FACTS } from '@/interview/screens';
import { ALL_INCOME_TABLES } from '@/data/reference/income-tables';

/**
 * Consistency checks over the curated data.
 *
 * The dataset and the interview are authored separately and have to stay in
 * agreement: a rule referencing a fact nothing asks about would leave a program
 * permanently in "might qualify", and a question supplying a fact no rule uses
 * is friction with no payoff. Neither failure is visible by reading either file
 * alone, so it is checked here.
 */

const referencedByPrograms = new Set<FactKey>(
  PROGRAMS.flatMap((p) => [...factsReferenced(p.eligibility)]),
);

describe('the interview and the rules agree', () => {
  it('asks about every fact the rules depend on', () => {
    const askable = new Set(ASKED_FACTS);
    const unanswerable = [...referencedByPrograms].filter((f) => !askable.has(f));
    expect(unanswerable).toEqual([]);
  });

  it('asks nothing the rules never consult', () => {
    const pointless = ASKED_FACTS.filter((f) => !referencedByPrograms.has(f));
    expect(pointless).toEqual([]);
  });

  it('leaves only the documented reserved facts unused', () => {
    const unused = FACT_KEYS.filter(
      (f) => !referencedByPrograms.has(f) && !ASKED_FACTS.includes(f),
    );
    expect(unused.sort()).toEqual([...RESERVED_FACT_KEYS].sort());
  });

  it('never asks the same fact from two different questions', () => {
    // Two controls writing one fact would let them disagree, and would make
    // "already answered" ambiguous.
    const seen = new Map<FactKey, string>();
    for (const question of ALL_QUESTIONS) {
      for (const fact of factsSupplied(question)) {
        expect(seen.has(fact), `${fact} is supplied by both ${seen.get(fact)} and ${question.id}`).toBe(false);
        seen.set(fact, question.id);
      }
    }
  });
});

function factsSupplied(question: (typeof ALL_QUESTIONS)[number]): FactKey[] {
  const { input } = question;
  switch (input.type) {
    case 'number':
    case 'multi':
      return [input.fact];
    case 'flags':
      return input.flags.map((f) => f.fact);
    case 'choice':
      return [...new Set(input.choices.flatMap((c) => Object.keys(c.implies) as FactKey[]))];
  }
}

describe('criteria are well formed', () => {
  it('only compares enum facts to values they can actually take', () => {
    for (const program of PROGRAMS) {
      for (const node of walk(program.eligibility)) {
        if (node.kind === 'compare' && typeof node.value === 'string') {
          const spec = FACTS[node.fact];
          if (spec.options) {
            expect(spec.options, `${program.id} compares ${node.fact}`).toContain(node.value);
          }
        }
        if (node.kind === 'set') {
          const spec = FACTS[node.fact];
          if (spec.options) {
            for (const value of node.values) {
              expect(spec.options, `${program.id} tests ${node.fact}`).toContain(value);
            }
          }
        }
      }
    }
  });

  it('only orders numeric facts', () => {
    for (const program of PROGRAMS) {
      for (const node of walk(program.eligibility)) {
        if (node.kind === 'compare' && node.op !== 'eq' && node.op !== 'neq') {
          expect(FACTS[node.fact].type, `${program.id} orders ${node.fact}`).toBe('number');
        }
      }
    }
  });

  it('gives every program a decidable rule', () => {
    for (const program of PROGRAMS) {
      const nodes = [...walk(program.eligibility)];
      expect(nodes.length, `${program.id} has an empty rule`).toBeGreaterThan(0);
    }
  });
});

describe('program records are complete', () => {
  it('has unique ids', () => {
    const ids = PROGRAMS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('cites a source and an application route for every program', () => {
    for (const program of PROGRAMS) {
      expect(program.source.url, program.id).toMatch(/^https?:\/\//);
      expect(program.source.name, program.id).toBeTruthy();
      expect(program.howToApply.url, program.id).toMatch(/^https?:\/\//);
      expect(program.summary.length, program.id).toBeGreaterThan(20);
      expect(program.benefit.length, program.id).toBeGreaterThan(10);
    }
  });

  it('uses only declared categories, and at least one', () => {
    for (const program of PROGRAMS) {
      expect(program.categories.length, program.id).toBeGreaterThan(0);
      for (const category of program.categories) {
        expect(CATEGORIES).toContain(category);
      }
    }
  });

  it('explains any seasonal restriction it claims', () => {
    for (const program of PROGRAMS.filter((p) => p.status === 'seasonal')) {
      expect(program.seasonalNote, program.id).toBeTruthy();
    }
  });

  it('covers both v1 categories and every jurisdiction level', () => {
    const categories = new Set(PROGRAMS.flatMap((p) => p.categories));
    expect(categories).toContain('housing-utilities');
    expect(categories).toContain('food-basic-needs');

    const levels = new Set(PROGRAMS.map((p) => p.jurisdiction));
    expect([...levels].sort()).toEqual(['city', 'county', 'federal', 'state']);
  });

  it('includes non-government providers, not only government ones', () => {
    expect(PROGRAMS.some((p) => p.provider === 'nonprofit')).toBe(true);
    expect(PROGRAMS.some((p) => p.provider === 'government')).toBe(true);
  });
});

/**
 * Not a pass/fail gate -- it reports rather than blocks, because the seed data
 * ships deliberately unverified and a red build would just get ignored. The app
 * shows a banner for the same reason: the debt should be visible, not silent.
 */
describe('curation status', () => {
  it('reports how much of the dataset still needs verifying', () => {
    const pending = unverifiedPrograms();
    if (pending.length > 0) {
      console.warn(
        `\n  ${pending.length} of ${PROGRAMS.length} programs are unverified:\n` +
          pending.map((p) => `    - ${p.id}`).join('\n') +
          '\n  See docs/data-authoring.md before launching.\n',
      );
    }
    expect(pending.length).toBeLessThanOrEqual(PROGRAMS.length);
  });

  it('reports unverified income tables', () => {
    const pending = ALL_INCOME_TABLES.filter((t) => !t.verified);
    if (pending.length > 0) {
      console.warn(`\n  Unverified income tables: ${pending.map((t) => t.id).join(', ')}\n`);
    }
    expect(ALL_INCOME_TABLES.length).toBeGreaterThan(0);
  });
});
