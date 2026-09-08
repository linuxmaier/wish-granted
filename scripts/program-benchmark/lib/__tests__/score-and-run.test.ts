import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scoreCase } from '../score.ts';
import { runBenchmark } from '../run.ts';
import { renderReport } from '../report.ts';
import { notWiredExtractor, verifiedEchoExtractor, abstainAllExtractor } from '../extractor.ts';
import { program, fixtureExtractor, c } from './fixtures.ts';

const foodshareLike = program({
  id: 'foodshare-like',
  name: 'FoodShare Wisconsin (SNAP)',
  administeredBy: 'Wisconsin Department of Health Services',
  summary: 'Money is loaded onto a QUEST card each month you use like a debit card at grocery stores.',
  benefit: 'A monthly food benefit on a QUEST card. The amount depends on household size and income.',
  eligibility: c.allOf(
    c.is('state', 'WI'),
    c.anyOf(c.income('fpl', 200), c.hasAnyOf('currentBenefits', ['ssi', 'w2-tanf'])),
  ),
  howToApply: { url: 'https://access.wi.gov/s/', phone: '1-800-362-3002' },
  source: { url: 'https://www.dhs.wisconsin.gov/foodshare/index.htm', name: 'WI DHS', lastVerified: '2026-08-21' },
});

const daneLike = program({
  id: 'dane-like',
  eligibility: c.allOf(c.is('county', 'dane'), c.isTrue('facingLossOfHousing'), c.manualReview('income not published')),
  source: { url: 'https://example.org/', name: 'TRC', lastVerified: null },
});

function scoredCase(over = {}) {
  return { programId: foodshareLike.id, sourceUrl: foodshareLike.source.url, sourceName: 'x', verified: foodshareLike, ...over };
}

test('scoreCase: an equivalent candidate is scored, equivalent, not dangerous, full descriptive', () => {
  const s = scoreCase({
    case: scoredCase(),
    kind: 'scored',
    result: {
      eligibility: c.allOf(
        c.anyOf(c.hasAnyOf('currentBenefits', ['w2-tanf', 'ssi']), c.income('fpl', 200)),
        c.is('state', 'WI'),
      ),
      name: 'FoodShare Wisconsin (SNAP)',
      administeredBy: 'Wisconsin Department of Health Services',
      summary: 'Each month money is loaded on a QUEST card you use like a debit card at grocery stores.',
      benefit: 'A monthly food benefit on a QUEST card; the amount depends on household size and income.',
      howToApply: { url: 'https://access.wi.gov/s/', phone: '800-362-3002' },
    },
  });
  assert.equal(s.outcome, 'scored');
  assert.equal(s.eligibility, 'equivalent');
  assert.equal(s.dangerous.length, 0);
  assert.equal(s.coverage, true);
  assert.ok(!s.descriptive.some((d) => d.verdict === 'miss'));
});

test('scoreCase: dropping the categorical branch is divergent AND dangerous', () => {
  const s = scoreCase({
    case: scoredCase(),
    kind: 'scored',
    result: { eligibility: c.allOf(c.is('state', 'WI'), c.income('fpl', 200)) },
  });
  assert.equal(s.eligibility, 'divergent');
  assert.ok(s.dangerous.length > 0);
});

test('scoreCase: a schema-gate failure is not scored and not covered', () => {
  const s = scoreCase({
    case: scoredCase(),
    kind: 'scored',
    result: { eligibility: c.oneOf('housingStatus', ['renting', 'levitating']) },
  });
  assert.equal(s.outcome, 'gate-failed');
  assert.equal(s.coverage, false);
  assert.equal(s.eligibility, 'not-scored');
});

test('scoreCase: a whole-record abstention still counts as coverage', () => {
  const s = scoreCase({
    case: scoredCase(),
    kind: 'scored',
    result: { abstained: true, reason: 'source publishes no rule' },
  });
  assert.equal(s.outcome, 'extractor-abstained');
  assert.equal(s.coverage, true);
  assert.equal(s.eligibility, 'candidate-abstained');
  assert.equal(s.dangerous.length, 0);
});

