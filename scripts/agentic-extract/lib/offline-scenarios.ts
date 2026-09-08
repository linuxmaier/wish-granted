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
import { renderStructured } from './html-structure.ts';
import { isAbstention } from '../../program-benchmark/lib/extractor.ts';
import { factsReferenced, type Criterion } from '../../../src/domain/criteria.ts';
import { RESERVED_FACT_KEYS } from '../../../src/domain/facts.ts';
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

/** 4. Step budget exhaustion abstains, never guesses -- and is tagged distinctly. */
const stepBudget: OfflineScenario = {
  name: 'budget: exhausting the step budget abstains, tagged budget-exhausted (not substantive)',
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
    if (run.abstention !== 'budget-exhausted') {
      failures.push(`expected abstention tagged "budget-exhausted", got "${run.abstention}"`);
    }
    return { run, failures };
  },
};

/**
 * 5. A rule over a RESERVED fact is rejected by the gate and sent back; the
 *    model re-routes that condition to manualReview and the corrected record
 *    is accepted with no reserved fact left in the tree. (PR #72 defect 1.)
 *    `citizenshipStatus` is still reserved and is the rejected condition here;
 *    `age` became askable in issue #88, so the corrected rule *keeps* the
 *    65-or-older band as a real `set` node -- the point is that the gate
 *    now draws the line exactly where the engine does.
 */
const reservedFactRejected: OfflineScenario = {
  name: 'reserved facts: a citizenshipStatus rule is gate-rejected and re-routed; the age band survives',
  async run() {
    const context = ctx({
      programId: 'seniorcare',
      sourceUrl: F.SENIORCARE_SOURCE_URL,
      sourceName: 'Wisconsin DHS — SeniorCare',
    });
    const badRule = {
      kind: 'allOf',
      of: [
        cmp('state', 'WI'),
        { kind: 'set', fact: 'age', op: 'in', values: ['65-plus'] },
        { kind: 'set', fact: 'citizenshipStatus', op: 'includesAny', values: ['us-citizen', 'qualified-immigrant'] },
      ],
    };
    const correctedRule = {
      kind: 'allOf',
      of: [
        cmp('state', 'WI'),
        { kind: 'set', fact: 'age', op: 'in', values: ['65-plus'] },
        {
          kind: 'manualReview',
          note:
            'SeniorCare also requires U.S. citizen / qualifying immigrant status. `citizenshipStatus` is not a fact the interview asks, so that condition is routed here rather than encoded as a rule that could never be satisfied. The 65-or-older band above is an asked fact and stays in the rule.',
        },
      ],
    };
    const prov = [
      { quote: 'Wisconsin resident', url: F.SENIORCARE_INDEX_URL },
      { quote: '65 years of age or older', url: F.SENIORCARE_INDEX_URL },
    ];
    const script: ScriptedTurn[] = [
      { toolCalls: [{ name: 'fetch_page', input: { url: F.SENIORCARE_SOURCE_URL } }] },
      { toolCalls: [{ name: 'fetch_page', input: { url: F.SENIORCARE_INDEX_URL } }] },
      { toolCalls: [{ name: 'emit_record', input: { eligibility: badRule, provenance: prov } }] },
      { toolCalls: [{ name: 'emit_record', input: { eligibility: correctedRule, provenance: prov } }] },
    ];
    const { run } = await execute(context, F.offlineFixtures(DATE), script);
    const failures: string[] = [];

    const rejection = run.trace.find((t) => t.includes('rejected'));
    if (!rejection) failures.push('trace does not record the emit rejection');
    else if (!/age|citizenshipStatus|reserved/.test(rejection)) {
      failures.push(`rejection did not name the reserved fact: ${rejection}`);
    }

    if (isAbstention(run.result)) {
      failures.push(`expected the corrected record to be accepted, got abstention: ${run.result.reason}`);
    } else {
      const referenced = [...factsReferenced(run.result.eligibility as Criterion)];
      const leaked = referenced.filter((k) => (RESERVED_FACT_KEYS as readonly string[]).includes(k));
      if (leaked.length > 0) failures.push(`reserved fact(s) survived into the accepted rule: ${leaked.join(', ')}`);
      if (run.result.eligibility.kind !== 'allOf') failures.push('expected an allOf with a manualReview leaf');
      if (!run.record?.provenance.length) failures.push('accepted record has no verified provenance');
    }
    return { run, failures };
  },
};

