/**
 * The extractor's internal result -- a candidate record WITH its provenance --
 * and the mapping down to #66's `CandidateRecord` seam shape.
 *
 * The seam (scripts/program-benchmark/lib/extractor.ts) has no provenance
 * field, and this issue must not change `src/` or the seam. So provenance
 * travels in `CandidateRecord.notes` (explicitly "free-text the extractor wants
 * a reviewer to see"), formatted so a human reviewer sees exactly which span
 * and which URL every part of the rule came from. The structured provenance is
 * also returned to the CLI for the per-source report and is what the unit tests
 * assert on.
 */
import type { Criterion } from '../../../src/domain/criteria.ts';
import type { CandidateRecord } from '../../program-benchmark/lib/extractor.ts';
import type { VerifiedSpan } from './provenance.ts';

export interface ExtractedRecord {
  readonly eligibility: Criterion;
  readonly provenance: readonly VerifiedSpan[];
  readonly name?: string;
  readonly administeredBy?: string;
  readonly summary?: string;
  readonly benefit?: string;
  readonly howToApply?: { readonly url?: string; readonly phone?: string };
  readonly requiredDocuments?: readonly string[];
  readonly modelNotes?: string;
  /** URLs visited this run, in order -- multi-page assembly is visible here. */
  readonly pagesVisited: readonly string[];
}

export function formatProvenanceNote(rec: ExtractedRecord): string {
  const lines: string[] = ['PROVENANCE (verbatim span -> URL it was fetched from):'];
  for (const span of rec.provenance) {
    lines.push(`- "${span.quote}"`);
    lines.push(`    ${span.url}${span.urlCorrected ? '  (URL corrected by the span matcher)' : ''}`);
  }
  if (rec.pagesVisited.length > 0) {
    lines.push('', `Pages read this run: ${rec.pagesVisited.join(', ')}`);
  }
  if (rec.modelNotes) lines.push('', `Extractor notes: ${rec.modelNotes}`);
  return lines.join('\n');
}

export function toCandidateRecord(rec: ExtractedRecord): CandidateRecord {
  return {
    eligibility: rec.eligibility,
    ...(rec.name ? { name: rec.name } : {}),
    ...(rec.administeredBy ? { administeredBy: rec.administeredBy } : {}),
    ...(rec.summary ? { summary: rec.summary } : {}),
    ...(rec.benefit ? { benefit: rec.benefit } : {}),
    ...(rec.howToApply ? { howToApply: rec.howToApply } : {}),
    ...(rec.requiredDocuments ? { requiredDocuments: rec.requiredDocuments } : {}),
    notes: formatProvenanceNote(rec),
  };
}
