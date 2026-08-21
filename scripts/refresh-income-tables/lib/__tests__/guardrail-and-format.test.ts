import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkGuardrail, GUARDRAIL_PERCENT } from '../guardrail.ts';
import { formatNumberLiteral, parseUnderscoredNumber, parseDollarNumber } from '../format.ts';

test('checkGuardrail is silent on a move exactly at the threshold', () => {
  // The check is "greater than", not "at or above" -- a move of exactly GUARDRAIL_PERCENT
  // passes.
  const newValue = 100 * (1 + GUARDRAIL_PERCENT / 100);
  const violations = checkGuardrail(() => 'x', [100], [newValue]);
  assert.equal(violations.length, 0);
});

test('checkGuardrail flags a move just over the threshold, in both directions', () => {
  const justOverUp = 100 * (1 + GUARDRAIL_PERCENT / 100) + 0.01;
  const up = checkGuardrail(() => 'x', [100], [justOverUp]);
  assert.equal(up.length, 1);
  assert.ok(up[0]!.percentChange > GUARDRAIL_PERCENT);

  const justOverDown = 100 * (1 - GUARDRAIL_PERCENT / 100) - 0.01;
  const down = checkGuardrail(() => 'x', [100], [justOverDown]);
  assert.equal(down.length, 1);
  assert.ok(down[0]!.percentChange < -GUARDRAIL_PERCENT);
});

test('checkGuardrail is silent on the real annual moves that calibrated it (issue #6 review)', () => {
  // FPL moves ~3-4%/year; Dane AMI's real 2026 correction (#3) was 9.1%; WI SMI's was
  // 15-20%. All three are legitimate and none should trip a 25% band -- that band exists
  // specifically because a 10% band tripped on the middle two.
  assert.equal(checkGuardrail(() => 'fpl', [33_000], [34_200]).length, 0); // +3.6%
  assert.equal(checkGuardrail(() => 'fourPersonMedian', [124_000], [135_300]).length, 0); // +9.1%
  assert.equal(checkGuardrail(() => 'wi-smi', [62_000], [73_888]).length, 0); // +19.2%
});

test('checkGuardrail still flags a move well beyond any normal annual change (a parse error, not a correction)', () => {
  // The guardrail's actual job: catching a misread column or a footnote captured as a
  // value, which produces a grossly wrong number, not a 12-20% one.
  const violations = checkGuardrail(() => 'x', [73_888], [738_880]); // a misplaced decimal
  assert.equal(violations.length, 1);
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
