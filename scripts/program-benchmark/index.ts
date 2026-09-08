// No shebang -- run as `node <path>` via an npm script; Vite does not strip a
// `#!` line when a test imports a sibling module. Same note as the other scripts.
/**
 * Program-level extraction benchmark (issue #66, foundational for epic #65).
 *
 * The unit of work is a PROGRAM, not a pre-cut excerpt: given a source URL,
 * produce a `Program` record or abstain. Ground truth is the 16 hand-verified
 * records in src/data/programs/ (#2, #40). The retired 27-case excerpt set
 * (scripts/llm-extraction/eval-cases.ts) stays in the tree as a narrow-skill
 * regression check -- see docs/eligibility-extraction.md Section 4.3 and #65 for
 * why it was demoted.
 *
 * This entrypoint does NOT call a model. It:
 *   - enumerates the verified records as cases,
 *   - runs a supplied `Extractor` over them (default: `not-wired`),
 *   - scores six dimensions SEPARATELY -- eligibility correctness, over-claim,
 *     under-claim, correct abstention, descriptive accuracy, coverage+yield --
 *     never blended,
 *   - reports SKIPPED per case when no ANTHROPIC_API_KEY is present, never a
 *     fabricated result.
 *
 * Live runs against a real model are performed separately by the coordinator.
 * The scoring is what #66 is about; it is unit-tested offline in
 * scripts/program-benchmark/lib/__tests__/ against hand-written fixture pairs.
 *
 * Usage:
 *   npm run eval:program-extraction                          # default extractor: not-wired
 *   npm run eval:program-extraction -- --extractor=abstain-all
 *   npm run eval:program-extraction -- --extractor=verified-echo   # scorer identity check
 *   npm run eval:program-extraction -- --report-file=out.txt
 *   npm run eval:program-extraction -- --self-test           # load graph, run scorer offline, exit 0
 *
 * Exit codes: 0 normal / SKIPPED / nothing-wired; 1 a live run hit a blocking
 * condition (over-claim, under-claim, or degenerate yield) or the self-test
 * failed.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';

import { PROGRAMS } from '@/data/programs';
import type { Program } from '@/domain/program';
import {
  abstainAllExtractor,
  notWiredExtractor,
  verifiedEchoExtractor,
  DIAGNOSTIC_EXTRACTORS,
  type DiagnosticExtractorName,
  type Extractor,
} from './lib/extractor.ts';
import { partitionPrograms, isVerified } from './lib/cases.ts';
import { runBenchmark } from './lib/run.ts';
import { renderReport } from './lib/report.ts';
import { scoreCase } from './lib/score.ts';
import { criterionEquivalence } from './lib/criterion-equivalence.ts';
import { normalizeCriterion } from './lib/criterion-normalize.ts';
import { dangerousWrongness } from './lib/dangerous.ts';
import { scoreAbstention } from './lib/abstention.ts';

interface Args {
  extractor: DiagnosticExtractorName;
  reportFile: string | undefined;
}

function parseArgs(argv: readonly string[]): Args {
  let extractor: DiagnosticExtractorName = 'not-wired';
  let reportFile: string | undefined;
  for (const arg of argv) {
    if (arg === '--self-test') continue;
    if (arg.startsWith('--extractor=')) {
      const value = arg.slice('--extractor='.length);
      if (!(DIAGNOSTIC_EXTRACTORS as readonly string[]).includes(value)) {
        throw new Error(`--extractor must be one of: ${DIAGNOSTIC_EXTRACTORS.join(', ')} (got "${value}")`);
      }
      extractor = value as DiagnosticExtractorName;
    } else if (arg.startsWith('--report-file=')) {
      reportFile = arg.slice('--report-file='.length);
    } else {
      throw new Error(`Unrecognized argument: ${arg}`);
    }
  }
  return { extractor, reportFile };
}

function resolveExtractor(name: DiagnosticExtractorName, programs: readonly Program[]): { extractor: Extractor; label: string } {
  switch (name) {
    case 'not-wired':
      return { extractor: notWiredExtractor, label: 'not-wired (default -- no real pipeline yet; #67 / #68)' };
    case 'abstain-all':
      return { extractor: abstainAllExtractor, label: 'abstain-all (diagnostic baseline: abstains on everything)' };
    case 'verified-echo':
      return {
        extractor: verifiedEchoExtractor(programs),
        label: 'verified-echo (DIAGNOSTIC: echoes ground truth; checks the scorer, not any model)',
      };
  }
}

async function runMain(args: Args): Promise<number> {
  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const { extractor, label } = resolveExtractor(args.extractor, PROGRAMS);

  const run = await runBenchmark({ extractor, programs: PROGRAMS, hasApiKey, extractorLabel: label });
  const report = renderReport(run);

  console.log(report.text);
  if (args.reportFile) writeFileSync(args.reportFile, report.text, 'utf8');

  return report.blocking ? 1 : 0;
}

/**
 * Offline proof the harness works (issue #55 pattern). Evaluates the whole
 * module graph via the resolve hook, then EXERCISES THE SCORER against real
 * data with the two diagnostic extractors -- no network, no model.
 */
