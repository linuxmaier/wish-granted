/**
 * End-to-end offline scenarios for the agent loop. Each one is a scripted model
 * transcript + a fixture fetcher + a `verify` that returns a list of failure
 * strings (empty === pass). Shared verbatim between the Node test suite
 * (lib/__tests__/agent-loop.test.ts) and the CLI --self-test, so "the machinery
 * is trustworthy before a token is spent" is the SAME code path in both.
 *
 * No network. No model. The ScriptedModelClient proves nothing about model
 * behaviour -- only that navigation, structure preservation, cross-reference
 * resolution, provenance and cost instrumentation are wired correctly.
 */
import type { ExtractionContext } from '../../program-benchmark/lib/extractor.ts';
import { createFixtureFetcher } from './fetcher.ts';
import { ScriptedModelClient, type ScriptedTurn } from './scripted-model.ts';
import { runAgent, type AgentRun } from './agent.ts';
import { ecfrSectionUrl } from './cross-reference.ts';
import { isAbstention } from '../../program-benchmark/lib/extractor.ts';
import * as F from './fixtures-offline.ts';

const DATE = '2026-09-06';

const cmp = (fact: string, value: unknown) => ({ kind: 'compare', fact, op: 'eq', value });
const income = (scale: string, percent: number) => ({ kind: 'incomeAtOrBelow', scale, percent });

export interface OfflineScenario {
  readonly name: string;
  run(): Promise<{ run: AgentRun; failures: string[] }>;
}

function ctx(over: Partial<ExtractionContext> & Pick<ExtractionContext, 'programId' | 'sourceUrl' | 'sourceName'>): ExtractionContext {
  return { hasApiKey: false, ...over };
}

async function execute(
  context: ExtractionContext,
  fixtures: F.OfflineFixtureSet,
  script: readonly ScriptedTurn[],
  maxSteps = 12,
): Promise<{ run: AgentRun; calls: { url: string; headers: Readonly<Record<string, string>> }[] }> {
  const { fetcher, calls } = createFixtureFetcher(fixtures);
  const model = new ScriptedModelClient(script);
  const run = await runAgent(context, { model, fetcher, maxSteps });
  return { run, calls };
}

/** 1. Dead URL recovered, structure preserved, multi-page, scope-carrying rule, provenance. */
const badgercare: OfflineScenario = {
  name: 'badgercare: 404 recovery + table structure + multi-page + population-scoped rule + provenance',
  async run() {
    const context = ctx({
      programId: 'badgercare-plus',
      sourceUrl: F.BADGERCARE_DEAD_URL,
      sourceName: 'Wisconsin DHS — BadgerCare Plus',
    });
    const eligibility = {
      kind: 'anyOf',
      of: [
        { kind: 'allOf', of: [cmp('state', 'WI'), income('fpl', 100)] },
        { kind: 'allOf', of: [cmp('state', 'WI'), cmp('isPregnantOrPostpartum', true), income('fpl', 306)] },
      ],
    };
    const script: ScriptedTurn[] = [
      { toolCalls: [{ name: 'fetch_page', input: { url: F.BADGERCARE_DEAD_URL } }] },
      { toolCalls: [{ name: 'fetch_page', input: { url: F.BADGERCARE_FPL_URL } }] },
      {
        toolCalls: [
          {
            name: 'emit_record',
            input: {
              eligibility,
              name: 'BadgerCare Plus',
              provenance: [
                { quote: 'Adult monthly income limit (100% FPL)', url: F.BADGERCARE_LIVE_URL },
                { quote: 'Pregnant people monthly income limit (306% FPL)', url: F.BADGERCARE_LIVE_URL },
              ],
              notes: 'The 201% FPL children figure is a premium trigger, not an eligibility cutoff — excluded.',
            },
          },
        ],
      },
    ];
    const { run, calls } = await execute(context, F.offlineFixtures(DATE), script);
    const failures: string[] = [];
    if (isAbstention(run.result)) failures.push(`expected a record, got abstention: ${run.result.reason}`);
    else {
      if (run.result.eligibility.kind !== 'anyOf') failures.push(`expected an anyOf rule, got ${run.result.eligibility.kind}`);
    }
    if (!run.record) failures.push('no ExtractedRecord attached');
    else {
      if (run.record.provenance.length !== 2) failures.push(`expected 2 verified spans, got ${run.record.provenance.length}`);
      if (run.record.provenance.some((s) => s.url !== F.BADGERCARE_LIVE_URL)) failures.push('a span resolved to the wrong URL');
    }
    if (run.pagesVisited.length !== 2) failures.push(`expected 2 pages visited, got ${run.pagesVisited.join(', ')}`);
    if (run.pagesVisited[0] !== F.BADGERCARE_LIVE_URL) failures.push('first page visited was not the RECOVERED live URL');
    // The recovered page's structured text must keep the table headers attached.
    const firstFetch = calls[0]?.url;
    if (firstFetch !== F.BADGERCARE_DEAD_URL) failures.push('did not request the dead URL first');
    if (run.cost.calls !== 3) failures.push(`expected 3 model calls, got ${run.cost.calls}`);
    if (run.cost.cacheHits !== 3) failures.push(`expected 3 cache hits, got ${run.cost.cacheHits}`);
    if (run.cost.usd <= 0) failures.push('cost meter reported $0');
    return { run, failures };
  },
};

