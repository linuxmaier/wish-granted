// No shebang -- run as `node --import ./scripts/triage/register.mjs <path>` via
// an npm script (same note as the sibling scripts).
/**
 * Triage (issue #68, part of epic #65): the routing step between deterministic
 * parsing and the agentic extractor.
 *
 *   source URL
 *     -> deterministic parse produced a scoped rule?      -> DETERMINISTIC (no model)
 *     -> a rule is published but not deterministically parseable? -> AGENTIC
 *     -> the source declines to state a rule (Tier 4)?     -> NO-RULE-PUBLISHED
 *                                                            (manualReview, no tokens)
 *
 * This entrypoint DOES NOT CALL A MODEL unless ANTHROPIC_API_KEY is set. The
 * routing decision is driven by the deterministic Tier-3 parser's outcome
 * (scripts/tier3-extract, zero token cost) plus a model-free signal scan
 * (lib/signals.ts). An optional live classifier (lib/classify-source.ts) is
 * consulted ONLY to second-guess a `no-rule-published` decision -- the one route
 * with a silent-loss failure mode -- and can only ever rescue a source toward
 * AGENTIC. With no key it reports SKIPPED (never a fabricated result -- #63's
 * mistake).
 *
 * Usage:
 *   npm run extract:triage                 # model-free routing distribution + SKIPPED live
 *   npm run extract:triage -- --verbose     # + per-record evidence quotes
 *   npm run extract:triage:self-test        # offline: all three routes + degenerate guard
 */
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';

import { PROGRAMS } from '@/data/programs';
import { triage } from './lib/route.ts';
import { renderRouting, type PerCaseRow } from './lib/report.ts';
import {
  TRIAGE_CORPUS,
  assertCorpusComplete,
  parserOutcomeFor,
  sourceTextFor,
} from './lib/corpus.ts';
import { reservedFactLabels } from './lib/vocabulary.ts';
import { liveSourceClassifier } from './lib/classify-source.ts';
import { MissingApiKeyError } from '../program-benchmark/lib/extractor.ts';
import { OFFLINE_SCENARIOS } from './lib/offline-scenarios.ts';

interface Args {
  readonly verbose: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  let verbose = false;
  for (const arg of argv) {
    if (arg === '--self-test') continue;
    if (arg === '--verbose') verbose = true;
    else throw new Error(`Unrecognized argument: ${arg}`);
  }
  return { verbose };
}

// --- model-free analysis (always printed) --------------------------------

function offlineRows(): PerCaseRow[] {
  const rows: PerCaseRow[] = [];
  for (const entry of TRIAGE_CORPUS) {
    if (entry.tier === 'no-offline-source') continue;
    const parser = parserOutcomeFor(entry.programId);
    const sourceText = sourceTextFor(entry.programId);
    rows.push({ programId: entry.programId, tier: entry.tier, decision: triage({ parser, sourceText }) });
  }
  return rows;
}

function renderAnalysis(verbose: boolean): string {
  const L: string[] = [];
  L.push('=================== Triage (#68) -- offline routing analysis ===================');
  L.push(`Corpus: ${PROGRAMS.length} program records.`);
  const mapped = TRIAGE_CORPUS.filter((e) => e.tier === 'tier3-mapped').length;
  const recon = TRIAGE_CORPUS.filter((e) => e.tier === 'reconstructed').length;
  const none = TRIAGE_CORPUS.filter((e) => e.tier === 'no-offline-source').length;
  L.push(
    `Offline source available: ${mapped} with a real committed Tier-3 capture, ` +
      `${recon} with a reconstructed Tier-4 fixture (see lib/__tests__/fixtures/SOURCES.md), ` +
      `${none} with neither (route predicted, not measured).`,
  );
  L.push('');
  L.push('The routing decision is model-free: the deterministic Tier-3 parser\'s outcome (zero token');
  L.push('cost) plus a regex signal scan. No ANTHROPIC_API_KEY was used to produce the table below.');
  L.push('');

  const rows = offlineRows();
  const { text } = renderRouting(rows);
  L.push(text);

  if (verbose) {
    L.push('--- Evidence per record ---');
    for (const r of rows) {
      L.push(`  ${r.programId}  ->  ${r.decision.route}`);
      L.push(`    ${r.decision.reason}`);
      for (const e of r.decision.evidence) L.push(`    [${e.kind}/${e.tag}] "${e.quote}"`);
      for (const g of r.decision.vocabularyGap) L.push(`    [vocab-gap] ${g.fact}: "${g.quote}"`);
      L.push('');
    }
  }

  L.push('--- Vocabulary gaps (candidate questions, docs/data-authoring.md) ---');
  const gaps = rows.flatMap((r) => r.decision.vocabularyGap.map((g) => ({ programId: r.programId, ...g })));
  if (gaps.length === 0) {
    L.push('  none in the offline corpus -- no source is blocked purely by a fact the interview cannot ask.');
  } else {
    for (const g of gaps) L.push(`  ${g.programId}: needs ${g.fact} -- "${g.quote}"`);
  }
  L.push(`  (reserved facts: ${reservedFactLabels().map((f) => f.fact).join(', ')} -- read from RESERVED_FACT_KEYS)`);
  L.push('');

  L.push('--- PRE-MEASUREMENT PREDICTION for the live run (stated before the coordinator runs it) ---');
  L.push('  Offline, over the 14 records with a committed or reconstructed source:');
  const s = renderRouting(rows).summary;
  L.push(`    deterministic ${s.byRoute.deterministic} / agentic ${s.byRoute.agentic} / no-rule-published ${s.byRoute['no-rule-published']}`);
  L.push('');
  L.push('  Predicted over all 17 (adding the 3 unmapped records):');
  L.push('    - madison-water-bill-assistance (MadCAP): DETERMINISTIC or AGENTIC -- the City page publishes a');
  L.push('      dollar table by household size + a categorical list; the parser may reach the categorical route.');
  L.push('    - madison-housing-choice-voucher (Section 8): AGENTIC -- an AMI-derived income-limit dollar table');
  L.push('      plus a closed-waitlist manualReview; bare dollars with no scale are not deterministically parseable.');
  L.push('    - the-river-food-pantry: NO-RULE-PUBLISHED or AGENTIC -- the pantry page is no-questions-asked;');
  L.push('      the 200% FPL grocery self-attestation is in a linked state TEFAP form, which the agentic');
  L.push('      extractor can follow but the deterministic parser and this signal scan would not see.');
  L.push('    Predicted 17-record split: deterministic ~7, agentic ~5-6, no-rule-published ~4-5 (~24-29%, in line');
  L.push('    with docs/eligibility-extraction.md Section 2\'s ~24% Tier 4).');
  L.push('');
  L.push('  Where the live run should differ from this offline table:');
  L.push('    - The 4 reconstructed fixtures are built from each record\'s source note, not a live capture. If a');
  L.push('      live page states a rule the note did not quote, that record moves no-rule-published -> agentic.');
  L.push('    - The live classifier (SKIPPED here) can only move a no-rule-published decision to agentic, never');
  L.push('      the reverse, so the live no-rule-published count can only fall relative to this table.');
  L.push('');
  return L.join('\n');
}