/**
 * 6. A step budget raised above PR #72's 12 is actually honored: the same
 *    13-fetch transcript exhausts at maxSteps=12 (tagged budget-exhausted) and
 *    completes at maxSteps=16. Exhaustion still abstains -- that stays.
 */
const raisedBudgetHonored: OfflineScenario = {
  name: 'budget: a raised step budget is honored (13 fetches complete at 16, exhaust at 12)',
  async run() {
    const context = ctx({
      programId: 'seniorcare',
      sourceUrl: F.SENIORCARE_SOURCE_URL,
      sourceName: 'Wisconsin DHS — SeniorCare',
    });
    const spin: ScriptedTurn = { toolCalls: [{ name: 'fetch_page', input: { url: F.SENIORCARE_INDEX_URL } }] };
    const emitTurn: ScriptedTurn = {
      toolCalls: [
        {
          name: 'emit_record',
          input: {
            eligibility: {
              kind: 'allOf',
              of: [
                cmp('state', 'WI'),
                { kind: 'manualReview', note: 'Citizenship gates SeniorCare and is not an asked fact.' },
              ],
            },
            provenance: [{ quote: 'Wisconsin resident', url: F.SENIORCARE_INDEX_URL }],
          },
        },
      ],
    };
    const thirteenFetchesThenEmit: ScriptedTurn[] = [...Array(13).fill(spin), emitTurn];

    const failures: string[] = [];

    // Old ceiling: exhausts before reaching the emit on turn 14.
    const tight = await execute(context, F.offlineFixtures(DATE), thirteenFetchesThenEmit, 12);
    if (!isAbstention(tight.run.result)) failures.push('at maxSteps=12 the 13-fetch transcript should exhaust the budget');
    if (tight.run.abstention !== 'budget-exhausted') {
      failures.push(`at maxSteps=12 expected budget-exhausted, got "${tight.run.abstention}"`);
    }

    // Raised ceiling: the extra steps are spent and the record lands.
    const roomy = await execute(context, F.offlineFixtures(DATE), thirteenFetchesThenEmit, 16);
    if (isAbstention(roomy.run.result)) {
      failures.push(`at maxSteps=16 the record should be emitted, got abstention: ${roomy.run.result.reason}`);
    }
    if (roomy.run.steps !== 14) failures.push(`expected the emit on step 14, got step ${roomy.run.steps}`);
    if (roomy.run.cost.calls !== 14) failures.push(`expected 14 model calls at maxSteps=16, got ${roomy.run.cost.calls}`);

    return { run: roomy.run, failures };
  },
};

/**
 * 7. A linked PDF is fetched, its income table read as a table, and a rule is
 *    emitted whose provenance URL is the PDF's own URL -- not the page that
 *    linked to it. (#77: school-meals-wi abstained because the numeric
 *    thresholds lived only in a PDF it could not read.)
 */
