import { test } from 'node:test';
import assert from 'node:assert/strict';

import { partitionPrograms, isVerified } from '../cases.ts';
import { program, c } from './fixtures.ts';

const verifiedConcrete = program({
  id: 'verified-concrete',
  eligibility: c.allOf(c.is('state', 'WI'), c.income('fpl', 200)),
  source: { url: 'https://example.gov/a', name: 'A', lastVerified: '2026-08-21' },
});

const unverifiedAbstains = program({
  id: 'unverified-abstains',
  eligibility: c.allOf(c.is('county', 'dane'), c.manualReview('not published')),
  source: { url: 'https://example.gov/b', name: 'B', lastVerified: null },
});

const unverifiedConcrete = program({
  id: 'unverified-concrete',
  eligibility: c.income('fpl', 80),
  source: { url: 'https://example.gov/c', name: 'C', lastVerified: null },
});

test('isVerified is driven by source.lastVerified', () => {
  assert.equal(isVerified(verifiedConcrete), true);
  assert.equal(isVerified(unverifiedAbstains), false);
});

test('verified records go in the scored set', () => {
  const p = partitionPrograms([verifiedConcrete, unverifiedAbstains, unverifiedConcrete]);
  assert.deepEqual(p.scored.map((x) => x.programId), ['verified-concrete']);
});

test('unverified-but-abstaining records are abstention-only, never in the scored denominator', () => {
  const p = partitionPrograms([verifiedConcrete, unverifiedAbstains, unverifiedConcrete]);
  assert.deepEqual(p.abstentionOnly.map((x) => x.programId), ['unverified-abstains']);
  assert.ok(!p.scored.some((x) => x.programId === 'unverified-abstains'));
});

test('unverified records with a concrete rule are excluded entirely', () => {
  const p = partitionPrograms([verifiedConcrete, unverifiedAbstains, unverifiedConcrete]);
  assert.deepEqual(p.excluded.map((x) => x.programId), ['unverified-concrete']);
});