test('scoreCase: a skipped case measures nothing', () => {
  const s = scoreCase({
    case: scoredCase(),
    kind: 'scored',
    result: { error: 'skipped-no-key', message: 'no ANTHROPIC_API_KEY' },
  });
  assert.equal(s.outcome, 'skipped-no-key');
  assert.equal(s.coverage, false);
});

test('scoreCase: abstention-only case scores only the abstention dimension', () => {
  const s = scoreCase({
    case: { programId: daneLike.id, sourceUrl: daneLike.source.url, sourceName: 'x', verified: daneLike },
    kind: 'abstention-only',
    result: { abstained: true, reason: 'cannot state a rule' },
  });
  assert.equal(s.eligibility, 'candidate-abstained');
  assert.equal(s.dangerous.length, 0);
  assert.equal(s.abstention?.verdict, 'correct');
});

test('runBenchmark + renderReport: all cases SKIPPED with no key -> nothing measured, never blocking', async () => {
  const run = await runBenchmark({
    extractor: notWiredExtractor,
    programs: [foodshareLike, daneLike],
    hasApiKey: false,
    extractorLabel: 'not-wired',
  });
  const r = renderReport(run);
  assert.equal(r.nothingMeasured, true);
  assert.equal(r.blocking, false);
  assert.match(r.text, /SKIPPED/);
});

test('runBenchmark + renderReport: verified-echo over fixtures is a clean, non-blocking run', async () => {
  const run = await runBenchmark({
    extractor: verifiedEchoExtractor([foodshareLike, daneLike]),
    programs: [foodshareLike, daneLike],
    hasApiKey: true,
    extractorLabel: 'verified-echo',
  });
  const r = renderReport(run);
  assert.equal(r.blocking, false);
  assert.equal(r.nothingMeasured, false);
  const scored = run.scores.filter((s) => s.kind === 'scored');
  assert.ok(scored.every((s) => s.eligibility === 'equivalent'));
  assert.ok(scored.every((s) => s.dangerous.length === 0));
});

test('runBenchmark + renderReport: an UNDER-claiming candidate on a live run is BLOCKING', async () => {
  const run = await runBenchmark({
    extractor: fixtureExtractor({
      'foodshare-like': { eligibility: c.allOf(c.is('state', 'WI'), c.income('fpl', 130)) },
    }),
    programs: [foodshareLike],
    hasApiKey: true,
    extractorLabel: 'under-claim-fixture',
  });
  const r = renderReport(run);
  assert.equal(r.blocking, true);
  assert.match(r.text, /BLOCKING/);
  assert.match(r.text, /UNDER-CLAIM/);
  assert.ok(r.blockingReasons.some((x) => x.includes('UNDER-CLAIM')));
});

test('runBenchmark + renderReport: an OVER-claiming candidate on a live run is BLOCKING', async () => {
  // The candidate keeps the geography gate but drops the income test, so the
  // app tells a household well over 200% FPL that they qualify.
  const run = await runBenchmark({
    extractor: fixtureExtractor({
      'foodshare-like': { eligibility: c.is('state', 'WI') },
    }),
    programs: [foodshareLike],
    hasApiKey: true,
    extractorLabel: 'over-claim-fixture',
  });
  const r = renderReport(run);
  assert.equal(r.blocking, true);
  assert.match(r.text, /OVER-CLAIM/);
  assert.ok(r.blockingReasons.some((x) => x.includes('OVER-CLAIM')));
});

test('runBenchmark: abstain-all produces no harm findings -- and is BLOCKING anyway', async () => {
  // An extractor that refuses to answer must not score clean. See
  // docs/standing-decisions.md, "The two harms".
  const run = await runBenchmark({
    extractor: abstainAllExtractor,
    programs: [foodshareLike, daneLike],
    hasApiKey: true,
    extractorLabel: 'abstain-all',
  });
  assert.ok(run.scores.every((s) => s.dangerous.length === 0));
  assert.ok(run.scores.every((s) => s.overClaim.length === 0));
  assert.ok(run.scores.every((s) => s.coverage));

  const r = renderReport(run);
  assert.equal(r.blocking, true, 'abstaining on everything must not pass the benchmark');
  assert.match(r.text, /DEGENERATE YIELD/);
  assert.ok(r.blockingReasons.some((x) => x.includes('DEGENERATE YIELD')));
});
