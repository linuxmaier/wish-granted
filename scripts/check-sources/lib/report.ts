/**
 * Render the run's outcomes as Markdown, for a scheduled workflow to use as a
 * PR body (issue #15's pattern). "Changes open a tracked item; unchanged
 * records are silent" (#7) -- so `hasActionableFindings()` decides whether the
 * workflow opens anything at all.
 */
import type { CheckResult } from './check.ts';

export interface StaleEntry {
  readonly id: string;
  readonly lastVerified: string | null;
}

export interface ReportInput {
  readonly results: readonly CheckResult[];
  readonly stale: readonly StaleEntry[];
  readonly staleDays: number;
  readonly generatedAt: string;
  readonly wrote: boolean;
  readonly branchBlocked: string | null;
}

/** Changed / gone / unreachable are worth a human's attention. new / unchanged are not. */
export function hasActionableFindings(results: readonly CheckResult[]): boolean {
  return results.some((r) => r.status === 'changed' || r.status === 'gone' || r.status === 'unreachable');
}

export function renderReport(input: ReportInput): string {
  const { results, stale, staleDays, generatedAt, wrote, branchBlocked } = input;
  const by = (s: CheckResult['status']) => results.filter((r) => r.status === s);
  const changed = by('changed');
  const gone = by('gone');
  const unreachable = by('unreachable');
  const fresh = by('new');
  const unchanged = by('unchanged');

  const lines: string[] = [];
  lines.push('# Source change detection');
  lines.push('');
  lines.push(`Generated ${generatedAt}. Checked ${results.length} program source pages.`);
  lines.push('');

  if (branchBlocked) {
    lines.push(`## Refusing to write source-hashes.json on \`${branchBlocked}\``);
    lines.push('');
    lines.push(
      'This job never advances the committed baseline directly on a default branch -- a ' +
        'human reviews the diff first, same rule as scripts/refresh-income-tables. Re-run on a ' +
        'branch, or pass `--dry-run`.',
    );
    lines.push('');
  }

  if (changed.length > 0) {
    lines.push(`## Changed (${changed.length}) -- re-verify against the source`);
    lines.push('');
    lines.push(
      "The normalized page text moved since the baseline. This is not proof the *eligibility rule* " +
        'changed -- it could be new prose, a reworded section, a new caveat. Follow the ' +
        're-verification loop in docs/data-authoring.md: open the URL, re-check the record, and ' +
        'either set a fresh `lastVerified` or land the correction.',
    );
    lines.push('');
    for (const r of changed) lines.push(`- **${r.id}** -- ${r.detail}\n  ${r.url}`);
    lines.push('');
  }

  if (gone.length > 0) {
    lines.push(`## Gone (${gone.length}) -- the page 404'd`);
    lines.push('');
    lines.push(
      'A removed page is a different problem from an edited one (see docs/data-authoring.md, ' +
        '"Moved vs. never correct"). Find the current official page, fix `source.url` in the ' +
        'record *and* in source-hashes.json, then re-verify.',
    );
    lines.push('');
    for (const r of gone) lines.push(`- **${r.id}** -- ${r.detail}\n  ${r.url}`);
    lines.push('');
  }

  if (unreachable.length > 0) {
    lines.push(`## Unreachable (${unreachable.length}) -- could not fetch`);
    lines.push('');
    lines.push(
      'Timeout, 403, 5xx, or a network error. Often transient. The baseline hash is kept as-is; ' +
        'if this persists across runs, treat it as "gone" and hunt for the new URL.',
    );
    lines.push('');
    for (const r of unreachable) lines.push(`- **${r.id}** -- ${r.detail}\n  ${r.url}`);
    lines.push('');
  }

  lines.push(`## Stale by time -- \`stalePrograms(${staleDays})\` (${stale.length})`);
  lines.push('');
  lines.push(
    'Independent of page changes: records not verified within the window. Curation debt is ' +
      'invisible unless something surfaces it.',
  );
  lines.push('');
  if (stale.length === 0) {
    lines.push('_None._');
  } else {
    for (const s of stale) {
      lines.push(`- **${s.id}** -- last verified ${s.lastVerified ?? 'never'}`);
    }
  }
  lines.push('');

  lines.push('## No action needed');
  lines.push('');
  lines.push(`- ${unchanged.length} unchanged`);
  if (fresh.length > 0) {
    lines.push(`- ${fresh.length} new baseline${fresh.length === 1 ? '' : 's'} recorded: ${fresh.map((r) => r.id).join(', ')}`);
  }
  lines.push('');
  lines.push(
    wrote
      ? '_source-hashes.json was updated. Review its diff alongside this report._'
      : '_source-hashes.json was not written (dry run or nothing to record)._',
  );
  lines.push('');

  return lines.join('\n');
}
