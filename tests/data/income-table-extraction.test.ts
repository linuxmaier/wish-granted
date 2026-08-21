import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractIncomeTable,
  extractTables,
  HTML_TABLE_SOURCES,
} from '../../scripts/extract-income-tables.mjs';

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
