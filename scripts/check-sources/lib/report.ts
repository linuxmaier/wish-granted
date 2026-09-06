/**
 * Render the run's outcomes as Markdown, for a scheduled workflow to use as a
 * PR body (issue #15's pattern). "Changes open a tracked item; unchanged
 * records are silent" (#7) -- so `hasActionableFindings()` decides whether the
 * workflow opens anything at all.
 */
import { ESCALATE_AFTER_FAILURES, isEscalated, type CheckResult } from './check.ts';
import { isWeakRegion } from './normalize.ts';

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

/**
 * What opens a PR: a changed page, a 404, or an `unreachable` that has failed
 * `ESCALATE_AFTER_FAILURES` runs running. A first-time `unreachable` is recorded
 * (its counter) but is NOT actionable -- almost always a blip (issue #49).
 * new / unchanged are never actionable.
 */
export function hasActionableFindings(results: readonly CheckResult[]): boolean {
  return results.some(isEscalated);
}

/**
 * True when the only thing a run would write to source-hashes.json is a
 * first-time `unreachable`'s failure counter: every result is either `unchanged`
 * or a not-yet-escalated `unreachable`, and at least one of the latter. The
 * workflow commits this straight to `main` as bookkeeping instead of opening a
 * PR. A `new` baseline or any actionable finding takes the PR path as before.
 */
export function isBookkeepingOnly(results: readonly CheckResult[]): boolean {
  const hasTransient = results.some((r) => r.status === 'unreachable' && !isEscalated(r));
  const allBenign = results.every(
    (r) => r.status === 'unchanged' || (r.status === 'unreachable' && !isEscalated(r)),
  );
  return hasTransient && allBenign;
}

export function renderReport(input: ReportInput): string {
  const { results, stale, staleDays, generatedAt, wrote, branchBlocked } = input;
  const by = (s: CheckResult['status']) => results.filter((r) => r.status === s);
  const changed = by('changed');
  const gone = by('gone');
  const unreachableEscalated = by('unreachable').filter(isEscalated);
  const unreachableTransient = by('unreachable').filter((r) => !isEscalated(r));
  const fresh = by('new');
  const unchanged = by('unchanged');
  const weakFallback = results.filter(
    (r) => r.contentRegion !== undefined && isWeakRegion(r.contentRegion) && (r.entry.normalizedChars ?? 0) > 0,
  );

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

  if (unreachableEscalated.length > 0) {
    lines.push(`## Unreachable (${unreachableEscalated.length}) -- failed ${ESCALATE_AFTER_FAILURES}+ runs running`);
    lines.push('');
    lines.push(
      'Timeout, 403, 5xx, or a network error, on this source for at least ' +
        `${ESCALATE_AFTER_FAILURES} consecutive runs -- past the point where "probably a blip" holds. ` +
        'The baseline hash is kept as-is; open the URL by hand. If the page is genuinely gone, treat it ' +
        'as "gone" and hunt for the new URL; if it is a persistent 403/blocklist, that is its own fix.',
    );
    lines.push('');
    for (const r of unreachableEscalated) lines.push(`- **${r.id}** -- ${r.detail}\n  ${r.url}`);
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

  if (weakFallback.length > 0) {
    lines.push(`## Weak content-region fallback (${weakFallback.length})`);
    lines.push('');
    lines.push(
      'These pages have no `<main>`, `[role="main"]`, or `#content` / `#main` landmark, so ' +
        'normalization fell back to `<body>` -- which drags nav, header, and footer into the hashed ' +
        'text. A site-wide template change (a new menu item) can flag every one of these at once ' +
        'without the eligibility rule moving. Not an error, but a weaker signal: if one of these ' +
        'shows up as `changed`, check the diff for chrome before treating it as a real edit. Worth a ' +
        'hand-picked selector if it churns (issue #49).',
    );
    lines.push('');
    for (const r of weakFallback) {
      lines.push(`- **${r.id}** -- fell back to \`<${r.contentRegion}>\`\n  ${r.url}`);
    }
    lines.push('');
  }

  lines.push('## No action needed');
  lines.push('');
  lines.push(`- ${unchanged.length} unchanged`);
  if (fresh.length > 0) {
    lines.push(`- ${fresh.length} new baseline${fresh.length === 1 ? '' : 's'} recorded: ${fresh.map((r) => r.id).join(', ')}`);
  }
  if (unreachableTransient.length > 0) {
    lines.push(
      `- ${unreachableTransient.length} unreachable for the first time (recorded, not escalated): ` +
        `${unreachableTransient.map((r) => r.id).join(', ')}. ` +
        `Failure #${ESCALATE_AFTER_FAILURES} in a row opens a PR; a successful fetch resets the count.`,
    );
  }
  lines.push('');
  if (wrote && isBookkeepingOnly(results)) {
    lines.push(
      '_source-hashes.json changed, but the only change is a transient-failure counter -- no page ' +
        'moved and nothing 404\'d. The workflow commits this to `main` as bookkeeping and opens no PR._',
    );
  } else if (wrote) {
    lines.push('_source-hashes.json was updated. Review its diff alongside this report._');
  } else {
    lines.push('_source-hashes.json was not written (dry run or nothing to record)._');
  }
  lines.push('');

  return lines.join('\n');
}
