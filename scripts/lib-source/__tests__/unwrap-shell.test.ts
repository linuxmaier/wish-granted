import { test } from 'node:test';
import assert from 'node:assert/strict';

import { unwrapContentShell } from '../unwrap-shell.ts';
import { normalize } from '../normalize.ts';
import { renderStructured } from '../html-structure.ts';

const bigBody = (inner: string) =>
  `<main><h1>Program</h1>${inner}<p>${'eligibility detail sentence. '.repeat(40)}</p></main>`;

test('a <form> wrapping the whole body is neutralised to a <div>', () => {
  const html = `<!doctype html><html><body><form id="aspnetForm" method="post">${bigBody('')}</form></body></html>`;
  const r = unwrapContentShell(html);
  assert.equal(r.unwrapped, true);
  assert.equal(r.count, 1);
  assert.match(r.html, /<div data-unwrapped-shell="form">/);
  assert.doesNotMatch(r.html, /<form/i);
  assert.match(r.html, /<\/div><\/body>/);
});

test('normalize() goes from empty to real text once the wrapper is unwrapped', () => {
  const html = `<!doctype html><html><body><form id="aspnetForm">${bigBody('')}</form></body></html>`;
  assert.equal(normalize(html).length, 0);
  const r = unwrapContentShell(html);
  assert.ok(normalize(r.html).length > 300);
  assert.match(normalize(r.html), /eligibility detail/);
});

test('table column headers survive the unwrap (renderStructured keeps them attached)', () => {
  const table =
    '<table><caption>Income limits</caption>' +
    '<thead><tr><th>Household Size</th><th>Annual Income</th></tr></thead>' +
    '<tbody><tr><th>1</th><td>$38,421</td></tr><tr><th>4</th><td>$73,888</td></tr></tbody></table>';
  const html = `<html><body><form name="aspnetForm">${bigBody(table)}</form></body></html>`;
  const s = renderStructured(unwrapContentShell(html).html);
  assert.match(s, /columns: Household Size \| Annual Income/);
  assert.match(s, /Annual Income = \$73,888/);
});

test('heading hierarchy survives the unwrap', () => {
  const html =
    `<html><body><form id="aspnetForm"><main>` +
    `<h2>Coverage levels are cost-sharing tiers</h2>` +
    `<h3>Level 3</h3><p>${'no upper income limit for level 3. '.repeat(20)}</p>` +
    `</main></form></body></html>`;
  const s = renderStructured(unwrapContentShell(html).html);
  assert.match(s, /## Coverage levels are cost-sharing tiers/);
  assert.match(s, /### Level 3/);
  assert.match(s, /\[Coverage levels are cost-sharing tiers > Level 3\]/);
});

test('a small form (search box, login) is left alone', () => {
  const html =
    `<html><body>` +
    `<form action="/search"><input name="q"><button>Go</button></form>` +
    bigBody('') +
    `</body></html>`;
  const r = unwrapContentShell(html);
  assert.equal(r.unwrapped, false);
  assert.equal(r.html, html);
});

test('a page with no form at all is returned byte-for-byte', () => {
  const html = `<html><body>${bigBody('')}</body></html>`;
  const r = unwrapContentShell(html);
  assert.equal(r.unwrapped, false);
  assert.equal(r.html, html);
});

test('nested forms: only the outer wrapper is rewritten, depth stays balanced', () => {
  // Real WebForms never nests <form>, but tag soup can. The depth counter must
  // not mistake an inner </form> for the wrapper's close.
  const html =
    `<html><body><form id="aspnetForm">${bigBody('<div><form action="/x"><input name="a"></form></div>')}</form></body></html>`;
  const r = unwrapContentShell(html);
  assert.equal(r.unwrapped, true);
  // exactly one wrapper rewritten; the inner form's tags remain
  assert.equal((r.html.match(/<div data-unwrapped-shell/g) ?? []).length, 1);
  assert.match(r.html, /<form action="\/x">/);
});

test('CSRF / viewstate input values do not survive into normalized text', () => {
  const html =
    `<html><body><form id="aspnetForm">` +
    `<input type="hidden" name="__VIEWSTATE" value="d3JpdGV0aGlzZG93bnNvbWVsb25nb3BhcXVldG9rZW524chars" />` +
    bigBody('') +
    `</form></body></html>`;
  const text = normalize(unwrapContentShell(html).html);
  assert.doesNotMatch(text, /VIEWSTATE|d3JpdGV0aGlz/);
  assert.match(text, /eligibility detail/);
});
