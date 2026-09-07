import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseStructure, renderStructured, flattenText } from '../html-structure.ts';

test('table rows keep their column headers attached to every cell', () => {
  const html = `<table>
    <tr><th>Household size</th><th>Adult monthly income limit (100% FPL)</th><th>Pregnant people monthly income limit (306% FPL)</th></tr>
    <tr><td>1</td><td>$1,255</td><td>$3,841</td></tr>
  </table>`;
  const nodes = parseStructure(html);
  const table = nodes.find((n) => n.type === 'table');
  assert.ok(table && table.type === 'table');
  assert.deepEqual(table.columnHeaders, [
    'Household size',
    'Adult monthly income limit (100% FPL)',
    'Pregnant people monthly income limit (306% FPL)',
  ]);
  assert.equal(table.rows.length, 1);
  assert.deepEqual(table.rows[0], [
    { header: 'Household size', cell: '1' },
    { header: 'Adult monthly income limit (100% FPL)', cell: '$1,255' },
    { header: 'Pregnant people monthly income limit (306% FPL)', cell: '$3,841' },
  ]);
});

test('a bare $3,841 is never severed from its population column header in the render', () => {
  const html = `<h1>BadgerCare</h1><table>
    <tr><th>Size</th><th>Pregnant people monthly income limit (306% FPL)</th></tr>
    <tr><td>1</td><td>$3,841</td></tr></table>`;
  const rendered = renderStructured(html);
  assert.match(rendered, /Pregnant people monthly income limit \(306% FPL\) = \$3,841/);
});

test('every block carries the heading path it sits under', () => {
  const html = `<h1>SeniorCare</h1><h2>Coverage levels</h2><p>Level 3 has no upper income limit.</p>`;
  const nodes = parseStructure(html);
  const para = nodes.find((n) => n.type === 'paragraph');
  assert.ok(para);
  assert.deepEqual(para.path, ['SeniorCare', 'Coverage levels']);
});

test('script/style/nav are dropped', () => {
  const html = `<nav>menu</nav><script>var x=1</script><main><p>real copy</p></main><style>.a{}</style>`;
  assert.equal(flattenText(html).trim(), 'real copy');
});

test('handles unclosed <p> and uppercase tags', () => {
  const nodes = parseStructure(`<P>one<P>two<P>three`);
  assert.deepEqual(nodes.map((n) => (n.type === 'paragraph' ? n.text : null)), ['one', 'two', 'three']);
});

test('eCFR-style XML flattens to readable text for span matching', () => {
  const xml = `<DIV8><HEAD>§ 273.1</HEAD><P>(a) General.</P><P>(2) Notwithstanding the provisions of paragraph (a) of this section, 165 percent of the poverty line.</P></DIV8>`;
  const flat = flattenText(xml);
  assert.match(flat, /Notwithstanding the provisions of paragraph \(a\) of this section/);
  assert.match(flat, /165 percent of the poverty line/);
});
