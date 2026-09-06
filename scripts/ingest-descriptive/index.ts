// No shebang -- run as `node <path>` via an npm script; Vite does not strip a
// `#!` line when a test imports a sibling module. Same note as the other scripts.
/**
 * Descriptive-field ingestion for the program dataset (issue #14, item 3 of
 * docs/data-sources.md's "Recommended ingestion order").
 *
 * Fetches every program's `source.url` (desktop-Chrome UA, robots.txt checked
 * first), reduces the page with scripts/check-sources/lib/normalize.ts, and
 * extracts *descriptive* candidates only -- `source.url` health (ok / redirected
 * / moved / gone / unreachable / blocked), `howToApply.phone`, and `status`
 * signals. It never reads or writes an `eligibility` rule (see
 * ./eligibility-seam.ts).
 *
 * Output is a committed review queue, scripts/ingest-descriptive/proposals.json,
 * modelled on scripts/check-sources/source-hashes.json: an unchanged run
 * reproduces it byte-for-byte, so the scheduled workflow opens nothing. Each
 * entry names a proposed change and the verbatim source excerpt it came from.
 *
 * Usage:
 *   npm run ingest:descriptive                     # fetch all, write proposals.json, print report
 *   npm run ingest:descriptive -- --dry-run         # fetch and report, write nothing
 *   npm run ingest:descriptive -- --id=foodshare-snap-wi   # one record (repeatable)
 *   npm run ingest:descriptive -- --report-file=out.md
 *   npm run ingest:descriptive -- --self-test       # load everything, touch nothing, exit 0
 *
 * Exit codes: 0 clean; 1 a write was refused for branch safety; 2 there is
 * something for a human to look at (a proposal, a health issue, or a review flag).
 *
 * --self-test is the CI smoke gate (issue #55), shared in spirit with
 * check-sources's. This entrypoint has the same exposure: it reaches `PROGRAMS`
 * through register.mjs (which reuses check-sources's resolve+JSON-load hook
 * verbatim), so a `src/` change can break it while every vitest suite stays
 * green -- which is exactly what happened once and went unnoticed for weeks.
 * The mode evaluates the whole module graph and parses argv, then stops before
 * the first fetch. It is not a second test suite.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';

import { PROGRAMS } from '@/data/programs';
import { normalize } from '../check-sources/lib/normalize.ts';
import { liveFetcher, fetchDistinct, type Fetcher } from './lib/fetch.ts';
import { classify, isActionable, type RecordFinding, type RecordInput } from './lib/classify.ts';
import {
  emptyProposalsFile,
  mergeEntry,
  readProposalsFile,
  serializeProposalsFile,
  writeProposalsFile,
  type ProposalEntry,
  type ProposalsFile,
} from './lib/proposals-file.ts';
import { renderReport } from './lib/report.ts';

interface Args {
  dryRun: boolean;
  ids: string[];
  reportFile: string | undefined;
  minText: number | undefined;
}

function parseArgs(argv: readonly string[]): Args {
  let dryRun = false;
  const ids: string[] = [];
  let reportFile: string | undefined;
  let minText: number | undefined;
  for (const arg of argv) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg.startsWith('--id=')) ids.push(arg.slice('--id='.length));
    else if (arg.startsWith('--report-file=')) reportFile = arg.slice('--report-file='.length);
    else if (arg.startsWith('--min-text=')) minText = Number(arg.slice('--min-text='.length));
    else throw new Error(`Unrecognized argument: ${arg}`);
  }
  if (minText !== undefined && (!Number.isFinite(minText) || minText < 0)) {
    throw new Error('--min-text must be a non-negative number');
  }
  return { dryRun, ids, reportFile, minText };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function currentBranch(): string {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return '(unknown)';
  }
}

export interface RunResult {
  report: string;
  exitCode: number;
  nextFile: ProposalsFile;
  wrote: boolean;
}

export async function runIngest(args: Args, fetcher: Fetcher = liveFetcher): Promise<RunResult> {
  const runInstant = new Date().toISOString();
  const today = isoDate(new Date());

  const selected = args.ids.length > 0 ? PROGRAMS.filter((p) => args.ids.includes(p.id)) : PROGRAMS;
  if (args.ids.length > 0 && selected.length !== args.ids.length) {
    const found = new Set(selected.map((p) => p.id));
    throw new Error(`Unknown --id: ${args.ids.filter((id) => !found.has(id)).join(', ')}`);
  }

  const outcomes = await fetchDistinct(selected.map((p) => p.source.url), fetcher);

  const findings: RecordFinding[] = selected.map((p) => {
    const input: RecordInput = {
      id: p.id,
      sourceUrl: p.source.url,
      currentPhone: p.howToApply.phone ?? null,
      currentStatus: p.status,
    };
    const outcome = outcomes.get(p.source.url)!;
    return classify(input, outcome, { normalize, minTextForPhoneCheck: args.minText });
  });

  // Build the next queue. When checking every record, an id that is now clean
  // (or no longer in the dataset) drops out -- that is a real event (resolved).
  // When checking a subset, untouched entries are preserved.
  const previous = readProposalsFile();
  const nextRecords: Record<string, ProposalEntry> = args.ids.length > 0 ? { ...previous.records } : {};
  if (args.ids.length > 0) {
    for (const id of args.ids) delete nextRecords[id];
  }
  for (const f of findings) {
    if (!isActionable(f)) continue;
    nextRecords[f.id] = mergeEntry(f, previous.records[f.id], runInstant, today);
  }
  const nextFile: ProposalsFile = { ...emptyProposalsFile(), records: nextRecords };

  const changed = serializeProposalsFile(previous) !== serializeProposalsFile(nextFile);

  let branchBlocked: string | null = null;
  let wrote = false;
  if (changed && !args.dryRun) {
    const branch = currentBranch();
    if (branch === 'main' || branch === 'master') {
      branchBlocked = branch;
    } else {
      writeProposalsFile(nextFile);
      wrote = true;
    }
  }

  const report = renderReport({
    findings,
    generatedAt: runInstant,
    checkedCount: selected.length,
    wrote,
    dryRun: args.dryRun,
    branchBlocked,
  });

  let exitCode = 0;
  if (branchBlocked) exitCode = 1;
  else if (findings.some(isActionable)) exitCode = 2;

  return { report, exitCode, nextFile, wrote };
}

/**
 * Prove the entrypoint can start on the pinned Node with no network (issue #55):
 * force evaluation of the whole module graph -- `@/data/programs` via the hook,
 * the shared `normalize`, and this pipeline's own lib -- exercise argv parsing,
 * and return without I/O.
 */
