// No shebang -- every script here is run as `node <path>` via an npm script,
// and Vite does not strip one when a test imports a sibling module. See the
// same note in scripts/refresh-income-tables/index.ts.
/**
 * Source change detection for the program dataset (issue #7).
 *
 * Fetches every program's `source.url`, reduces the page to its meaningful text
 * (scripts/check-sources/lib/normalize.ts), hashes it, and compares against the
 * committed baseline in scripts/check-sources/source-hashes.json. Also reports
 * `stalePrograms(days)` -- the time-based half of the same "is this record
 * still good?" question -- on the same run.
 *
 * Per-record outcome: new / unchanged / changed / gone / unreachable. Unchanged
 * records are silent; changed/gone/unreachable are collected into a Markdown
 * report a scheduled workflow turns into a PR (see docs/data-authoring.md,
 * "Source change detection", and .github/workflows/check-sources.yml).
 *
 * Why this cannot just diff raw bytes: docs/eligibility-extraction.md Section 5
 * measured that byte-level change on these sources is dominated by incidental
 * churn (render timestamps, CSRF tokens, rotating banners) -- three automatic
 * signals were tried there and all three rejected. normalize.ts is the answer
 * to that; tests/normalize.test.ts is where its run-to-run stability is proven.
 *
 * Usage:
 *   npm run check:sources                      # fetch all, write source-hashes.json, print report
 *   npm run check:sources -- --dry-run          # fetch and report, write nothing
 *   npm run check:sources -- --report-file=out.md
 *   npm run check:sources -- --id=foodshare-snap-wi   # just one record (repeatable)
 *   npm run check:sources -- --stale-days=180
 *
 * Exit codes: 0 clean (nothing changed, nothing unreachable); 1 a write was
 * refused for branch safety; 2 at least one record is changed / gone /
 * unreachable and a human should look.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath } from 'node:path';

import { PROGRAMS, stalePrograms } from '@/data/programs';
import { checkSource, liveFetcher, type CheckResult, type Fetcher } from './lib/check.ts';
import {
  emptyHashesFile,
  readHashesFile,
  serializeHashesFile,
  writeHashesFile,
  type HashesFile,
  type SourceHashEntry,
} from './lib/hashes-file.ts';
import { hasActionableFindings, renderReport, type StaleEntry } from './lib/report.ts';

interface Args {
  dryRun: boolean;
  reportFile: string | undefined;
  ids: string[];
  staleDays: number;
}

function parseArgs(argv: readonly string[]): Args {
  let dryRun = false;
  let reportFile: string | undefined;
  const ids: string[] = [];
  let staleDays = 180;
  for (const arg of argv) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg.startsWith('--report-file=')) reportFile = arg.slice('--report-file='.length);
    else if (arg.startsWith('--id=')) ids.push(arg.slice('--id='.length));
    else if (arg.startsWith('--stale-days=')) staleDays = Number(arg.slice('--stale-days='.length));
    else throw new Error(`Unrecognized argument: ${arg}`);
  }
  if (!Number.isFinite(staleDays) || staleDays <= 0) throw new Error('--stale-days must be a positive number');
  return { dryRun, reportFile, ids, staleDays };
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

/** Run `worker` over `items` with at most `limit` in flight -- polite to the sources. */
async function pool<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

export async function runCheck(args: Args, fetcher: Fetcher = liveFetcher): Promise<{ report: string; exitCode: number }> {
  const today = isoDate(new Date());
  const generatedAt = new Date().toISOString();

  const selected = args.ids.length > 0 ? PROGRAMS.filter((p) => args.ids.includes(p.id)) : PROGRAMS;
  if (args.ids.length > 0 && selected.length !== args.ids.length) {
    const found = new Set(selected.map((p) => p.id));
    throw new Error(`Unknown --id: ${args.ids.filter((id) => !found.has(id)).join(', ')}`);
  }

  const baseline = args.ids.length > 0 ? readHashesFile() : mergePartial(readHashesFile(), selected);

  const results: CheckResult[] = await pool(selected, 5, (program) =>
    checkSource(
      { id: program.id, url: program.source.url, previous: baseline.sources[program.id], today },
      fetcher,
    ),
  );

  // Build the next baseline: keep untouched entries, replace checked ones.
  const nextSources: Record<string, SourceHashEntry> = { ...baseline.sources };
  for (const r of results) nextSources[r.id] = r.entry;
  const nextFile: HashesFile = { ...emptyHashesFile(), sources: nextSources };

  const baselineChanged = serializeHashesFile(baseline) !== serializeHashesFile(nextFile);

  let branchBlocked: string | null = null;
  let wrote = false;
  if (baselineChanged && !args.dryRun) {
    const branch = currentBranch();
    if (branch === 'main' || branch === 'master') {
      branchBlocked = branch;
    } else {
      writeHashesFile(nextFile);
      wrote = true;
    }
  }

  const stale: StaleEntry[] = stalePrograms(args.staleDays).map((p) => ({
    id: p.id,
    lastVerified: p.source.lastVerified,
  }));

  const report = renderReport({
    results,
    stale,
    staleDays: args.staleDays,
    generatedAt,
    wrote,
    branchBlocked,
  });

  let exitCode = 0;
  if (branchBlocked) exitCode = 1;
  else if (hasActionableFindings(results)) exitCode = 2;

  return { report, exitCode };
}

/** When checking every record, drop baseline entries for ids no longer in the dataset. */
function mergePartial(file: HashesFile, selected: readonly { id: string }[]): HashesFile {
  const live = new Set(selected.map((p) => p.id));
  const sources: Record<string, SourceHashEntry> = {};
  for (const [id, entry] of Object.entries(file.sources)) {
    if (live.has(id)) sources[id] = entry;
  }
  return { ...file, sources };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const { report, exitCode } = await runCheck(args);
  console.log(report);
  if (args.reportFile) writeFileSync(args.reportFile, report, 'utf8');
  return exitCode;
}

// Only run when executed directly, not when a test imports runCheck.
const invokedDirectly =
  process.argv[1] !== undefined &&
  resolvePath(fileURLToPath(import.meta.url)) === resolvePath(process.argv[1]);
if (invokedDirectly) {
  main()
    .then((code) => {
      // Set exitCode and let the loop drain rather than process.exit(): the
      // module resolve hook (register.mjs) runs on a worker thread, and a hard
      // exit while that thread is tearing down trips a libuv assertion on
      // Windows. There is nothing keeping the loop alive here once fetches
      // settle, so this exits promptly on its own.
      process.exitCode = code;
    })
    .catch((err) => {
      console.error('check-sources crashed:', err);
      process.exitCode = 1;
    });
}
