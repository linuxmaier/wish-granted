import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RESERVED_FACT_KEYS } from '../../../../src/domain/facts.ts';
import { detectVocabularyGap, isReservedFact, reservedFactLabels } from '../vocabulary.ts';

test('the reserved list is read from RESERVED_FACT_KEYS, not hardcoded', () => {
  const labelled = reservedFactLabels().map((f) => f.fact);
  assert.deepEqual([...labelled].sort(), [...RESERVED_FACT_KEYS].sort());
});

test('age is not reserved (#89) so it is never a vocabulary gap', () => {
  assert.equal(isReservedFact('age'), false);
  assert.deepEqual(detectVocabularyGap('gated by an age band (40 to 64)', 'ages 40 to 64'), []);
});

test('a disability-determination gate names hasDisability', () => {
  const gaps = detectVocabularyGap('the ceiling is gated on a disability determination', 'Be determined disabled by the Disability Determination Bureau.');
  assert.ok(gaps.some((g) => g.fact === 'hasDisability'));
});

test('a Medicare/asset gate with no reserved-fact phrase produces no gap', () => {
  assert.deepEqual(detectVocabularyGap('gated on being entitled to Medicare Part A and an asset test', ''), []);
});

test('an immigration-status gate names citizenshipStatus', () => {
  const gaps = detectVocabularyGap('multi-factor citizenship / alien status test with 40 qualifying quarters', '');
  assert.ok(gaps.some((g) => g.fact === 'citizenshipStatus'));
});
