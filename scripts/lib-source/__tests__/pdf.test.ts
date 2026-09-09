import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { extractPdf, looksLikePdf } from '../pdf.ts';
import type { StructureNode } from '../html-structure.ts';

const FIXTURE = fileURLToPath(
  new URL('./fixtures/cnp-income-eligibility-guidelines-2025.pdf', import.meta.url),
);
const pdfBytes = readFileSync(FIXTURE);

test('looksLikePdf sniffs the %PDF- header, not the file name', () => {
  assert.equal(looksLikePdf(pdfBytes), true);
  assert.equal(looksLikePdf(Buffer.from('<!doctype html><html></html>')), false);
  assert.equal(looksLikePdf(Buffer.from('   %PDF-1.7 trailing')), true);
});

test('a non-PDF / truncated buffer abstains cleanly rather than throwing', () => {
  const r1 = extractPdf(Buffer.from('not a pdf at all'));
  assert.equal(r1.ok, false);
  const r2 = extractPdf(Buffer.from('%PDF-1.7\n%%EOF'));
  assert.equal(r2.ok, false); // header only, no pages
});

test('extracts the Federal Register notice: 2 pages, prose readable in column order', () => {
  const r = extractPdf(pdfBytes);
  assert.ok(r.ok, r.ok ? '' : r.reason);
  assert.equal(r.pageCount, 2);
  // The 3-column body is read column-by-column, not zig-zagged across columns.
  assert.match(
    r.flat,
    /free and reduced-price meals and free milk and Summer Electronic Benefit Transfer benefits for the period from July 1, 2025, through June 30, 2026/,
  );
  // The sentence carrying the 130% / 185% multipliers survives verbatim -- this
  // is the span school-meals-wi could not quote before (#72).
  assert.match(
    r.flat,
    /multiplying the year 2025 Federal income poverty guidelines by 1\.30 and 1\.85, respectively/,
  );
});

test('the income table is extracted AS A TABLE: every value stays bound to its column meaning', () => {
  const r = extractPdf(pdfBytes);
  assert.ok(r.ok);
  const tables = r.nodes.filter((n): n is Extract<StructureNode, { type: 'table' }> => n.type === 'table');
  assert.ok(tables.length >= 1, 'expected at least one table node');

  // Find the "household size 4" row in the first (48 contiguous states) section.
  const rowFor = (size: string) => {
    for (const t of tables) {
      for (const row of t.rows) {
        if ((row[0]?.cell ?? '').trim() === size) return row;
      }
    }
    return undefined;
  };
  const row4 = rowFor('4');
  assert.ok(row4, 'household-size-4 row not found');

  // Federal poverty guideline for a family of 4, 48 states (2025): $32,150.
  const fpl = row4.find((c) => /federal|poverty/i.test(c.header));
  assert.equal(fpl?.cell, '32,150');

  // Reduced-price (185% FPL) annual: $59,478, under a header naming 185%.
  const rp = row4.find((c) => /185%/.test(c.header) && /annual/i.test(c.header));
  assert.equal(rp?.cell, '59,478');

  // Free meals (130% FPL) annual: $41,795, under a header naming 130%.
  const free = row4.find((c) => /130%/.test(c.header) && /annual/i.test(c.header));
  assert.equal(free?.cell, '41,795');

  // Nothing about the render flattens 41,795 away from its 130% column.
  assert.match(r.structured, /Free meals—130%[^=|]*Annual = 41,795/);
});

test('the Alaska / Hawaii sub-tables are kept distinct, not merged into one grid', () => {
  const r = extractPdf(pdfBytes);
  assert.ok(r.ok);
  assert.match(r.structured, /table section: Alaska/);
  assert.match(r.structured, /table section: Hawaii/);
  // Alaska household of 1 free-meal annual is 25,415 -- distinct from the 48-state 20,345.
  assert.match(r.flat, /25,415/);
  assert.match(r.flat, /20,345/);
});
