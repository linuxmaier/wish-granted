#!/usr/bin/env node
/**
 * Deterministic (no-LLM) extractor for Tier-1 income tables.
 *
 * Built for issue #5 (docs/eligibility-extraction.md) to answer a factual
 * question with a script rather than a claim: how much of the corpus is a
 * literal HTML `<table>` a regex parser can lift reliably?
 *
 * Deliberately plain JavaScript, zero dependencies (no cheerio, no jsdom) --
 * this is a build-time dev tool, not shipped app code, but the "no new
 * dependency without asking the reviewer" rule in the contributor brief is
 * cheapest to honor by just not needing one. The four sources below have
 * meaningfully different table markup (see the per-source `selectTable` /
 * `valueCol` below), which is itself a finding: even "deterministic" tier-1
 * sources need a small per-source adapter, not one universal regex.
 *
 * Usage:
 *   node scripts/extract-income-tables.mjs            # reads local fixtures
 *   node scripts/extract-income-tables.mjs --live      # refetches from the web
 *
 * Fixtures in tests/fixtures/income-tables/ are real HTML snapshots fetched
 * 2026-08-21 (see tests/fixtures/income-tables/SOURCES.md) so the measured
 * hit rate below is reproducible offline, in CI, without a network call.
 *
 * NOT the production refresher -- that's scripts/refresh-income-tables/
 * (issue #24, `npm run refresh:income-tables`), which landed independently
 * mid-spike, patches src/data/reference/income-tables.ts directly with a
 * guardrail against implausible jumps, and covers DANE_AMI too. This script
 * stays as spike evidence and a standing corroboration check (its output
 * matches #24's independently-verified FPL/WI_SMI_60 figures exactly -- see
 * docs/eligibility-extraction.md Section 3) -- not something to run to
 * actually refresh the dataset. Don't maintain both as live tooling.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'income-tables');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// --- Generic HTML table tokenizer -----------------------------------------
// Deliberately crude (regex, not a real DOM parser): good enough for the
// well-formed government/nonprofit table markup actually observed, and
// avoids a new dependency. A source with malformed HTML would need a real
// parser -- that's a legitimate future limitation, not hidden here.

const ENTITY_MAP = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&#58;': ':',
  '&rsquo;': "'",
  '&#8217;': "'",
};

function decodeCell(raw) {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&amp;|&#58;|&rsquo;|&#8217;/g, (m) => ENTITY_MAP[m] ?? m)
    .replace(/[​­]/g, '') // zero-width space / soft hyphen seen in SharePoint markup
    .replace(/\s+/g, ' ')
    .trim();
}

/** @returns {{ rows: string[][] }[]} every <table> on the page, as trimmed cell text. */
export function extractTables(html) {
  const tables = [];
  for (const tableHtml of html.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
    const rows = [];
    for (const rowMatch of tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...rowMatch[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) =>
        decodeCell(c[1]),
      );
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length > 0) tables.push({ rows });
  }
  return tables;
}

function parseMoney(text) {
  const m = text.match(/\$([\d,]+(?:\.\d+)?)/);
  if (!m) return null;
  return Math.round(parseFloat(m[1].replace(/,/g, '')));
}

