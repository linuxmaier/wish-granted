/**
 * The triage corpus: every program record, mapped to the best source text
 * available offline (issue #68).
 *
 * Two tiers of evidence, kept explicitly separate (see
 * `lib/__tests__/fixtures/SOURCES.md`):
 *
 *   - `tier3-mapped`   -- the program cites a source with a committed, real,
 *                         dated Tier-3 capture (reused from
 *                         scripts/cross-check/lib/corpus.ts, issue #84). The
 *                         real deterministic parser runs against it. 10 records.
 *   - `reconstructed`  -- a community-org source with no committed capture; the
 *                         fixture is rebuilt from the program record's verbatim
 *                         `source` note. 5 records.
 *   - `no-offline-source` -- neither. Route is predicted in the PR, measured by
 *                         the coordinator's live run. 2 records.
 *
 * NO MODEL, NO NETWORK. `sourceTextFor` reads a committed file and normalises it
 * with scripts/check-sources/lib/normalize; `parserOutcomeFor` runs the
 * dependency-free Tier-3 parser.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { extractFromHtml, type Tier3Source } from '../../tier3-extract/index.mjs';
import { normalize } from '../../check-sources/lib/normalize.ts';
import { CORPUS as TIER3_CORPUS, runDeterministic, fixtureSourceText } from '../../cross-check/lib/corpus.ts';
import type { ParserOutcome } from './route.ts';

// This module and its tests must NOT import `@/data/programs` -- same convention
// as scripts/program-benchmark/lib (see its fixtures.ts note). The live dataset
// is cross-checked against this corpus by `assertCorpusComplete`, called from
// index.ts's --self-test where the resolve hook is loaded.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, '__tests__', 'fixtures');

export type EvidenceTier = 'tier3-mapped' | 'reconstructed' | 'no-offline-source';

export interface TriageCorpusEntry {
  readonly programId: string;
  readonly tier: EvidenceTier;
  /** Reconstructed fixture filename, when `tier === 'reconstructed'`. */
  readonly file?: string;
  readonly note: string;
}

/**
 * The 4 community-org records whose live pages unambiguously decline to state a
 * rule, reconstructed from each record's verbatim `source` note. The other 3
 * unmapped records are left as `no-offline-source` -- a reconstructed fixture
 * would be guessing at content that decides the route (a MadCAP / Section 8
 * dollar table; The River's rule lives in a state TEFAP PDF, not the pantry
 * page) -- and the prediction for them is stated in the PR and the analysis
 * output instead.
 */
const RECONSTRUCTED: readonly TriageCorpusEntry[] = [
  { programId: 'dane-eviction-prevention', tier: 'reconstructed', file: 'tenant-resource-center.html', note: 'Screening tool, explicitly not an application, no published threshold.' },
  { programId: 'dane-joining-forces-for-families', tier: 'reconstructed', file: 'dane-joining-forces-for-families.html', note: 'Neighborhood social workers; voluntary, no eligibility gate beyond location.' },
  { programId: 'wi-211', tier: 'reconstructed', file: '211-wisconsin.html', note: 'Referral helpline; no eligibility requirements.' },
  { programId: 'second-harvest-southern-wi', tier: 'reconstructed', file: 'second-harvest.html', note: 'Food bank; verbatim "no proof of income ... is required".' },
];

const NO_OFFLINE_SOURCE: readonly TriageCorpusEntry[] = [
  { programId: 'madison-water-bill-assistance', tier: 'no-offline-source', note: 'MadCAP: published dollar table by household size + categorical list on the City page. No committed capture.' },
  { programId: 'madison-housing-choice-voucher', tier: 'no-offline-source', note: 'Section 8: published income-limit dollar table + closed waitlist on the CDA page. No committed capture.' },
  { programId: 'the-river-food-pantry', tier: 'no-offline-source', note: 'Pantry page is no-questions-asked; the 200% FPL self-attestation for groceries is stated in a linked state TEFAP form, not the pantry page. Borderline no-rule / agentic.' },
];

