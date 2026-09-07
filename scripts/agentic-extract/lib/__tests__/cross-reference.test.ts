import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  detectReferences,
  resolveEcfrSection,
  ecfrSectionUrl,
  splitCfrParagraphs,
  ECFR_HEADERS,
} from '../cross-reference.ts';
import { createFixtureFetcher } from '../fetcher.ts';
import { ECFR_273_1_XML } from '../fixtures-offline.ts';

test('detects a "paragraph (a) of this section" reference and marks it resolvable in CFR context', () => {
  const refs = detectReferences('Notwithstanding the provisions of paragraph (a) of this section, ...', {
    cfrTitle: 7,
    cfrPart: 273,
    cfrSection: '273.1',
  });
  const para = refs.find((r) => r.kind === 'cfr-paragraph');
  assert.ok(para);
  assert.equal(para.resolvable, true);
  assert.equal(para.cfr?.paragraph, 'a');
});

test('non-CFR references (Wis. Admin. Code) are detected but not marked resolvable', () => {
  const refs = detectReferences('See Wis. Admin. Code § DHS 103.04 for asset rules.');
  const wac = refs.find((r) => r.kind === 'wis-admin-code');
  assert.ok(wac);
  assert.equal(wac.resolvable, false);
});

test('ecfrSectionUrl builds the versioner path with part+section query', () => {
  const url = ecfrSectionUrl({ title: 7, part: 273, section: '273.1', date: '2026-09-06' });
  assert.equal(url, 'https://www.ecfr.gov/api/versioner/v1/full/2026-09-06/title-7.xml?part=273&section=273.1');
});

test('resolveEcfrSection returns the section text AND records the resolved API URL', async () => {
  const url = ecfrSectionUrl({ title: 7, part: 273, section: '273.1', date: '2026-09-06' });
  const { fetcher, calls } = createFixtureFetcher({
    [url.split('?')[0]!]: { body: ECFR_273_1_XML, requireHeaders: { 'accept-encoding': 'gzip' } },
  });
  const r = await resolveEcfrSection(fetcher, { title: 7, part: 273, section: '273.1', date: '2026-09-06' });
  assert.ok(r.ok);
  assert.equal(r.url, url);
  assert.match(r.flat, /Notwithstanding the provisions of paragraph \(a\) of this section/);
  // The request carried Accept-Encoding (else the fixture 406s).
  assert.ok(Object.keys(calls[0]!.headers).some((k) => k.toLowerCase() === 'accept-encoding'));
});

test('without Accept-Encoding the versioner fixture 406s -- and our code always sends it', async () => {
  const url = ecfrSectionUrl({ title: 7, part: 273, section: '273.1', date: '2026-09-06' });
  const { fetcher } = createFixtureFetcher({
    [url.split('?')[0]!]: { body: ECFR_273_1_XML, requireHeaders: { 'accept-encoding': 'gzip' } },
  });
  // Sanity: a raw call with no headers is refused.
  const bare = await fetcher({ url });
  assert.equal(bare.kind, 'unreachable');
  // The real resolver sends ECFR_HEADERS, so it succeeds.
  assert.ok('Accept-Encoding' in ECFR_HEADERS);
  const r = await resolveEcfrSection(fetcher, { title: 7, part: 273, section: '273.1', date: '2026-09-06' });
  assert.ok(r.ok);
});

test('splitCfrParagraphs separates (a), (b), (1), (2)', () => {
  const parts = splitCfrParagraphs('(a) General text here. (b) Special. (1) first. (2) Notwithstanding paragraph (a), the limit is 165 percent.');
  assert.deepEqual(parts.map((p) => p.label), ['a', 'b', '1', '2']);
  assert.match(parts[3]!.text, /165 percent/);
});