async function selfTest(): Promise<number> {
  parseArgs(['--extractor=abstain-all']);

  if (!Array.isArray(PROGRAMS) || PROGRAMS.length === 0) {
    throw new Error('self-test: PROGRAMS did not load as a non-empty array');
  }

  // --- partition is correct and driven by lastVerified, not a hard-coded list.
  const partition = partitionPrograms(PROGRAMS);
  const dane = PROGRAMS.find((p) => p.id === 'dane-eviction-prevention');
  if (!dane) throw new Error('self-test: expected a dane-eviction-prevention record');
  if (isVerified(dane)) {
    // #45 resolved -- fine, but then it must be in `scored`, not abstention-only.
    if (!partition.scored.some((c) => c.programId === 'dane-eviction-prevention')) {
      throw new Error('self-test: dane-eviction-prevention is now verified but not in the scored set');
    }
  } else {
    if (partition.scored.some((c) => c.programId === 'dane-eviction-prevention')) {
      throw new Error('self-test: unverified dane-eviction-prevention leaked into the scored set (denominator inflation)');
    }
    if (!partition.abstentionOnly.some((c) => c.programId === 'dane-eviction-prevention')) {
      throw new Error('self-test: dane-eviction-prevention should be an abstention-only case');
    }
  }
  for (const p of PROGRAMS) {
    if (isVerified(p) && !partition.scored.some((c) => c.programId === p.id)) {
      throw new Error(`self-test: verified record ${p.id} missing from the scored set`);
    }
  }

  // --- the scorer's identity property: echoing ground truth is a perfect run.
  const echo = await runBenchmark({
    extractor: verifiedEchoExtractor(PROGRAMS),
    programs: PROGRAMS,
    hasApiKey: false,
    extractorLabel: 'self-test verified-echo',
  });
  for (const s of echo.scores) {
    if (s.kind === 'abstention-only') continue;
    if (s.outcome !== 'scored') throw new Error(`self-test: verified-echo produced outcome=${s.outcome} for ${s.programId}`);
    if (s.eligibility !== 'equivalent') {
      throw new Error(`self-test: verified-echo not equivalent for ${s.programId}: ${s.eligibilityDetail ?? ''}`);
    }
    if (s.dangerous.length > 0) throw new Error(`self-test: verified-echo flagged dangerous for ${s.programId}`);
    if (!s.coverage) throw new Error(`self-test: verified-echo missed coverage for ${s.programId}`);
    for (const d of s.descriptive) {
      if (d.verdict === 'miss') {
        throw new Error(`self-test: verified-echo descriptive miss on ${s.programId}.${d.field}: ${d.detail}`);
      }
    }
  }

  // --- abstain-all: no harm findings in either direction, always covered...
  const abstain = await runBenchmark({
    extractor: abstainAllExtractor,
    programs: PROGRAMS,
    hasApiKey: false,
    extractorLabel: 'self-test abstain-all',
  });
  for (const s of abstain.scores) {
    if (s.dangerous.length > 0) throw new Error(`self-test: abstain-all flagged under-claim for ${s.programId}`);
    if (s.overClaim.length > 0) throw new Error(`self-test: abstain-all flagged over-claim for ${s.programId}`);
    if (!s.coverage) throw new Error(`self-test: abstain-all missed coverage for ${s.programId}`);
  }

  // ...and is BLOCKED anyway, on a live run, by the yield guard.
  const abstainLive = await runBenchmark({
    extractor: abstainAllExtractor,
    programs: PROGRAMS,
    hasApiKey: true,
    extractorLabel: 'self-test abstain-all (live)',
  });
  const abstainReport = renderReport(abstainLive);
  if (!abstainReport.blocking || !abstainReport.blockingReasons.some((r) => r.includes('DEGENERATE YIELD'))) {
    throw new Error('self-test: abstain-all on a live run must be BLOCKED by the yield guard');
  }

  // --- renderReport handles the all-skipped case honestly.
  const skipped = await runBenchmark({
    extractor: notWiredExtractor,
    programs: PROGRAMS,
    hasApiKey: false,
    extractorLabel: 'self-test not-wired',
  });
  const rendered = renderReport(skipped);
  if (!rendered.nothingMeasured || rendered.blocking) {
    throw new Error('self-test: an all-SKIPPED run should measure nothing and never block');
  }
  if (!/SKIPPED/.test(rendered.text)) throw new Error('self-test: SKIPPED run did not say SKIPPED');

  // --- lib surface intact.
  for (const [name, fn] of Object.entries({
    partitionPrograms,
    runBenchmark,
    renderReport,
    scoreCase,
    criterionEquivalence,
    normalizeCriterion,
    dangerousWrongness,
    scoreAbstention,
  })) {
    if (typeof fn !== 'function') throw new Error(`self-test: lib export ${name} is not callable`);
  }

  console.log(
    `program-benchmark self-test OK: module graph loaded (${PROGRAMS.length} programs via the @/ resolve + JSON load hook), ` +
      `${partition.scored.length} scored / ${partition.abstentionOnly.length} abstention-only / ${partition.excluded.length} excluded, ` +
      `verified-echo is a perfect run, abstain-all produces no harm findings but is BLOCKED by the yield guard, ` +
      `all-SKIPPED measures nothing. No network, no model.`,
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
      // Set exitCode and let the loop drain rather than process.exit() -- the
      // resolve hook runs on a worker thread and a hard exit mid-teardown trips
      // a libuv assertion on Windows (same note as the sibling scripts).
      process.exitCode = code;
    })
    .catch((err) => {
      console.error('program-benchmark crashed:', err);
      process.exitCode = 1;
    });
}
