import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  sha256,
  normalize,
  normalizeToResult,
  isolateContentRegion,
  isolateContentRegionWithSource,
  looksLikeHtml,
} from '../normalize.ts';


/**
 * The acceptance criterion from issue #7 that is actually hard: "stable across
 * two consecutive runs on unchanged pages (no false-positive churn)". These
 * tests encode it as a real assertion, not a claim.
 *
 * `PAGE_RUN_A` and `PAGE_RUN_B` are the *same* government page as it might be
 * served on two different requests: the eligibility content is byte-identical,
 * but everything Section 5 of docs/archive/eligibility-extraction.md identified as
 * incidental churn differs -- CSRF token, session id in a link, a rotating
 * announcement banner, the "page last reviewed" date, an analytics blob, a
 * nonce, the copyright year, a "N views" counter, whitespace, and an HTML
 * comment.
 */

const PAGE_RUN_A = `<!doctype html>
<html lang="en">
<head>
  <title>FoodShare | Wisconsin Department of Health Services</title>
  <meta name="csrf-token" content="a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6">
  <script nonce="RANDOMNONCE111">window.dataLayer = [{"pageView":"2026-09-05T12:01:03Z","visitId":"sess-abc123def456ghi789"}];</script>
  <style>.hero{color:#003366}</style>
</head>
<body>
  <div class="announcement-ribbon">Reminder: county offices closed Sept 5 for the holiday.</div>
  <header>
    <nav aria-label="Primary"><a href="/">Home</a> <a href="/foodshare/?sid=SESSION-1111-AAAA">FoodShare</a></nav>
  </header>
  <main id="main-content">
    <h1>FoodShare</h1>
    <!-- editor note: check with policy before Oct -->
    <p>FoodShare helps people with limited income buy food. Benefits load onto a QUEST card each month.</p>
    <h2>Who can get FoodShare</h2>
    <p>Most households qualify if gross monthly income is at or below 200% of the federal poverty level.</p>
    <p>People who get SSI or Wisconsin Works (W-2) qualify no matter their income.</p>
    <p>Page last reviewed: September 5, 2026</p>
    <p>1,204 people viewed this page this week.</p>
  </main>
  <footer>
    <p>&copy; 2026 Wisconsin Department of Health Services</p>
    <a href="/privacy?token=xyz987xyz987xyz987xyz987">Privacy</a>
  </footer>
</body>
</html>`;

const PAGE_RUN_B = `<!doctype html>
<html lang="en">
<head>
  <title>FoodShare | Wisconsin Department of Health Services</title>
  <meta name="csrf-token" content="99887766zzzzyyyyxxxxwwwwvvvvuuuu">
  <script nonce="DIFFERENTNONCE22">window.dataLayer = [{"pageView":"2026-11-20T23:47:55Z","visitId":"sess-zzz999yyy888www777"}];</script>
  <style>.hero{color:#003366}</style>
</head>
<body>
  <div class="announcement-ribbon">Open enrollment for BadgerCare starts November 1. Learn more.</div>
  <header>
    <nav aria-label="Primary"><a href="/">Home</a> <a href="/foodshare/?sid=SESSION-2222-BBBB">FoodShare</a></nav>
  </header>
  <main id="main-content">
    <h1>FoodShare</h1>
    <p>FoodShare helps people with limited income buy food. Benefits load onto a QUEST card each month.</p>
    <h2>Who can get FoodShare</h2>
    <p>Most households qualify if gross monthly income is at or below 200% of the federal poverty level.</p>
    <p>People who get SSI or Wisconsin Works (W-2) qualify no matter their income.</p>
    <p>Page last reviewed: November 20, 2026</p>
    <p>876 people viewed this page this week.</p>
  </main>
  <footer>
    <p>&copy; 2027 Wisconsin Department of Health Services</p>
    <a href="/privacy?token=aaa111aaa111aaa111aaa111">Privacy</a>
  </footer>
</body>
</html>`;

test('normalize is byte-identical across two churned renders of the same page', () => {
  const a = normalize(PAGE_RUN_A);
  const b = normalize(PAGE_RUN_B);
  assert.equal(a, b, `normalized output differed:\n--- A ---\n${a}\n--- B ---\n${b}`);
  assert.equal(sha256(a), sha256(b));
});

test('normalize is idempotent (running it twice changes nothing)', () => {
  const once = normalize(PAGE_RUN_A);
  assert.equal(normalize(once), once);
});

test('normalize keeps the eligibility-bearing sentences', () => {
  const out = normalize(PAGE_RUN_A);
  assert.match(out, /200% of the federal poverty level/);
  assert.match(out, /SSI or Wisconsin Works/);
});

test('normalize drops nav, announcement ribbon, footer, and the reviewed-on date', () => {
  const out = normalize(PAGE_RUN_A);
  assert.doesNotMatch(out, /county offices closed/i);
  assert.doesNotMatch(out, /Privacy/);
  assert.doesNotMatch(out, /viewed this page/i);
  assert.doesNotMatch(out, /September 5, 2026/);
  assert.doesNotMatch(out, /Home/);
});

test('a real edit to the eligibility text DOES change the hash', () => {
  const edited = PAGE_RUN_A.replace('200% of the federal poverty level', '185% of the federal poverty level');
  assert.notEqual(sha256(normalize(PAGE_RUN_A)), sha256(normalize(edited)));
});

