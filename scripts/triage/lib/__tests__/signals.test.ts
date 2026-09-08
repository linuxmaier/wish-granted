import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scanSignals, hasDecisiveNoRule } from '../signals.ts';

test('a quantified income limit is a rule-present signal', () => {
  const s = scanSignals('To be eligible, your household income must be at or below 200% of the federal poverty level.');
  assert.ok(s.rulePresent.length > 0);
  assert.equal(s.noRule.length, 0);
});

test('a categorical enrolment route is a rule-present signal', () => {
  const s = scanSignals('You may qualify if you already get SNAP, Medicaid, or SSI.');
  assert.ok(s.rulePresent.some((x) => x.tag === 'categorical-enrolment'));
});

test('"income limits are not published here" is NOT a rule-present signal', () => {
  const s = scanSignals('Income limits and funding availability change and are not published here in a way you can check.');
  assert.equal(s.rulePresent.length, 0, JSON.stringify(s.rulePresent));
  assert.ok(s.noRule.some((x) => x.tag === 'not-published'));
});

test('"you do not need to qualify for anything first" is NOT a rule-present signal', () => {
  const s = scanSignals('The service is free and voluntary. You do not need to qualify for anything first.');
  assert.equal(s.rulePresent.length, 0, JSON.stringify(s.rulePresent));
  assert.ok(s.noRule.some((x) => x.tag === 'no-eligibility-requirements'));
});

test('a food bank decline is all no-rule and decisive', () => {
  const s = scanSignals(
    'Pantries are open to anyone who needs food. No identification, proof of income, or documentation is required. There is no income test and no application.',
  );
  assert.equal(s.rulePresent.length, 0);
  assert.ok(s.noRule.length >= 2);
  assert.equal(hasDecisiveNoRule(s), true);
});

test('a page with both a no-rule phrase and a real rule is NOT a decisive decline', () => {
  const s = scanSignals(
    'No documentation is required. Groceries follow the state guideline: household income at or below 200% of the federal poverty level.',
  );
  assert.ok(s.noRule.length > 0);
  assert.ok(s.rulePresent.length > 0);
  assert.equal(hasDecisiveNoRule(s), false);
});

test('signals quote the matched span', () => {
  const s = scanSignals('This is a pre-screening questionnaire, not an application. It does not guarantee assistance.');
  assert.ok(s.noRule[0]!.quote.length > 0);
  assert.match(s.noRule.map((x) => x.quote).join(' '), /not an application/i);
});

test('each pattern tag fires at most once', () => {
  const s = scanSignals('open to anyone who needs food. open to anyone who needs help. open to everyone regardless.');
  const tags = s.noRule.map((x) => x.tag);
  assert.equal(new Set(tags).size, tags.length);
});
