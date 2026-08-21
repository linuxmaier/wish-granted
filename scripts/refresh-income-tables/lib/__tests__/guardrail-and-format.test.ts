import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkGuardrail, GUARDRAIL_PERCENT } from '../guardrail.ts';
import { formatNumberLiteral, parseUnderscoredNumber, parseDollarNumber } from '../format.ts';

test('checkGuardrail is silent on a move exactly at the threshold', () => {
  // 100 -> 110 is exactly +10%, and the check is "greater than", not "at or above".
  const violations = checkGuardrail(() => 'x', [100], [110]);
  assert.equal(violations.length, 0);
});

test('checkGuardrail flags a move just over the threshold, in both directions', () => {
  const up = checkGuardrail(() => 'x', [100], [110.01]);
  assert.equal(up.length, 1);
  assert.ok(up[0]!.percentChange > GUARDRAIL_PERCENT);

  const down = checkGuardrail(() => 'x', [100], [89.98]);
  assert.equal(down.length, 1);
  assert.ok(down[0]!.percentChange < -GUARDRAIL_PERCENT);
});

test('checkGuardrail reproduces the real Dane AMI move (issue #3) as just under the threshold', () => {
  // Documented in the coordinator's review: $124,000 -> $135,300 is 9.1%, under the 10% band.
  const violations = checkGuardrail(() => 'fourPersonMedian', [124_000], [135_300]);
  assert.equal(violations.length, 0);
});

test('checkGuardrail skips a newly-tracked size rather than comparing against undefined', () => {
  const violations = checkGuardrail((i) => `size ${i + 1}`, [100, 200], [101, 202, 999]);
  assert.equal(violations.length, 0);
});

test('checkGuardrail labels each violation using the caller-supplied labelFor', () => {
  const violations = checkGuardrail((i) => `household size ${i + 1}`, [100, 100], [100, 200]);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]!.label, 'household size 2');
});

test('formatNumberLiteral matches income-tables.ts underscore-grouping style', () => {
  assert.equal(formatNumberLiteral(15_960), '15_960');
  assert.equal(formatNumberLiteral(135_300), '135_300');
  assert.equal(formatNumberLiteral(5_680), '5_680');
  assert.equal(formatNumberLiteral(999), '999');
});

test('formatNumberLiteral and parseUnderscoredNumber round-trip', () => {
  for (const n of [999, 5_680, 15_960, 135_300, 1_234_567]) {
    assert.equal(parseUnderscoredNumber(formatNumberLiteral(n)), n);
  }
});

test('parseDollarNumber handles the shapes actually scraped from source pages/PDFs', () => {
  assert.equal(parseDollarNumber('$135,300'), 135_300);
  assert.equal(parseDollarNumber('135300'), 135_300);
  assert.equal(parseDollarNumber(' $38,421 '), 38_421);
});
