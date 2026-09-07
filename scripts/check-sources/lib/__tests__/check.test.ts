import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkSource,
  isEscalated,
  normalizeWithUnwrap,
  ESCALATE_AFTER_FAILURES,
  MIN_PLAUSIBLE_CHARS,
  type Fetcher,
} from '../check.ts';
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

/**
 * Issue #82: the empty-string normalization must be its own outcome. Before this,
 * an empty page hashed to sha256("") == the stored empty baseline and reported
 * `unchanged` -- change detection silently off. A page whose reducer output is
 * empty (a <form>-wrapped SharePoint page the unwrap could not save, a template
 * the landmark chain misses) is `unreadable`, escalates, and never advances the
 * baseline.
 */
const EMPTY_PAGE = '<!doctype html><html><body><form id="aspnetForm"><input name="__VIEWSTATE" value="x"></form></body></html>';

test('#82: an empty normalization is `unreadable`, never `unchanged`', async () => {
  const emptyBaseline = baselineFor('<html><body></body></html>', {
    normalizedSha256: sha256(''),
    normalizedChars: 0,
  });
  assert.equal(normalize(EMPTY_PAGE), '', 'precondition: this page reduces to nothing');
  assert.equal(emptyBaseline.normalizedSha256, sha256(normalize(EMPTY_PAGE)), 'precondition: matches the empty baseline');

  const r = await checkSource(
    { id: 'wheap', url: 'https://energyandhousing.wi.gov/x.aspx', previous: emptyBaseline, today: TODAY },
    fetcherReturning({ kind: 'ok', text: EMPTY_PAGE }),
  );
  assert.equal(r.status, 'unreadable', 'must NOT be folded into unchanged');
  assert.equal(isEscalated(r), true, 'a bug signal a human should see');
  assert.equal(r.entry.status, 'unreadable');
});

test('#82: a brand-new record that reduces to empty is `unreadable`, not a `new` baseline', async () => {
  const r = await checkSource(
    { id: 'wheap', url: 'https://energyandhousing.wi.gov/x.aspx', previous: undefined, today: TODAY },
    fetcherReturning({ kind: 'ok', text: EMPTY_PAGE }),
  );
  assert.equal(r.status, 'unreadable');
  assert.notEqual(r.entry.normalizedSha256, sha256(''), 'the empty hash is never recorded as a baseline');
  assert.equal(r.entry.normalizedSha256, null);
});

test('#82: `unreadable` keeps the last good hash and is a run-to-run fixed point', async () => {
  const good = baselineFor(PAGE);
  const a = await checkSource(
    { id: 'wic', url: 'https://example.gov/wic', previous: good, today: TODAY },
    fetcherReturning({ kind: 'ok', text: EMPTY_PAGE }),
  );
  assert.equal(a.status, 'unreadable');
  assert.equal(a.entry.normalizedSha256, good.normalizedSha256, 'last good hash retained');
  const b = await checkSource(
    { id: 'wic', url: 'https://example.gov/wic', previous: a.entry, today: '2026-10-05' },
    fetcherReturning({ kind: 'ok', text: EMPTY_PAGE }),
  );
  assert.deepEqual(b.entry, a.entry, 'second run reproduces the entry byte-for-byte');
});

/**
 * Issue #82: the motivating case. ASP.NET WebForms / SharePoint
 * (energyandhousing.wi.gov) wraps the whole <body> in one <form id="aspnetForm">;
 * normalize() strips <form> wholesale, so the WHEAP income guidelines came back
 * as "" and hashed to sha256(""). `normalizeWithUnwrap` neutralises that wrapper
 * (reusing scripts/render-fallback/lib/unwrap-shell.ts) and retries.
 */