// --- live run (only with a key) -----------------------------------------

async function runLive(): Promise<number> {
  const classifier = liveSourceClassifier({ hasApiKey: true });
  const rows: PerCaseRow[] = [];
  for (const entry of TRIAGE_CORPUS) {
    if (entry.tier === 'no-offline-source') continue;
    const parser = parserOutcomeFor(entry.programId);
    const sourceText = sourceTextFor(entry.programId);
    // First pass, model-free.
    let decision = triage({ parser, sourceText });
    // Only the no-rule-published route consults the model (the silent-loss route).
    if (decision.route === 'no-rule-published') {
      const p = PROGRAMS.find((x) => x.id === entry.programId);
      const classification = await classifier({ sourceName: p?.source.name ?? entry.programId, sourceText });
      decision = triage({ parser, sourceText, classification });
    }
    rows.push({ programId: entry.programId, tier: entry.tier, decision });
  }
  const { text } = renderRouting(rows);
  console.log('--- Live triage run (deterministic routing + model confirmation of no-rule-published) ---');
  console.log(text);
  return 0;
}

// --- self-test ---------------------------------------------------------

async function selfTest(): Promise<number> {
  parseArgs(['--self-test']);
  parseArgs(['--self-test', '--verbose']);
  let rejected = false;
  try {
    parseArgs(['--nope']);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error('self-test: parseArgs accepted an unknown flag');

  assertCorpusComplete(PROGRAMS.map((p) => p.id));
  console.log(`  ok    corpus: all ${PROGRAMS.length} shipped programs are mapped exactly once`);

  let failures = 0;
  for (const scenario of OFFLINE_SCENARIOS) {
    const { failures: f } = await scenario.run();
    if (f.length > 0) {
      failures += f.length;
      console.error(`  FAIL  ${scenario.name}`);
      for (const line of f) console.error(`        - ${line}`);
    } else {
      console.log(`  ok    ${scenario.name}`);
    }
  }
  if (failures > 0) throw new Error(`self-test: ${failures} scenario assertion(s) failed`);

  // The live classifier must refuse to run without a key.
  let threw = false;
  try {
    await liveSourceClassifier()({ sourceName: 'x', sourceText: 'y' });
  } catch (err) {
    threw = err instanceof MissingApiKeyError;
  }
  if (!threw) throw new Error('self-test: liveSourceClassifier did not throw MissingApiKeyError without a key');

  // The offline analysis renders and does not trip the degenerate guard.
  const { summary } = renderRouting(offlineRows());
  if (summary.noRuleDegenerate || summary.singleRouteDegenerate) {
    throw new Error('self-test: the real offline corpus tripped the degenerate-outcome guard');
  }
  for (const route of ['deterministic', 'agentic', 'no-rule-published'] as const) {
    if (summary.byRoute[route] === 0) throw new Error(`self-test: offline corpus produced 0 ${route} routes`);
  }

  console.log(
    `\ntriage self-test OK: ${OFFLINE_SCENARIOS.length} offline scenarios pass ` +
      `(deterministic / agentic-rule-present / agentic-mixed / no-rule-published / classifier rescue / ` +
      `classifier cannot force no-rule / vocabulary gap / age-is-askable / degenerate guard fires / ` +
      `real corpus is not degenerate / live classifier SKIPPED without a key), the ${TRIAGE_CORPUS.length}-record ` +
      `corpus is complete, and all three routes are populated offline. No network, no model.`,
  );
  return 0;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) return selfTest();

  const args = parseArgs(argv);
  console.log(renderAnalysis(args.verbose));

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('--- Live triage run ---');
    console.log('SKIPPED: no ANTHROPIC_API_KEY. The routing table above is fully model-free; the only thing a');
    console.log('live run adds is the classifier double-checking each no-rule-published decision (it can only');
    console.log('move one to agentic). Nothing was measured against a model. Run offline verification with --self-test.');
    return 0;
  }
  return runLive();
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
      console.error('triage crashed:', err);
      process.exitCode = 1;
    });
}
