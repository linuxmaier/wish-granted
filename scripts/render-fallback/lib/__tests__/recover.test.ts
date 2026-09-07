import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { recoverEmptyPage } from '../recover.ts';
import type { BrowserRenderer } from '../browser.ts';
import { normalize } from '../../../check-sources/lib/normalize.ts';
import { renderStructured } from '../../../agentic-extract/lib/html-structure.ts';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../tests/fixtures/js-pages');
const measure = (h: string) => normalize(h).length;

const SHELL = (body: string) =>
  `<!doctype html><html><body><form id="aspnetForm" method="post">` +
  `<input type="hidden" name="__VIEWSTATE" value="AAAABBBBCCCCDDDDEEEEFFFFGGGG1234" />` +
  `<main>${body}<p>${'household income eligibility sentence. '.repeat(30)}</p></main>` +
  `</form></body></html>`;

const neverCalled: BrowserRenderer = {
  render: async () => {
    throw new Error('browser renderer must not be called on the deterministic path');
  },
};

test('step 1: an ASP.NET form shell is recovered with no browser', async () => {
  const html = SHELL('<h1>WHEAP</h1>');
  assert.equal(measure(html), 0);
  const r = await recoverEmptyPage({ url: 'https://x.gov/a.aspx', html }, { measure, renderer: neverCalled });
  assert.equal(r.recovered, true);
  assert.equal(r.method, 'unwrap-shell');
  assert.ok(r.textLength > 300);
  assert.match(normalize(r.html), /household income eligibility/);
});

test('a page that already reduced fine is returned untouched', async () => {
  const html = '<html><body><main><p>' + 'plenty of real content here. '.repeat(30) + '</p></main></body></html>';
  const r = await recoverEmptyPage({ url: 'https://x.gov/', html }, { measure, renderer: neverCalled });
  assert.equal(r.recovered, false);
  assert.equal(r.method, 'none');
  assert.equal(r.html, html);
});

test('a JS-only page: no recovery without allowBrowser, flagged for the caller', async () => {
  const html = '<html><body><div id="root"></div><script>/* renders later */</script></body></html>';
  const r = await recoverEmptyPage({ url: 'https://x.gov/spa', html }, { measure });
  assert.equal(r.recovered, false);
  assert.match(r.note, /no browser fallback requested|allowBrowser/);
});

test('step 2: a JS-only page is recovered via the injected renderer', async () => {
  const html = '<html><body><div id="root"></div><script>x()</script></body></html>';
  const hydrated =
    '<html><body><div id="root"><main><h1>Now Here</h1><p>' +
    'rendered eligibility copy. '.repeat(30) + '</p></main></div></body></html>';
  const renderer: BrowserRenderer = { render: async () => ({ ok: true, html: hydrated, finalUrl: 'https://x.gov/spa' }) };
  const r = await recoverEmptyPage({ url: 'https://x.gov/spa', html }, { measure, allowBrowser: true, renderer });
  assert.equal(r.recovered, true);
  assert.equal(r.method, 'browser-render');
  assert.match(normalize(r.html), /rendered eligibility copy/);
});

test('step 2: a rendered WebForms SPA is unwrapped after the render', async () => {
  const html = '<html><body><div id="root"></div><script>x()</script></body></html>';
  const renderedShell = SHELL('<h1>Hydrated WHEAP</h1>');
  const renderer: BrowserRenderer = { render: async () => ({ ok: true, html: renderedShell, finalUrl: 'u' }) };
  const r = await recoverEmptyPage({ url: 'https://x.gov/spa', html }, { measure, allowBrowser: true, renderer });
  assert.equal(r.recovered, true);
  assert.equal(r.method, 'browser-render+unwrap-shell');
});

test('step 2: browser unavailable degrades to "not recovered" (never throws)', async () => {
  const html = '<html><body><div id="root"></div></body></html>';
  const renderer: BrowserRenderer = { render: async () => ({ ok: false, reason: 'Chromium would not launch' }) };
  const r = await recoverEmptyPage({ url: 'https://x.gov/spa', html }, { measure, allowBrowser: true, renderer });
  assert.equal(r.recovered, false);
  assert.match(r.note, /could not run|Chromium/);
});

test('step 2: browser reaches the page but it is still empty -> hand-authored', async () => {
  const html = '<html><body><div id="root"></div></body></html>';
  const renderer: BrowserRenderer = { render: async () => ({ ok: true, html: '<html><body><div></div></body></html>', finalUrl: 'u' }) };
  const r = await recoverEmptyPage({ url: 'https://x.gov/spa', html }, { measure, allowBrowser: true, renderer });
  assert.equal(r.recovered, false);
  assert.match(r.note, /not in the DOM|hand-authored/);
});

// --- the real motivating pages -------------------------------------------------
for (const file of ['wheap-energy-assistance.aspx.html', 'weatherization.aspx.html']) {
  test(`real fixture ${file}: plain fetch is empty, recovery yields eligibility text with structure`, async () => {
    const raw = readFileSync(resolve(FIXTURES, file), 'utf8');

    assert.equal(normalize(raw).length, 0, 'precondition: plain normalize is empty');
    assert.equal(renderStructured(raw).length, 0, 'precondition: plain renderStructured is empty');

    const viaNormalize = await recoverEmptyPage({ url: `https://energyandhousing.wi.gov/${file}`, html: raw }, { measure });
    assert.equal(viaNormalize.recovered, true);
    assert.equal(viaNormalize.method, 'unwrap-shell');
    assert.ok(viaNormalize.textLength > 1000, `expected >1000 chars, got ${viaNormalize.textLength}`);

    const viaStructure = await recoverEmptyPage(
      { url: `https://energyandhousing.wi.gov/${file}`, html: raw },
      { measure: (h) => renderStructured(h).length },
    );
    assert.equal(viaStructure.recovered, true);
    const s = renderStructured(viaStructure.html);
    assert.match(s, /^#+ /m, 'headings preserved');
  });
}

test('real WHEAP page: the 60%-SMI income table survives with column headers and dollar figures', async () => {
  const raw = readFileSync(resolve(FIXTURES, 'wheap-energy-assistance.aspx.html'), 'utf8');
  const r = await recoverEmptyPage(
    { url: 'https://energyandhousing.wi.gov/x', html: raw },
    { measure: (h) => renderStructured(h).length },
  );
  const s = renderStructured(r.html);
  assert.match(s, /columns:.*Household Size/i);
  assert.match(s, /Annual Income = \$\d{2},\d{3}/);
  assert.match(normalize(r.html), /Income Guidelines/);
});
