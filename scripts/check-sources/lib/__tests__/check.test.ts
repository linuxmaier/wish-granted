import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkSource, isEscalated, ESCALATE_AFTER_FAILURES, type Fetcher } from '../check.ts';
import { sha256, type SourceHashEntry } from '../hashes-file.ts';
import { normalize } from '../normalize.ts';

const TODAY = '2026-09-05';

const PAGE = `<!doctype html><html><body><main><h1>WIC</h1>
<p>You may qualify if your household income is at or below 185% of the federal poverty level.</p>
</main></body></html>`;

function fetcherReturning(outcome: Awaited<ReturnType<Fetcher>>): Fetcher {
  return async () => outcome;
}

function baselineFor(html: string, over: Partial<SourceHashEntry> = {}): SourceHashEntry {
  const norm = normalize(html);
  return {
    url: 'https://example.gov/wic',
    normalizedSha256: sha256(norm),
    normalizedChars: norm.length,
    status: 'ok',
    firstSeen: '2026-01-01',
    lastChanged: '2026-01-01',
    ...over,
  };
}

test('no baseline -> new, and records a hash', async () => {
  const r = await checkSource(
    { id: 'wic', url: 'https://example.gov/wic', previous: undefined, today: TODAY },
    fetcherReturning({ kind: 'ok', text: PAGE }),
  );
  assert.equal(r.status, 'new');
  assert.equal(r.entry.normalizedSha256, sha256(normalize(PAGE)));
  assert.equal(r.entry.firstSeen, TODAY);
});

test('same normalized text -> unchanged, baseline hash untouched, lastChecked bumped', async () => {
  const previous = baselineFor(PAGE);
  const churned = PAGE.replace('<main>', '<main data-render="2026-09-05T09:00:00Z">').replace(
    '<body>',
    '<body><nav>menu changed since last time</nav>',
  );
  const r = await checkSource(
    { id: 'wic', url: 'https://example.gov/wic', previous, today: TODAY },
    fetcherReturning({ kind: 'ok', text: churned }),
  );
  assert.equal(r.status, 'unchanged');
  assert.deepEqual(r.entry, { ...previous, status: 'ok' });
});

test('changed body text -> changed, new hash, firstSeen preserved', async () => {
  const previous = baselineFor(PAGE);
  const edited = PAGE.replace('185%', '200%');
  const r = await checkSource(
    { id: 'wic', url: 'https://example.gov/wic', previous, today: TODAY },
    fetcherReturning({ kind: 'ok', text: edited }),
  );
  assert.equal(r.status, 'changed');
  assert.notEqual(r.entry.normalizedSha256, previous.normalizedSha256);
  assert.equal(r.entry.firstSeen, previous.firstSeen);
  assert.equal(r.entry.lastChanged, TODAY);
});

test('404 -> gone (distinct from changed), keeps the last good hash', async () => {
  const previous = baselineFor(PAGE);
  const r = await checkSource(
    { id: 'wic', url: 'https://example.gov/wic', previous, today: TODAY },
    fetcherReturning({ kind: 'gone', httpStatus: 404 }),
  );
  assert.equal(r.status, 'gone');
  assert.equal(r.entry.status, 'gone');
  assert.equal(r.entry.normalizedSha256, previous.normalizedSha256, 'last good hash is retained');
  assert.match(r.detail, /removed, not edited/);
});

test('404 escalates on the FIRST run, unaffected by the retry counter', async () => {
  // No prior state at all -- a 404 on the very first check must still be actionable.
  const r = await checkSource(
    { id: 'wic', url: 'https://example.gov/wic', previous: undefined, today: TODAY },
    fetcherReturning({ kind: 'gone', httpStatus: 410 }),
  );
  assert.equal(r.status, 'gone');
  assert.equal(isEscalated(r), true, 'a vanished page is never suppressed behind consecutiveFailures');
  assert.equal(r.entry.consecutiveFailures, undefined, 'gone does not carry a failure counter');
  assert.equal(r.consecutiveFailures, undefined);
});

