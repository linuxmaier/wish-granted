import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractIncomeTable,
  extractTables,
  HTML_TABLE_SOURCES,
} from '../../scripts/extract-income-tables.mjs';
import { FPL, WI_SMI_60 } from '@/data/reference/income-tables';

/**
 * Locks in the measured hit rate claimed in docs/eligibility-extraction.md:
 * the deterministic (no-LLM) extractor gets 4/4 of the Tier-1 HTML income
 * tables right, against real page snapshots, not synthetic fixtures.
 *
 * Runs against tests/fixtures/income-tables/*.html -- real HTML fetched
 * 2026-08-21 (see SOURCES.md in that directory) -- so this is offline and
 * deterministic like the rest of the suite, but every value asserted below
 * is a number a human can currently see by loading the cited URL.
 */

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'income-tables');

function loadFixture(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, name), 'utf8');
}

describe('deterministic income-table extraction (Tier 1)', () => {
  it('extracts all four HTML income-table sources', () => {
    for (const source of HTML_TABLE_SOURCES) {
      const html = loadFixture(source.fixture);
      const result = extractIncomeTable(html, source);
      expect(result.ok, `${source.id}: ${!result.ok ? result.reason : ''}`).toBe(true);
    }
  });

  it('gets the FPL 48-contiguous-states table right, including the add-on row', () => {
    const source = HTML_TABLE_SOURCES.find((s) => s.id === 'fpl')!;
    const result = extractIncomeTable(loadFixture(source.fixture), source);
    if (!result.ok) throw new Error(result.reason);
    expect(result.bySize[0]).toBe(15_960); // household of 1
    expect(result.bySize[3]).toBe(33_000); // household of 4
    expect(result.bySize).toHaveLength(8);
    expect(result.perAdditionalPerson).toBe(5_680);
  });

  it('gets the MadCAP table right, including the "8 or more" label', () => {
    const source = HTML_TABLE_SOURCES.find((s) => s.id === 'madcap')!;
    const result = extractIncomeTable(loadFixture(source.fixture), source);
    if (!result.ok) throw new Error(result.reason);
    expect(result.bySize[0]).toBe(45_450);
    expect(result.bySize[7]).toBe(85_700); // "8 or more" parses to size 8
    // MadCAP genuinely does not publish a >8 formula -- a flat ceiling at
    // size 8. Confirming this stays `null` (not a wrong guess) matters as
    // much as confirming the numbers that did extract.
    expect(result.perAdditionalPerson).toBeNull();
  });

  it('gets the Lifeline table right, using the 48-contiguous-states column not Alaska/Hawaii', () => {
    const source = HTML_TABLE_SOURCES.find((s) => s.id === 'lifeline')!;
    const result = extractIncomeTable(loadFixture(source.fixture), source);
    if (!result.ok) throw new Error(result.reason);
    expect(result.bySize[0]).toBe(21_546);
    expect(result.perAdditionalPerson).toBe(7_668);
  });

  it('gets the WHEAP table right, using the annual column not the monthly one', () => {
    const source = HTML_TABLE_SOURCES.find((s) => s.id === 'wheap')!;
    const result = extractIncomeTable(loadFixture(source.fixture), source);
    if (!result.ok) throw new Error(result.reason);
    expect(result.bySize[0]).toBe(38_421); // annual, not $3,201.75/month
    expect(result.bySize[3]).toBe(73_888);
  });

  it('finds three distinct tables on the FPL page (contiguous US, Alaska, Hawaii)', () => {
    const html = loadFixture('fpl.html');
    expect(extractTables(html)).toHaveLength(3);
  });

  it('does not silently substitute a value when the selector matches nothing', () => {
    const source = HTML_TABLE_SOURCES.find((s) => s.id === 'madcap')!;
    const result = extractIncomeTable('<html><body>no tables here</body></html>', source);
    expect(result.ok).toBe(false);
  });
});

/**
 * Corroboration against issue #3's hand-verified reference tables.
 *
 * #3 verified `FPL` and `WI_SMI_60` (src/data/reference/income-tables.ts) by
 * an entirely different route than this extractor: a human read the HHS
 * Federal Register notice and the WHEAP PY26 manual PDF directly and cross-
 * checked figures against a regulatory formula (45 CFR 96.85). This
 * extractor independently re-derived the same numbers from the live HTML
 * pages, before #3's verification PR existed. Two independent methods
 * landing on the same number is stronger evidence than either one alone --
 * this test makes that agreement a permanent, enforced regression rather
 * than a one-time observation in a doc: if either side ever drifts (a real
 * source change, or a typo in either place), this fails loudly instead of
 * silently going stale. See docs/eligibility-extraction.md Section 3.
 */
describe('corroboration: this extractor agrees with the #3-verified reference tables', () => {
  it('matches the verified FPL table exactly, every household size and the add-on', () => {
    const source = HTML_TABLE_SOURCES.find((s) => s.id === 'fpl')!;
    const result = extractIncomeTable(loadFixture(source.fixture), source);
    if (!result.ok) throw new Error(result.reason);
    expect(result.bySize).toEqual(FPL.bySize);
    expect(result.perAdditionalPerson).toBe(FPL.perAdditionalPerson);
  });

  it('matches the verified WHEAP/WI_SMI_60 table exactly on every published household size', () => {
    const source = HTML_TABLE_SOURCES.find((s) => s.id === 'wheap')!;
    const result = extractIncomeTable(loadFixture(source.fixture), source);
    if (!result.ok) throw new Error(result.reason);
    expect(result.bySize).toEqual(WI_SMI_60.bySize);
    // Not compared: WI_SMI_60.perAdditionalPerson (2,217) comes from a
    // different document than this fixture -- #3 derived it from 45 CFR
    // 96.85 applied to the PY26 manual PDF, which this HTML-table extractor
    // never reads. This page simply doesn't publish that figure (this
    // extractor correctly reports `null`, not a wrong guess) -- absence
    // here is not a disagreement with #3, just a narrower source.
  });

  it('has no independent data point for DANE_AMI -- HUD\'s dataset format was out of scope for this extractor', () => {
    // Recorded explicitly rather than silently omitted: unlike FPL and
    // WI_SMI_60, this spike never attempted to extract HUD's Area Median
    // Income figures (see NOT_ATTEMPTED in scripts/extract-income-tables.mjs),
    // so there is nothing here to agree or disagree with #3's verified
    // `DANE_AMI` ($135,300 four-person median). That gap is honest, not a
    // silent pass.
    expect(HTML_TABLE_SOURCES.some((s) => s.id === 'dane-ami')).toBe(false);
  });
});