function parseSize(text) {
  const m = text.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function isAdditionalPersonRow(row) {
  return /additional/i.test(row.join(' '));
}

/**
 * Extracts a `{ bySize, perAdditionalPerson }` income table given a source
 * config. Returns `{ ok: false, reason }` on any failure instead of
 * guessing -- an extractor that silently returns a wrong or partial table is
 * worse than one that visibly abstains, same principle as the LLM path.
 */
export function extractIncomeTable(html, source) {
  const tables = extractTables(html);
  const table = source.selectTable(tables);
  if (!table) {
    return { ok: false, reason: `no table matched selector (${tables.length} tables on page)` };
  }

  const bySize = [];
  let perAdditionalPerson = null;

  for (const row of table.rows) {
    // Checked on the whole row, not `row[valueCol]`: a colspanned footer row
    // ("add $5,680 for each additional person") collapses to one cell in
    // this parser (colspan is not modeled), so the value can land in any
    // column depending on the source.
    if (isAdditionalPersonRow(row)) {
      perAdditionalPerson = parseMoney(row.join(' '));
      continue;
    }
    const value = row[source.valueCol];
    if (value === undefined) continue;
    const size = parseSize(row[0] ?? '');
    const amount = parseMoney(value);
    if (size !== null && amount !== null) {
      bySize[size - 1] = amount;
    }
  }

  if (bySize.filter((v) => v !== undefined).length === 0) {
    return { ok: false, reason: 'table matched but no (size, dollar amount) rows parsed' };
  }
  return { ok: true, bySize, perAdditionalPerson };
}

// --- Per-source configuration -----------------------------------------
// Four Tier-1 HTML sources with literal income tables, each with different
// markup (see the raw fixtures). `valueCol` is the 0-indexed cell holding
// the dollar figure to use; `selectTable` disambiguates when a page has more
// than one <table> (FPL publishes three: contiguous US, Alaska, Hawaii).

export const HTML_TABLE_SOURCES = [
  {
    id: 'fpl',
    name: 'HHS Poverty Guidelines -- 48 contiguous states + DC',
    url: 'https://aspe.hhs.gov/topics/poverty-economic-mobility/poverty-guidelines',
    fixture: 'fpl.html',
    valueCol: 1,
    selectTable: (tables) =>
      tables.find((t) => t.rows.some((r) => /CONTIGUOUS STATES/i.test(r[0] ?? ''))),
  },
  {
    id: 'madcap',
    name: 'City of Madison -- MadCAP water-bill assistance income table',
    url: 'https://www.cityofmadison.com/pay/madcap',
    fixture: 'madcap.html',
    valueCol: 1,
    selectTable: (tables) => tables.find((t) => t.rows.some((r) => r[0] === 'Household size')),
  },
  {
    id: 'lifeline',
    name: 'Lifeline (federal phone/internet subsidy) -- 48 contiguous states column',
    url: 'https://www.lifelinesupport.org/how-to-qualify/',
    fixture: 'lifeline.html',
    valueCol: 1,
    selectTable: (tables) => tables.find((t) => t.rows.some((r) => r[0] === 'Household Size')),
  },
  {
    id: 'wheap',
    name: 'WHEAP (WI home energy assistance) -- 60% SMI, PY2025-26, annual column',
    url: 'https://energyandhousing.wi.gov/Pages/AgencyResources/energy-assistance.aspx',
    fixture: 'wheap.html',
    valueCol: 2,
    selectTable: (tables) => tables.find((t) => t.rows.some((r) => r[0] === 'Household Size')),
  },
];

/**
 * Identified as Tier-1 (genuinely tabular, published on a predictable cadence)
 * in docs/data-sources.md and docs/eligibility-extraction.md, but NOT
 * attempted by this script: USDA's SNAP income standard ships as a PDF, and
 * HUD's Area Median Income figures ship as a dataset/spreadsheet page rather
 * than an HTML <table>. Both need different tooling (a PDF text/table
 * extractor; the HUD dataset API) than the HTML-table parser above. Recorded
 * here rather than silently dropped, so the corpus-level hit rate in the doc
 * is honest about what this script does and does not cover.
 */
export const NOT_ATTEMPTED = [
  {
    id: 'usda-snap-standards',
    name: 'USDA FNS/FNA -- SNAP gross/net income eligibility standards',
    reason: 'published as an annual PDF table, not HTML; needs a PDF extractor',
  },
  {
    id: 'hud-ami',
    name: 'HUD -- Area Median Income dataset (Madison, WI HUD Metro FMR Area)',
    reason: 'served as a dataset/spreadsheet download page, not a literal HTML table',
  },
];

// --- CLI runner -------------------------------------------------------

async function loadHtml(source, live) {
  if (live) {
    const res = await fetch(source.url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`${source.url} -> HTTP ${res.status}`);
    return res.text();
  }
  return readFile(path.join(FIXTURES_DIR, source.fixture), 'utf8');
}

async function main() {
  const live = process.argv.includes('--live');
  console.log(`Mode: ${live ? 'live fetch' : 'local fixtures (2026-08-21 snapshot)'}\n`);

  let ok = 0;
  for (const source of HTML_TABLE_SOURCES) {
    let html;
    try {
      html = await loadHtml(source, live);
    } catch (err) {
      console.log(`FAIL  ${source.id.padEnd(10)} fetch error: ${err.message}`);
      continue;
    }

    const result = extractIncomeTable(html, source);
    if (!result.ok) {
      console.log(`FAIL  ${source.id.padEnd(10)} ${result.reason}`);
      continue;
    }

    ok += 1;
    const sizes = result.bySize.map((v, i) => (v === undefined ? null : `${i + 1}:$${v}`)).filter(Boolean);
    console.log(`OK    ${source.id.padEnd(10)} ${sizes.join('  ')}`);
    console.log(
      `      perAdditionalPerson: ${result.perAdditionalPerson === null ? 'not published on this page' : '$' + result.perAdditionalPerson}`,
    );
  }

  console.log(
    `\n${ok}/${HTML_TABLE_SOURCES.length} HTML income-table sources extracted successfully.`,
  );
  console.log(
    `${NOT_ATTEMPTED.length} additional Tier-1 sources identified but not attempted (different format):`,
  );
  for (const s of NOT_ATTEMPTED) console.log(`  - ${s.id}: ${s.reason}`);
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
