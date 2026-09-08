import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ScriptedModelClient } from '../../../agentic-extract/lib/scripted-model.ts';
import { MissingApiKeyError } from '../../../program-benchmark/lib/extractor.ts';
import { liveSourceClassifier, parseClassifyResponse } from '../classify-source.ts';

test('no key and no injected model -> MissingApiKeyError (SKIPPED, not fabricated)', async () => {
  await assert.rejects(() => liveSourceClassifier()({ sourceName: 's', sourceText: 't' }), MissingApiKeyError);
});

test('a scripted "states a rule" tool call is parsed with its numeric score', async () => {
  const model = new ScriptedModelClient([
    { toolCalls: [{ name: 'report_classification', input: { states_eligibility_rule: true, evidence_quote: 'income at or below 185% FPL', confidence_score: 85 } }] },
  ]);
  const res = await liveSourceClassifier({ model })({ sourceName: 's', sourceText: 't' });
  assert.equal(res.statesEligibilityRule, true);
  assert.equal(res.confidenceScore, 85);
  assert.match(res.evidenceQuote, /185% FPL/);
});

test('a malformed tool call is read as "states a rule, score 0" (the fail-safe direction)', () => {
  assert.deepEqual(parseClassifyResponse({}), { statesEligibilityRule: true, confidenceScore: 0, evidenceQuote: '' });
  assert.deepEqual(parseClassifyResponse({ states_eligibility_rule: 'maybe' }), { statesEligibilityRule: true, confidenceScore: 0, evidenceQuote: '' });
});

test('confidence score is clamped to 0..100', () => {
  assert.equal(parseClassifyResponse({ states_eligibility_rule: false, evidence_quote: 'x', confidence_score: 250 }).confidenceScore, 100);
  assert.equal(parseClassifyResponse({ states_eligibility_rule: false, evidence_quote: 'x', confidence_score: -5 }).confidenceScore, 0);
});

test('no tool call at all -> "states a rule, score 0"', async () => {
  const model = new ScriptedModelClient([{ text: 'I am not sure.' }]);
  const res = await liveSourceClassifier({ model })({ sourceName: 's', sourceText: 't' });
  assert.equal(res.statesEligibilityRule, true);
  assert.equal(res.confidenceScore, 0);
});
