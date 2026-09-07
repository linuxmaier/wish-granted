// No shebang -- run as `node --import ./scripts/cross-check/register.mjs <path>`
// via an npm script (same note as the sibling scripts).
/**
 * Cross-method agreement (issue #84, part of epic #65).
 *
 * Four extraction designs failed because each asked the extracting model to
 * police itself. This one does not. It runs two INDEPENDENT methods against the
 * same source and cross-checks them mechanically:
 *
 *   Path A -- run the deterministic Tier-3 parser (scripts/tier3-extract, no
 *     model) and the agentic extractor (scripts/agentic-extract) on the same
 *     source. The parser emits a narrow fragment, the agentic extractor a full
 *     record, so we PROJECT both `Criterion` trees onto the dimension the parser
 *     actually constrains (lib/scoped-agreement.ts, issue #84/#85) and hand the
 *     projections to `criterionEquivalence` (scripts/program-benchmark,
 *     UNCHANGED -- it is the referee). Equivalent on that dimension -> high
 *     confidence. Divergent in the dangerous direction, either way -> route to a
 *     human.
 *
 *   Path B -- where the parser abstains and Path A has nothing to compare, a
 *     FRESH model call (no extraction memory) is asked one narrow question:
 *     "name someone the source says is eligible whom this rule would exclude."
 *     Its answer is checked mechanically against a quoted span before it can
 *     route anything.
 *
 * THIS ENTRYPOINT DOES NOT CALL A MODEL unless ANTHROPIC_API_KEY is set. With no
 * key it reports SKIPPED for the live measurement (never a fabricated result --
 * #63's mistake) and still prints the model-free analysis: the corpus overlap,
 * the deterministic parser's outcomes on every mapped source, and -- the number
 * #84 turns on -- how often the parser's fragment agrees with the verified
 * record ON THE DIMENSION THE PARSER SPEAKS TO (both projected onto the parser's
 * constrained facts before the referee runs -- issue #84/#85).
 *
 * Usage:
 *   npm run extract:cross-check                 # model-free analysis + SKIPPED live
 *   npm run extract:cross-check -- --max-steps=32
 *   npm run extract:cross-check:self-test       # offline: both paths, corpus, SKIPPED wiring
 */
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';

import { PROGRAMS } from '@/data/programs';
import { partitionPrograms } from '../program-benchmark/lib/cases.ts';
import { scopedAgreement } from './lib/scoped-agreement.ts';
import { agenticExtractor } from '../agentic-extract/extractor.ts';
import { DEFAULT_MAX_STEPS } from '../agentic-extract/lib/agent.ts';
import type { ExtractionContext } from '../program-benchmark/lib/extractor.ts';
import { MissingApiKeyError } from '../program-benchmark/lib/extractor.ts';

import { CORPUS, corpusFor, runDeterministic, fixtureSourceText, assertCorpusResolves } from './lib/corpus.ts';
import { fromAgentic, type MethodOutcome } from './lib/methods.ts';
import { crossCheck } from './lib/route.ts';
import { renderRouting, type PerCaseRow } from './lib/report.ts';
import { liveExclusionProbe } from './lib/live-probe.ts';
import { OFFLINE_SCENARIOS } from './lib/offline-scenarios.ts';

interface Args {
  readonly maxSteps: number | undefined;
}

function parseArgs(argv: readonly string[]): Args {
  let maxSteps: number | undefined;
  for (const arg of argv) {
    if (arg === '--self-test') continue;
    if (arg.startsWith('--max-steps=')) {
      const n = Number(arg.slice('--max-steps='.length));
      if (!Number.isInteger(n) || n < 1) throw new Error(`--max-steps must be a positive integer, got "${arg}"`);
      maxSteps = n;
    } else throw new Error(`Unrecognized argument: ${arg}`);
  }
  return { maxSteps };
}

// --- model-free analysis (always printed) --------------------------------