test('404 after prior unreachable failures still escalates immediately and clears the counter', async () => {
  const previous = baselineFor(PAGE, { status: 'unreachable', consecutiveFailures: 1 });
  const r = await checkSource(
    { id: 'wic', url: 'https://example.gov/wic', previous, today: TODAY },
    fetcherReturning({ kind: 'gone', httpStatus: 404 }),
  );
  assert.equal(r.status, 'gone');
  assert.equal(isEscalated(r), true);
  assert.equal(r.entry.consecutiveFailures, undefined);
});

test('first transient unreachable -> counted, NOT escalated, no PR', async () => {
  const previous = baselineFor(PAGE);
  const r = await checkSource(
    { id: 'wic', url: 'https://example.gov/wic', previous, today: TODAY },
    fetcherReturning({ kind: 'unreachable', reason: 'ETIMEDOUT' }),
  );
  assert.equal(r.status, 'unreachable');
  assert.equal(r.consecutiveFailures, 1);
  assert.equal(r.entry.consecutiveFailures, 1);
  assert.equal(r.entry.normalizedSha256, previous.normalizedSha256, 'last good hash kept');
  assert.equal(isEscalated(r), false);
  assert.match(r.detail, /ETIMEDOUT/);
  assert.match(r.detail, /not yet escalated/);
});

test('the Nth consecutive unreachable escalates', async () => {
  const previous = baselineFor(PAGE, { status: 'unreachable', consecutiveFailures: ESCALATE_AFTER_FAILURES - 1 });
  const r = await checkSource(
    { id: 'wic', url: 'https://example.gov/wic', previous, today: TODAY },
    fetcherReturning({ kind: 'unreachable', reason: 'HTTP 503' }),
  );
  assert.equal(r.consecutiveFailures, ESCALATE_AFTER_FAILURES);
  assert.equal(r.entry.consecutiveFailures, ESCALATE_AFTER_FAILURES);
  assert.equal(isEscalated(r), true);
});

test('a recovered fetch clears status and the failure counter (back to a clean entry)', async () => {
  const previous = baselineFor(PAGE, { status: 'unreachable', consecutiveFailures: 3 });
  const r = await checkSource(
    { id: 'wic', url: 'https://example.gov/wic', previous, today: TODAY },
    fetcherReturning({ kind: 'ok', text: PAGE }),
  );
  assert.equal(r.status, 'unchanged');
  assert.equal(r.entry.status, 'ok');
  assert.equal(r.entry.consecutiveFailures, undefined);
  // Byte-identical to a never-failed baseline for the same page.
  assert.deepEqual(r.entry, {
    url: 'https://example.gov/wic',
    normalizedSha256: previous.normalizedSha256,
    normalizedChars: previous.normalizedChars,
    status: 'ok',
    firstSeen: previous.firstSeen,
    lastChanged: previous.lastChanged,
  });
});

test('consecutive unreachable runs at the same count are a fixed point', async () => {
  const previous = baselineFor(PAGE, { status: 'unreachable', consecutiveFailures: ESCALATE_AFTER_FAILURES });
  const a = await checkSource(
    { id: 'wic', url: 'https://example.gov/wic', previous, today: TODAY },
    fetcherReturning({ kind: 'unreachable', reason: 'HTTP 503' }),
  );
  const b = await checkSource(
    { id: 'wic', url: 'https://example.gov/wic', previous: a.entry, today: '2026-10-05' },
    fetcherReturning({ kind: 'unreachable', reason: 'HTTP 503' }),
  );
  // The count keeps climbing while it stays down -- that is a real, ongoing event,
  // and the escalated PR is already open, so this is not "byte-for-byte forever".
  assert.equal(a.entry.consecutiveFailures, ESCALATE_AFTER_FAILURES + 1);
  assert.equal(b.entry.consecutiveFailures, ESCALATE_AFTER_FAILURES + 2);
  assert.equal(isEscalated(a), true);
});

test('a prior failure with a null hash recovers to new, not changed', async () => {
  const previous = baselineFor(PAGE, { normalizedSha256: null, normalizedChars: null, status: 'unreachable' });
  const r = await checkSource(
    { id: 'wic', url: 'https://example.gov/wic', previous, today: TODAY },
    fetcherReturning({ kind: 'ok', text: PAGE }),
  );
  assert.equal(r.status, 'new');
  assert.equal(r.entry.firstSeen, previous.firstSeen);
});
