import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findBlock, readScalarField, readArrayField, replaceScalarField, replaceArrayField } from '../table-source.ts';

// A minimal fixture shaped like the real income-tables.ts, deliberately including things
// that have broken naive regexes before: a `\r\n` line ending, an `IncomeTable`-typed export
// and an untyped `as const` export, and an inline comment inside the object body.
const FIXTURE = [
  '/**\r',
  ' * Some hand-written prose about FPL.\r',
  ' */\r',
  'export const FPL: IncomeTable = {\r',
  "  id: 'fpl',\r",
  '  bySize: [15_960, 21_640, 27_320, 33_000],\r',
  '  perAdditionalPerson: 5_680,\r',
  '  effectiveYear: 2026,\r',
  "  source: 'https://example.com/fpl',\r",
  '  verified: true,\r',
  "  lastVerified: '2026-08-21',\r",
  '};\r',
  '\r',
  '/**\r',
  ' * Some hand-written prose about DANE_AMI.\r',
  ' */\r',
  'export const DANE_AMI = {\r',
  "  id: 'dane-ami',\r",
  '  fourPersonMedian: 135_300,\r',
  '  /** a comment inside the object body */\r',
  '  sizeAdjustment: [0.7, 0.8, 0.9, 1.0] as const,\r',
  '  effectiveYear: 2026,\r',
  "  source: 'https://example.com/dane',\r",
  '  verified: true,\r',
  "  lastVerified: '2026-08-21',\r",
  '} as const;\r',
].join('\n');

test('findBlock locates the typed FPL export and its exact brace span', () => {
  const block = findBlock(FIXTURE, 'FPL');
  assert.equal(FIXTURE.slice(block.blockStart, block.blockStart + 18), 'export const FPL: ');
  assert.equal(FIXTURE[block.braceOpen], '{');
  assert.equal(FIXTURE[block.braceClose], '}');
  assert.equal(FIXTURE.slice(block.braceClose + 1, block.blockEnd), ';');
});

test('findBlock locates the untyped `as const` DANE_AMI export and consumes its trailing `as const;`', () => {
  const block = findBlock(FIXTURE, 'DANE_AMI');
  assert.equal(FIXTURE.slice(block.blockStart, block.blockStart + 21), 'export const DANE_AMI');
  assert.equal(FIXTURE.slice(block.braceClose + 1, block.blockEnd), ' as const;');
});

test('findBlock throws a descriptive error for a name that is not in the file', () => {
  assert.throws(() => findBlock(FIXTURE, 'NOT_THERE'), /Could not find "export const NOT_THERE"/);
});

test('readScalarField and readArrayField round-trip every field shape', () => {
  const { body } = findBlock(FIXTURE, 'FPL');
  assert.equal(readScalarField(body, 'FPL', 'effectiveYear'), '2026');
  assert.equal(readScalarField(body, 'FPL', 'source'), "'https://example.com/fpl'");
  assert.equal(readScalarField(body, 'FPL', 'verified'), 'true');
  assert.equal(readScalarField(body, 'FPL', 'lastVerified'), "'2026-08-21'");
  assert.equal(readArrayField(body, 'FPL', 'bySize'), '15_960, 21_640, 27_320, 33_000');
});

test('readScalarField reads `null` for lastVerified', () => {
  const nullFixture = FIXTURE.replace("lastVerified: '2026-08-21',\r\n};", 'lastVerified: null,\r\n};');
  const { body } = findBlock(nullFixture, 'FPL');
  assert.equal(readScalarField(body, 'FPL', 'lastVerified'), 'null');
});

test('replaceScalarField and replaceArrayField only touch the targeted field', () => {
  const { body } = findBlock(FIXTURE, 'FPL');
  let updated = replaceScalarField(body, 'FPL', 'effectiveYear', '2027');
  updated = replaceScalarField(updated, 'FPL', 'verified', 'false');
  updated = replaceScalarField(updated, 'FPL', 'lastVerified', 'null');
  updated = replaceArrayField(updated, 'FPL', 'bySize', '16_000, 22_000, 28_000, 34_000');

  assert.match(updated, /effectiveYear: 2027/);
  assert.match(updated, /verified: false/);
  assert.match(updated, /lastVerified: null/);
  assert.match(updated, /bySize: \[16_000, 22_000, 28_000, 34_000\]/);
  // Untouched fields survive exactly.
  assert.match(updated, /perAdditionalPerson: 5_680/);
  assert.match(updated, /source: 'https:\/\/example\.com\/fpl'/);
});

test('replaceScalarField throws rather than silently no-op-ing on an unknown field', () => {
  const { body } = findBlock(FIXTURE, 'FPL');
  assert.throws(() => replaceScalarField(body, 'FPL', 'doesNotExist', 'x'), /Could not find field "doesNotExist"/);
});
