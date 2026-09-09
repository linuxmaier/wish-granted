import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CostMeter, sumCost, PRICE } from '../cost.ts';

test('CostMeter accumulates calls, tokens and cache hits per source', () => {
  const m = new CostMeter();
  m.record({ input_tokens: 500, output_tokens: 100, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 });
  m.record({ input_tokens: 300, output_tokens: 80, cache_read_input_tokens: 4000 });
  m.record({ input_tokens: 200, output_tokens: 50 }); // no cache read
  const s = m.summary();
  assert.equal(s.calls, 3);
  assert.equal(s.cacheHits, 2);
  assert.equal(s.freshInputTokens, 1000);
  assert.equal(s.cacheReadTokens, 8000);
  assert.equal(s.outputTokens, 230);
  assert.ok(s.usd > 0);
});

test('the no-caching counterfactual is always at least the actual cost', () => {
  const m = new CostMeter();
  m.record({ input_tokens: 100, output_tokens: 100, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 10_000 });
  const s = m.summary();
  assert.ok(s.usdNoCaching > s.usd);
});

test('price table matches the published Sonnet 5 rates', () => {
  assert.equal(PRICE.inputPerMTok, 2.0);
  assert.equal(PRICE.outputPerMTok, 10.0);
});

test('sumCost folds per-source summaries into a run total', () => {
  const a = new CostMeter();
  a.record({ input_tokens: 100, output_tokens: 10 });
  const b = new CostMeter();
  b.record({ input_tokens: 200, output_tokens: 20, cache_read_input_tokens: 1000 });
  const total = sumCost([a.summary(), b.summary()]);
  assert.equal(total.calls, 2);
  assert.equal(total.cacheHits, 1);
  assert.equal(total.freshInputTokens, 300);
});