test('a new caveat paragraph in <main> DOES change the hash', () => {
  const edited = PAGE_RUN_A.replace(
    '</main>',
    '<p>New: adults 18-52 without dependents face a work requirement after 3 months.</p></main>',
  );
  assert.notEqual(sha256(normalize(PAGE_RUN_A)), sha256(normalize(edited)));
});

test('isolateContentRegion returns <main> inner content, not the chrome', () => {
  const region = isolateContentRegion(PAGE_RUN_A);
  assert.match(region, /Who can get FoodShare/);
  assert.doesNotMatch(region, /county offices closed/);
});

test('isolateContentRegion is depth-aware: a nested block does not truncate the slice', () => {
  const html = `<main><p>start</p><div><div>deeply <span>nested</span></div></div><p>end sentinel</p></main>`;
  const region = isolateContentRegion(html);
  assert.match(region, /end sentinel/);
});

test('isolateContentRegion falls back to <body> when there is no landmark', () => {
  const html = `<html><head><title>x</title></head><body><nav>menu</nav><p>only content here, long enough to pass the length gate ${'x'.repeat(200)}</p></body></html>`;
  const { html: region, region: which } = isolateContentRegionWithSource(html);
  assert.match(region, /only content here/);
  assert.doesNotMatch(region, /<title>/);
  assert.equal(which, 'body');
});

test('landmark chain: <main> wins when present', () => {
  const html = `<body><nav>nav</nav><div role="main"><p>role main ${'x'.repeat(200)}</p></div><main><p>real main content ${'y'.repeat(200)}</p></main></body>`;
  const { region } = isolateContentRegionWithSource(html);
  assert.equal(region, 'main');
});

test('landmark chain: [role="main"] is used when there is no <main>', () => {
  const html = `<body><nav>site nav that should be dropped</nav><div role="main"><p>the article body, well past the length gate ${'x'.repeat(200)}</p></div><footer>footer</footer></body>`;
  const { html: region, region: which } = isolateContentRegionWithSource(html);
  assert.equal(which, 'role-main');
  assert.match(region, /the article body/);
  assert.doesNotMatch(region, /site nav/);
});

test('landmark chain: #content / #main container is used before <body>', () => {
  for (const id of ['content', 'main', 'main-content', 'maincontent']) {
    const html = `<body><nav>primary navigation menu, incidental</nav><div id="${id}"><p>eligibility copy that matters, long enough to pass ${'z'.repeat(200)}</p></div></body>`;
    const { html: region, region: which } = isolateContentRegionWithSource(html);
    assert.equal(which, 'id-landmark', `id="${id}"`);
    assert.match(region, /eligibility copy that matters/);
    assert.doesNotMatch(region, /primary navigation/);
  }
});

test('landmark chain: a near-miss id ("main-header", "content-sidebar") is not treated as the landmark', () => {
  const html = `<body><header id="main-header">masthead</header><div id="content-sidebar">links</div><p>the actual page body with enough length to matter ${'q'.repeat(200)}</p></body>`;
  assert.equal(isolateContentRegionWithSource(html).region, 'body');
});

test('normalizeToResult reports the weak <body> fallback so the caller can name it', () => {
  const noLandmark = `<!doctype html><html><body><nav><a href="/">Home</a> <a href="/apply">Apply</a></nav>
    <h1>Program</h1><p>Households at or below 150% of the federal poverty level qualify. ${'x'.repeat(200)}</p>
    <footer>Copyright</footer></body></html>`;
  const r = normalizeToResult(noLandmark);
  assert.equal(r.region, 'body');
  assert.match(r.text, /150% of the federal poverty level/);

  const withMain = noLandmark.replace('<body>', '<body><main>').replace('</body>', '</main></body>');
  assert.equal(normalizeToResult(withMain).region, 'main');
});

test('a new nav item does NOT move the hash once a real landmark exists', () => {
  const base = `<body><nav>Home Apply Contact</nav><main><h1>WIC</h1><p>Income at or below 185% FPL. ${'x'.repeat(200)}</p></main></body>`;
  const withExtraNav = base.replace('Home Apply Contact', 'Home Apply Contact News Events');
  assert.equal(sha256(normalize(base)), sha256(normalize(withExtraNav)));
});

test('normalize() still returns a plain string (back-compatible)', () => {
  assert.equal(typeof normalize('<main><p>hi there everyone</p></main>'), 'string');
});

test('entities are decoded so &amp; / &nbsp; / numeric refs do not read as changes', () => {
  const withEntities = `<main><p>Food&nbsp;&amp;&#32;shelter &#x2014; both&rsquo;s covered</p></main>`;
  const withChars = `<main><p>Food & shelter - both's covered</p></main>`;
  assert.equal(normalize(withEntities), normalize(withChars));
});

test('looksLikeHtml distinguishes a JSON feed from a page', () => {
  assert.equal(looksLikeHtml('<!DOCTYPE html><html>'), true);
  assert.equal(looksLikeHtml('{"data":{"year":"2026"}}'), false);
});

test('non-HTML input still gets volatile-pattern scrubbing', () => {
  const a = normalize('{"updated":"2026-09-05T00:00:00Z","limit":33000}');
  const b = normalize('{"updated":"2026-11-01T12:00:00Z","limit":33000}');
  assert.equal(a, b);
});
