/**
 * Wiring the two corpora together for issue #84.
 *
 * scripts/program-benchmark scores 16 hand-verified `Program` records by source
 * URL. scripts/tier3-extract has a frozen fixture per Tier-3 source. This module
 * maps one to the other so Path A can run the deterministic parser on the SAME
 * source the agentic extractor is given.
 *
 * The mapping is written out by hand and reviewed, not guessed by URL string
 * match -- a fixture is only listed here when it is genuinely the page (or, for
 * `approximate` entries, the eligibility subpage of the site) the program record
 * cites. `assertCorpusResolves` checks every referenced fixture exists on disk.
 *
 * NO MODEL. `runDeterministic` reads a committed fixture and runs the
 * dependency-free parser; that is the entire Path-A left-hand side, offline.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// scripts/tier3-extract is plain .mjs; index.d.mts gives it types.
import {
  TIER3_SOURCES,
  TIER3_HELDOUT,
  TIER3_HELDOUT2,
  extractFromHtml,
  extractFromEcfr,
  type Tier3Source,
} from '../../tier3-extract/index.mjs';
import { fromDeterministic, type MethodOutcome } from './methods.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.join(__dirname, '..', '..', '..', 'tests', 'fixtures');

type Split = 'tuning' | 'heldout' | 'heldout2';

const SPLIT_DIR: Record<Split, string> = {
  tuning: path.join(FIXTURE_ROOT, 'tier3'),
  heldout: path.join(FIXTURE_ROOT, 'tier3-heldout'),
  heldout2: path.join(FIXTURE_ROOT, 'tier3-heldout2'),
};

const SPLIT_SOURCES: Record<Split, readonly Tier3Source[]> = {
  tuning: TIER3_SOURCES,
  heldout: TIER3_HELDOUT,
  heldout2: TIER3_HELDOUT2,
};

export interface CorpusEntry {
  readonly programId: string;
  readonly tier3Id: string;
  readonly split: Split;
  /** `exact` when the fixture URL is the program's own source.url; `approximate`
   *  when it is the eligibility subpage of the same site. */
  readonly match: 'exact' | 'approximate';
  readonly note: string;
}

/**
 * program id -> the Tier-3 fixture at (or nearest) its source URL.
 *
 * 16 of the 17 program records are verified/scored; `dane-eviction-prevention`
 * is abstention-only. Community-org sources (Second Harvest, The River, 211,
 * Madison HCV/water, Dane JFF, Tenant Resource Center) have no Tier-3 fixture --
 * they are not in this map, and Path A cannot run for them.
 */
export const CORPUS: readonly CorpusEntry[] = [
  {
    programId: 'badgercare-plus',
    tier3Id: 'badgercareplus-index',
    split: 'tuning',
    match: 'exact',
    note: 'Landing page. Parser abstains (no income figure); the real figures are on badgercareplus/fpl.htm.',
  },
  {
    programId: 'foodshare-snap-wi',
    tier3Id: 'foodshare-index',
    split: 'tuning',
    match: 'exact',
    note: 'Marketing landing page. Parser abstains.',
  },
  {
    programId: 'sun-bucks-wi',
    tier3Id: 'sebt-index',
    split: 'tuning',
    match: 'exact',
    note: 'Income-based program, no threshold on the page. Parser abstains.',
  },
  {
    programId: 'wisconsin-weatherization',
    tier3Id: 'weatherization',
    split: 'tuning',
    match: 'exact',
    note: '"Low-income households", no threshold. Parser abstains.',
  },
  {
    programId: 'wheap-energy-assistance',
    tier3Id: 'energy-assistance',
    split: 'tuning',
    match: 'exact',
    note: 'By-household-size SMI table under "at or below the amounts shown". Parser extracts incomeAtOrBelow(wi-smi,100).',
  },
  {
    programId: 'wheap-crisis-assistance',
    tier3Id: 'energy-assistance',
    split: 'tuning',
    match: 'exact',
    note: 'Same source page as WHEAP energy assistance. Parser extracts the same income rule.',
  },
  {
    programId: 'wisconsin-shares-child-care',
    tier3Id: 'wishares-parents',
    split: 'tuning',
    match: 'exact',
    note: '"monthly gross income must not be more than 200% of the FPL" + activity requirement. Parser extracts allOf(fpl 200, manualReview).',
  },
  {
    programId: 'wic-wisconsin',
    tier3Id: 'h2-wic-index',
    split: 'heldout2',
    match: 'exact',
    note: 'Categorical situational test in prose. Parser extracts anyOf(pregnant/postpartum, child under 5).',
  },
  {
    programId: 'school-meals-wi',
    tier3Id: 'ho-dpi-free-reduced-meals',
    split: 'heldout',
    match: 'exact',
    note: 'Direct-certification categorical list. Parser extracts hasAnyOf(currentBenefits, [...]).',
  },
  {
    programId: 'lifeline-phone-internet',
    tier3Id: 'ho-lifeline-qualify',
    split: 'heldout',
    match: 'approximate',
    note: 'Program cites lifelinesupport.org/; the fixture is its /do-i-qualify/ eligibility page, which the agentic extractor would navigate to. Parser extracts anyOf(fpl 135, categorical list).',
  },
];

function loadFixture(entry: CorpusEntry): { source: Tier3Source; text: string } {
  const source = SPLIT_SOURCES[entry.split].find((s) => s.id === entry.tier3Id);
  if (!source) {
    throw new Error(`corpus: no Tier-3 source "${entry.tier3Id}" in split "${entry.split}"`);
  }
  const text = readFileSync(path.join(SPLIT_DIR[entry.split], source.file), 'utf8');
  return { source, text };
}

/** Run the deterministic parser against a corpus entry's committed fixture. */
export function runDeterministic(entry: CorpusEntry): { outcome: MethodOutcome; raw: ReturnType<typeof extractFromHtml> } {
  const { source, text } = loadFixture(entry);
  const raw = source.kind === 'ecfr' ? extractFromEcfr(text, source) : extractFromHtml(text, source);
  return { outcome: fromDeterministic(raw), raw };
}

/** The source's meaningful text, for feeding Path B's exclusion probe offline. */
export function fixtureSourceText(entry: CorpusEntry): string {
  return loadFixture(entry).text;
}

export function corpusFor(programId: string): CorpusEntry | undefined {
  return CORPUS.find((e) => e.programId === programId);
}

/** Throws if any referenced fixture is missing -- called from --self-test and CI. */
export function assertCorpusResolves(): void {
  for (const entry of CORPUS) {
    const { source, text } = loadFixture(entry);
    if (!text || text.length < 200) {
      throw new Error(`corpus: fixture for ${entry.programId} (${source.file}) is empty or truncated`);
    }
  }
}
