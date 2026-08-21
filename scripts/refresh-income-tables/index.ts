#!/usr/bin/env node
/**
 * Deterministic refresher for src/data/reference/income-tables.ts (issue #6).
 *
 * Fetches FPL, Wisconsin 60% SMI, and Dane County AMI from their live sources, validates
 * the results, and -- only for tables that changed and passed validation -- patches
 * income-tables.ts in place, leaving the git diff as the reviewable artifact. No table is
 * ever marked `verified: true` by this script; that stays a human decision. See
 * docs/data-authoring.md, "Automated refresh", for the full contract this script honors
 * (failure-mode taxonomy, the 10% guardrail, exit codes, and what a human does with each
 * outcome).
 *
 * Usage:
 *   node scripts/refresh-income-tables/index.ts [--year=YYYY] [--dry-run] [--report-file=PATH]
 *
 *   --year=YYYY      Fetch this year for every table instead of (recorded effectiveYear + 1).
 *                     Mainly for verification runs -- e.g. --year matching the currently
 *                     recorded year should reproduce it exactly and report "no changes".
 *   --dry-run        Validate and report, but never write income-tables.ts.
 *   --report-file    Also write the Markdown report to this path (for a future CI step to
 *                     use as a PR body -- see issue #15).
 *
 * Exit codes: 0 clean run (nothing needed attention beyond what is in the report); 1 a
 * source could not be reached or parsed, or two sources disagreed, or a write was refused
 * for safety; 2 a change was found but held back by the year-over-year guardrail.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { fetchFpl } from './sources/fpl.ts';
import { fetchWiSmi } from './sources/wi-smi.ts';
import { fetchDaneAmi } from './sources/dane-ami.ts';
import { readCurrentBySizeTable, readCurrentDaneAmi } from './lib/read-current.ts';
import { applyPatch, buildProposedComment, type PatchPlan } from './lib/patch-file.ts';
import { checkGuardrail, GUARDRAIL_PERCENT } from './lib/guardrail.ts';
import type { SourceResult, BySizeTableData, DaneAmiData } from './lib/types.ts';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, '..', '..');
const TABLE_FILE = join(REPO_ROOT, 'src', 'data', 'reference', 'income-tables.ts');

interface Args {
  year: number | undefined;
  dryRun: boolean;
  reportFile: string | undefined;
}

function parseArgs(argv: readonly string[]): Args {
  let year: number | undefined;
  let dryRun = false;
  let reportFile: string | undefined;
  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('--year=')) {
      year = Number(arg.slice('--year='.length));
    } else if (arg.startsWith('--report-file=')) {
      reportFile = arg.slice('--report-file='.length);
    } else {
      throw new Error(`Unrecognized argument: ${arg}`);
    }
  }
  return { year, dryRun, reportFile };
}

type Outcome =
  | { kind: 'not-yet-published'; table: string; candidateYear: number }
  | { kind: 'failure'; table: string; status: 'fetch-failed' | 'parse-failed' | 'disagreement'; message: string }
  | {
      kind: 'guardrail';
      table: string;
      candidateYear: number;
      violations: { label: string; oldValue: number; newValue: number; percentChange: number }[];
      provenance: string[];
    }
  | { kind: 'no-change'; table: string }
  | { kind: 'applied'; table: string; diffLines: string[]; provenance: string[]; patch: PatchPlan };

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US')}`;
}

function fmtPct(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

async function processBySizeTable(
  exportName: 'FPL' | 'WI_SMI_60',
  fileText: string,
  fetcher: (year: number) => Promise<SourceResult<BySizeTableData>>,
  args: Args,
  generatedAt: string,
): Promise<Outcome> {
  const current = readCurrentBySizeTable(fileText, exportName);
  const candidateYear = args.year ?? current.effectiveYear + 1;
  const result = await fetcher(candidateYear);

  if (result.status === 'not-yet-published') return { kind: 'not-yet-published', table: exportName, candidateYear };
  if (result.status !== 'ok') return { kind: 'failure', table: exportName, status: result.status, message: result.message };

  const { data, provenance } = result;
  const changed =
    current.effectiveYear !== data.effectiveYear ||
    current.source !== data.source ||
    current.perAdditionalPerson !== data.perAdditionalPerson ||
    current.bySize.length !== data.bySize.length ||
    current.bySize.some((v, i) => v !== data.bySize[i]);

  if (!changed) return { kind: 'no-change', table: exportName };

  const oldValues = [...current.bySize, current.perAdditionalPerson];
  const newValues = [...data.bySize, data.perAdditionalPerson];
  const labelFor = (i: number) => (i < current.bySize.length ? `household size ${i + 1}` : 'perAdditionalPerson');
  const violations = checkGuardrail(labelFor, oldValues, newValues);
  if (violations.length > 0) {
    return { kind: 'guardrail', table: exportName, candidateYear, violations, provenance };
  }

  const diffLines: string[] = [];
  if (current.effectiveYear !== data.effectiveYear) diffLines.push(`effectiveYear: ${current.effectiveYear} -> ${data.effectiveYear}`);
  if (current.source !== data.source) diffLines.push(`source: ${current.source} -> ${data.source}`);
  data.bySize.forEach((v, i) => {
    const old = current.bySize[i];
    if (old !== v) diffLines.push(`bySize[size ${i + 1}]: ${old !== undefined ? fmtMoney(old) : '(new)'} -> ${fmtMoney(v)}`);
  });
  if (current.perAdditionalPerson !== data.perAdditionalPerson) {
    diffLines.push(`perAdditionalPerson: ${fmtMoney(current.perAdditionalPerson)} -> ${fmtMoney(data.perAdditionalPerson)}`);
  }

  const patch: PatchPlan = {
    exportName,
    bySize: data.bySize,
    perAdditionalPerson: data.perAdditionalPerson,
    effectiveYear: data.effectiveYear,
    source: data.source,
    proposedComment: buildProposedComment({
      generatedAt,
      summaryLines: [`Changed: ${diffLines.join('; ')}.`],
      provenance,
    }),
  };

  return { kind: 'applied', table: exportName, diffLines, provenance, patch };
}

async function processDaneAmi(fileText: string, args: Args, generatedAt: string): Promise<Outcome> {
  const exportName = 'DANE_AMI';
  const current = readCurrentDaneAmi(fileText, exportName);
  const candidateYear = args.year ?? current.effectiveYear + 1;
  const result: SourceResult<DaneAmiData> = await fetchDaneAmi(candidateYear);

  if (result.status === 'not-yet-published') return { kind: 'not-yet-published', table: exportName, candidateYear };
  if (result.status !== 'ok') return { kind: 'failure', table: exportName, status: result.status, message: result.message };

  const { data, provenance } = result;
  const changed =
    current.effectiveYear !== data.effectiveYear ||
    current.source !== data.source ||
    current.fourPersonMedian !== data.fourPersonMedian;

  if (!changed) return { kind: 'no-change', table: exportName };

  const violations = checkGuardrail(
    () => 'fourPersonMedian',
    [current.fourPersonMedian],
    [data.fourPersonMedian],
  );
  if (violations.length > 0) {
    return { kind: 'guardrail', table: exportName, candidateYear, violations, provenance };
  }

  const diffLines: string[] = [];
  if (current.effectiveYear !== data.effectiveYear) diffLines.push(`effectiveYear: ${current.effectiveYear} -> ${data.effectiveYear}`);
  if (current.source !== data.source) diffLines.push(`source: ${current.source} -> ${data.source}`);
  if (current.fourPersonMedian !== data.fourPersonMedian) {
    diffLines.push(`fourPersonMedian: ${fmtMoney(current.fourPersonMedian)} -> ${fmtMoney(data.fourPersonMedian)}`);
  }

  const patch: PatchPlan = {
    exportName,
    fourPersonMedian: data.fourPersonMedian,
    effectiveYear: data.effectiveYear,
    source: data.source,
    proposedComment: buildProposedComment({
      generatedAt,
      summaryLines: [`Changed: ${diffLines.join('; ')}.`],
      provenance,
    }),
  };

  return { kind: 'applied', table: exportName, diffLines, provenance, patch };
}

function currentBranch(): string {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf-8' }).trim();
  } catch {
    return '(unknown)';
  }
}

function renderReport(
  outcomes: readonly Outcome[],
  generatedAt: string,
  branchBlocked: string | null,
  dryRun: boolean,
): string {
  const applied = outcomes.filter((o): o is Extract<Outcome, { kind: 'applied' }> => o.kind === 'applied');
  const guardrail = outcomes.filter((o): o is Extract<Outcome, { kind: 'guardrail' }> => o.kind === 'guardrail');
  const failures = outcomes.filter((o): o is Extract<Outcome, { kind: 'failure' }> => o.kind === 'failure');
  const quiet = outcomes.filter((o) => o.kind === 'no-change' || o.kind === 'not-yet-published');

  const lines: string[] = [];
  lines.push(`# Income table refresh report`);
  lines.push(``);
  lines.push(`Generated ${generatedAt}.`);
  lines.push(``);

  if (branchBlocked) {
    lines.push(`## BLOCKED: refusing to write`);
    lines.push(``);
    lines.push(
      `This run is on branch \`${branchBlocked}\`. This script never writes income-tables.ts directly on ` +
        `main/master -- a proposed update must land on a branch that becomes a PR, so a human reviews it before ` +
        `it ships. Re-run from a feature branch, or pass --dry-run to see what would have changed.`,
    );
    lines.push(``);
  }

  if (applied.length > 0) {
    lines.push(dryRun ? `## Would apply -- dry run, nothing written (${applied.length})` : `## Applied (${applied.length})`);
    lines.push(``);
    lines.push(
      dryRun
        ? `--dry-run was passed, so income-tables.ts was NOT written. Re-run without --dry-run to write these ` +
            `changes (with \`verified: false\` and \`lastVerified: null\` -- proposed, not confirmed).`
        : `Written to income-tables.ts with \`verified: false\` and \`lastVerified: null\` -- these figures are ` +
            `proposed, not confirmed. See "Reviewing a proposed update" in docs/data-authoring.md before merging.`,
    );
    lines.push(``);
    for (const o of applied) {
      lines.push(`### ${o.table}`);
      for (const line of o.diffLines) lines.push(`- ${line}`);
      lines.push(`- Sources:`);
      for (const p of o.provenance) lines.push(`  - ${p}`);
      lines.push(``);
    }
  }

  if (guardrail.length > 0) {
    lines.push(`## Held for review -- exceeds the ${GUARDRAIL_PERCENT}% guardrail (${guardrail.length})`);
    lines.push(``);
    lines.push(
      `Not written. A large year-over-year move can be entirely legitimate (Dane AMI moved 9.1% and WI SMI ` +
        `moved 15-20% in the #3 correction) -- this is a flag for a human to confirm against the source directly, ` +
        `not a claim that the figure is wrong.`,
    );
    lines.push(``);
    for (const o of guardrail) {
      lines.push(`### ${o.table} (candidate year ${o.candidateYear})`);
      for (const v of o.violations) {
        lines.push(`- ${v.label}: ${fmtMoney(v.oldValue)} -> ${fmtMoney(v.newValue)} (${fmtPct(v.percentChange)})`);
      }
      lines.push(`- Sources:`);
      for (const p of o.provenance) lines.push(`  - ${p}`);
      lines.push(``);
    }
  }

  if (failures.length > 0) {
    lines.push(`## Failed (${failures.length})`);
    lines.push(``);
    lines.push(`No change was made to any of these tables. Each message below names which leg failed and why.`);
    lines.push(``);
    for (const o of failures) {
      lines.push(`### ${o.table} -- ${o.status}`);
      lines.push(o.message);
      lines.push(``);
    }
  }

  if (quiet.length > 0) {
    lines.push(`## No action needed (${quiet.length})`);
    lines.push(``);
    for (const o of quiet) {
      if (o.kind === 'no-change') {
        lines.push(`- ${o.table}: fetched current year's figures again and they match what is already recorded.`);
      } else if (o.kind === 'not-yet-published') {
        lines.push(`- ${o.table}: candidate year ${o.candidateYear} is not published yet at the expected source.`);
      }
    }
    lines.push(``);
  }

  return lines.join('\n');
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();

  let fileText = readFileSync(TABLE_FILE, 'utf-8');

  const outcomes: Outcome[] = [];
  outcomes.push(await processBySizeTable('FPL', fileText, fetchFpl, args, generatedAt));
  outcomes.push(await processBySizeTable('WI_SMI_60', fileText, fetchWiSmi, args, generatedAt));
  outcomes.push(await processDaneAmi(fileText, args, generatedAt));

  const applied = outcomes.filter((o): o is Extract<Outcome, { kind: 'applied' }> => o.kind === 'applied');
  const hasFailures = outcomes.some((o) => o.kind === 'failure');
  const hasGuardrail = outcomes.some((o) => o.kind === 'guardrail');

  let branchBlocked: string | null = null;
  if (applied.length > 0 && !args.dryRun) {
    const branch = currentBranch();
    if (branch === 'main' || branch === 'master') {
      branchBlocked = branch;
    } else {
      for (const o of applied) {
        fileText = applyPatch(fileText, o.patch);
      }
      writeFileSync(TABLE_FILE, fileText, 'utf-8');
    }
  }

  const report = renderReport(outcomes, generatedAt, branchBlocked, args.dryRun);
  console.log(report);
  if (args.reportFile) {
    writeFileSync(args.reportFile, report, 'utf-8');
  }

  if (hasFailures || branchBlocked) return 1;
  if (hasGuardrail) return 2;
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('refresh-income-tables crashed:', err);
    process.exit(1);
  });
