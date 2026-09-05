import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractPhones, normalizePhone, excerptAround, detectStatusSignals } from '../extract.ts';

test('normalizePhone reduces separators and a leading country code to 10 digits', () => {
  assert.equal(normalizePhone('1-800-362-3002'), '8003623002');
  assert.equal(normalizePhone('(608) 266-3509'), '6082663509');
  assert.equal(normalizePhone('608.266.3509'), '6082663509');
});

test('extractPhones finds separated numbers and dedupes on the normalized form', () => {
  const text = 'Call 1-800-362-3002 or (800) 362-3002 for help, or the local office at 608-266-4651.';
  const found = extractPhones(text);
  assert.deepEqual(
    found.map((p) => p.normalized),
    ['8003623002', '6082664651'],
  );
});

test('extractPhones ignores bare digit runs with no separators (analytics IDs)', () => {
  // New Relic applicationID / browserID shapes seen in real WI DHS page HTML.
  const text = 'applicationID:"708311829" browserID:"1120064829" visitId 15841609891';
  assert.deepEqual(extractPhones(text), []);
});

test('extractPhones does not match a 7-or-11-digit-adjacent false positive', () => {
  assert.deepEqual(extractPhones('order 800-362-30021 confirmed'), []);
});

test('excerptAround returns a window with ellipses and flattened whitespace', () => {
  const text = `line one\n   the number 608-266-3509 is here\nline three`;
  const idx = text.indexOf('608');
  const ex = excerptAround(text, idx, '608-266-3509'.length, 12);
  assert.match(ex, /number 608-266-3509 is here/);
  assert.match(ex, /^\.\.\./);
  assert.match(ex, /\.\.\.$/);
  assert.doesNotMatch(ex, /\n/);
});

test('detectStatusSignals catches a closure phrase', () => {
  const hits = detectStatusSignals('The program has ended and we are no longer accepting applications.');
  assert.ok(hits.some((h) => h.signal === 'closed'));
  assert.ok(hits[0]!.excerpt.length > 0);
});

test('detectStatusSignals catches a waitlist phrase', () => {
  const hits = detectStatusSignals('Applicants are placed on a waitlist until a unit opens.');
  assert.ok(hits.some((h) => h.signal === 'waitlist'));
});

test('detectStatusSignals is quiet on ordinary eligibility prose', () => {
  assert.deepEqual(
    detectStatusSignals('You may qualify if your household income is at or below 200% of the federal poverty level.'),
    [],
  );
});
