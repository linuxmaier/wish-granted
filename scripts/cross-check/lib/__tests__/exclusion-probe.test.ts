import { test } from 'node:test';
import assert from 'node:assert/strict';

import { incomeAtOrBelow, allOf, anyOf, isTrue, hasAnyOf } from '../../../../src/domain/criteria.ts';
import {
  spanIsInSource,
  describeCriterion,
  runExclusionProbe,
  buildProbeUserMessage,
  type ProbeAnswer,
} from '../exclusion-probe.ts';
import { parseProbeResponse } from '../live-probe.ts';

const SOURCE =
  'We help people of all ages who: Have low-income jobs. Live on a small or fixed income. Are retired. ' +
  'Foster parents and relatives may also apply on behalf of an infant or child in their care.';

test('spanIsInSource: exact sentence matches', () => {
  assert.equal(spanIsInSource('Live on a small or fixed income.', SOURCE), true);
});

test('spanIsInSource: whitespace and case are normalised', () => {
  assert.equal(spanIsInSource('  live on a SMALL   or fixed income.  ', SOURCE), true);
});

test('spanIsInSource: dash and curly-quote variants are folded', () => {
  assert.equal(spanIsInSource('have low‑income jobs', 'text with have low-income jobs in it'), true);
});

test('spanIsInSource: a fabricated span does not match', () => {
  assert.equal(spanIsInSource('anyone under 400% of the poverty level qualifies', SOURCE), false);
});

test('spanIsInSource: too-short spans are rejected (accidental match guard)', () => {
  assert.equal(spanIsInSource('retired', SOURCE), false);
  assert.equal(spanIsInSource(null, SOURCE), false);
  assert.equal(spanIsInSource(undefined, SOURCE), false);
});

test('describeCriterion renders a nested tree as indented text', () => {
  const text = describeCriterion(
    anyOf(incomeAtOrBelow('fpl', 135), hasAnyOf('currentBenefits', ['snap-foodshare', 'ssi'])),
  );
  assert.match(text, /ANY of/);
  assert.match(text, /income at or below 135% of fpl/);
  assert.match(text, /currentBenefits includesAny \[snap-foodshare, ssi\]/);
});

test('buildProbeUserMessage embeds the source text and the rule, and asks the narrow question', () => {
  const msg = buildProbeUserMessage({
    sourceName: 'Test source',
    sourceText: SOURCE,
    rule: allOf(isTrue('isPregnantOrPostpartum')),
  });
  assert.match(msg, /SOURCE TEXT/);
  assert.match(msg, /EXTRACTED RULE/);
  assert.match(msg, /Name someone the source says is eligible whom this rule would exclude/);
});

test('runExclusionProbe: a named person with a verified span is the routable signal', async () => {
  const answer: ProbeAnswer = {
    excludedPerson: 'a retired person on a fixed income above the ceiling',
    quotedSpan: 'Live on a small or fixed income.',
  };
  const r = await runExclusionProbe(async () => answer, {
    sourceName: 's',
    sourceText: SOURCE,
    rule: incomeAtOrBelow('fpl', 200),
  });
  assert.equal(r.namedSomeone, true);
  assert.equal(r.spanVerified, true);
});

test('runExclusionProbe: a named person with an unverifiable span is discarded', async () => {
  const r = await runExclusionProbe(
    async () => ({ excludedPerson: 'someone', quotedSpan: 'not in the source at all, invented' }),
    { sourceName: 's', sourceText: SOURCE, rule: incomeAtOrBelow('fpl', 200) },
  );
  assert.equal(r.namedSomeone, true);
  assert.equal(r.spanVerified, false);
});

test('runExclusionProbe: no one named -> nothing to route on', async () => {
  const r = await runExclusionProbe(async () => ({ excludedPerson: null, quotedSpan: null }), {
    sourceName: 's',
    sourceText: SOURCE,
    rule: incomeAtOrBelow('fpl', 200),
  });
  assert.equal(r.namedSomeone, false);
  assert.equal(r.spanVerified, false);
});

test('parseProbeResponse: found=false yields a clean "nobody" answer', () => {
  assert.deepEqual(parseProbeResponse({ found: false, rationale: 'the rule matches the source' }), {
    excludedPerson: null,
    quotedSpan: null,
    rationale: 'the rule matches the source',
  });
});

test('parseProbeResponse: found=true with fields', () => {
  const a = parseProbeResponse({
    found: true,
    excluded_person: 'an SSI recipient over 200% FPL',
    quoted_span: 'SSI recipients qualify regardless of income',
  });
  assert.equal(a.excludedPerson, 'an SSI recipient over 200% FPL');
  assert.equal(a.quotedSpan, 'SSI recipients qualify regardless of income');
});

test('parseProbeResponse: malformed input is read as "nobody", never throws', () => {
  assert.deepEqual(parseProbeResponse(undefined), { excludedPerson: null, quotedSpan: null, rationale: undefined });
  assert.deepEqual(parseProbeResponse({ found: 'yes' }), { excludedPerson: null, quotedSpan: null, rationale: undefined });
});
