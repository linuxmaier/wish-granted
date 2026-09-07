// No shebang -- run as `node --import ./scripts/agentic-extract/register.mjs <path>`
// via an npm script (same note as the sibling scripts).
/**
 * Agentic extraction with real source access (issue #67, part of epic #65).
 *
 * The extractor here does NOT receive a pre-cut excerpt. Given a source URL it
 * fetches and navigates the page itself, preserves table/section structure,
 * resolves eCFR cross-references via the versioner API, assembles across
 * multiple pages, and emits a `Program` eligibility rule with mandatory
 * verbatim provenance -- or abstains. It plugs into #66's benchmark as an
 * `Extractor` implementation.
 *
 * THIS ENTRYPOINT DOES NOT CALL A MODEL. Live measurement against a real model
 * is a marginal cost run separately by the coordinator (#67's cost note). With
 * no ANTHROPIC_API_KEY every case is reported SKIPPED -- never a fabricated
 * result (#63's mistake; the convention is in scripts/program-benchmark).
 *
 * Usage:
 *   npm run extract:agentic                      # over #66's cases; SKIPPED with no key
 *   npm run extract:agentic -- --report-file=out.txt
 *   npm run extract:agentic:self-test            # offline: scenarios + scorer wiring, exit 0
 *
 * Exit codes: 0 normal / SKIPPED / self-test pass; 1 self-test failure or a
 * live run that produced a dangerous finding (BLOCKING, delegated to #66's
 * report).
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';

import { PROGRAMS } from '@/data/programs';
import { runBenchmark } from '../program-benchmark/lib/run.ts';
import { renderReport } from '../program-benchmark/lib/report.ts';
import { agenticExtractor } from './extractor.ts';
import type { AgentRun } from './lib/agent.ts';
import type { ExtractionContext } from '../program-benchmark/lib/extractor.ts';
import { sumCost, type CostSummary } from './lib/cost.ts';
import { OFFLINE_SCENARIOS } from './lib/offline-scenarios.ts';

interface Args {
  readonly reportFile: string | undefined;
}

function parseArgs(argv: readonly string[]): Args {
  let reportFile: string | undefined;
  for (const arg of argv) {
    if (arg === '--self-test') continue;
    if (arg.startsWith('--report-file=')) reportFile = arg.slice('--report-file='.length);
    else throw new Error(`Unrecognized argument: ${arg}`);
  }
  return { reportFile };
}

function renderCostTable(rows: { id: string; cost: CostSummary; steps: number; pages: number }[]): string {
  if (rows.length === 0) {
    return 'Per-source cost: nothing measured (no live model call was made this run).';
  }
  const lines = ['Per-source cost (measured from each run\'s usage blocks):'];
  for (const r of rows) {
    lines.push(
      `  ${r.id.padEnd(32)} calls=${r.cost.calls} steps=${r.steps} pages=${r.pages} ` +
        `cacheHits=${r.cost.cacheHits} tok(in/cacheR/out)=${r.cost.freshInputTokens}/${r.cost.cacheReadTokens}/${r.cost.outputTokens} ` +
        `$${r.cost.usd.toFixed(5)}`,
    );
  }
  const total = sumCost(rows.map((r) => r.cost));
  lines.push(
    `  ${'TOTAL'.padEnd(32)} calls=${total.calls} cacheHits=${total.cacheHits} ` +
      `$${total.usd.toFixed(5)}  (no-caching counterfactual $${total.usdNoCaching.toFixed(5)})`,
  );
  return lines.join('\n');
}

async function runMain(args: Args): Promise<number> {
  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const costRows: { id: string; cost: CostSummary; steps: number; pages: number }[] = [];

  const extractor = agenticExtractor({
    onRun: (ctx: ExtractionContext, run: AgentRun) => {
      costRows.push({ id: ctx.programId, cost: run.cost, steps: run.steps, pages: run.pagesVisited.length });
    },
  });

  const run = await runBenchmark({
    extractor,
    programs: PROGRAMS,
    hasApiKey,
    extractorLabel: 'agentic (#67): real source access, provenance-gated',
  });
  const report = renderReport(run);

  console.log(report.text);
  console.log('');
  console.log(renderCostTable(costRows));
  if (!hasApiKey) {
    console.log('\nResult: SKIPPED (no ANTHROPIC_API_KEY). Nothing was measured. Build verified offline via --self-test.');
  }

  if (args.reportFile) {
    writeFileSync(args.reportFile, `${report.text}\n\n${renderCostTable(costRows)}\n`, 'utf8');
  }
  return report.blocking ? 1 : 0;
}

async function selfTest(): Promise<number> {
  parseArgs(['--self-test']);

  if (!Array.isArray(PROGRAMS) || PROGRAMS.length === 0) {
    throw new Error('self-test: PROGRAMS did not load as a non-empty array');
  }

  // 1. The offline scenarios: navigation, structure, cross-reference, provenance, budget.
  let scenarioFailures = 0;
  for (const scenario of OFFLINE_SCENARIOS) {
    const { failures } = await scenario.run();
    if (failures.length > 0) {
      scenarioFailures += failures.length;
      console.error(`  FAIL  ${scenario.name}`);
      for (const f of failures) console.error(`        - ${f}`);
    } else {
      console.log(`  ok    ${scenario.name}`);
    }
  }
  if (scenarioFailures > 0) throw new Error(`self-test: ${scenarioFailures} scenario assertion(s) failed`);

  // 2. The seam wiring: with no key the extractor MUST throw MissingApiKeyError
  //    so the benchmark reports SKIPPED, not a fabricated result.
  const skipped = await runBenchmark({
    extractor: agenticExtractor(),
    programs: PROGRAMS,
    hasApiKey: false,
    extractorLabel: 'self-test agentic (no key)',
  });
  const rendered = renderReport(skipped);
  if (!rendered.nothingMeasured || rendered.blocking) {
    throw new Error('self-test: an all-SKIPPED agentic run should measure nothing and never block');
  }
  if (!/SKIPPED/.test(rendered.text)) throw new Error('self-test: SKIPPED run did not say SKIPPED');
  if (skipped.scores.some((s) => s.outcome !== 'skipped-no-key')) {
    throw new Error('self-test: some case was not skipped-no-key (a result may have been fabricated)');
  }

  console.log(
    `\nagentic-extract self-test OK: ${OFFLINE_SCENARIOS.length} offline scenarios pass ` +
      `(404 recovery, table structure, eCFR versioner cross-reference with Accept-Encoding, ` +
      `verbatim provenance incl. cross-ref URL, step-budget abstention), and the #66 seam ` +
      `reports SKIPPED with no key. No network, no model.`,
  );
  return 0;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) return selfTest();
  return runMain(parseArgs(argv));
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolvePath(fileURLToPath(import.meta.url)) === resolvePath(process.argv[1]);
if (invokedDirectly) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error('agentic-extract crashed:', err);
      process.exitCode = 1;
    });
}
