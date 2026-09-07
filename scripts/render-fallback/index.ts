// No shebang -- run as `node scripts/render-fallback/index.ts` via an npm script
// (same note as the other scripts; Vite does not strip a `#!` line when a test
// imports a sibling module).
/**
 * Empty-page recovery for the extraction pipelines (issue #76, part of epic #65).
 *
 * A shared fallback used by scripts/ingest-descriptive and scripts/agentic-extract:
 * when a plain fetch + the caller's own text reducer come back (near-)empty, try
 * to recover the real content -- first by neutralising an ASP.NET WebForms /
 * SharePoint `<form>` wrapper (deterministic, no network), then, opt-in, by
 * rendering in headless Chromium.
 *
 * THE #76 FINDING, UP FRONT: energyandhousing.wi.gov is NOT a JS-rendered SPA.
 * A plain fetch already returns the full WHEAP income table and eligibility
 * prose. Both pipelines saw "zero text" only because their reducers strip
 * `<form>` wholesale and WebForms wraps the whole body in one. `unwrapContentShell`
 * fixes all three motivating records with no browser. See lib/unwrap-shell.ts.
 *
 * Usage:
 *   node scripts/render-fallback/index.ts --self-test      # offline; CI smoke gate
 *   node scripts/render-fallback/index.ts --browser-check   # launches real Chromium (skips cleanly if absent)
 *   node scripts/render-fallback/index.ts --demo=<path.html> --url=<u>   # print a before/after for one saved page
 *
 * Exit codes: 0 pass / clean; 1 a self-test assertion failed.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname, join } from 'node:path';

import { normalize } from '../check-sources/lib/normalize.ts';
import { renderStructured } from '../agentic-extract/lib/html-structure.ts';
import { unwrapContentShell } from './lib/unwrap-shell.ts';
import { recoverEmptyPage } from './lib/recover.ts';
import { renderStaticHtml, playwrightRenderer, type BrowserRenderer } from './lib/browser.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolvePath(HERE, '../../tests/fixtures/js-pages');

const measureNormalize = (h: string): number => normalize(h).length;
const measureStructured = (h: string): number => renderStructured(h).length;

interface Args {
  selfTest: boolean;
  browserCheck: boolean;
  demoPath: string | undefined;
  demoUrl: string | undefined;
  allowBrowser: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    selfTest: false,
    browserCheck: false,
    demoPath: undefined,
    demoUrl: undefined,
    allowBrowser: false,
  };
  for (const a of argv) {
    if (a === '--self-test') args.selfTest = true;
    else if (a === '--browser-check') args.browserCheck = true;
    else if (a === '--allow-browser') args.allowBrowser = true;
    else if (a.startsWith('--demo=')) args.demoPath = a.slice('--demo='.length);
    else if (a.startsWith('--url=')) args.demoUrl = a.slice('--url='.length);
    else throw new Error(`Unrecognized argument: ${a}`);
  }
  return args;
}

/** A stub renderer for the self-test: returns a canned "hydrated" DOM. */
function stubRenderer(html: string): BrowserRenderer {
  return { render: async () => ({ ok: true as const, html, finalUrl: 'https://example.test/rendered' }) };
}