const WEBFORMS_PAGE = (csrf: string, reviewed: string) =>
  `<!doctype html><html lang="en"><head><title>Energy Assistance</title></head><body>` +
  `<form method="post" action="./energy-assistance.aspx" id="aspnetForm">` +
  `<input type="hidden" name="__VIEWSTATE" value="${csrf}">` +
  `<header><nav><a href="/">Skip to the county agency directory</a></nav></header>` +
  `<main><h1>Wisconsin Energy Assistance Program</h1><h2>Income Guidelines</h2>` +
  `<p>Your household may qualify if gross income is at or below 60% of the state median income.</p>` +
  `<p>A household of four qualifies at or below $5,838 per month; a household of one at $3,036 per month.</p>` +
  `<p>Benefits are paid once per heating season directly to your energy provider.</p>` +
  `<p>Page last reviewed: ${reviewed}</p></main>` +
  `<footer><a href="/privacy">Privacy policy</a></footer>` +
  `</form></body></html>`;

test('#82: a <form>-wrapped page normalizes to real text (not the empty string)', () => {
  const bare = normalize(WEBFORMS_PAGE('AAAABBBBCCCCDDDD1234', 'September 5, 2026'));
  assert.equal(bare, '', 'precondition: plain normalize() still strips the whole <form>');

  const r = normalizeWithUnwrap(WEBFORMS_PAGE('AAAABBBBCCCCDDDD1234', 'September 5, 2026'));
  assert.ok(r.text.length > 200, `expected real text, got ${r.text.length} chars`);
  assert.equal(r.region, 'main');
  assert.match(r.text, /Income Guidelines/);
  assert.match(r.text, /60% of the state median income/);
  assert.doesNotMatch(r.text, /county agency directory/, 'wrapped nav still dropped');
  assert.doesNotMatch(r.text, /Privacy policy/, 'wrapped footer still dropped');
  assert.doesNotMatch(r.text, /VIEWSTATE|AAAABBBB/, 'CSRF/viewstate value never reaches the text');
});

test('#82: the unwrap keeps #7 run-to-run stability (CSRF token + reviewed date churn)', () => {
  const a = normalizeWithUnwrap(WEBFORMS_PAGE('TOKEN-aaaa-1111', 'September 5, 2026')).text;
  const b = normalizeWithUnwrap(WEBFORMS_PAGE('TOKEN-zzzz-9999', 'November 20, 2026')).text;
  assert.equal(a, b, `unwrapped output churned:\n--- A ---\n${a}\n--- B ---\n${b}`);
  assert.equal(sha256(a), sha256(b));
});

test('#82: checkSource on a form-wrapped page reports real text, re-baselining off the empty hash', async () => {
  const emptyBaseline = baselineFor('<html><body></body></html>', {
    normalizedSha256: sha256(''),
    normalizedChars: 0,
    firstSeen: '2026-09-05',
    lastChanged: '2026-09-05',
  });
  const r = await checkSource(
    {
      id: 'wheap-energy-assistance',
      url: 'https://energyandhousing.wi.gov/Pages/AgencyResources/energy-assistance.aspx',
      previous: emptyBaseline,
      today: TODAY,
    },
    fetcherReturning({ kind: 'ok', text: WEBFORMS_PAGE('AAAABBBBCCCCDDDD1234', 'September 5, 2026') }),
  );
  assert.equal(r.status, 'changed', 'the empty baseline -> a real hash is a (correction) change');
  assert.ok((r.entry.normalizedChars ?? 0) > 200);
  assert.notEqual(r.entry.normalizedSha256, sha256(''));
  assert.equal(r.entry.firstSeen, '2026-09-05', 'firstSeen preserved');
});

test('#82: a real <main> page never enters the unwrap retry (small form left alone)', () => {
  const withSearchForm = PAGE.replace(
    '<h1>WIC</h1>',
    '<h1>WIC</h1><form action="/search"><input name="q"><button>Go</button></form>',
  );
  assert.equal(normalizeWithUnwrap(withSearchForm).text, normalize(withSearchForm));
});

test('#82: a short-but-real page just above the floor is still `unchanged`', async () => {
  const shortPage = `<html><body><main><p>${'x'.repeat(MIN_PLAUSIBLE_CHARS + 40)}</p></main></body></html>`;
  const previous = baselineFor(shortPage);
  assert.ok(normalize(shortPage).length >= MIN_PLAUSIBLE_CHARS);
  const r = await checkSource(
    { id: 'wic', url: 'https://example.gov/wic', previous, today: TODAY },
    fetcherReturning({ kind: 'ok', text: shortPage }),
  );
  assert.equal(r.status, 'unchanged');
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