const schoolMealsPdf: OfflineScenario = {
  name: 'pdf: linked income-table PDF is fetched, quoted, and cited by its OWN url (not the linking page)',
  async run() {
    const context = ctx({
      programId: 'school-meals-wi',
      sourceUrl: F.SCHOOL_MEALS_SOURCE_URL,
      sourceName: 'Wisconsin DPI — free and reduced-price school meals',
    });
    const eligibility = {
      kind: 'allOf',
      of: [
        income('fpl', 185),
        {
          kind: 'manualReview',
          note:
            'Two benefit tiers: free meals at or below 130% FPL, reduced-price at or below 185% FPL. ' +
            'The rule encodes the outer (185%) bound; the free/reduced split is a benefit-level review.',
        },
      ],
    };
    const script: ScriptedTurn[] = [
      { toolCalls: [{ name: 'fetch_page', input: { url: F.SCHOOL_MEALS_SOURCE_URL } }] },
      { toolCalls: [{ name: 'fetch_page', input: { url: F.SCHOOL_MEALS_PDF_URL } }] },
      {
        toolCalls: [
          {
            name: 'emit_record',
            input: {
              eligibility,
              name: 'Free and reduced-price school meals',
              provenance: [
                {
                  quote:
                    'multiplying the year 2025 Federal income poverty guidelines by 1.30 and 1.85, respectively',
                  url: F.SCHOOL_MEALS_PDF_URL,
                },
                {
                  quote: 'Income Eligibility Guidelines to be effective from July 1, 2025 through June 30, 2026',
                  url: F.SCHOOL_MEALS_PDF_URL,
                },
              ],
              notes: 'Dollar amounts by household size are in the fetched PDF table.',
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
      if (run.record.provenance.length !== 2) failures.push(`expected 2 verified spans, got ${run.record.provenance.length}`);
      if (run.record.provenance.some((s) => s.url !== F.SCHOOL_MEALS_PDF_URL)) {
        failures.push(`a provenance span was attributed to something other than the PDF url: ${run.record.provenance.map((s) => s.url).join(', ')}`);
      }
      if (run.record.provenance.some((s) => s.urlCorrected)) {
        failures.push('the matcher had to correct a provenance url -- the model should have cited the PDF directly');
      }
    }
    if (!run.pagesVisited.includes(F.SCHOOL_MEALS_PDF_URL)) failures.push('the PDF url is not in pagesVisited');
    if (run.pagesVisited.includes(F.SCHOOL_MEALS_SOURCE_URL) === false) failures.push('the landing page is not in pagesVisited');
    if (!calls.some((c) => c.url === F.SCHOOL_MEALS_PDF_URL)) failures.push('the PDF was never fetched');
    if (!run.trace.some((t) => t.includes('.pdf'))) failures.push('trace does not show the PDF fetch');
    return { run, failures };
  },
};

/**
 * 8. A dead PDF link abstains cleanly -- no crash, no record. school-meals-wi's
 *    "Nutshell" PDF 404s today; that must stay an honest abstention.
 */
const deadPdfAbstains: OfflineScenario = {
  name: 'pdf: a dead PDF link (404) abstains cleanly rather than erroring',
  async run() {
    const context = ctx({
      programId: 'school-meals-wi',
      sourceUrl: F.SCHOOL_MEALS_SOURCE_URL,
      sourceName: 'Wisconsin DPI — free and reduced-price school meals',
    });
    const script: ScriptedTurn[] = [
      { toolCalls: [{ name: 'fetch_page', input: { url: F.SCHOOL_MEALS_SOURCE_URL } }] },
      { toolCalls: [{ name: 'fetch_page', input: { url: F.SCHOOL_MEALS_DEAD_PDF_URL } }] },
      {
        toolCalls: [
          {
            name: 'abstain',
            input: { reason: 'the linked Nutshell PDF with the dollar thresholds 404s and could not be recovered' },
          },
        ],
      },
    ];
    const { run } = await execute(context, F.offlineFixtures(DATE), script);
    const failures: string[] = [];
    if (!isAbstention(run.result)) failures.push('expected an abstention when the linked PDF is dead');
    if (run.record) failures.push('a record was emitted despite the source PDF being unreachable');
    if (!run.trace.some((t) => /nutshell|\.pdf/i.test(t) && /gone|unreachable/i.test(t))) {
      failures.push(`trace does not record the dead-PDF fetch: ${run.trace.join(' | ')}`);
    }
    return { run, failures };
  },
};

/**
 * 9. #75 -- the last retrieval gap. `foodshare-snap-wi` (#72's one unsolved
 *    case) abstained because it could not reach the page stating FoodShare's
 *    size-tiered income limits. That page (`/foodshare/fpl.htm`) is linked from
 *    the entry page only in the sidebar <nav>, which the structure renderer
 *    drops -- so the model never sees the URL -- and the site's paginated
 *    sitemap 403s. search_web (site-scoped, crawls the site's links) finds it;
 *    the model fetches it and emits a 200%-FPL rule quoted verbatim from it.
 *
 *    Before this change search_web returned guidance text only and this exact
 *    transcript ended in an abstention.
 */
const foodshareSiteSearch: OfflineScenario = {
  name: 'search: foodshare income-limits page unreachable from the entry page is found by site-scoped search',
  async run() {
    const context = ctx({
      programId: 'foodshare-snap-wi',
      sourceUrl: F.FOODSHARE_INDEX_URL,
      sourceName: 'Wisconsin DHS — FoodShare',
    });
    const eligibility = {
      kind: 'allOf',
      of: [cmp('state', 'WI'), income('fpl', 200)],
    };
    const script: ScriptedTurn[] = [
      { toolCalls: [{ name: 'fetch_page', input: { url: F.FOODSHARE_INDEX_URL } }] },
      { toolCalls: [{ name: 'search_web', input: { query: 'FoodShare monthly income limits household size gross income' } }] },
      { toolCalls: [{ name: 'fetch_page', input: { url: F.FOODSHARE_FPL_URL } }] },
      {
        toolCalls: [
          {
            name: 'emit_record',
            input: {
              eligibility,
              name: 'FoodShare Wisconsin (SNAP)',
              provenance: [
                { quote: 'at or below 200% of the federal poverty level', url: F.FOODSHARE_FPL_URL },
                { quote: 'Effective October 1, 2025, through September 30, 2026', url: F.FOODSHARE_FPL_URL },
              ],
              notes: 'Wisconsin BBCE gross-income limit is 200% FPL; the dollar table by household size is on the fetched page.',
            },
          },
        ],
      },
    ];
    const { run, calls } = await execute(context, F.offlineFixtures(DATE), script, 12);
    const failures: string[] = [];

    if (isAbstention(run.result)) failures.push(`expected a record, got abstention: ${run.result.reason}`);
    if (!run.record) failures.push('no ExtractedRecord attached');
    else {
      if (run.record.provenance.length !== 2) failures.push(`expected 2 verified spans, got ${run.record.provenance.length}`);
      if (run.record.provenance.some((s) => s.url !== F.FOODSHARE_FPL_URL)) {
        failures.push(`a span resolved to a URL other than the income-limits page: ${run.record.provenance.map((s) => s.url).join(', ')}`);
      }
    }
    if (!run.pagesVisited.includes(F.FOODSHARE_FPL_URL)) failures.push('the income-limits page is not in pagesVisited');

    // The URL was NOT visible to the model on the entry page -- it came from search.
    if (renderStructured(F.FOODSHARE_INDEX_HTML).includes('/foodshare/fpl.htm')) {
      failures.push('fixture invalid: the entry page render leaks the fpl.htm URL, so search is not what found it');
    }
    const searchLine = run.trace.find((t) => t.startsWith('search_web'));
    if (!searchLine) failures.push('trace does not record a search_web call');
    else if (!/-> [1-9]\d* hit/.test(searchLine)) failures.push(`search_web returned no hits: ${searchLine}`);

    // The sitemap path was exercised and degraded to a link crawl (Akamai 403s
    // the paginated children).
    if (!calls.some((c) => c.url === F.DHS_SITEMAP_URL)) failures.push('the sitemap index was never fetched');
    if (!calls.some((c) => /sitemap\.xml\?page=/.test(c.url))) failures.push('the crawler did not try the child sitemaps');
    if (!calls.some((c) => c.url === F.DHS_ROBOTS_URL)) failures.push('robots.txt was never consulted for sitemap discovery');

    return { run, failures };
  },
};

export const OFFLINE_SCENARIOS: readonly OfflineScenario[] = [
  badgercare,
  snapCrossRef,
  fabricatedQuoteRejected,
  stepBudget,
  reservedFactRejected,
  raisedBudgetHonored,
  schoolMealsPdf,
  deadPdfAbstains,
  foodshareSiteSearch,
];