async function selfTest(): Promise<number> {
  const failures: string[] = [];
  const ok = (label: string) => console.log(`  ok    ${label}`);
  const fail = (label: string, detail: string) => {
    failures.push(`${label}: ${detail}`);
    console.error(`  FAIL  ${label} -- ${detail}`);
  };

  // 1. Argv parsing.
  parseArgs(['--self-test']);
  try {
    parseArgs(['--nope']);
    fail('parseArgs rejects unknown flags', 'accepted --nope');
  } catch {
    ok('parseArgs rejects unknown flags');
  }

  // 2. unwrapContentShell on a synthetic ASP.NET WebForms shell.
  const shell =
    `<!doctype html><html><head><title>t</title></head><body>` +
    `<form method="post" action="./x.aspx" id="aspnetForm">` +
    `<input type="hidden" name="__VIEWSTATE" value="AAAAAAAABBBBBBBBCCCCCCCCDDDDDDDD" />` +
    `<main><h1>WHEAP</h1><h3>Income Guidelines</h3>` +
    `<table><caption>Income limits</caption><thead><tr><th>Household Size</th><th>Annual Income</th></tr></thead>` +
    `<tbody><tr><th>1</th><td>$38,421</td></tr><tr><th>4</th><td>$73,888</td></tr></tbody></table>` +
    `<p>Based on 60% of Wisconsin's median income. Households with income at or below the amounts ` +
    `shown may qualify during the 2025-2026 program year for help with heating and electric bills ` +
    `through the Wisconsin Home Energy Assistance Program, which is funded by LIHEAP and the Public ` +
    `Benefits program and administered by local county agencies across the state.</p></main></form></body></html>`;
  const beforeN = normalize(shell).length;
  const u = unwrapContentShell(shell);
  const afterN = normalize(u.html).length;
  if (beforeN > 40) fail('form-wrapped shell reduces to ~nothing', `normalize gave ${beforeN} chars`);
  else ok(`form-wrapped shell reduces to ~nothing (${beforeN} chars)`);
  if (!u.unwrapped || afterN < 120) fail('unwrap recovers the shell body', `unwrapped=${u.unwrapped}, ${afterN} chars`);
  else ok(`unwrap recovers the shell body (${beforeN} -> ${afterN} chars)`);
  if (!normalize(u.html).includes('Income Guidelines')) fail('recovered text keeps the heading', 'missing "Income Guidelines"');
  else ok('recovered text keeps the heading');

  // 2b. Structure survives: the table headers must still be attached.
  const struct = renderStructured(u.html);
  if (!/Household Size.*\$38,421|\$38,421.*Household Size/s.test(struct.replace(/\s+/g, ' '))) {
    // fall back to a looser check: header word and a cell value both present near "row:"
    if (!(struct.includes('Household Size') && struct.includes('$38,421') && struct.includes('columns:'))) {
      fail('table structure survives unwrap', 'column header not attached to cell in renderStructured output');
    } else ok('table structure survives unwrap');
  } else ok('table structure survives unwrap');

  // 3. A normal page is untouched (no wrapper form -> no-op).
  const plain = '<html><body><main><h1>Hi</h1><p>' + 'real content '.repeat(30) + '</p></main></body></html>';
  const plainU = unwrapContentShell(plain);
  if (plainU.unwrapped || plainU.html !== plain) fail('no-wrapper page is a no-op', 'unwrap mutated a plain page');
  else ok('no-wrapper page is a no-op');

  // 4. recoverEmptyPage ladder with an injected renderer (no real browser).
  const r1 = await recoverEmptyPage({ url: 'https://x.test/a.aspx', html: shell }, { measure: measureNormalize });
  if (!r1.recovered || r1.method !== 'unwrap-shell') fail('recover: step 1 handles the shell', JSON.stringify(r1.method));
  else ok('recover: step 1 (unwrap) handles the shell');

  const jsOnly =
    '<!doctype html><html><body><div id="root"></div>' +
    '<script>document.getElementById("root").innerHTML="x"</script></body></html>';
  const hydrated =
    '<!doctype html><html><body><div id="root"><main><h1>Now Rendered</h1><p>' +
    'eligibility copy '.repeat(20) + '</p></main></div></body></html>';
  const r2 = await recoverEmptyPage(
    { url: 'https://x.test/spa', html: jsOnly },
    { measure: measureNormalize, allowBrowser: true, renderer: stubRenderer(hydrated) },
  );
  if (!r2.recovered || !r2.method.startsWith('browser-render')) fail('recover: step 2 uses the renderer', JSON.stringify(r2));
  else ok(`recover: step 2 (browser) handles a JS-only page (method=${r2.method})`);

  const r3 = await recoverEmptyPage(
    { url: 'https://x.test/spa', html: jsOnly },
    { measure: measureNormalize, allowBrowser: false },
  );
  if (r3.recovered) fail('recover: no browser -> not recovered', 'reported recovered without allowBrowser');
  else ok('recover: JS-only page without allowBrowser stays unrecovered (caller flags it)');

  // 5. Real saved fixtures: plain normalize is empty, recovery makes them rich.
  let fixtureFiles: string[] = [];
  try {
    fixtureFiles = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.html'));
  } catch {
    fail('js-pages fixtures present', `cannot read ${FIXTURE_DIR}`);
  }
  if (fixtureFiles.length === 0) fail('js-pages fixtures present', 'no *.html in tests/fixtures/js-pages');
  for (const f of fixtureFiles) {
    const raw = readFileSync(join(FIXTURE_DIR, f), 'utf8');
    const before = normalize(raw).length;
    const rec = await recoverEmptyPage({ url: `https://energyandhousing.wi.gov/${f}`, html: raw }, { measure: measureNormalize });
    const beforeS = renderStructured(raw).length;
    const recS = await recoverEmptyPage({ url: `https://energyandhousing.wi.gov/${f}`, html: raw }, { measure: measureStructured });
    if (before > 50) fail(`${f}: plain normalize is empty`, `${before} chars`);
    else if (!rec.recovered || rec.textLength < 500) fail(`${f}: recovered via normalize`, JSON.stringify({ m: rec.method, n: rec.textLength }));
    else if (!recS.recovered || recS.textLength < 500) fail(`${f}: recovered via renderStructured`, JSON.stringify({ m: recS.method, n: recS.textLength }));
    else ok(`${f}: normalize ${before}->${rec.textLength}, structured ${beforeS}->${recS.textLength} (method=${rec.method})`);
  }

  // 6. WHEAP income figures survive into the structured render of the real page.
  const wheap = fixtureFiles.find((f) => f.includes('energy-assistance'));
  if (wheap) {
    const rec = await recoverEmptyPage(
      { url: 'https://energyandhousing.wi.gov/x', html: readFileSync(join(FIXTURE_DIR, wheap), 'utf8') },
      { measure: measureStructured },
    );
    const s = renderStructured(rec.html);
    const hasTable = s.includes('columns:') && /household size/i.test(s);
    const hasFigure = /\$3[0-9],[0-9]{3}/.test(s);
    if (!hasTable || !hasFigure) fail('WHEAP table + a dollar figure present after recovery', JSON.stringify({ hasTable, hasFigure }));
    else ok('WHEAP income table (with column headers + a $ figure) present after recovery');
  }

  if (failures.length > 0) {
    console.error(`\nrender-fallback self-test FAILED: ${failures.length} assertion(s)`);
    return 1;
  }
  console.log(
    `\nrender-fallback self-test OK: shell-unwrap recovers the ASP.NET/SharePoint form wrapper, ` +
      `table + heading structure survives it, the browser step is reached only with --allow-browser ` +
      `and degrades cleanly, and the real energyandhousing.wi.gov fixtures go from 0 to real ` +
      `eligibility text. No network, no browser, no model.`,
  );
  return 0;
}