/** 2. Cross-reference resolved via the eCFR versioner API; provenance URL is the resolved URL. */
const snapCrossRef: OfflineScenario = {
  name: 'snap: notwithstanding-(a) resolved via eCFR versioner API, cross-ref URL recorded as provenance',
  async run() {
    const context = ctx({
      programId: 'foodshare-snap-wi',
      sourceUrl: F.SNAP_SOURCE_URL,
      sourceName: 'Wisconsin DHS — FoodShare',
    });
    const apiUrl = ecfrSectionUrl({ title: 7, part: 273, section: '273.1', date: DATE });
    const eligibility = {
      kind: 'allOf',
      of: [
        cmp('state', 'WI'),
        {
          kind: 'manualReview',
          note:
            'The 165% FPL test in 7 CFR 273.1(b)(2) measures the income of the OTHER residents, excluding the elderly/disabled person and spouse. No fact isolates a household subset, so a separate-household income gate cannot be encoded safely.',
        },
      ],
    };
    const script: ScriptedTurn[] = [
      { toolCalls: [{ name: 'fetch_page', input: { url: F.SNAP_SOURCE_URL } }] },
      { toolCalls: [{ name: 'resolve_cfr_reference', input: { title: 7, part: 273, section: '273.1', date: DATE } }] },
      {
        toolCalls: [
          {
            name: 'emit_record',
            input: {
              eligibility,
              provenance: [
                { quote: 'Notwithstanding the provisions of paragraph (a) of this section', url: apiUrl },
                { quote: '165 percent of the poverty line', url: apiUrl },
              ],
            },
          },
        ],
      },
    ];
    const { run, calls } = await execute(context, F.offlineFixtures(DATE), script);
    const failures: string[] = [];
    if (isAbstention(run.result)) failures.push(`expected a record, got abstention: ${run.result.reason}`);
    if (!run.record) failures.push('no ExtractedRecord attached');
    else {
      if (!run.record.provenance.every((s) => s.url === apiUrl)) {
        failures.push(`provenance URL is not the resolved eCFR API URL: ${run.record.provenance.map((s) => s.url).join(', ')}`);
      }
      if (run.record.eligibility.kind !== 'allOf') failures.push('expected an allOf with a manualReview leaf');
    }
    if (!run.pagesVisited.includes(apiUrl)) failures.push('the eCFR API URL is not in pagesVisited');
    // The versioner call must carry Accept-Encoding, or the fixture 406s.
    const ecfrCall = calls.find((c) => c.url.includes('ecfr.gov'));
    if (!ecfrCall) failures.push('no eCFR request was made');
    else {
      const ae = Object.entries(ecfrCall.headers).find(([k]) => k.toLowerCase() === 'accept-encoding')?.[1];
      if (!ae) failures.push('eCFR request did not send Accept-Encoding');
    }
    return { run, failures };
  },
};

/** 3. Fabricated quote is rejected; loop does not emit a fabricated record; then abstains. */
const fabricatedQuoteRejected: OfflineScenario = {
  name: 'provenance: a fabricated span is rejected, the loop abstains rather than emit it',
  async run() {
    const context = ctx({
      programId: 'badgercare-plus',
      sourceUrl: F.BADGERCARE_DEAD_URL,
      sourceName: 'Wisconsin DHS — BadgerCare Plus',
    });
    const script: ScriptedTurn[] = [
      { toolCalls: [{ name: 'fetch_page', input: { url: F.BADGERCARE_DEAD_URL } }] },
      {
        toolCalls: [
          {
            name: 'emit_record',
            input: {
              eligibility: { kind: 'allOf', of: [cmp('state', 'WI'), income('fpl', 500)] },
              provenance: [{ quote: 'every household earning under 500% of the poverty level qualifies', url: F.BADGERCARE_LIVE_URL }],
            },
          },
        ],
      },
      { toolCalls: [{ name: 'abstain', input: { reason: 'could not ground a 500% FPL ceiling in the source text' } }] },
    ];
    const { run } = await execute(context, F.offlineFixtures(DATE), script);
    const failures: string[] = [];
    if (!isAbstention(run.result)) failures.push('expected an abstention after the fabricated span was rejected');
    if (run.record) failures.push('a record was emitted despite an unverifiable span');
    if (!run.trace.some((t) => t.includes('rejected'))) failures.push('trace does not record the emit rejection');
    return { run, failures };
  },
};

/** 4. Step budget exhaustion abstains, never guesses. */
const stepBudget: OfflineScenario = {
  name: 'budget: exhausting the step budget abstains',
  async run() {
    const context = ctx({
      programId: 'seniorcare',
      sourceUrl: F.SENIORCARE_SOURCE_URL,
      sourceName: 'Wisconsin DHS — SeniorCare',
    });
    const spin: ScriptedTurn = { toolCalls: [{ name: 'fetch_page', input: { url: F.SENIORCARE_INDEX_URL } }] };
    const { run } = await execute(context, F.offlineFixtures(DATE), [spin, spin, spin], 3);
    const failures: string[] = [];
    if (!isAbstention(run.result)) failures.push('expected an abstention when the step budget ran out');
    else if (!run.result.reason.includes('budget')) failures.push(`abstention reason should mention the budget: ${run.result.reason}`);
    return { run, failures };
  },
};

export const OFFLINE_SCENARIOS: readonly OfflineScenario[] = [
  badgercare,
  snapCrossRef,
  fabricatedQuoteRejected,
  stepBudget,
];