function selfTest(): number {
  parseArgs(['--dry-run', '--min-text=400']);

  if (!Array.isArray(PROGRAMS) || PROGRAMS.length === 0) {
    throw new Error('self-test: PROGRAMS did not load as a non-empty array');
  }

  // `normalize` is imported from scripts/check-sources across a directory
  // boundary -- run it on a literal so a broken cross-import fails here, not
  // against a fetched page. Pure string transform, no I/O.
  const normalized = normalize('<main><p>hello</p></main>');
  if (typeof normalized !== 'string') throw new Error('self-test: normalize did not return a string');

  for (const [name, fn] of Object.entries({
    liveFetcher,
    fetchDistinct,
    classify,
    isActionable,
    emptyProposalsFile,
    mergeEntry,
    readProposalsFile,
    serializeProposalsFile,
    writeProposalsFile,
    renderReport,
  })) {
    if (typeof fn !== 'function') throw new Error(`self-test: lib export ${name} is not callable`);
  }

  console.log(
    `ingest-descriptive self-test OK: module graph loaded (${PROGRAMS.length} programs via the ` +
      `@/ resolve + JSON load hook, plus the shared normalizer), argv parses. No network touched.`,
  );
  return 0;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) return selfTest();
  const args = parseArgs(argv);
  const { report, exitCode } = await runIngest(args);
  console.log(report);
  if (args.reportFile) writeFileSync(args.reportFile, report, 'utf8');
  return exitCode;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolvePath(fileURLToPath(import.meta.url)) === resolvePath(process.argv[1]);
if (invokedDirectly) {
  main()
    .then((code) => {
      // Set exitCode and let the loop drain rather than process.exit() -- the
      // resolve hook runs on a worker thread and a hard exit mid-teardown trips
      // a libuv assertion on Windows (same note as scripts/check-sources).
      process.exitCode = code;
    })
    .catch((err) => {
      console.error('ingest-descriptive crashed:', err);
      process.exitCode = 1;
    });
}
