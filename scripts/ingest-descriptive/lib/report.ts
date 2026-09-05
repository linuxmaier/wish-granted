/**
 * Render a run as Markdown for the scheduled workflow to use as a PR body
 * (issue #15's pattern, same as scripts/check-sources/lib/report.ts).
 *
 * The section order is deliberate and load-bearing for issue #14's acceptance:
 * descriptive proposals and eligibility are in *separate, unmistakably distinct*
 * sections, and the eligibility section says plainly that this pipeline never
 * touches an `eligibility` rule. A reviewer skimming the PR must not be able to
 * confuse "we propose changing a phone number" with "we propose changing who
 * qualifies".
 */
import type { RecordFinding, FieldProposal, ReviewFlag } from './classify.ts';

export interface ReportInput {
  readonly findings: readonly RecordFinding[];
  readonly generatedAt: string;
  readonly checkedCount: number;
  readonly wrote: boolean;
  readonly dryRun: boolean;
  readonly branchBlocked: string | null;
}

function proposalLines(id: string, p: FieldProposal): string[] {
  return [
    `- **${id}** \`${p.field}\` (${p.classification}, confidence: ${p.confidence})`,
    `  - current: ${p.current === null ? '_(empty)_' : `\`${p.current}\``}`,
    `  - proposed: \`${p.proposed}\``,
    `  - source: ${p.provenance.finalUrl}`,
    `  - excerpt: > ${p.provenance.excerpt || '_(n/a)_'}`,
  ];
}

function reviewLines(id: string, r: ReviewFlag): string[] {
  const out = [`- **${id}** (${r.kind}) -- ${r.message}`];
  if (r.excerpt) out.push(`  - excerpt: > ${r.excerpt}`);
  return out;
}

export function renderReport(input: ReportInput): string {
  const { findings, generatedAt, checkedCount, wrote, dryRun, branchBlocked } = input;
  const L: string[] = [];

  const allProposals = findings.flatMap((f) => f.proposals.map((p) => ({ id: f.id, p })));
  const descriptiveReviews = findings.flatMap((f) =>
    f.reviews.filter((r) => r.kind === 'phone-missing-from-page' || r.kind === 'phone-candidates' || r.kind === 'status-signal' || r.kind === 'source-text-review').map((r) => ({ id: f.id, r })),
  );
  const health = findings.filter((f) => f.urlHealth !== 'ok');

  L.push('# Descriptive-field ingestion');
  L.push('');
  L.push(`Generated ${generatedAt}. Checked ${checkedCount} program source pages.`);
  L.push('');
  L.push(
    'Scope: **descriptive fields only** -- `source.url`, `howToApply.phone`, and `status` signals. ' +
      'This pipeline never reads or writes an `eligibility` rule (see the eligibility section below).',
  );
  L.push('');

  if (branchBlocked) {
    L.push(`## Refusing to write proposals.json on \`${branchBlocked}\``);
    L.push('');
    L.push('This job never advances the committed queue on a default branch -- a human reviews the diff first. Re-run on a branch, or pass `--dry-run`.');
    L.push('');
  }

  L.push(`## Descriptive proposals (${allProposals.length})`);
  L.push('');
  if (allProposals.length === 0) {
    L.push('_None. No descriptive field had an unambiguous, deduplicated change to propose._');
  } else {
    L.push('Each is a value a reviewer can accept as-is after checking it against the linked excerpt. Apply an accepted one in `src/data/programs/<id>.ts`, then `npm run build:snapshot`.');
    L.push('');
    for (const { id, p } of allProposals) L.push(...proposalLines(id, p));
  }
  L.push('');

  L.push(`## Link and domain health (${health.length})`);
  L.push('');
  if (health.length === 0) {
    L.push('_All source URLs resolved to their recorded address._');
  } else {
    L.push('`moved` = redirected to a different host (find the official replacement); `gone` = 404/410 (a removed page, not an edit); `redirected` = same host, new path; `unreachable`/`blocked` = not fetched.');
    L.push('');
    for (const f of health) L.push(`- **${f.id}** -- \`${f.urlHealth}\` -- ${f.detail}\n  ${f.sourceUrl}`);
  }
  L.push('');

  L.push(`## Needs human review -- descriptive (${descriptiveReviews.length})`);
  L.push('');
  if (descriptiveReviews.length === 0) {
    L.push('_None._');
  } else {
    for (const { id, r } of descriptiveReviews) L.push(...reviewLines(id, r));
  }
  L.push('');

  L.push('## Eligibility -- NOT handled by this pipeline');
  L.push('');
  L.push(
    'This pipeline does **not** read, extract, propose, or write an `eligibility` rule. ' +
      'The LLM eligibility extractor (`scripts/llm-extraction/`) is built but **deliberately not wired in**: ' +
      'its held-out eval produced a dangerous over-claim (issue #51), and unlike an earlier failure that the ' +
      'schema gate caught, that output was schema-valid. "The gate protects us" is not available here.',
  );
  L.push('');
  L.push(
    'If a record above is flagged `moved`, `gone`, or its source text changed, a human must still run the ' +
      '`scripts/check-sources` eligibility re-verification loop (docs/data-authoring.md) -- a descriptive ' +
      'change to a page can accompany an eligibility change on the same page.',
  );
  L.push('');

  L.push('## No action needed');
  L.push('');
  const quiet = findings.filter((f) => f.urlHealth === 'ok' && f.proposals.length === 0 && f.reviews.length === 0);
  L.push(`- ${quiet.length} record${quiet.length === 1 ? '' : 's'} clean`);
  L.push('');
  L.push(
    dryRun
      ? '_--dry-run: proposals.json was not written._'
      : wrote
        ? '_proposals.json was updated. Review its diff alongside this report._'
        : '_proposals.json was not written (nothing changed)._',
  );
  L.push('');

  return L.join('\n');
}