const TIER3_MAPPED: readonly TriageCorpusEntry[] = TIER3_CORPUS.map((e) => ({
  programId: e.programId,
  tier: 'tier3-mapped' as const,
  note: e.note,
}));

export const TRIAGE_CORPUS: readonly TriageCorpusEntry[] = [
  ...TIER3_MAPPED,
  ...RECONSTRUCTED,
  ...NO_OFFLINE_SOURCE,
];

const TIER3_BY_PROGRAM = new Map(TIER3_CORPUS.map((e) => [e.programId, e]));
const RECON_BY_PROGRAM = new Map(RECONSTRUCTED.map((e) => [e.programId, e]));

function reconstructedSource(programId: string): Tier3Source {
  return {
    id: `triage-recon-${programId}`,
    kind: 'html',
    file: '',
    url: `reconstructed://${programId}`,
    fetchedOn: 'reconstructed',
    citationName: `reconstructed fixture for ${programId}`,
    tierAssigned: 4,
    expected: { decision: 'abstain', why: 'reconstructed Tier-4 fixture' },
    groundedIn: 'the program record source note',
  };
}

/** Raw HTML of the best offline source for a program, or '' if there is none. */
export function rawHtmlFor(programId: string): string {
  const t3 = TIER3_BY_PROGRAM.get(programId);
  if (t3) return fixtureSourceText(t3);
  const recon = RECON_BY_PROGRAM.get(programId);
  if (recon?.file) return readFileSync(path.join(FIXTURE_DIR, recon.file), 'utf8');
  return '';
}

/** Normalised meaningful text of the best offline source, or '' if there is none. */
export function sourceTextFor(programId: string): string {
  const raw = rawHtmlFor(programId);
  return raw ? normalize(raw) : '';
}

/** The deterministic Tier-3 parser's outcome for a program's offline source. */
export function parserOutcomeFor(programId: string): ParserOutcome {
  const t3 = TIER3_BY_PROGRAM.get(programId);
  if (t3) {
    const { raw } = runDeterministic(t3);
    return { decision: raw.decision, code: raw.code, reason: raw.reason };
  }
  const recon = RECON_BY_PROGRAM.get(programId);
  if (recon?.file) {
    const html = readFileSync(path.join(FIXTURE_DIR, recon.file), 'utf8');
    const raw = extractFromHtml(html, reconstructedSource(programId));
    return { decision: raw.decision, code: raw.code, reason: raw.reason };
  }
  return { decision: 'not-run', code: null, reason: 'no offline source fixture for this program' };
}

export function corpusEntryFor(programId: string): TriageCorpusEntry | undefined {
  return TRIAGE_CORPUS.find((e) => e.programId === programId);
}

/** Throws if the corpus lists a program twice or references a missing fixture. */
export function assertCorpusConsistent(): void {
  const covered = new Set<string>();
  for (const e of TRIAGE_CORPUS) {
    if (covered.has(e.programId)) throw new Error(`triage corpus: ${e.programId} listed twice`);
    covered.add(e.programId);
  }
  for (const e of RECONSTRUCTED) {
    const text = e.file ? readFileSync(path.join(FIXTURE_DIR, e.file), 'utf8') : '';
    if (text.length < 200) throw new Error(`triage corpus: reconstructed fixture ${e.file} is missing or truncated`);
  }
}

/**
 * Throws unless the corpus covers exactly the shipped program ids. Called from
 * index.ts's --self-test, which has the `@/` resolve hook loaded and so can pass
 * `PROGRAMS.map(p => p.id)`.
 */
export function assertCorpusComplete(shippedProgramIds: readonly string[]): void {
  assertCorpusConsistent();
  const shipped = new Set(shippedProgramIds);
  const covered = new Set(TRIAGE_CORPUS.map((e) => e.programId));
  for (const id of covered) {
    if (!shipped.has(id)) throw new Error(`triage corpus: ${id} is not a shipped program`);
  }
  for (const id of shipped) {
    if (!covered.has(id)) throw new Error(`triage corpus: shipped program ${id} is not in the corpus`);
  }
}