function renderCorpusAnalysis(): string {
  const L: string[] = [];
  const partition = partitionPrograms(PROGRAMS);
  const scoredIds = new Set([...partition.scored, ...partition.abstentionOnly].map((c) => c.programId));
  const byId = new Map(PROGRAMS.map((p) => [p.id, p]));

  L.push('=================== Cross-method agreement (#84) -- offline analysis ===================');
  L.push(`Corpus: ${PROGRAMS.length} program records, ${scoredIds.size} scored/abstention-only.`);
  L.push(`Tier-3 fixture available at the program's source for ${CORPUS.length} of them ` +
    `(${CORPUS.filter((e) => e.match === 'exact').length} exact URL, ${CORPUS.filter((e) => e.match === 'approximate').length} approximate).`);
  const noFixture = [...scoredIds].filter((id) => !corpusFor(id));
  L.push(`No Tier-3 fixture -> Path A cannot run: ${noFixture.length} (${noFixture.join(', ')})`);
  L.push('');

  L.push('--- What the deterministic parser produces on each mapped source, SCOPED against the VERIFIED record ---');
  L.push('    (model-free. Path A compares only the dimension the parser speaks to: both trees are');
  L.push('     projected onto the parser fragment\'s constrained facts / income scales, then the referee');
  L.push('     runs on the projections. Geography, program gates and manualReview are pruned, not');
  L.push('     counted as divergence -- see scripts/cross-check/lib/scoped-agreement.ts, issue #84/#85.)');
  let parserAbstains = 0;
  let agreeOnDimension = 0;
  let divergentOnDimension = 0;
  let dangerousOnDimension = 0;
  for (const e of CORPUS) {
    const p = byId.get(e.programId);
    if (!p) continue;
    const { outcome } = runDeterministic(e);
    if (outcome.decision === 'abstain') {
      parserAbstains += 1;
      L.push(`  ${e.programId.padEnd(28)} parser ABSTAINS -> Path B  (${outcome.reason.split(':')[0]})`);
      continue;
    }
    const scoped = scopedAgreement(outcome.criterion, p.eligibility);
    const agree = scoped.verdict === 'equivalent';
    const dangerous = scoped.verdict === 'divergent-dangerous';
    if (agree) agreeOnDimension += 1;
    else divergentOnDimension += 1;
    if (dangerous) dangerousOnDimension += 1;
    L.push(
      `  ${e.programId.padEnd(28)} parser EXTRACTS -> Path A  ` +
        `[scoped vs verified: ${agree ? 'AGREE' : scoped.verdict.toUpperCase()}]`,
    );
  }
  L.push('');
  L.push(`  parser abstains (-> Path B):                       ${parserAbstains}`);
  L.push(`  parser extracts, agrees on its dimension:          ${agreeOnDimension}`);
  L.push(`  parser extracts, diverges on its dimension:        ${divergentOnDimension}  (of which dangerous: ${dangerousOnDimension})`);
  L.push('');
  L.push('  PRE-MEASUREMENT PREDICTION for the live run (stated before the coordinator runs it):');
  L.push(`  Against the VERIFIED record as a proxy for a correct agentic extraction, ${agreeOnDimension} of the`);
  L.push(`  ${agreeOnDimension + divergentOnDimension} comparable cases agree on the parser\'s own dimension -- an ~${Math.round((100 * agreeOnDimension) / Math.max(1, agreeOnDimension + divergentOnDimension))}% scoped agreement rate,`);
  L.push('  where the OLD whole-tree comparison predicted ~1 in 6 (17%). The 1-in-6 figure was an');
  L.push('  artefact: an added `state = WI` leaf was scored as a dangerous-direction divergence on');
  L.push('  every full record. Scoped to the dimension the parser speaks to, that artefact is gone.');
  L.push('  The live agentic extractor will not match the verified record perfectly, so expect the');
  L.push('  measured rate to land somewhat below this proxy -- but the mechanical inflation is removed,');
  L.push('  and a case that still routes to a human (e.g. school-meals: parser over-lists medicaid as a');
  L.push('  direct-certification category) is a real divergence a reviewer should see, not noise.');
  L.push('');
  return L.join('\n');
}

// --- live run (only with a key) -----------------------------------------