async function browserCheck(): Promise<number> {
  console.log('render-fallback --browser-check: attempting a real headless Chromium render (setContent, no network)...');
  // A genuinely JS-dependent page: the body is empty until the script runs, so
  // only a real browser render (not the deterministic unwrap) can recover it.
  const html =
    '<!doctype html><html><body><div id="root"></div><script>' +
    'document.getElementById("root").innerHTML=' +
    '\'<main><h1>Rendered</h1><p>\' + "hydrated eligibility copy ".repeat(20) + \'</p></main>\';' +
    '</script></body></html>';
  const outcome = await renderStaticHtml(html);
  if (!outcome.ok) {
    console.log(`  SKIPPED: ${outcome.reason}`);
    console.log('  (this is a pass -- the browser step is designed to degrade when Chromium is absent)');
    return 0;
  }
  const rec = await recoverEmptyPage(
    { url: 'about:blank', html },
    { measure: measureNormalize, allowBrowser: true, renderer: { render: async () => outcome } },
  );
  if (!rec.recovered) {
    console.error('  FAIL: browser produced a DOM but recovery did not lift it above the threshold');
    return 1;
  }
  console.log(`  ok: rendered + recovered (${rec.method}, ${rec.textLength} chars). Playwright wiring works on this platform.`);
  return 0;
}

async function demo(path: string, url: string | undefined, allowBrowser: boolean): Promise<number> {
  const raw = readFileSync(path, 'utf8');
  const target = url ?? 'https://example.test/page';
  console.log(`# ${path}`);
  console.log(`plain fetch:        normalize=${normalize(raw).length}  renderStructured=${renderStructured(raw).length}`);
  const renderer: BrowserRenderer | undefined = allowBrowser ? playwrightRenderer() : undefined;
  const rec = await recoverEmptyPage(
    { url: target, html: raw },
    { measure: measureNormalize, allowBrowser, ...(renderer ? { renderer } : {}) },
  );
  console.log(`after recovery:     normalize=${rec.textLength}  method=${rec.method}`);
  console.log(`note:              ${rec.note}`);
  console.log('\n--- first 1200 chars of recovered normalized text ---');
  console.log(normalize(rec.html).slice(0, 1200));
  return 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) return selfTest();
  if (args.browserCheck) return browserCheck();
  if (args.demoPath) return demo(args.demoPath, args.demoUrl, args.allowBrowser);
  console.log('nothing to do. Pass --self-test, --browser-check, or --demo=<path.html> [--url=<u>] [--allow-browser].');
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolvePath(fileURLToPath(import.meta.url)) === resolvePath(process.argv[1]);
if (invokedDirectly) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error('render-fallback crashed:', err);
      process.exitCode = 1;
    });
}
