import type { Program } from '../../../../src/domain/program.ts';
import type { Criterion } from '../../../../src/domain/criteria.ts';
import type { Extractor } from '../extractor.ts';
import type { CandidateRecord } from '../extractor.ts';

/**
 * Hand-written fixtures for the offline scoring tests. Deliberately NOT the real
 * PROGRAMS: the lib tests run under `node --test` with no resolve hook, so they
 * must not import `@/data/programs`. The real dataset is exercised separately by
 * `eval:program-extraction:self-test`.
 */

export function program(over: Partial<Program> & Pick<Program, 'id' | 'eligibility'>): Program {
  return {
    id: over.id,
    name: over.name ?? 'Test Program',
    administeredBy: over.administeredBy ?? 'Test Agency',
    jurisdiction: over.jurisdiction ?? 'state',
    provider: over.provider ?? 'government',
    categories: over.categories ?? ['food-basic-needs'],
    summary: over.summary ?? 'A test program that helps people with a thing they need.',
    benefit: over.benefit ?? 'A monthly benefit loaded onto a card.',
    eligibility: over.eligibility,
    howToApply: over.howToApply ?? { url: 'https://example.gov/apply', phone: '608-266-4675' },
    requiredDocuments: over.requiredDocuments,
    status: over.status ?? 'open',
    source: over.source ?? {
      url: 'https://example.gov/program',
      name: 'Example Agency -- Test Program',
      lastVerified: '2026-08-21',
    },
  };
}

/** A fixed-map extractor: returns the given candidate (or abstention) per id. */
export function fixtureExtractor(
  byId: Record<string, CandidateRecord | { abstained: true; reason: string }>,
): Extractor {
  return async (ctx) => {
    const hit = byId[ctx.programId];
    if (!hit) return { abstained: true, reason: `no fixture for ${ctx.programId}` };
    return hit;
  };
}

export const c = {
  is: (fact: string, value: string | number | boolean): Criterion => ({ kind: 'compare', fact: fact as never, op: 'eq', value }),
  isTrue: (fact: string): Criterion => ({ kind: 'compare', fact: fact as never, op: 'eq', value: true }),
  atMost: (fact: string, value: number): Criterion => ({ kind: 'compare', fact: fact as never, op: 'lte', value }),
  atLeast: (fact: string, value: number): Criterion => ({ kind: 'compare', fact: fact as never, op: 'gte', value }),
  oneOf: (fact: string, values: string[]): Criterion => ({ kind: 'set', fact: fact as never, op: 'in', values }),
  hasAnyOf: (fact: string, values: string[]): Criterion => ({ kind: 'set', fact: fact as never, op: 'includesAny', values }),
  income: (scale: 'fpl' | 'wi-smi' | 'dane-ami', percent: number): Criterion => ({ kind: 'incomeAtOrBelow', scale, percent }),
  allOf: (...of: Criterion[]): Criterion => ({ kind: 'allOf', of }),
  anyOf: (...of: Criterion[]): Criterion => ({ kind: 'anyOf', of }),
  not: (of: Criterion): Criterion => ({ kind: 'not', of }),
  manualReview: (note = 'a human must check this'): Criterion => ({ kind: 'manualReview', note }),
  always: (): Criterion => ({ kind: 'always' }),
};