async function runLive(args: Args): Promise<number> {
  const maxSteps = args.maxSteps ?? DEFAULT_MAX_STEPS;
  const partition = partitionPrograms(PROGRAMS);
  const cases = [...partition.scored, ...partition.abstentionOnly];
  const extractor = agenticExtractor({ maxSteps });
  const probeAsker = liveExclusionProbe({ hasApiKey: true });

  const rows: PerCaseRow[] = [];
  for (const c of cases) {
    const entry = corpusFor(c.programId);
    const deterministic: MethodOutcome = entry
      ? runDeterministic(entry).outcome
      : { decision: 'abstain', reason: 'no Tier-3 fixture for this source; the deterministic parser was not run' };

    const ctx: ExtractionContext = {
      programId: c.programId,
      sourceUrl: c.sourceUrl,
      sourceName: c.sourceName,
      hasApiKey: true,
    };
    const agentic = fromAgentic(await extractor(ctx));

    // Path B's source text: the committed fixture where we have one (same text
    // the parser read), else the record's own source name only -- a live refetch
    // is deliberately not added here (one more live dependency for marginal gain).
    const sourceText = entry ? fixtureSourceText(entry) : '';
    const decision = await crossCheck({
      deterministic,
      agentic,
      probe: sourceText
        ? { ask: probeAsker, question: { sourceName: c.sourceName, sourceText } }
        : undefined,
    });
    rows.push({ programId: c.programId, decision });
  }

  const { text } = renderRouting(rows);
  console.log(text);
  return 0;
}

// --- self-test ---------------------------------------------------------

async function selfTest(): Promise<number> {
  parseArgs(['--self-test']);
  parseArgs(['--max-steps=8']);
  let rejected = false;
  try {
    parseArgs(['--nope']);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error('self-test: parseArgs accepted an unknown flag');

  assertCorpusResolves();
  console.log(`  ok    corpus: ${CORPUS.length} Tier-3 fixtures resolve`);

  let failures = 0;
  for (const s of OFFLINE_SCENARIOS) {
    const { failures: f } = await s.run();
    if (f.length > 0) {
      failures += f.length;
      console.error(`  FAIL  ${s.name}`);
      for (const line of f) console.error(`        - ${line}`);
    } else {
      console.log(`  ok    ${s.name}`);
    }
  }
  if (failures > 0) throw new Error(`self-test: ${failures} scenario assertion(s) failed`);

  // The live probe asker must refuse to run without a key.
  const ask = liveExclusionProbe();
  let threw = false;
  try {
    await ask({ sourceName: 'x', sourceText: 'y', rule: { kind: 'always' } });
  } catch (err) {
    threw = err instanceof MissingApiKeyError;
  }
  if (!threw) throw new Error('self-test: liveExclusionProbe did not throw MissingApiKeyError without a key');

  console.log(
    `\ncross-check self-test OK: ${OFFLINE_SCENARIOS.length} offline scenarios pass ` +
      `(agreeing pair -> high confidence; dangerous divergence both directions -> human/high; ` +
      `parser abstention -> Path B; probe names a span-verified excluded person -> human/high; ` +
      `fabricated span discarded; corroborated abstention; referee-undecided -> human/low; ` +
      `no-probe -> never trusted; fragment-vs-record: an added geography envelope -> agreement; ` +
      `the foodshare shape: a dropped categorical branch -> human/high), the ${CORPUS.length}-entry ` +
      `corpus resolves, and the live probe reports SKIPPED with no key. No network, no model.`,
  );
  return 0;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) return selfTest();

  const args = parseArgs(argv);
  console.log(renderCorpusAnalysis());

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('--- Live cross-method + exclusion-probe run ---');
    console.log('SKIPPED: no ANTHROPIC_API_KEY. The agentic extractor and the exclusion probe both need');
    console.log('the model; nothing was measured. Run offline verification with --self-test.');
    return 0;
  }
  console.log('--- Live cross-method + exclusion-probe run ---');
  return runLive(args);
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
      console.error('cross-check crashed:', err);
      process.exitCode = 1;
    });
}
