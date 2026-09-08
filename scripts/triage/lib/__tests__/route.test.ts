import { test } from 'node:test';
import assert from 'node:assert/strict';

import { triage, type ParserOutcome } from '../route.ts';

const abstain = (code: string, reason = 'x'): ParserOutcome => ({ decision: 'abstain', code, reason });
const extract = (): ParserOutcome => ({ decision: 'extract', code: 'EXTRACT', reason: 'clean ceiling, scope intact' });

test('parser extracted -> deterministic', () => {
  const d = triage({ parser: extract(), sourceText: 'income at or below 200% of the federal poverty level' });
  assert.equal(d.route, 'deterministic');
  assert.equal(d.uncertain, false);
});

test('parser found an unscopeable figure -> agentic, not uncertain', () => {
  const d = triage({ parser: abstain('COST_SHARING_TIER', 'the figure is a cost-sharing tier boundary'), sourceText: 'prescription cost-sharing levels' });
  assert.equal(d.route, 'agentic');
  assert.equal(d.uncertain, false);
  assert.ok(d.evidence.length > 0);
});

test('parser found nothing + decisive no-rule signal -> no-rule-published', () => {
  const d = triage({
    parser: abstain('NO_RULE_STATED', 'no income figure appears anywhere'),
    sourceText: 'A referral helpline that connects you to local assistance. There are no eligibility requirements to call 211.',
  });
  assert.equal(d.route, 'no-rule-published');
  assert.ok(d.evidence.every((e) => e.kind === 'no-rule'));
});

test('parser found nothing + a rule-present signal -> agentic, uncertain (the #68 asymmetry)', () => {
  const d = triage({
    parser: abstain('NO_RULE_STATED', 'no income figure'),
    sourceText: 'BadgerCare Plus helps Wisconsinites who have low income. The only way to know if you can enroll is to apply.',
  });
  assert.equal(d.route, 'agentic');
  assert.equal(d.uncertain, true);
});

test('a live classifier can rescue a no-rule-published decision to agentic', () => {
  const d = triage({
    parser: abstain('NO_RULE_STATED', 'no income figure'),
    sourceText: 'A referral helpline. There are no eligibility requirements to call 211.',
    classification: { statesEligibilityRule: true, confidenceScore: 40, evidenceQuote: 'must be a Wisconsin resident' },
  });
  assert.equal(d.route, 'agentic');
  assert.equal(d.uncertain, true);
  assert.ok(d.classifierNote);
});

test('a live classifier CANNOT push a rule-present source to no-rule-published', () => {
  const d = triage({
    parser: abstain('NO_RULE_STATED', 'no income figure'),
    sourceText: 'To be eligible you must have income at or below 185% of the federal poverty level.',
    classification: { statesEligibilityRule: false, confidenceScore: 99, evidenceQuote: 'whatever' },
  });
  assert.equal(d.route, 'agentic');
});

test('a reserved-fact gate is flagged as a vocabulary gap; age is not', () => {
  const withDisability = triage({
    parser: abstain('UNDECIDABLE_COCONDITION', '250% of fpl is gated by a disability determination'),
    sourceText: 'Be determined disabled by the Disability Determination Bureau.',
  });
  assert.ok(withDisability.vocabularyGap.some((g) => g.fact === 'hasDisability'));

  const withAge = triage({
    parser: abstain('UNDECIDABLE_COCONDITION', '250% of fpl is gated by an age band (40 to 64)'),
    sourceText: 'Must be ages 40 to 64.',
  });
  assert.equal(withAge.vocabularyGap.length, 0);
});

test('parser not run + no signals -> agentic, uncertain (never dropped silently)', () => {
  const d = triage({ parser: { decision: 'not-run', code: null, reason: 'no fixture' }, sourceText: 'Some page with no clear eligibility language at all.' });
  assert.equal(d.route, 'agentic');
  assert.equal(d.uncertain, true);
});
