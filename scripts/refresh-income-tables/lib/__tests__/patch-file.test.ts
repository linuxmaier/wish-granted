import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch, buildProposedComment, type PatchPlan } from '../patch-file.ts';

const FIXTURE = [
  '/**',
  ' * Prose about FPL that must survive untouched.',
  ' */',
  'export const FPL: IncomeTable = {',
  "  id: 'fpl',",
  '  bySize: [15_960, 21_640, 27_320, 33_000],',
  '  perAdditionalPerson: 5_680,',
  '  effectiveYear: 2026,',
  "  source: 'https://example.com/fpl',",
  '  verified: true,',
  "  lastVerified: '2026-08-21',",
  '};',
  '',
  '/**',
  ' * Prose about DANE_AMI that must survive untouched.',
  ' */',
  'export const DANE_AMI = {',
  "  id: 'dane-ami',",
  '  fourPersonMedian: 135_300,',
  '  effectiveYear: 2026,',
  "  source: 'https://example.com/dane',",
  '  verified: true,',
  "  lastVerified: '2026-08-21',",
  '} as const;',
].join('\n');

test('applyPatch updates only the targeted export, leaving every other export byte-identical', () => {
  const plan: PatchPlan = {
    exportName: 'FPL',
    bySize: [16_000, 22_000, 28_000, 34_000],
    perAdditionalPerson: 6_000,
    effectiveYear: 2027,
    source: 'https://example.com/fpl-2027',
    proposedComment: buildProposedComment({
      generatedAt: '2027-01-01T00:00:00.000Z',
      summaryLines: ['Changed: everything.'],
      provenance: ['https://example.com/fpl-2027'],
    }),
  };
  const patched = applyPatch(FIXTURE, plan);

  // The DANE_AMI block, including its hand-written prose comment, is untouched.
  const daneAmiBlock = patched.slice(patched.indexOf('/**\n * Prose about DANE_AMI'));
  assert.equal(
    daneAmiBlock,
    [
      '/**',
      ' * Prose about DANE_AMI that must survive untouched.',
      ' */',
      'export const DANE_AMI = {',
      "  id: 'dane-ami',",
      '  fourPersonMedian: 135_300,',
      '  effectiveYear: 2026,',
      "  source: 'https://example.com/dane',",
      '  verified: true,',
      "  lastVerified: '2026-08-21',",
      '} as const;',
    ].join('\n'),
  );

  // The FPL block's original prose comment is untouched, and a new comment is inserted above it.
  assert.match(patched, / \* Prose about FPL that must survive untouched\.\n \*\/\n\n\/\*\*\n \* PROPOSED UPDATE/);

  // Data fields are updated...
  assert.match(patched, /bySize: \[16_000, 22_000, 28_000, 34_000\]/);
  assert.match(patched, /perAdditionalPerson: 6_000/);
  assert.match(patched, /effectiveYear: 2027/);
  assert.match(patched, /source: 'https:\/\/example\.com\/fpl-2027'/);
  // ...and this script never claims verification for itself -- checked scoped to the FPL
  // block specifically, since the untouched DANE_AMI block legitimately still says
  // `verified: true` (it was not part of this patch).
  const fplBlock = patched.slice(patched.indexOf('export const FPL'), patched.indexOf('export const DANE_AMI'));
  assert.match(fplBlock, /verified: false/);
  assert.match(fplBlock, /lastVerified: null/);
  assert.doesNotMatch(fplBlock, /verified: true/);
});

test('applyPatch on DANE_AMI-shaped data (fourPersonMedian, `as const`, no IncomeTable annotation) works the same way', () => {
  const plan: PatchPlan = {
    exportName: 'DANE_AMI',
    fourPersonMedian: 140_000,
    effectiveYear: 2027,
    source: 'https://example.com/dane-2027',
    proposedComment: buildProposedComment({
      generatedAt: '2027-01-01T00:00:00.000Z',
      summaryLines: ['Changed: fourPersonMedian.'],
      provenance: ['https://example.com/dane-2027'],
    }),
  };
  const patched = applyPatch(FIXTURE, plan);

  assert.match(patched, /fourPersonMedian: 140_000/);
  assert.match(patched, /\} as const;/);
  // The FPL block is untouched.
  assert.match(patched, /bySize: \[15_960, 21_640, 27_320, 33_000\]/);
  assert.match(patched, /verified: true,\n  lastVerified: '2026-08-21',\n\};/);
});

test('buildProposedComment never contains the string "verified: true"', () => {
  const comment = buildProposedComment({
    generatedAt: '2027-01-01T00:00:00.000Z',
    summaryLines: ['Changed: x.'],
    provenance: ['https://example.com'],
  });
  assert.doesNotMatch(comment, /verified: true/);
  assert.match(comment, /PROPOSED UPDATE \(unverified\)/);
});
