import { test } from 'node:test';
import assert from 'node:assert/strict';

import { verifySpan, verifyAllSpans, spanAppearsIn } from '../provenance.ts';

const pages = [
  { url: 'https://dhs.wi.gov/badgercareplus/index.htm', flat: 'Adult monthly income limit (100% FPL) is $1,255. The 201% figure is a premium trigger.' },
  { url: 'https://www.ecfr.gov/api/versioner/v1/full/2026-09-06/title-7.xml?part=273&section=273.1', flat: 'Notwithstanding the provisions of paragraph (a) of this section, 165 percent of the poverty line.' },
];

test('a verbatim span resolves to the exact page it appears on', () => {
  const r = verifySpan({ quote: '165 percent of the poverty line' }, pages);
  assert.ok(r.ok);
  assert.equal(r.span.url, pages[1]!.url);
});

test('a cross-referenced span records the RESOLVED url, not the entry page', () => {
  const r = verifySpan(
    { quote: 'Notwithstanding the provisions of paragraph (a) of this section', url: pages[1]!.url },
    pages,
  );
  assert.ok(r.ok);
  assert.equal(r.span.url, pages[1]!.url);
  assert.equal(r.span.urlCorrected, false);
});

test('a wrong claimed url is corrected to the page that actually contains the quote', () => {
  const r = verifySpan({ quote: 'Adult monthly income limit (100% FPL)', url: pages[1]!.url }, pages);
  assert.ok(r.ok);
  assert.equal(r.span.url, pages[0]!.url);
  assert.equal(r.span.urlCorrected, true);
});

test('a fabricated span fails verification', () => {
  const r = verifySpan({ quote: 'all households under 500% FPL qualify', url: pages[0]!.url }, pages);
  assert.equal(r.ok, false);
});

test('whitespace and case differences do not defeat a real span', () => {
  assert.equal(spanAppearsIn('adult   MONTHLY income  limit (100% fpl)', pages[0]!.flat), true);
});

test('verifyAllSpans fails the whole record if any span is unverifiable, and reports which', () => {
  const r = verifyAllSpans(
    [
      { quote: '165 percent of the poverty line' },
      { quote: 'this sentence is invented' },
    ],
    pages,
  );
  assert.equal(r.ok, false);
  assert.equal(r.verified.length, 1);
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0]!.quote, /invented/);
});

test('no spans at all is a hard failure', () => {
  assert.equal(verifyAllSpans([], pages).ok, false);
});
